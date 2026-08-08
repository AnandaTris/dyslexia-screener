import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { roleOf, STUDENT } from "../../lib/roles";
import ChangePasswordForm from "./ChangePasswordForm";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Students have exactly one place to go back to; therapists have the hub.
  const backHref = roleOf(user) === STUDENT ? "/my-journey" : "/dashboard";

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead-main">
          <h1>Your account</h1>
          <span className="tagline">{user.email}</span>
        </div>
        <div className="user-bar">
          <Link className="nav-link" href={backHref}>
            Back
          </Link>
        </div>
      </header>

      <section className="dash-card dash-card-static">
        <h2>Change your password</h2>
        <ChangePasswordForm />
      </section>
    </main>
  );
}
