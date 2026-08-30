import { AppShell } from "@/components/app-shell";
import { TextLink } from "@/components/button";
import { Metric, MetricGroup } from "@/components/dashboard-surfaces";
import { PageHeader } from "@/components/page-header";
import "@/styles/mastline-dashboard-screens.css";
import { type WorkQueueFilter, filterWorkQueue, isWorkQueueFilter } from "@/lib/data/work-queue";
import { loadWorkQueuePage } from "@/lib/data/work-queue-page";
import { formatLongDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { WorkActiveShoots } from "./_components/work-active-shoots";
import { WorkAttentionQueue } from "./_components/work-attention-queue";
import { WorkNextUp } from "./_components/work-next-up";
import { WorkRecentActivity } from "./_components/work-recent-activity";

/**
 * The Work Queue: which existing action moves work closest to dispatch, an
 * outcome, or a payment. Everything on it is a view of recorded state -- the
 * deterministic ranking in the data layer decides the order, and the screen
 * repeats its reasons rather than inventing its own.
 *
 * One load: the eight-call dashboard and the one-call activity feed.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** The request's query, as it arrived, so a filter link can keep the rest. */
function toSearchParams(query: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) params.append(key, entry);
  }
  return params;
}

export default async function WorkQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { workspace: requestedWorkspace } = await params;
  const query = await searchParams;
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
  const requestedFilter = typeof query.queue === "string" ? query.queue : undefined;
  const filter: WorkQueueFilter = isWorkQueueFilter(requestedFilter) ? requestedFilter : "all";
  const writable = can(session.activeWorkspace.role, "shoot.write");

  const { dashboard, activity } = await loadWorkQueuePage(organizationId, routes);
  const rows = filterWorkQueue(dashboard.queue, filter);
  const { counts, pulse } = dashboard;

  return (
    <AppShell active="Work" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          description={
            counts.all === 0
              ? "Nothing needs attention. Every shoot, submission, and payment is up to date."
              : `${counts.all} ${counts.all === 1 ? "item needs" : "items need"} action. The next best move is visible.`
          }
          eyebrow={formatLongDate(now.toISOString())}
          primaryAction={writable ? { label: "Create shoot", href: routes.newShoot() } : undefined}
          title="Work queue"
        />

        <WorkNextUp item={dashboard.nextUp} now={now} />

        <section aria-labelledby="work-pulse" className="ml-work-queue-pulse">
          <h2 className="ml-visually-hidden" id="work-pulse">
            This period
          </h2>
          <MetricGroup label="This period">
            <Metric
              detail="Net that arrived"
              label="Received"
              tone="success"
              value={formatMoney(pulse.netReceived)}
            />
            <Metric
              detail={`${pulse.overdueCount} overdue`}
              label="Outstanding"
              tone={pulse.overdueCount > 0 ? "danger" : "neutral"}
              value={formatMoney(pulse.outstanding)}
            />
            <Metric
              detail="Shoot start to first dispatch"
              label="Median dispatch"
              value={pulse.medianDispatchMinutes > 0 ? `${pulse.medianDispatchMinutes} min` : "—"}
            />
            <Metric
              detail="Statement value not attributed"
              label="Unmatched"
              value={formatMoney(pulse.unmatched)}
            />
          </MetricGroup>
          <p className="ml-caption ml-work-queue-pulse__foot">
            <TextLink href={routes.money()}>View money</TextLink>
          </p>
        </section>

        <div className="ml-dashboard-grid">
          <div className="ml-stack">
            <WorkAttentionQueue
              basePath={routes.work()}
              counts={counts}
              filter={filter}
              now={now}
              params={toSearchParams(query)}
              rows={rows}
            />
            <WorkRecentActivity events={activity} now={now} routes={routes} />
          </div>
          <div className="ml-stack">
            <WorkActiveShoots routes={routes} shoots={dashboard.activeShoots} writable={writable} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
