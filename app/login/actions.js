"use server";

import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";

// Supabase returns terse, sometimes cryptic auth errors ("email rate limit
// exceeded"). Translate the ones users actually hit into something actionable.
function friendlyMessage(error) {
  const code = error.code ?? "";

  if (code === "over_email_send_rate_limit" || /rate limit/i.test(error.message)) {
    return "Too many confirmation emails have been sent from this project. Wait about an hour, or sign in with an account you already created.";
  }

  switch (code) {
    case "email_not_confirmed":
      return "Check your inbox and confirm your email address before signing in.";
    case "invalid_credentials":
      return "That email and password don't match an account. Create one first if you haven't.";
    case "user_already_exists":
      return "That email is already registered. Sign in instead.";
    case "weak_password":
      return "Password is too weak — use at least 6 characters.";
    default:
      return error.message;
  }
}

function failWith(error) {
  redirect(`/login?error=${encodeURIComponent(friendlyMessage(error))}`);
}

export async function login(formData) {
  const supabase = await createClient();

  const email = formData.get("email");
  const password = formData.get("password");

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    failWith(error);
  }

  redirect("/");
}

export async function signup(formData) {
  const supabase = await createClient();

  const email = formData.get("email");
  const password = formData.get("password");

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    failWith(error);
  }

  // With email confirmation on, signing up an address that already exists
  // succeeds silently and re-sends the confirmation mail — which is how the
  // send quota gets burned. An empty identities array is the only tell.
  if (data.user && data.user.identities?.length === 0) {
    redirect(
      `/login?error=${encodeURIComponent(
        "That email is already registered. Sign in instead."
      )}`
    );
  }

  // A session here means email confirmation is switched off, so the user is
  // already signed in and no mail was sent.
  if (data.session) {
    redirect("/");
  }

  redirect(
    `/login?message=${encodeURIComponent(
      "Account created. Check your inbox for the confirmation link, then sign in."
    )}`
  );
}

export async function signout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
