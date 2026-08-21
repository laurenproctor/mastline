import Image from "next/image";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Mastline" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Image alt="Mastline" height={30} priority src="/mastline-wordmark.png" width={174} />
        <h1>Sign in</h1>
        <p className="section-note">
          Your workspaces, shoots, submissions, and revenue records are private to you and the
          people you invite.
        </p>
        <div className="spacer" />
        <LoginForm next={next ?? "/work"} />
        <p className="section-note">
          <Link className="text-link" href="/reset-password">
            Forgot your password?
          </Link>
          {" · "}
          <Link className="text-link" href="/signup">
            Create an account
          </Link>
        </p>
      </div>

      <aside className="auth-aside">
        <div className="eyebrow">Local development</div>
        <p className="section-note">
          The seeded workspace signs in as <code>marcus@mastline.test</code> with the password{" "}
          <code>mastline-dev-password</code>. Other seeded roles use the same password:{" "}
          <code>jordan@</code> (editor), <code>dana@</code> (dispatcher), <code>felix@</code>{" "}
          (finance), <code>rhea@</code> (rights), <code>vera@</code> (viewer).
        </p>
        <Link className="text-link" href="/welcome">
          Back to the marketing site
        </Link>
      </aside>
    </main>
  );
}
