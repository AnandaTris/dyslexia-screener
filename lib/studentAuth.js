// Shared constants and validation for student logins.
//
// Lives outside app/students/actions.js because that file is "use server",
// which may export only async functions — and the page has to display the
// password to the therapist who will pass it on.

// Chosen by the user. Every student starts here and changes it from /account.
// Supabase's default minimum is 6 characters; "12345" is rejected outright.
export const INITIAL_PASSWORD = "123456";
export const MIN_PASSWORD_LENGTH = 6;

// Deliberately loose. This catches the typos a therapist makes in a hurry; the
// real check is that Supabase accepts the address when the account is created.
// A stricter pattern would reject valid addresses and teach nobody anything.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

export function isValidEmail(value) {
  return EMAIL.test(value);
}
