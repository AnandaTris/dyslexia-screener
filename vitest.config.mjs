import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Everything under test is server-side: server actions, route handlers and
    // the collaborations between them. None of it touches the DOM, so the node
    // environment is the honest one — a jsdom global would only hide an
    // accidental browser dependency.
    environment: "node",
    // Two conventions live side by side: tests colocated with their source
    // (lib/ragService.test.js) and the test-plan suites under tests/. This
    // pattern picks up both, so neither set can go quietly unrun.
    include: ["**/*.test.js"],
    exclude: ["node_modules/**", ".next/**"],
    // Route handlers read process.env at request time; the suites set what they
    // need themselves so a developer's real .env.local cannot change a result.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
});
