import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, Metric, PageHeader, Panel, Progress } from "@/components/primitives";
import { formatElapsed, formatLongDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { DEMO_NOW } from "@/lib/mock/fixtures";
import {
  getArchiveRevenue,
  getMedianSubmissionMinutes,
  getMoneySummary,
  getShootProgress,
  getWorkQueue,
  listActivity,
} from "@/lib/mock/queries";

const KIND_TONE = {
  Shoot: "warn",
  Delivery: "danger",
  Money: "warn",
  Rights: "blue",
} as const;

export default async function WorkQueuePage() {
  const [queue, summary, archiveRevenue, medianMinutes, onDeck, activity] = await Promise.all([
    getWorkQueue(),
    getMoneySummary(),
    getArchiveRevenue(),
    getMedianSubmissionMinutes(),
    getShootProgress("sht_chelsea"),
    listActivity(),
  ]);

  const archiveShare = Math.round(
    (archiveRevenue.minor / Math.max(1, summary.netReceived.minor)) * 100,
  );

  return (
    <AppShell active="Work">
      <div className="page">
        <PageHeader
          action="Import a shoot"
          description={`${queue.length} items need action. The next best move is visible.`}
          eyebrow={formatLongDate(DEMO_NOW.toISOString())}
          href="/shoots/new"
          title="Work queue"
        />

        <div className="metrics">
          <Metric
            detail="Received this period"
            label="Net received"
            tone="good"
            value={formatMoney(summary.netReceived)}
          />
          <Metric
            detail={`${summary.overdueCount} overdue`}
            label="Outstanding"
            tone={summary.overdueCount > 0 ? "danger" : undefined}
            value={formatMoney(summary.outstanding)}
          />
          <Metric
            detail="Capture to first dispatch"
            label="Median submission time"
            value={`${medianMinutes} min`}
          />
          <Metric
            detail={`${archiveShare}% of received`}
            label="Archive revenue"
            value={formatMoney(archiveRevenue)}
          />
        </div>

        <div className="panel-grid">
          <div className="stack">
            <Panel
              action={<span className="muted">Now · {queue.length}</span>}
              title="Needs attention"
            >
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
                      {item.urgent ? "Urgent" : formatElapsed(item.occurredAt, DEMO_NOW)}
                    </span>
                    <Link className="row-action" href={item.href}>
                      {item.actionLabel} <span aria-hidden="true">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel
              action={
                <Link className="text-link" href="/archive">
                  View all
                </Link>
              }
              title="Recent activity"
            >
              <ul className="list">
                {activity.slice(0, 4).map((event) => (
                  <li className="list-row" key={event.id}>
                    <Badge tone="neutral">{event.entityType}</Badge>
                    <div>
                      <h3>{event.summary}</h3>
                      <p>{event.action}</p>
                    </div>
                    <span className="age">{formatElapsed(event.createdAt, DEMO_NOW)}</span>
                    <span className="row-action muted">Logged</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <Panel title="On deck">
            {onDeck && (
              <div className="side-card">
                <Badge tone="warn">{onDeck.shoot.status}</Badge>
                <h3>{onDeck.shoot.title}</h3>
                <p>
                  {onDeck.importedFileCount} files · {onDeck.selectedCount} selected ·{" "}
                  {onDeck.shoot.locationName}
                </p>
                <div aria-hidden="true" className="mini-photo" />
                <Progress label="Captions" value={onDeck.captionCompletionPercent} />
                <div className="spacer" />
                <Link className="button small" href={`/shoots/${onDeck.shoot.id}`}>
                  Open shoot
                </Link>
              </div>
            )}
            <div className="side-card">
              <h3>This period</h3>
              <dl className="pulse-list">
                <div>
                  <dt>Received</dt>
                  <dd>{formatMoney(summary.netReceived)}</dd>
                </div>
                <div>
                  <dt>Outstanding</dt>
                  <dd>{formatMoney(summary.outstanding)}</dd>
                </div>
                <div>
                  <dt>Unmatched statement lines</dt>
                  <dd>{formatMoney(summary.unmatchedStatementTotal)}</dd>
                </div>
              </dl>
              <Link className="text-link" href="/money">
                View money <span aria-hidden="true">→</span>
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
