import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { loadStudentSummaries, ageFromBirthYear } from "../../lib/students";
import { signout } from "../login/actions";
import AddStudentForm from "./AddStudentForm";

const PROFILE_LABELS = {
  phonological: "Phonological",
  surface: "Surface",
  visual_spatial: "Visual-spatial",
};

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export default async function StudentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { students, schemaMissing } = await loadStudentSummaries(supabase, user.id);

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead-main">
          <h1>Your students</h1>
          <span className="tagline">Each one keeps their own profile and cited journey</span>
        </div>
        <div className="user-bar">
          <Link className="nav-link" href="/dashboard">
            Dashboard
          </Link>
          <span className="user-email">{user.email}</span>
          <form action={signout}>
            <button type="submit" className="btn btn-ghost">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {schemaMissing ? (
        <section className="setup-callout" role="alert">
          <h2>Database not set up yet</h2>
          <p>
            The <code>students</code> table does not exist, so nothing can be saved. Open
            the Supabase dashboard, go to <strong>SQL Editor → New query</strong>, paste
            the contents of <code>supabase/students.sql</code> and run it.
          </p>
          <p className="auth-hint">
            It also backfills the screenings already in the project, so nothing is lost.
          </p>
        </section>
      ) : null}

      {!schemaMissing && students.length === 0 ? (
        <section className="empty-panel">
          <h2>No students yet</h2>
          <p>
            Add your first student below. Then screen a writing sample for them — the
            profile and the learning journey are both built from that screening.
          </p>
        </section>
      ) : null}

      {students.length > 0 && (
        <ul className="student-list">
          {students.map((student) => {
            const age = ageFromBirthYear(student.birth_year);
            const label = student.profile
              ? PROFILE_LABELS[student.profile.primary_label] ?? student.profile.primary_label
              : null;

            return (
              <li key={student.id}>
                <Link href={`/students/${student.id}`} className="student-card">
                  <div className="student-card-head">
                    <span className="student-avatar" aria-hidden="true">
                      {initials(student.display_name)}
                    </span>
                    <div>
                      <h2>{student.display_name}</h2>
                      <p className="student-meta">
                        {age === null ? "Age not recorded" : `About ${age} years old`}
                      </p>
                    </div>
                  </div>

                  <div className="student-card-body">
                    {label ? (
                      <span className="badge badge-profile">{label}</span>
                    ) : (
                      <span className="badge badge-todo">Needs a screening</span>
                    )}

                    {student.hasJourney ? (
                      <>
                        <div
                          className="progress-bar"
                          role="img"
                          aria-label={`Journey ${student.percent}% complete`}
                        >
                          <div
                            className="progress-fill"
                            style={{ width: `${student.percent}%` }}
                          />
                        </div>
                        <p className="student-meta">
                          {student.stepsDone} of {student.stepsTotal} steps done
                        </p>
                      </>
                    ) : (
                      <p className="student-meta">
                        {label ? "No journey built yet" : "Journey starts after a screening"}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <section className="add-student-panel">
        <h2>Add a student</h2>
        <AddStudentForm />
      </section>
    </main>
  );
}
