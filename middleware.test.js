/**
 * The application's only auth boundary.
 *
 * Every route handler under app/api re-checks the user itself, but the pages do
 * not: app/dashboard, app/journey and app/analysis render one educator's
 * screening data with nothing between the request and the database except this
 * middleware. A hole here is a data leak, not a cosmetic bug, so the negative
 * cases carry the weight below.
 *
 * tests/integration/it2-login.test.js already covers the plain happy path — a
 * signed-in request to "/" passes through and getUser() is consulted once — and
 * the two bare turn-aways: anonymous "/" redirects, anonymous "/api/analyze"
 * answers 401. None of that is repeated here. What is left uncovered, and what
 * this suite pins, is the login-page branch, the *shape* of the 401 the browser
 * actually parses, the cookie plumbing the session refresh rides on, and the
 * matcher that decides which requests reach the middleware at all.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { value: null },
  // Cookies a real Supabase client rotates onto the response during getUser().
  refreshed: { value: [] },
  // The cookie adapter the middleware hands to createServerClient. Capturing it
  // is the only way to observe either half of the session refresh from outside.
  adapter: { value: null },
}));

// The middleware builds its own client against the request's cookies rather
// than going through lib/supabase/server.js, so @supabase/ssr is the seam.
vi.mock("@supabase/ssr", async () => {
  const { fakeSupabase } = await import("./tests/support/queryBuilder.js");

  return {
    createServerClient(_url, _key, options) {
      mocks.adapter.value = options.cookies;
      const client = fakeSupabase({ user: mocks.user.value });

      return {
        ...client,
        auth: {
          // The shared double answers getUser() but knows nothing about cookies.
          // A real client writes the rotated tokens back through the adapter
          // from inside this call, and that write is what drives the
          // middleware's setAll branch, so the double does the same.
          async getUser() {
            if (mocks.refreshed.value.length > 0) {
              options.cookies.setAll(mocks.refreshed.value);
            }
            return client.auth.getUser();
          },
        },
      };
    },
  };
});

const { config, middleware } = await import("./middleware.js");
const { NextRequest } = await import("next/server");

const SIGNED_IN = { id: "user-1", email: "teacher@school.edu" };

beforeEach(() => {
  mocks.user.value = null;
  mocks.refreshed.value = [];
  mocks.adapter.value = null;
});

function request(pathname, { cookie } = {}) {
  return new NextRequest(`http://localhost:3000${pathname}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("the login and signup pages", () => {
  it("send a signed-in visitor on to /dashboard", async () => {
    mocks.user.value = SIGNED_IN;

    // Both paths, because they share one `isLoginPage` test — losing /signup
    // from it would leave a signed-in user able to register a second account
    // over the top of their live session.
    for (const pathname of ["/login", "/signup"]) {
      const response = await middleware(request(pathname));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")).pathname).toBe("/dashboard");
    }
  });

  it("stay reachable while signed out", async () => {
    // The exemption that makes signing in possible at all: without it the
    // redirect to /login is itself redirected to /login, forever.
    for (const pathname of ["/login", "/signup"]) {
      const response = await middleware(request(pathname));

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
  });
});

describe("an anonymous request", () => {
  it("never reaches a page that renders someone's screening data", async () => {
    const response = await middleware(request("/dashboard"));
    const location = new URL(response.headers.get("location"));

    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/login");
    // Same origin: a redirect rebuilt from an attacker-controlled Host or
    // X-Forwarded-Host would send the visitor off-site to type a password.
    expect(location.origin).toBe("http://localhost:3000");
  });

  it("gets a parseable JSON 401 from an API route, not a login page", async () => {
    // JourneyBoard.jsx and ChatAssistant.jsx call res.json() before looking at
    // res.ok and then render data.error. HTML here throws a parser message in
    // the browser and the real reason — an expired session — never surfaces.
    // The nested path also pins that the check is a prefix, not an exact match.
    const response = await middleware(request("/api/journey/step"));

    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = await response.json();
    expect(body.error).toMatch(/sign in/i);
  });
});

describe("the session refresh", () => {
  it("reads the session from the request's own cookies", async () => {
    mocks.user.value = SIGNED_IN;

    await middleware(
      request("/dashboard", { cookie: "sb-auth-token=stored-session; theme=dark" })
    );

    // Middleware runs before the request reaches the app, where next/headers'
    // cookies() is unavailable. If this jar were ever wired to anything but the
    // incoming request, every signed-in user would read as anonymous and the
    // whole app would bounce to /login.
    const seen = mocks.adapter.value.getAll().map((c) => [c.name, c.value]);
    expect(Object.fromEntries(seen)).toEqual({
      "sb-auth-token": "stored-session",
      theme: "dark",
    });
  });

  it("carries a rotated token to both the browser and the app in one pass", async () => {
    mocks.user.value = SIGNED_IN;
    mocks.refreshed.value = [
      { name: "sb-auth-token", value: "rotated", options: { httpOnly: true, path: "/" } },
    ];

    const incoming = request("/dashboard", { cookie: "sb-auth-token=expiring" });
    const response = await middleware(incoming);

    // Browser half. Supabase rotates the refresh token on use, so a response
    // that omits Set-Cookie strands the browser holding a token that has
    // already been spent — the user is signed out mid-session.
    expect(response.cookies.get("sb-auth-token")).toMatchObject({
      value: "rotated",
      httpOnly: true,
    });

    // App half. The server components rendered by this same request read the
    // forwarded request cookies, so the new token has to be written there too
    // or the page renders as though the visitor were signed out.
    expect(incoming.cookies.get("sb-auth-token").value).toBe("rotated");
  });
});

describe("the matcher", () => {
  it("covers pages and API routes while skipping static assets", () => {
    // Next compiles this with path-to-regexp, but the pattern contains no
    // path-to-regexp tokens, so an anchored RegExp agrees with it on these
    // paths. Worth pinning: a careless exclusion added here silently removes
    // the auth check from a whole route tree without touching any logic above.
    const matches = (pathname) => new RegExp(`^${config.matcher[0]}$`).test(pathname);

    expect(matches("/dashboard")).toBe(true);
    expect(matches("/api/journey")).toBe(true);
    // /login has to run too, otherwise the signed-in bounce above never fires.
    expect(matches("/login")).toBe(true);
    expect(matches("/_next/static/chunks/main.js")).toBe(false);
    expect(matches("/logo.png")).toBe(false);
  });
});
