import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, Metric, PageHeader, Panel, Progress } from "@/components/primitives";
import { listActivity } from "@/lib/data/activity";
import { listAssets } from "@/lib/data/assets";
import { listShoots } from "@/lib/data/shoots";
import { getWorkPulse, getWorkQueue } from "@/lib/data/work-queue";
import { formatElapsed, formatLongDate } from "@/lib/format";
import { reviewSelection } from "@/lib/metadata-rules";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";

const KIND_TONE = {
  Shoot: "warn",
  Dispatch: "blue",
  Submission: "blue",
  Money: "warn",
} as const;

const ACTIVE_STATUSES = new Set([
  "draft",
  "scheduled",
  "active",
  "ingesting",
  "preparing",
  "ready",
]);

export default async function WorkQueuePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: requestedWorkspace } = await params;
  const { session, organizationId, canonicalSlug } = await workspaceContext(requestedWorkspace);
  // Links are built from the address the workspace holds now, never from the
  // one the request happened to arrive on.
  const routes = workspaceRoutes(canonicalSlug);
  /*
   * Everything below builds on the address the workspace holds NOW, not the one
   * the request arrived on. A request may land on a retired address, and a link
   * rendered from that would send the next click back through the rename
   * redirect; a slug that was never resolved at all would be a value the
   * browser supplied, sitting in a destination.
   */
  const workspaceSlug = canonicalSlug;
  const now = new Date();

  const [queue, pulse, shoots, activity] = await Promise.all([
    getWorkQueue(organizationId, routes),
    getWorkPulse(organizationId),
    listShoots(organizationId),
    listActivity(organizationId, { limit: 6 }),
  ]);

  const onDeck = shoots.find((shoot) => ACTIVE_STATUSES.has(shoot.status)) ?? null;
  const onDeckAssets = onDeck ? await listAssets(organizationId, { shootId: onDeck.id }) : [];
  const onDeckReport = reviewSelection(onDeckAssets.filter((asset) => asset.selected));

  return (
    <AppShell active="Work" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          action={can(session.activeWorkspace.role, "shoot.write") ? "Create shoot" : undefined}
          description={
            queue.length === 0
              ? "Nothing needs attention. Every shoot, submission, and payment is up to date."
              : `${queue.length} ${queue.length === 1 ? "item needs" : "items need"} action. The next best move is visible.`
          }
          eyebrow={formatLongDate(now.toISOString())}
          href={routes.newShoot()}
          title="Work queue"
        />

        <div className="metrics">
          <Metric
            detail="Net that arrived"
            label="Received"
            tone="good"
            value={formatMoney(pulse.netReceived)}
          />
          <Metric
            detail={`${pulse.overdueCount} overdue`}
            label="Outstanding"
            tone={pulse.overdueCount > 0 ? "danger" : undefined}
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
        </div>

        <div className="panel-grid">
          <div className="stack">
            <Panel
              action={<span className="muted">Now · {queue.length}</span>}
              title="Needs attention"
            >
              {queue.length === 0 ? (
                <div className="panel-body">
                  <p className="section-note">
                    Nothing is blocked. Import a shoot, or record an outcome when a buyer replies.
                  </p>
                </div>
              ) : (
                <ul className="list">
                  {queue.map((item) => (
                    <li className={`list-row${item.urgent ? " danger" : ""}`} key={item.id}>
                      <Badge tone={KIND_TONE[item.kind]}>{item.kind}</Badge>
                      <div>
                        <h3>{item.title}</h3>
                        <p>
                          {item.detail} · <span className="muted">{item.rankingBasis}</span>
                        </p>
                      </div>
                      <span className="age">
                        {item.urgent
                          ? "Urgent"
                          : item.occurredAt
                            ? formatElapsed(item.occurredAt, now)
                            : "—"}
                      </span>
                      <Link className="row-action" href={item.href}>
                        {item.actionLabel} <span aria-hidden="true">→</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              action={
                <Link className="text-link" href={routes.archive()}>
                  View archive
                </Link>
              }
              title="Recent activity"
            >
              {activity.length === 0 ? (
                <div className="panel-body">
                  <p className="section-note">Nothing recorded yet.</p>
                </div>
              ) : (
                <ul className="list activity">
                  {activity.map((event) => (
                    <li className="list-row" key={event.id}>
                      <Badge tone="neutral">{event.entityType}</Badge>
                      <div>
                        <h3>{event.summary}</h3>
                      </div>
                      <span className="age">{formatElapsed(event.createdAt, now)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title="On deck">
            {onDeck ? (
              <div className="side-card">
                <Badge tone="warn">{onDeck.status}</Badge>
                <h3>{onDeck.title}</h3>
                <p>
                  {onDeckAssets.length} files · {onDeckReport.total} selected
                  {onDeck.locationName ? ` · ${onDeck.locationName}` : ""}
                </p>
                <Progress label="Ready to dispatch" value={onDeckReport.completionPercent} />
                <div className="spacer" />
                <Link className="button small" href={routes.shoot(onDeck.id)}>
                  Open shoot
                </Link>
              </div>
            ) : (
              <div className="side-card">
                <h3>No shoot in progress</h3>
                <p>Create a shoot from a brief, before there are any files.</p>
                <Link className="button small" href={routes.newShoot()}>
                  Create shoot
                </Link>
              </div>
            )}

            <div className="side-card">
              <h3>This period</h3>
              <dl className="pulse-list">
                <div>
                  <dt>Received</dt>
                  <dd>{formatMoney(pulse.netReceived)}</dd>
                </div>
                <div>
                  <dt>Outstanding</dt>
                  <dd>{formatMoney(pulse.outstanding)}</dd>
                </div>
                <div>
                  <dt>Unmatched</dt>
                  <dd>{formatMoney(pulse.unmatched)}</dd>
                </div>
              </dl>
              <Link className="text-link" href={routes.money()}>
                View money <span aria-hidden="true">→</span>
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
