import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { loadActiveJourney, progressFor } from "../../lib/journey";
import { DISPLAYED_MESSAGES, loadRecentMessages } from "../../lib/chat";
import { signout } from "../login/actions";
import ChatAssistant from "./ChatAssistant";

const PROFILE_LABELS = {
  phonological: "Phonological (sound–symbol)",
  surface: "Surface (whole-word memory)",
  visual_spatial: "Visual-spatial (letter formation)",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profileRow } = await supabase
    .from("learner_profiles")
    .select("profile")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = profileRow?.profile ?? null;

  // Progress summary for the hub card, read through the same helper /journey
  // uses. A narrower status-only query would save a few bytes, but it would be a
  // second definition of "your active journey" — and two definitions are how the
  // card and the board start disagreeing.
  const journey = await loadActiveJourney(supabase, user.id);
  const progress = progressFor(journey?.steps);

  const messages = await loadRecentMessages(supabase, user.id, DISPLAYED_MESSAGES);

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead-main">
          <h1>Your dashboard</h1>
          <span className="tagline">
            Screen writing, then get a grounded learning assistant
          </span>
        </div>
        <div className="user-bar">
          <span className="user-email">{user.email}</span>
          <form action={signout}>
            <button type="submit" className="btn btn-ghost">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="dash-grid">
        <Link href="/" className="dash-card">
          <h2>Writing screener</h2>
          <p>
            Upload a handwriting sample and flag dyslexia-associated patterns.
          </p>
        </Link>

        <Link href="/journey" className="dash-card">
          <h2>My learning journey</h2>
          {journey ? (
            <>
              <p>
                {progress.done} of {progress.total} steps done — {progress.percent}%
                complete.
              </p>
              <div
                className="progress-bar"
                role="img"
                aria-label={`${progress.percent}% complete`}
              >
                <div
                  className="progress-fill"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </>
          ) : (
            <p>Build a cited, step-by-step plan from your screening profile.</p>
          )}
        </Link>

        <Link href="/analysis" className="dash-card">
          <h2>Error pattern analyser</h2>
          <p>
            Paste a writing sample and break its spelling errors into
            phonological, orthographic, morphological and visual patterns.
          </p>
        </Link>

        <section className="dash-card dash-card-static">
          <h2>Your profile</h2>
          {profile ? (
            <p>
              Emphasis:{" "}
              <strong>
                {PROFILE_LABELS[profile.primary_label] ?? profile.primary_label}
              </strong>
              . The assistant tailors answers to this.
            </p>
          ) : (
            <p>
              Run a screening first — your learning profile is derived from it.
            </p>
          )}
        </section>
      </div>

      <section className="assistant-panel" aria-label="Learning assistant">
        <h2>Learning assistant</h2>
        <p className="assistant-note">
          Answers are grounded in the uploaded dyslexia resources, with
          citations. Not a diagnosis.
        </p>
        <ChatAssistant initialMessages={messages} />
      </section>
    </main>
  );
}
