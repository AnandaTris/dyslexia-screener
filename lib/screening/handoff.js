/**
 * Carries a screened sample from the screener to the error pattern analyser.
 *
 * The two pages are separate routes with separate state, so sending an educator
 * from one to the other used to mean re-typing the transcription by hand into an
 * empty textarea. This module is the bridge.
 *
 * It uses sessionStorage rather than a query string deliberately. The payload is
 * a child's writing, and a query string would put that text in the address bar,
 * in browser history, and in the referrer of anything the analyser page later
 * requests. sessionStorage keeps it in the tab, and the handoff is read once and
 * erased, so a later visit to the analyser starts empty instead of silently
 * re-filling with someone else's sample.
 */

const HANDOFF_KEY = "dyslexia-screener:handoff";

/**
 * sessionStorage is not always there to be written to: it throws in Safari's
 * private browsing when the quota is zero, and it is absent entirely during
 * server rendering. A failed handoff is not worth breaking navigation over —
 * the educator lands on the analyser with an empty box, which is exactly where
 * they were before this existed.
 */
function safeStorage() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Stores the sample for the analyser page to pick up. Returns true when the
 * text was actually stashed, so the caller can tell the user to paste manually
 * rather than promising a handoff that did not happen.
 */
export function stashHandoff({ text, writerAge, studentId } = {}) {
  const storage = safeStorage();
  if (!storage) return false;
  if (typeof text !== "string" || text.trim() === "") return false;

  try {
    storage.setItem(
      HANDOFF_KEY,
      // studentId rides along so the analyser can pre-select the child the
      // screening was just filed against. Without it the educator picks the
      // same student twice in a row, and a mis-pick files one learner's errors
      // onto another's trend line.
      JSON.stringify({ text, writerAge: writerAge ?? null, studentId: studentId ?? null })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and clears the pending handoff. Returns null when there is none, when
 * storage is unavailable, or when the stored value is not the shape we wrote —
 * a stale or hand-edited entry should leave the page empty, not crash it.
 */
export function takeHandoff() {
  const storage = safeStorage();
  if (!storage) return null;

  let raw;
  try {
    raw = storage.getItem(HANDOFF_KEY);
    // Cleared before parsing, so a malformed entry cannot wedge every future
    // visit to the analyser.
    storage.removeItem(HANDOFF_KEY);
  } catch {
    return null;
  }

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.text !== "string" || parsed.text.trim() === "") {
      return null;
    }
    const age = Number(parsed.writerAge);
    return {
      text: parsed.text,
      writerAge: Number.isFinite(age) && age > 0 ? age : null,
      // Absent on entries written before this field existed, so it is read
      // defensively rather than assumed — a stale handoff should pre-select
      // nobody, not crash the picker.
      studentId: typeof parsed.studentId === "string" ? parsed.studentId : null,
    };
  } catch {
    return null;
  }
}
