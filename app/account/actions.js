"use server";

import { createClient } from "../../lib/supabase/server";
import { INITIAL_PASSWORD, MIN_PASSWORD_LENGTH } from "../../lib/studentAuth";

// Serves both roles. updateUser acts on whichever session is present, so this
// needs no admin client and no role check — a therapist changing their own
// password takes exactly the same path.
export async function changePassword(formData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password !== confirm) {
    return { error: "Those two passwords don't match." };
  }
  // Without this, "changing" the password to the one printed on every student
  // page would count as a change.
  if (password === INITIAL_PASSWORD) {
    return { error: "Pick something other than the starting password." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Could not change your password." };

  return { ok: "Password changed. Use the new one next time you sign in." };
}
