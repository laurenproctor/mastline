import Image from "next/image";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Reset your password — Mastline" };

export default function ResetPasswordPage() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Image alt="Mastline" height={30} priority src="/mastline-wordmark.png" width={174} />
        <h1>Reset your password</h1>
        <p className="section-note">
          Enter the address you signed up with and we will send you a link.
        </p>
        <div className="spacer" />
        <ResetForm />
      </div>
      <aside className="auth-aside">
        <div className="eyebrow">Your work is safe</div>
        <p className="section-note">
          Resetting a password does not touch anything in your workspace. Shoots, assets,
          submissions, and financial records are unaffected.
        </p>
      </aside>
    </main>
  );
}
