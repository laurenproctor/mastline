import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/primitives";
import { COMMERCIAL_OPPORTUNITIES } from "@/lib/commercial-opportunities";
import { CommercialQueue } from "./_components/commercial-queue";

export default async function CommercialOpportunitiesPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: workspaceSlug } = await params;
  return (
    <AppShell active="Commercial" workspace={workspaceSlug}>
      <div className="page commercial-page">
        <PageHeader
          description="Review detected fashion moments and decide where each asset can earn next. Every match is suggested, explained, and confirmed by a person."
          eyebrow="Commercial desk · prototype data"
          title="Commercial opportunities"
        />
        <CommercialQueue opportunities={COMMERCIAL_OPPORTUNITIES} />
      </div>
    </AppShell>
  );
}
