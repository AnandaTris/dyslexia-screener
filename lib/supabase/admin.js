import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client holding the SERVICE-ROLE key. It BYPASSES EVERY RLS POLICY.
 *
 * This is the only module in the app that reads SUPABASE_SERVICE_ROLE_KEY, and
 * it must stay that way. Import it from server actions only — never from a
 * client component, never from anything that ends up in the browser bundle.
 *
 * It exists for exactly one reason: creating and updating an auth user on
 * someone else's behalf needs the admin API, and the admin API needs this key.
 * Everything else in the app goes through lib/supabase/server.js, which runs as
 * the signed-in user and is subject to RLS.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Throw rather than build a half-configured client: that client fails later
  // with an opaque 401 from the auth API, which reads like a code bug instead
  // of a missing line in .env.
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set — see .env.example.");
  }
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set, so student logins cannot be " +
        "issued. Copy it from rag-service/.env into the root .env — see .env.example."
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
