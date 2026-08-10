import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const created = vi.hoisted(() => ({ calls: [] }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (url, key, options) => {
    created.calls.push({ url, key, options });
    return { marker: "admin-client" };
  },
}));

import { createAdminClient } from "./admin.js";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  created.calls = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("createAdminClient", () => {
  it("builds a client from the service-role key", () => {
    expect(createAdminClient()).toEqual({ marker: "admin-client" });
    expect(created.calls[0].url).toBe("https://project.supabase.co");
    expect(created.calls[0].key).toBe("service-role-key");
  });

  it("never persists or refreshes a session", () => {
    // This client is built per request on the server and must not try to store
    // a session; doing so would leak service-role state across requests.
    createAdminClient();
    expect(created.calls[0].options.auth).toEqual({
      autoRefreshToken: false,
      persistSession: false,
    });
  });

  it("throws a message naming the variable when the key is missing", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    // Throwing beats returning a client built with an undefined key: that
    // client fails later with an opaque 401 from the auth API.
    expect(() => createAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(created.calls).toHaveLength(0);
  });

  it("throws when the project URL is missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => createAdminClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
