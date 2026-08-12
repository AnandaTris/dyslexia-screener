const isDev = process.env.NODE_ENV === "development";

// The browser talks to exactly one third party: the Supabase project, for auth
// and every table read. Everything else — Gemini, the RAG service, Ollama — is
// reached from the server, so none of it belongs in a *browser* policy.
//
// Derived rather than hardcoded so a project move updates the policy with it. An
// unset value yields an empty list instead of the string "undefined", which
// would be a silently broken source expression.
function supabaseOrigins() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return [];
  try {
    const { origin } = new URL(url);
    // Realtime opens a WebSocket to the same host on wss://.
    return [origin, origin.replace(/^https:/, "wss:")];
  } catch {
    return [];
  }
}

// Note on `script-src 'unsafe-inline'`: the App Router streams its RSC payload
// through inline <script> tags, so a policy without it renders a blank page. The
// alternative is a per-request nonce set in middleware, which is stricter but
// forces every route to render dynamically — it would cost `/` and `/analysis`
// their static prerender. That trade is worth revisiting if this app ever takes
// untrusted HTML; today every string it renders is its own or Supabase's.
//
// `'unsafe-eval'` is development-only: webpack's hot reloader evals module code.
// It is absent from the production policy.
function contentSecurityPolicy() {
  const supabase = supabaseOrigins();

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    // styled-jsx and Next's critical-CSS inlining both emit <style> elements.
    "style-src 'self' 'unsafe-inline'",
    // blob: is the upload preview in app/page.jsx; data: covers inlined icons.
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    ["connect-src 'self'", ...supabase].join(" "),
    // No <object>/<embed> anywhere, and PDFs render in the browser's own viewer.
    "object-src 'none'",
    // Stops an injected <base> from re-pointing every relative URL.
    "base-uri 'self'",
    // Server actions post to this origin only.
    "form-action 'self'",
    // The modern frame-ancestors; X-Frame-Options below covers older browsers.
    "frame-ancestors 'none'",
    // Harmless over http, and stops a stray http:// asset breaking the page once
    // the app is served over TLS.
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy(),
  },
  {
    // Redundant with frame-ancestors for current browsers, kept for old ones.
    // Clickjacking matters here because the screener and the student pages are
    // both single-click destructive-ish actions behind an authenticated session.
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    // Stops a browser second-guessing a Content-Type — the upload path accepts
    // files from outside and hands some of them back.
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Same-origin keeps the full URL internal but sends only the origin
    // outbound, so a student id in a path never leaves in a Referer header.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // Nothing here uses a camera, microphone or location. Denying them means an
    // injected script cannot prompt for them either.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

// HSTS is deliberately production-only. On http://localhost it is ignored, but
// pinning it from a dev build that briefly ran on a shared hostname would make
// that hostname https-only for everyone who loaded it, for two years.
if (!isDev) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb"
    }
  },

  // Keep the NLP stack out of the webpack bundle:
  //   - onnxruntime-node loads a native binary at runtime, and bundling it
  //     breaks the require path Transformers.js uses to find it.
  //   - dictionary-en reads its Hunspell .aff/.dic files at import time via
  //     `fs.readFile(new URL(..., import.meta.url))`. Bundled, the URL no
  //     longer resolves against the package directory and the read throws.
  // Left `experimental` and became top-level `serverExternalPackages` in Next 15.
  serverExternalPackages: [
    "onnxruntime-node",
    "@huggingface/transformers",
    "dictionary-en",
    "nspell",
    "cmu-pronouncing-dictionary"
  ],

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  }
};

export default nextConfig;
