import { ResetForm } from "./reset-form";

export const metadata = { title: "Reset your password — Mastline" };

export default function ResetPasswordPage() {
  return (
    <main className="gate-main" id="main">
      <div className="gate-lead">
        <span className="mk-eyebrow">Password</span>
        <h1>Send me a link.</h1>
        <p className="lede">
          Enter the address the account was made with. Resetting a password touches nothing inside
          the workspace: shoots, assets, submissions and financial records are unaffected.
        </p>
      </div>

      <div className="gate-panel">
        <ResetForm />
      </div>
    </main>
  );
}
