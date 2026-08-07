import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { roleOf, STUDENT } from "./lib/roles";

// Everything a student account may reach. An ALLOWLIST on purpose: a therapist
// route added later is closed to students automatically, whereas a denylist
// leaks every route until somebody remembers to add it.
const STUDENT_PATHS = ["/my-journey", "/account", "/login", "/api/journey/step"];

function allowedForStudent(pathname) {
  return STUDENT_PATHS.some(
    (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`)
  );
}

// Refreshes the Supabase auth session on every request and redirects
// unauthenticated users to /login (except for the login page itself and
// static assets, which are excluded by the matcher below).
export async function middleware(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() refreshes the session token when needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLoginPage = pathname.startsWith("/login") || pathname.startsWith("/signup");
  const isApiRoute = pathname.startsWith("/api/");

  if (!user && !isLoginPage) {
    // Redirecting an API request sends the caller an HTML login page, which
    // blows up on res.json(). Answer with JSON so the client can show the
    // real reason — typically a session that expired with the page open.
    if (isApiRoute) {
      return NextResponse.json(
        { error: "Your session expired. Please sign in again." },
        { status: 401 }
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    // Role-aware so a student does not bounce /login -> /dashboard -> /my-journey.
    const url = request.nextUrl.clone();
    url.pathname = roleOf(user) === STUDENT ? "/my-journey" : "/dashboard";
    return NextResponse.redirect(url);
  }

  if (user) {
    const student = roleOf(user) === STUDENT;

    if (student && !allowedForStudent(pathname)) {
      // Same reasoning as the 401 above: JourneyBoard.jsx calls res.json()
      // before checking res.ok, so HTML here surfaces a parser error instead of
      // the real reason.
      if (isApiRoute) {
        return NextResponse.json(
          { error: "That is not available on a student account." },
          { status: 403 }
        );
      }

      const url = request.nextUrl.clone();
      url.pathname = "/my-journey";
      return NextResponse.redirect(url);
    }

    // A therapist has no student record, so /my-journey would render an error
    // for them. Send them where their work actually is.
    if (!student && pathname.startsWith("/my-journey")) {
      const url = request.nextUrl.clone();
      url.pathname = "/students";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Run on all paths except static files and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
