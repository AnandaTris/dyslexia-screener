import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { loadStudents, ageFromBirthYear } from "../../lib/students";
import { signout } from "../login/actions";
import AddStudentForm from "./AddStudentForm";

export default async function StudentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const students = await loadStudents(supabase, user.id);

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

      {students.length === 0 ? (
        <p className="empty-state">
          No students yet. Add one below, then run a writing screening for them — the
          journey is built from that screening.
        </p>
      ) : (
        <ul className="student-list">
          {students.map((s) => {
            const age = ageFromBirthYear(s.birth_year);
            return (
              <li key={s.id}>
                <Link href={`/students/${s.id}`} className="dash-card">
                  <h2>{s.display_name}</h2>
                  <p>
                    {age === null
                      ? "No year of birth recorded"
                      : `Born ${s.birth_year} · about ${age}`}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <section className="dash-card dash-card-static">
        <h2>Add a student</h2>
        <AddStudentForm />
      </section>
    </main>
  );
}
