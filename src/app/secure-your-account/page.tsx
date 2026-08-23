import Image from "next/image";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { TwoFactor } from "@/app/settings/_components/two-factor";
import { ACTIVE_WORKSPACE_COOKIE, getSession } from "@/lib/auth";
import { mfaBlocksAccess, mfaStanding } from "@/lib/mfa";

export const metadata = { title: "Secure your account — Mastline" };

/**
 * Where someone lands when their workspace requires a second factor and their
 * account does not have one yet.
 *
 * It reads the session directly rather than through requireSession, which is
 * the thing that redirects here: going through it would be a loop. Anyone who
 * does not need to be here is sent back to their work.
 */
export default async function SecureYourAccountPage() {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value);
  if (!session) redirect("/login");
  if (!session.activeWorkspace) redirect("/onboarding");

  const standing = mfaStanding({
    role: session.activeWorkspace.role,
    hasVerifiedFactor: session.hasVerifiedFactor,
    enforced: session.activeWorkspace.requireMfa,
  });
  if (!mfaBlocksAccess(standing)) redirect("/work");

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Image alt="Mastline" height={30} priority src="/mastline-wordmark.png" width={174} />
        <h1>Secure your account</h1>
        <p className="section-note">
          {session.activeWorkspace.name} requires a second factor for owners and finance. Set one up
          to carry on.
        </p>
        <div className="spacer" />
        <TwoFactor email={session.email} standing={standing} />
      </div>
    </main>
  );
}
