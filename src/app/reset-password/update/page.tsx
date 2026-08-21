import Image from "next/image";
import { UpdatePasswordForm } from "./update-form";

export const metadata = { title: "Choose a new password — Mastline" };

export default function UpdatePasswordPage() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Image alt="Mastline" height={30} priority src="/mastline-wordmark.png" width={174} />
        <h1>Choose a new password</h1>
        <p className="section-note">
          You followed a reset link, so we know you control the mailbox. Pick something new.
        </p>
        <div className="spacer" />
        <UpdatePasswordForm />
      </div>
      <aside className="auth-aside">
        <div className="eyebrow">One link, once</div>
        <p className="section-note">
          A reset link works a single time and expires shortly. If this page says the link has
          expired, request a fresh one.
        </p>
      </aside>
    </main>
  );
}
