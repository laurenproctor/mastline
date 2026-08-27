import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { TRIAL_DAYS, TRIAL_PLAN, TRIAL_STORAGE_BYTES, findPlan } from "@/lib/pricing";
import { formatBytes } from "@/lib/subscription";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata = { title: "Set up your workspace — Mastline" };

export default async function OnboardingPage() {
  const session = await requireUser();

  // Somebody who already has a workspace does not need this screen. Named
  // rather than bare: "/work" would have gone back through the cookie.
  if (session.activeWorkspace) {
    redirect(workspaceRoutes(session.activeWorkspace.slug).work());
  }

  const plan = findPlan(TRIAL_PLAN);

  return (
    <OnboardingFlow
      email={session.email}
      suggestedName={session.displayName ? `${session.displayName} Studio` : ""}
      trialLabel={`${TRIAL_DAYS} days on ${plan.name} · ${formatBytes(TRIAL_STORAGE_BYTES)} · no card`}
    />
  );
}
