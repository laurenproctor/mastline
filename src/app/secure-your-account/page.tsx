import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { TwoFactor } from "@/app/[workspace]/settings/_components/two-factor";
import { ACTIVE_WORKSPACE_COOKIE, getSession } from "@/lib/auth";
import { mfaBlocksAccess, mfaStanding } from "@/lib/mfa";

export const metadata = { title: "Add a second factor — Mastline" };

/**
 * Where someone lands when their workspace requires a second factor and their
 * account does not have one yet.
 *
 * It reads the session directly rather than through requireSession, which is
 * the thing that redirects here: going through it would be a loop.
 *
 * It deliberately does NOT bounce someone away the moment they are protected,
 * which is the obvious thing to write and is wrong. Confirming a factor is a
 * Server Action, and an action re-renders the route it was called from; a
 * redirect at that point navigates away from the panel that is holding the ten
 * recovery codes, which exist in that one render and nowhere else afterwards.
 * The result was an enrolment that worked, opened the workspace, and quietly
 * threw away the only way back from a lost phone. So the page stays put and
 * hands over the way out as a link.
 */
export default async function SecureYourAccountPage() {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value);
  if (!session) redirect("/sign-in");
  if (!session.activeWorkspace) redirect("/onboarding");

  const standing = mfaStanding({
    role: session.activeWorkspace.role,
    hasVerifiedFactor: session.hasVerifiedFactor,
    enforced: session.activeWorkspace.requireMfa,
  });
  const blocked = mfaBlocksAccess(standing);

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Image alt="Mastline" height={30} priority src="/mastline-wordmark.png" width={174} />
        <h1>{blocked ? "Add a second factor" : "The workspace is open"}</h1>
        <p className="section-note">
          {blocked
            ? `${session.activeWorkspace.name} requires a second factor for owners and finance. Adding one unlocks the workspace.`
            : `Your account is protected, so ${session.activeWorkspace.name} is yours to use again.`}
        </p>
        <div className="spacer" />
        <TwoFactor
          workspaceSlug={session.activeWorkspace.slug}
          email={session.email}
          standing={standing}
        />
        {!blocked && (
          <p className="section-note">
            <Link href={`/${session.activeWorkspace.slug}/work`}>Continue to your work</Link>
          </p>
        )}
      </div>
    </main>
  );
}
