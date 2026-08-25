import Image from "next/image";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { TRIAL_DAYS, TRIAL_PLAN, TRIAL_STORAGE_BYTES, findPlan } from "@/lib/pricing";
import { formatBytes } from "@/lib/subscription";
import { WorkspaceForm } from "./workspace-form";

export const metadata = { title: "Name the workspace — Mastline" };

export default async function OnboardingPage() {
  const session = await requireUser();

  // Somebody who already has a workspace does not need this screen.
  if (session.activeWorkspace) redirect("/work");

  const plan = findPlan(TRIAL_PLAN);

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Image alt="Mastline" height={30} priority src="/mastline-wordmark.png" width={174} />
        <h1>Name the workspace</h1>
        <p className="section-note">
          Every shoot, dispatch and payment lives inside a workspace. Other people can be invited to
          it later.
        </p>
        <div className="spacer" />
        <WorkspaceForm suggestedName={session.displayName ? `${session.displayName} Studio` : ""} />
      </div>

      <aside className="auth-aside">
        <div className="eyebrow">The trial</div>
        <p className="section-note">
          {TRIAL_DAYS} days on <strong>{plan.name}</strong>, {formatBytes(TRIAL_STORAGE_BYTES)} of
          storage, no card.
        </p>
        <p className="section-note">
          Long enough to run a shoot, dispatch it, record the sale, and see the payment arrive —
          which is the whole point.
        </p>
        <p className="section-note">
          Signed in as <strong>{session.email}</strong>.
        </p>
      </aside>
    </main>
  );
}
