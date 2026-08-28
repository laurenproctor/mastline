import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/primitives";
import { getWorkQueueDashboard, isWorkQueueFilter } from "@/lib/data/work-queue";
import { formatFullDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { ActiveShoots } from "./_components/active-shoots";
import { AttentionQueue } from "./_components/attention-queue";
import { MoneyReconcile } from "./_components/money-reconcile";
import { NextUp } from "./_components/next-up";
import { RecipientActivity } from "./_components/recipient-activity";

/**
 * The Work Queue: which existing action moves work closest to dispatch, an
 * outcome, or a payment. Everything on it is a view of recorded state --
 * the deterministic ranking in the data layer decides the order, and the
 * screen repeats its reasons rather than inventing its own.
 */
export default async function WorkQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ queue?: string }>;
}) {
  const { workspace: requestedWorkspace } = await params;
  const { queue: requestedFilter } = await searchParams;
  const { session, organizationId, canonicalSlug } = await workspaceContext(requestedWorkspace);
  /*
   * Everything below builds on the address the workspace holds NOW, not the one
   * the request arrived on. A request may land on a retired address, and a link
   * rendered from that would send the next click back through the rename
   * redirect; a slug that was never resolved at all would be a value the
   * browser supplied, sitting in a destination.
   */
  const routes = workspaceRoutes(canonicalSlug);
  const workspaceSlug = canonicalSlug;
  const now = new Date();

  // An unknown value in the query is somebody's typo, not an error page.
  const filter = isWorkQueueFilter(requestedFilter) ? requestedFilter : "all";
  const writable = can(session.activeWorkspace.role, "shoot.write");

  const dashboard = await getWorkQueueDashboard(organizationId, routes);

  return (
    <AppShell active="Work" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          action={writable ? "Import a shoot" : undefined}
          eyebrow={formatFullDate(now.toISOString(), session.activeWorkspace.timezone)}
          href={routes.newShoot()}
          title="Work queue"
        />

        <NextUp item={dashboard.nextUp} now={now} />

        <div className="work-queue-layout">
          <AttentionQueue
            counts={dashboard.counts}
            filter={filter}
            items={dashboard.queue}
            nextUpId={dashboard.nextUp?.id ?? null}
            now={now}
            routes={routes}
          />

          <ActiveShoots
            now={now}
            routes={routes}
            shoots={dashboard.activeShoots}
            writable={writable}
          />

          <RecipientActivity items={dashboard.recipientActivity} now={now} routes={routes} />
        </div>

        <MoneyReconcile money={dashboard.money} routes={routes} />
      </div>
    </AppShell>
  );
}
