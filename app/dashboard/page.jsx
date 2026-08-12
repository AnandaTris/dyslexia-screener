import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { loadStudentSummaries, isSchemaMissing } from "../../lib/students";
import { DISPLAYED_MESSAGES, loadRecentMessages } from "../../lib/chat";
import { summariseCaseload, TREND_COLUMNS } from "../../lib/trends";
import { TrendPill } from "../components/ErrorTrend";
import { Sparkline } from "../components/TrendCharts";
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

  // Every analysis for this therapist in one query, grouped in memory, rather
  // than one query per student. A caseload is small but this page already makes
  // several round trips, and N+1 here would add one per card.
  //
  // RLS scopes these rows to the caller; the explicit user_id filter is the
  // same belt-and-braces lib/students.js applies, and it keeps the query
  // correct if a policy is ever loosened.
  const { data: analysisRows, error: analysesError } = await supabase
    .from("error_analyses")
    .select(`student_id, ${TREND_COLUMNS}`)
    .eq("user_id", user.id)
    .not("student_id", "is", null)
    .order("created_at", { ascending: true });

  const trendsUnavailable = isSchemaMissing(analysesError);

  const rowsByStudent = new Map();
  for (const row of analysisRows ?? []) {
    if (!rowsByStudent.has(row.student_id)) rowsByStudent.set(row.student_id, []);
    rowsByStudent.get(row.student_id).push(row);
  }

  const caseload = summariseCaseload(
    students.map((student) => ({ student, rows: rowsByStudent.get(student.id) ?? [] })),
  );

  // Counts rather than an average. Averaging error rates across children would
  // produce a number that describes nobody and moves whenever the caseload
  // changes; what a therapist can act on is how many need attention.
  const caseloadSummary = [
    `${caseload.withSamples} of ${students.length} ${
      students.length === 1 ? "student has" : "students have"
    } analysed samples.`,
    caseload.withTrend > 0
      ? `${caseload.withTrend} ${caseload.withTrend === 1 ? "has" : "have"} enough for a direction.`
      : "None yet has the three samples a direction needs.",
    caseload.rising > 0
      ? `${caseload.rising} ${caseload.rising === 1 ? "shows" : "show"} errors rising.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

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

      {/* The caseload roll-up sits directly under "next step" because it is the
          only part of this page carrying data rather than navigation — it is
          what makes this a dashboard instead of a menu. */}
      <section className="trend-panel" aria-label="Error trends across your students">
        <h2>Error trends across your caseload</h2>

        {trendsUnavailable ? (
          <>
            <p className="trend-headline">Trends are not set up yet.</p>
            <p className="trend-caveat">
              Run <code>supabase/error_analyses_student.sql</code> in the Supabase
              SQL editor. It adds the column linking an analysed sample to a
              student, which is what these rows group by.
            </p>
          </>
        ) : students.length === 0 ? (
          <p className="trend-caveat">
            No students yet. <Link href="/students">Add one</Link>, then run their
            writing through the analyser to start a trend.
          </p>
        ) : caseload.totalSamples === 0 ? (
          <>
            <p className="trend-headline">No writing samples analysed yet.</p>
            <p className="trend-caveat">
              Every sample run through the{" "}
              <Link href="/analysis">error pattern analyser</Link> adds a point to
              that student&apos;s trend. Three samples are enough to read a
              direction.
            </p>
          </>
        ) : (
          <>
            <p className="trend-headline">{caseloadSummary}</p>
            <div className="caseload-scroll">
              <table className="caseload-table">
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col" className="caseload-num">
                      Samples
                    </th>
                    <th scope="col">Leading error type</th>
                    <th scope="col" className="caseload-num">
                      Per 100 words
                    </th>
                    <th scope="col">Direction</th>
                  </tr>
                </thead>
                <tbody>
                  {caseload.students.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">
                        <Link href={`/students/${row.id}`}>{row.name}</Link>
                      </th>
                      <td className="caseload-num">{row.samples}</td>
                      <td>{row.leading?.label ?? "—"}</td>
                      <td className="caseload-num">{row.errorRate.last ?? "—"}</td>
                      <td>
                        <div className="caseload-direction">
                          <TrendPill
                            direction={row.errorRate.direction}
                            hasTrend={row.hasTrend}
                          />
                          <Sparkline
                            values={row.sparkline}
                            label={`${row.name}: errors per 100 words, oldest first — ${row.sparkline.join(", ")}`}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="trend-caveat" style={{ marginTop: 14 }}>
              Rows where errors are rising come first. These describe submitted
              writing, not the students — a sample can look worse because the
              task was harder.
            </p>
          </>
        )}
      </section>

      <h2 className="section-heading">What you can do</h2>
      <div className="dash-grid">
        <Link href="/students" className="dash-card">
          <h2>My students</h2>
          {schemaMissing ? (
            <p>Database setup is incomplete — open this to see what to run.</p>
          ) : students.length === 0 ? (
            <p>Add your first student, then screen their writing to start a journey.</p>
          ) : (
            // Absorbed from the old static "Learning journeys" card. Both were
            // counting the same caseload from different angles, which made the
            // grid read as four things to do when three of them were one.
            <p>
              {students.length === 1 ? "1 student" : `${students.length} students`}
              {needScreening > 0 ? ` · ${needScreening} awaiting a screening` : " · all screened"}
              {` · ${withJourney} with an active journey`}
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

      </div>

      <section className="assistant-panel" aria-label="Learning assistant">
        <h2>Learning assistant</h2>
        <p className="assistant-note">
          Ask about dyslexia patterns and teaching approaches. Answers cover your whole
          caseload, not one student. Either way, it is not a diagnosis.
        </p>
        <ChatAssistant initialMessages={messages} />
      </section>

      {/* Last, not first. It is onboarding — read once, then in the way of the
          caseload data every visit after that. */}
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
    </main>
  );
}
