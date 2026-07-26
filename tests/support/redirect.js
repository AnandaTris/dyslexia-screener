/**
 * A stand-in for `redirect()` from `next/navigation`.
 *
 * The real one never returns: it throws a NEXT_REDIRECT error that Next catches
 * at the framework boundary, which is why `login()` and `signup()` can call it
 * mid-function and rely on nothing after it running. A mock that merely recorded
 * the URL and returned would let execution fall through into branches the real
 * app never reaches, so this throws too.
 */

export class RedirectError extends Error {
  constructor(url) {
    super(`NEXT_REDIRECT: ${url}`);
    this.name = "RedirectError";
    this.url = url;
  }
}

export function redirect(url) {
  throw new RedirectError(url);
}

/**
 * Runs a server action and returns the URL it redirected to, split into its path
 * and query parameters. Fails loudly if the action returns without redirecting —
 * every path through these actions is supposed to end in one.
 */
export async function captureRedirect(action) {
  try {
    await action();
  } catch (err) {
    if (err instanceof RedirectError) {
      const [pathname, query = ""] = err.url.split("?");
      return {
        url: err.url,
        pathname,
        params: Object.fromEntries(new URLSearchParams(query)),
      };
    }
    throw err;
  }

  throw new Error("Expected the action to redirect, but it returned normally.");
}

/** Builds the FormData a server action receives from a submitted `<form>`. */
export function formDataOf(fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.set(key, value);
  }
  return form;
}
