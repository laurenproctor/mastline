import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { COMMERCIAL_OPPORTUNITIES, getCommercialOpportunity } from "@/lib/commercial-opportunities";
import { OpportunityReview } from "../_components/opportunity-review";

export function generateStaticParams() {
  return COMMERCIAL_OPPORTUNITIES.map((opportunity) => ({ opportunityId: opportunity.id }));
}

export default async function CommercialOpportunityReviewPage({
  params,
}: {
  params: Promise<{ opportunityId: string }>;
}) {
  const { opportunityId } = await params;
  const opportunity = getCommercialOpportunity(opportunityId);
  if (!opportunity) notFound();

  return (
    <AppShell active="Commercial">
      <div className="page commercial-review-page">
        <OpportunityReview opportunity={opportunity} />
      </div>
    </AppShell>
  );
}
