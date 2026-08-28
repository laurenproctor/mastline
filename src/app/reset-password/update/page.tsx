import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasRecoverySession } from "../recovery-session";
import { UpdatePasswordForm } from "./update-form";

export const metadata = { title: "Choose a new password — Mastline" };

/**
 * Nothing reaches this screen except by way of /auth/recovery, which is where
 * the emailed link is spent for a session. The check is repeated here anyway,
 * because the address is guessable and typing it in used to serve a password
 * form to anybody at all -- one that could not work, but that said "a reset
 * link was followed" to somebody who had not followed one.
 *
 * The action behind the form makes the same check for itself. This one is what
 * the person sees; that one is what actually holds, since a form post does not
 * have to come from a rendered page.
 *
 * Redirected rather than rendered as an error so there is only one place that
 * explains a refused link, and it is the place with the form for getting
 * another.
 */
export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  if (!(await hasRecoverySession(supabase))) redirect("/reset-password?link=invalid");

  return (
    <main className="gate-main" id="main">
      <div className="gate-lead">
        <span className="mk-eyebrow">Password</span>
        <h1>Choose a new one.</h1>
        <p className="lede">
          A reset link was followed, which proves control of the mailbox. Choosing a new password
          signs this account out everywhere, on every device, including here.
        </p>
      </div>

      <div className="gate-panel">
        <UpdatePasswordForm />
      </div>
    </main>
  );
}
