import Link from "next/link";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in — Mastline" };

/**
 * Signing in is a utility, not a pitch: somebody here has already decided. The
 * screen carries what a returning photographer needs and nothing that competes
 * with the form -- a way out of a forgotten password, a way out of a wrong
 * account, and the assurance that what they left is where they left it.
 *
 * The seeded credentials are shown only outside production. They were on the
 * live sign-in page: a real password and the naming convention for six accounts
 * published to anyone who looked. Production is never seeded
 * (docs/DEPLOY.md), so nothing was open, but the day it is seeded the page
 * would have handed over an owner account.
 */
const seeded = process.env.NODE_ENV !== "production";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="gate-main" id="main">
      <div className="gate-lead">
        <span className="mk-eyebrow">Sign in</span>
        <h1>Back to work.</h1>
        <p className="lede">
          Every shoot, submission and dollar is where you left it, private to you and the people you
          invited.
        </p>
      </div>

      <div className="gate-panel">
        <SignInForm next={next ?? "/work"} />
      </div>

      <div className="gate-support">
        <h2 className="gate-support-head">Trouble getting in?</h2>
        <ul className="gate-outs">
          <li>
            <Link href="/reset-password">Reset your password</Link> — a link to the address you
            signed up with. It works once, and touches nothing in the workspace.
          </li>
          <li>
            Still stuck? <a href="mailto:support@mastline.co">support@mastline.co</a>.
          </li>
        </ul>
        {seeded && (
          <div className="gate-seed">
            <span className="mk-eyebrow">Local development</span>
            <p>
              The seeded workspace signs in as <code>marcus@mastline.test</code> with the password{" "}
              <code>mastline-dev-password</code>. The other seeded roles use the same password:{" "}
              <code>jordan@</code> (editor), <code>dana@</code> (dispatcher), <code>felix@</code>{" "}
              (finance), <code>rhea@</code> (rights), <code>vera@</code> (viewer).
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
