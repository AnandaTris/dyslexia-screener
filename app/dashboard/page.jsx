import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { loadStudentSummaries } from "../../lib/students";
import { DISPLAYED_MESSAGES, loadRecentMessages } from "../../lib/chat";
import { signout } from "../login/actions";
import ChatAssistant from "./ChatAssistant";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // No profile lookup here. A profile belongs to a student, so learner_profiles
  // holds one row per student — the old `.eq("user_id", …).maybeSingle()` would
  // match several rows as soon as a therapist had a second student, and fail.
  const { students, schemaMissing } = await loadStudentSummaries(supabase, user.id);
  const messages = await loadRecentMessages(supabase, user.id, DISPLAYED_MESSAGES);

  const needScreening = students.filter((s) => !s.profile).length;
  const withJourney = students.filter((s) => s.hasJourney).length;

  // The next thing worth doing, so the hub answers "what now?" instead of
  // leaving four equal-weight cards to be guessed between.
  const nextStep = schemaMissing
    ? { href: "/students", label: "Finish the database setup" }
    : students.length === 0
      ? { href: "/students", label: "Add your first student" }
      : needScreening > 0
        ? { href: "/", label: "Screen a writing sample" }
        : withJourney < students.length
          ? { href: "/students", label: "Build a learning journey" }
          : { href: "/students", label: "Review your students" };

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead-main">
          <h1>Your dashboard</h1>
          <span className="tagline">Screen a student, then work their cited journey</span>
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

      <section className="next-step">
        <div>
          <span className="next-step-label">Next step</span>
          <p className="next-step-text">{nextStep.label}</p>
        </div>
        <Link href={nextStep.href} className="btn btn-primary">
          Go
        </Link>
      </section>

      <h2 className="section-heading">How this works</h2>
      <ol className="how-strip">
        <li>
          <span className="how-num">1</span>
          <strong>Add a student</strong>
          <span>They keep their own records.</span>
        </li>
        <li>
          <span className="how-num">2</span>
          <strong>Screen their writing</strong>
          <span>A photo or PDF gives a verdict and a profile.</span>
        </li>
        <li>
          <span className="how-num">3</span>
          <strong>Build their journey</strong>
          <span>Ordered steps, every one citing a source.</span>
        </li>
        <li>
          <span className="how-num">4</span>
          <strong>Track and ask</strong>
          <span>Tick steps off; ask the assistant anything.</span>
        </li>
      </ol>

      <h2 className="section-heading">What you can do</h2>
      <div className="dash-grid">
        <Link href="/students" className="dash-card">
          <h2>My students</h2>
          {schemaMissing ? (
            <p>Database setup is incomplete — open this to see what to run.</p>
          ) : students.length === 0 ? (
            <p>Add your first student, then screen their writing to start a journey.</p>
          ) : (
            <p>
              {students.length === 1 ? "1 student" : `${students.length} students`}
              {needScreening > 0 ? ` · ${needScreening} awaiting a screening` : " · all screened"}
            </p>
          )}
        </Link>

        <Link href="/" className="dash-card">
          <h2>Writing screener</h2>
          <p>
            Upload a handwriting photo or PDF. Flags dyslexia-associated patterns and
            derives the profile the journey is built from.
          </p>
        </Link>

        <Link href="/analysis" className="dash-card">
          <h2>Error pattern analyser</h2>
          <p>
            Paste a writing sample and break its spelling errors into phonological,
            orthographic, morphological and visual patterns.
          </p>
        </Link>

        <section className="dash-card dash-card-static">
          <h2>Learning journeys</h2>
          <p>
            {withJourney === 0
              ? "None built yet. A journey is created from a student's screening profile."
              : `${withJourney} of ${students.length} students have an active journey.`}
          </p>
        </section>
      </div>

      <section className="assistant-panel" aria-label="Learning assistant">
        <h2>Learning assistant</h2>
        <p className="assistant-note">
          Ask about dyslexia patterns and teaching approaches. Answers cover your whole
          caseload, not one student. Either way, it is not a diagnosis.
        </p>
        <ChatAssistant initialMessages={messages} />
      </section>
    </main>
  );
}
