import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { COMMERCIAL_OPPORTUNITIES, getCommercialOpportunity } from "@/lib/commercial-opportunities";
import { workspaceContext } from "@/lib/session-context";
import { OpportunityReview } from "../_components/opportunity-review";

export function generateStaticParams() {
  return COMMERCIAL_OPPORTUNITIES.map((opportunity) => ({ opportunityId: opportunity.id }));
}

export default async function CommercialOpportunityReviewPage({
  params,
}: {
  params: Promise<{ workspace: string; opportunityId: string }>;
}) {
  const { workspace: requestedWorkspace, opportunityId } = await params;
  const { canonicalSlug } = await workspaceContext(requestedWorkspace);
  const workspaceSlug = canonicalSlug;
  const opportunity = getCommercialOpportunity(opportunityId);
  if (!opportunity) notFound();

  return (
    <AppShell active="Commercial" workspace={workspaceSlug}>
      <div className="page commercial-review-page">
        <OpportunityReview workspaceSlug={workspaceSlug} opportunity={opportunity} />
      </div>
    </AppShell>
  );
}
