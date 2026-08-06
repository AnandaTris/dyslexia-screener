import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { loadStudents } from "../../lib/students";
import { DISPLAYED_MESSAGES, loadRecentMessages } from "../../lib/chat";
import { signout } from "../login/actions";
import ChatAssistant from "./ChatAssistant";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // No profile lookup here any more. A profile belongs to a student, so
  // `learner_profiles` now holds one row per student — the old
  // `.eq("user_id", …).maybeSingle()` would match several rows the moment a
  // therapist had a second student, and fail. Profiles are shown per student on
  // /students/[id].
  const students = await loadStudents(supabase, user.id);

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

        <Link href="/students" className="dash-card">
          <h2>My students</h2>
          {students.length === 0 ? (
            <p>Add your first student, then screen their writing to start a journey.</p>
          ) : (
            <p>
              {students.length === 1 ? "1 student" : `${students.length} students`} — each
              with their own profile and cited learning journey.
            </p>
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
          <h2>Profiles</h2>
          <p>
            A profile belongs to a student, not to your account. Open a student to see
            their emphasis and the journey built from it.
          </p>
        </section>
      </div>

      <section className="assistant-panel" aria-label="Learning assistant">
        <h2>Learning assistant</h2>
        <p className="assistant-note">
          Choose how it answers below. Either way, it is not a diagnosis.
        </p>
        <ChatAssistant initialMessages={messages} />
      </section>
    </main>
  );
}
