import Link from "next/link";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Reset password — Mastline" };

/**
 * Three states, decided by two flags this application sets on itself.
 *
 * `updated=1` is where updatePasswordAction leaves somebody once the password
 * has been changed and every session ended. The confirmation cannot live on the
 * screen with the password form, because that screen requires the recovery
 * session the change deliberately destroys.
 *
 * `link=invalid` is set by /auth/recovery when a link cannot be honoured --
 * expired, already spent, malformed, or belonging to some other kind of flow.
 * One flag rather than a reason code: the answer to all of them is the form on
 * this page, and naming which guess was closest would help somebody probing the
 * endpoint.
 *
 * Both arrive in the address bar, so each decides only whether a fixed sentence
 * is shown, never what it says. Anything else in either parameter is ignored.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string; updated?: string }>;
}) {
  const params = await searchParams;
  const updated = params.updated === "1";
  const refused = params.link === "invalid";

  if (updated) {
    return (
      <main className="gate-main" id="main">
        <div className="gate-lead">
          <span className="mk-eyebrow">Password</span>
          <h1>That is done.</h1>
          <p className="lede">
            The workspace is untouched: shoots, assets, submissions and financial records are
            exactly where they were left.
          </p>
        </div>

        <div className="gate-panel">
          <div className="gate-sent" role="status">
            <h2>Password updated</h2>
            <p className="gate-note">
              Every session on this account has been ended, on this device and any other. Anything
              still signed in with the old password has been signed out.
            </p>
            <Link className="btn primary" href="/sign-in">
              Sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="gate-main" id="main">
      <div className="gate-lead">
        <span className="mk-eyebrow">Password</span>
        <h1>Send me a link.</h1>
        <p className="lede">
          A link goes to the address the account was made with. Resetting a password touches nothing
          inside the workspace: shoots, assets, submissions and financial records are unaffected.
        </p>
      </div>

      <div className="gate-panel">
        {refused && (
          <p className="gate-error" role="alert">
            That reset link cannot be used. Links work once and expire shortly — request a new one
            below.
          </p>
        )}
        <ResetForm />
      </div>
    </main>
  );
}
