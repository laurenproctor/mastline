import { UpdatePasswordForm } from "./update-form";

export const metadata = { title: "Choose a new password — Mastline" };

export default function UpdatePasswordPage() {
  return (
    <main className="gate-main" id="main">
      <div className="gate-lead">
        <span className="mk-eyebrow">Password</span>
        <h1>Choose a new one.</h1>
        <p className="lede">
          You followed a reset link, so the mailbox is yours. A link works a single time and expires
          shortly — if this page says it has expired, ask for a fresh one.
        </p>
      </div>

      <div className="gate-panel">
        <UpdatePasswordForm />
      </div>
    </main>
  );
}
