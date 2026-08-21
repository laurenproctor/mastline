import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel, PendingButton, PhotoTile } from "@/components/primitives";
import { formatConfidence, formatElapsed, humanizeStatus } from "@/lib/format";
import { formatMoneyRange } from "@/lib/money";
import { DEMO_NOW } from "@/lib/mock/fixtures";
import { listOpportunities } from "@/lib/mock/queries";

function windowLabel(closesAt: string | undefined, now: Date): { text: string; urgent: boolean } {
  if (!closesAt) return { text: "No window", urgent: false };
  const minutes = Math.round((new Date(closesAt).getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return { text: "Closed", urgent: false };
  if (minutes <= 180) return { text: "Act now", urgent: true };
  const hours = Math.floor(minutes / 60);
  return { text: `${hours}h ${minutes % 60}m`, urgent: false };
}

export default async function NewsPage() {
  const opportunities = await listOpportunities();
  const selected = opportunities[0];

  return (
    <AppShell active="News radar">
      <div className="page">
        <PageHeader
          action="Manage sources"
          description="Prioritized by relevance, demand, timing, and the assets you already own."
          eyebrow="Manual story entry · live feeds not yet connected"
          href="/settings"
          title="News opportunities"
        />

        <Panel>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Signal</th>
                  <th scope="col">Story</th>
                  <th scope="col">Archive match</th>
                  <th scope="col">Assets</th>
                  <th scope="col">Est. value</th>
                  <th scope="col">Window</th>
                  <th scope="col">Next action</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((opportunity) => {
                  const window = windowLabel(opportunity.windowClosesAt, DEMO_NOW);
                  return (
                    <tr key={opportunity.id}>
                      <td>
                        <span className="signal">{humanizeStatus(opportunity.signal)}</span>
                      </td>
                      <td>
                        <strong>{opportunity.title}</strong>
                        <small>
                          {opportunity.sourceName} ·{" "}
                          {formatElapsed(opportunity.sourcePublishedAt, DEMO_NOW)}
                        </small>
                      </td>
                      <td>
                        <strong className="text-link">
                          {formatConfidence(opportunity.archiveMatch.confidence)}
                        </strong>
                        <small>suggested</small>
                      </td>
                      <td>{opportunity.archiveMatch.value.assetIds.length}</td>
                      <td>
                        {formatMoneyRange(
                          opportunity.archiveMatch.value.estimatedLow,
                          opportunity.archiveMatch.value.estimatedHigh,
                        )}
                      </td>
                      <td className={window.urgent ? "text-link" : "muted"}>{window.text}</td>
                      <td>
                        <PendingButton className="blue" small>
                          {window.urgent ? "Build pitch" : "Review"}
                        </PendingButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="opportunity-detail">
              <div className="detail-block">
                <Badge tone="blue">
                  {formatConfidence(selected.archiveMatch.confidence)} archive match · suggested
                </Badge>
                <h3>{selected.title}</h3>
                <p>{selected.summary}</p>
                <p className="muted">
                  {selected.relatedTopics.join(" · ")} — {selected.sourceName}
                </p>
                <div className="actions">
                  <PendingButton small>View full story</PendingButton>
                  <PendingButton small>Snooze 2 hours</PendingButton>
                </div>
              </div>

              <div className="detail-block">
                <strong>Top archive matches ({selected.archiveMatch.value.assetIds.length})</strong>
                <div className="thumb-strip">
                  {selected.archiveMatch.value.assetIds.slice(0, 5).map((assetId, index) => (
                    <Link href={`/assets/${assetId}`} key={assetId}>
                      <PhotoTile index={index + 1} selected={index < 4} />
                    </Link>
                  ))}
                </div>
                <p>
                  <strong>Basis:</strong> {selected.archiveMatch.basis}.
                </p>
              </div>

              <div className="detail-block">
                <strong>Recommended play</strong>
                <p>
                  Estimated direct-license range{" "}
                  {formatMoneyRange(
                    selected.archiveMatch.value.estimatedLow,
                    selected.archiveMatch.value.estimatedHigh,
                  )}
                  . This is a suggestion with a stated basis and confidence, not a valuation.
                </p>
                <PendingButton className="blue">Build pitch</PendingButton>
                <p className="section-note">
                  No buyer is contacted automatically. A pitch is prepared for review.
                </p>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
