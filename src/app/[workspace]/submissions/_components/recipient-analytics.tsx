import { Badge, TableScroll } from "@/components/primitives";
import { formatDateTime } from "@/lib/format";
import { describeActiveTime, type DeliveryEngagement } from "@/lib/data/delivery-analytics";

/**
 * What each recipient link actually did.
 *
 * Two rules govern every line of copy in here.
 *
 * The first is that this is about a *link*, never a person. "Viewed through the
 * link created for New York picture desk" is a claim Mastline can support: that
 * link was opened and those frames were on screen. "Jane viewed this for 43
 * seconds" is not, unless Jane typed her name into the acceptance -- which is an
 * explicit identification, and is reported on its own line where it can be read
 * as one.
 *
 * The second is that missing measurement is not zero measurement. A link can be
 * opened -- which is recorded whatever the visitor's consent choice, because it
 * is commercial evidence -- and still have no session data at all, because the
 * visitor declined optional analytics or something blocked the heartbeats. That
 * state says so. Rendering it as "0 seconds" would be inventing a fact about
 * how little somebody cared.
 *
 * Durations are labelled approximate everywhere, because they are: a series of
 * bounded heartbeats is good enough to tell four minutes from four seconds and
 * was never good enough to report to the second.
 */

export interface AnalyticsAssetRow {
  readonly assetId: string;
  readonly filename: string;
  readonly viewed: boolean;
  readonly viewCount: number;
  readonly activeVisibleMs: number;
  readonly downloaded: boolean;
}

export interface RecipientAnalyticsRow {
  readonly deliveryId: string;
  readonly recipientLabel?: string;
  readonly parameters: readonly (readonly [string, string])[];
  readonly stageLabel: string;
  readonly createdAt: string;
  readonly sharedAt?: string;
  readonly acceptedBy?: string;
  readonly acceptedAt?: string;
  readonly acceptedIpAddress?: string;
  /** The terms as they were shown at the moment somebody agreed to them. */
  readonly acceptedTerms?: string;
  readonly engagement: DeliveryEngagement;
  readonly assets: readonly AnalyticsAssetRow[];
}

function EngagementSummary({ engagement }: { engagement: DeliveryEngagement }) {
  if (engagement.state === "never-opened") {
    return <p className="section-note">Not opened yet.</p>;
  }

  if (engagement.state === "no-analytics") {
    return (
      <p className="section-note">
        The link was opened, but detailed viewing time was unavailable. Opens and downloads are
        still recorded below.
      </p>
    );
  }

  if (engagement.state === "opened-no-active-time") {
    return <p className="section-note">Opened, with no active viewing time recorded yet.</p>;
  }

  return (
    <dl className="confirm-list">
      <div>
        <dt>Active viewing</dt>
        <dd>{describeActiveTime(engagement.activeVisibleMs)} (approximate)</dd>
      </div>
      <div>
        <dt>Sessions</dt>
        <dd>
          {engagement.sessionCount}, averaging {describeActiveTime(engagement.averageSessionMs)}
        </dd>
      </div>
      <div>
        <dt>Browsers</dt>
        <dd>
          {engagement.visitorCount} anonymous{" "}
          {engagement.visitorCount === 1 ? "browser" : "browsers"}
        </dd>
      </div>
    </dl>
  );
}

export function RecipientAnalytics({ rows }: { rows: readonly RecipientAnalyticsRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="panel-body">
        <p className="section-note">
          No delivery link yet, so there is nothing to measure. Create one for a recipient and its
          activity appears here.
        </p>
      </div>
    );
  }

  return (
    <div className="panel-body">
      {rows.map((row) => {
        const recipient = row.recipientLabel ?? "an unnamed recipient";
        return (
          <section className="recipient-analytics" key={row.deliveryId}>
            <div className="delivery-link-head">
              <Badge tone="neutral">{row.stageLabel}</Badge>
              <span className="muted">{recipient}</span>
            </div>

            {row.parameters.length > 0 && (
              <p className="section-note">
                {row.parameters.map(([key, value]) => (
                  <code className="parameter-chip" key={key}>
                    {key}={value}
                  </code>
                ))}
              </p>
            )}

            <dl className="confirm-list">
              <div>
                <dt>Created</dt>
                <dd>{formatDateTime(row.createdAt)}</dd>
              </div>
              <div>
                <dt>Shared</dt>
                <dd>{row.sharedAt ? formatDateTime(row.sharedAt) : "Not marked as shared"}</dd>
              </div>
              <div>
                <dt>First opened</dt>
                <dd>
                  {row.engagement.firstOpenedAt
                    ? formatDateTime(row.engagement.firstOpenedAt)
                    : "Not opened yet"}
                </dd>
              </div>
              <div>
                <dt>Last opened</dt>
                <dd>
                  {row.engagement.lastOpenedAt ? formatDateTime(row.engagement.lastOpenedAt) : "—"}
                </dd>
              </div>
              <div>
                <dt>Downloads</dt>
                <dd>{row.engagement.downloadCount}</dd>
              </div>
              <div>
                <dt>Terms</dt>
                <dd>
                  {row.acceptedAt
                    ? `Accepted by ${row.acceptedBy} on ${formatDateTime(row.acceptedAt)}`
                    : "Not accepted"}
                </dd>
              </div>
            </dl>

            {row.acceptedAt && (
              /*
               * The acceptance is evidence rather than analytics, so it says
               * more than the summary above and says it differently: who
               * identified themselves, when, from where, and -- the part that
               * matters in a disagreement -- the words that were on the screen
               * that day rather than the words in the package today.
               */
              <div className="delivery-acceptance">
                <Badge tone="good">Terms accepted</Badge>
                <p className="section-note">
                  <strong>{row.acceptedBy}</strong> accepted on {formatDateTime(row.acceptedAt)}
                  {row.acceptedIpAddress ? ` from ${row.acceptedIpAddress}` : ""}. This is the one
                  point at which a person identified themselves.
                </p>
                {row.acceptedTerms && (
                  <p className="section-note">
                    What they agreed to: <q>{row.acceptedTerms}</q>
                  </p>
                )}
              </div>
            )}

            <EngagementSummary engagement={row.engagement} />

            {row.engagement.firstOpenedAt && (
              <p className="section-note">
                Recorded against the link created for {recipient}. Mastline knows the link was
                opened; it does not know who was holding it
                {row.acceptedBy
                  ? `, beyond ${row.acceptedBy} having identified themselves when accepting the terms.`
                  : " unless somebody identifies themselves by accepting the terms."}
              </p>
            )}

            {row.assets.length > 0 && (
              <TableScroll label={`Frames viewed through the link for ${recipient}`}>
                <table className="data-table">
                  <caption className="visually-hidden">
                    Frames viewed through the link created for {recipient}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Frame</th>
                      <th scope="col">Viewed</th>
                      <th scope="col">Views</th>
                      <th scope="col">Time on screen</th>
                      <th scope="col">Downloaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.assets.map((asset) => (
                      <tr key={asset.assetId}>
                        <td>{asset.filename}</td>
                        <td>{asset.viewed ? "Yes" : "Not recorded"}</td>
                        <td>{asset.viewed ? asset.viewCount : "—"}</td>
                        <td>{asset.viewed ? describeActiveTime(asset.activeVisibleMs) : "—"}</td>
                        <td>{asset.downloaded ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
            <p className="section-note">
              Times are approximate. They are measured only while the page was visible, focused, and
              being used, so a tab left open in the background adds nothing.
            </p>
          </section>
        );
      })}
    </div>
  );
}
