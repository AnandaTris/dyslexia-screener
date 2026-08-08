import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { loadStudent, ageFromBirthYear } from "../../../lib/students";
import { loadActiveJourney } from "../../../lib/journey";
import JourneyBoard from "../../journey/JourneyBoard";
import StudentLoginPanel from "../StudentLoginPanel";

const PROFILE_LABELS = {
  phonological: "Phonological (sound–symbol)",
  surface: "Surface (whole-word memory)",
  visual_spatial: "Visual-spatial (letter formation)",
};

export default async function StudentPage({ params }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // loadStudent scopes by therapist_id, so another therapist's id resolves to
  // null and lands here as a 404 rather than an empty-looking page.
  const student = await loadStudent(supabase, user.id, params.id);
  if (!student) notFound();

  const { data: profileRow } = await supabase
    .from("learner_profiles")
    .select("profile")
    .eq("student_id", student.id)
    .maybeSingle();
  const profile = profileRow?.profile ?? null;

  const { data: screenings } = await supabase
    .from("screenings")
    .select("id, verdict, likelihood_score, created_at")
    .eq("student_id", student.id)
    .order("created_at", { ascending: false })
    .limit(5);

  const journey = await loadActiveJourney(supabase, user.id, student.id);
  const age = ageFromBirthYear(student.birth_year);

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead-main">
          <h1>{student.display_name}</h1>
          <span className="tagline">
            {age === null ? "No year of birth recorded" : `Born ${student.birth_year} · about ${age}`}
          </span>
        </div>
        <div className="user-bar">
          <Link className="nav-link" href="/students">
            All students
          </Link>
          <Link className="nav-link" href="/dashboard">
            Dashboard
          </Link>
        </div>
      </header>

      <div className="dash-grid">
        <section className="dash-card dash-card-static">
          <h2>Profile</h2>
          {profile ? (
            <p>
              Emphasis:{" "}
              <strong>
                {PROFILE_LABELS[profile.primary_label] ?? profile.primary_label}
              </strong>
              . The journey is built from this.
            </p>
          ) : (
            <p>
              No profile yet — <Link href="/">run a screening</Link> for {student.display_name}{" "}
              first.
            </p>
          )}
        </section>

        <section className="dash-card dash-card-static">
          <h2>Recent screenings</h2>
          {screenings?.length ? (
            <ul className="screening-list">
              {screenings.map((s) => (
                <li key={s.id}>
                  <strong>{s.verdict ?? "unscored"}</strong>
                  {typeof s.likelihood_score === "number" ? ` · ${s.likelihood_score}` : ""}
                  <span className="screening-date">
                    {new Date(s.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Nothing screened yet.</p>
          )}
        </section>

        <section className="dash-card dash-card-static">
          <h2>Student login</h2>
          <StudentLoginPanel
            studentId={student.id}
            studentName={student.display_name}
            loginEmail={student.login_email ?? null}
          />
        </section>
      </div>

      <section className="assistant-panel" aria-label="Learning journey">
        <h2>Learning journey</h2>
        <JourneyBoard
          initialJourney={journey}
          studentId={student.id}
          studentName={student.display_name}
        />
      </section>
    </main>
  );
}
