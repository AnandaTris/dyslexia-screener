import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { loadActiveJourney } from "../../lib/journey";
import { signout } from "../login/actions";
import JourneyBoard from "./JourneyBoard";

export default async function JourneyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Server-rendered first paint: the board arrives with its steps already in
  // place, so there is no empty flash while a client fetch resolves.
  const journey = await loadActiveJourney(supabase, user.id);

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead-main">
          <h1>My learning journey</h1>
          <span className="tagline">
            Cited steps, chosen for your screening profile
          </span>
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

      <div className="disclaimer-band" role="note">
        <strong>This is a learning aid, not a treatment plan.</strong> Steps are
        drawn only from the resources uploaded to this app, and every one shows
        its source.
      </div>

      <section className="assistant-panel" aria-label="Journey steps">
        <JourneyBoard initialJourney={journey} />
      </section>
    </main>
  );
}
