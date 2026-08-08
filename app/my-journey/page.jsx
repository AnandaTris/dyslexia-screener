import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "../../lib/supabase/server";
import { loadJourneyForStudent } from "../../lib/journey";
import { roleOf, STUDENT } from "../../lib/roles";
import { signout } from "../login/actions";
import JourneyBoard from "../journey/JourneyBoard";

// The only page a student account can reach, along with /account.
export default async function MyJourneyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Middleware already sends therapists away, but a page that renders one
  // learner's plan should not depend on routing alone to decide who sees it.
  if (roleOf(user) !== STUDENT) redirect("/students");

  // RLS ("student reads own record") narrows this to exactly one row.
  const { data: student } = await supabase
    .from("students")
    .select("id, display_name")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!student) {
    // Reachable if the claim was set but the link write did not land. Say what
    // to do rather than showing an empty journey that looks like a bug.
    return (
      <main className="shell">
        <header className="masthead">
          <div className="masthead-main">
            <h1>Your learning journey</h1>
          </div>
        </header>
        <p className="empty-state">
          This account isn&apos;t linked to a student record yet. Ask your
          therapist to set it up.
        </p>
      </main>
    );
  }

  const journey = await loadJourneyForStudent(supabase, student.id);

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead-main">
          <h1>Your learning journey</h1>
          <span className="tagline">Hello, {student.display_name}</span>
        </div>
        <div className="user-bar">
          <Link className="nav-link" href="/account">
            Change password
          </Link>
          <form action={signout}>
            <button type="submit" className="btn btn-ghost">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="assistant-panel" aria-label="Learning journey">
        <JourneyBoard
          initialJourney={journey}
          studentId={student.id}
          studentName={student.display_name}
          canBuild={false}
        />
      </section>
    </main>
  );
}
