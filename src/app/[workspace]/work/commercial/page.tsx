import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/primitives";
import { COMMERCIAL_OPPORTUNITIES } from "@/lib/commercial-opportunities";
import { workspaceContext } from "@/lib/session-context";
import { CommercialQueue } from "./_components/commercial-queue";

export default async function CommercialOpportunitiesPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: requestedWorkspace } = await params;
  // The queue links to a review screen, so it needs the address the workspace
  // holds now rather than the one the request arrived on.
  const { canonicalSlug } = await workspaceContext(requestedWorkspace);
  const workspaceSlug = canonicalSlug;
  return (
    <AppShell active="Commercial" workspace={workspaceSlug}>
      <div className="page commercial-page">
        <PageHeader
          description="Review detected fashion moments and decide where each asset can earn next. Every match is suggested, explained, and confirmed by a person."
          eyebrow="Commercial desk · prototype data"
          title="Commercial opportunities"
        />
        <CommercialQueue workspaceSlug={workspaceSlug} opportunities={COMMERCIAL_OPPORTUNITIES} />
      </div>
    </AppShell>
  );
}
