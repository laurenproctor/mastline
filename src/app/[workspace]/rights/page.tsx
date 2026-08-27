import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import {
  Badge,
  Metric,
  PageHeader,
  Panel,
  PendingButton,
  TableScroll,
} from "@/components/primitives";
import { formatConfidence, formatDateTime, humanizeStatus } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getAsset } from "@/lib/data/assets";
import { listPayments } from "@/lib/data/money";
import { listRightsMatches } from "@/lib/data/rights";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";

const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "danger" | "blue"> = {
  new: "danger",
  reviewing: "warn",
  licensed: "good",
  ignored: "neutral",
  monitoring: "blue",
  escalated: "danger",
  resolved: "good",
};

export default async function RightsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: requestedWorkspace } = await params;
  const { organizationId, canonicalSlug } = await workspaceContext(requestedWorkspace);
  const routes = workspaceRoutes(canonicalSlug);
  /*
   * Everything below builds on the address the workspace holds NOW, not the one
   * the request arrived on. A request may land on a retired address, and a link
   * rendered from that would send the next click back through the rename
   * redirect; a slug that was never resolved at all would be a value the
   * browser supplied, sitting in a destination.
   */
  const workspaceSlug = canonicalSlug;
  const matches = await listRightsMatches(organizationId);
  const assets = await Promise.all(matches.map((match) => getAsset(organizationId, match.assetId)));
  const payments = await listPayments(organizationId);

  const recovered = payments
    .filter((payment) => payment.source === "recovery")
    .reduce((total, payment) => total + payment.net.minor, 0);

  const selected = matches[0];
  const selectedAsset = assets[0];
  const hasMatches = matches.length > 0;

  const counts = {
    needsReview: matches.filter((match) => match.status === "new").length,
    monitoring: matches.filter((match) => match.status === "monitoring").length,
    licensed: matches.filter((match) => match.status === "licensed").length,
  };

  return (
    <AppShell active="Rights" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          action="Add monitored domain"
          description="Review possible uses against licenses, provenance, and publisher evidence."
          eyebrow="Evidence before action"
          href={routes.settings()}
          title="Rights matches"
        />

        <div className="metrics">
          <Metric
            detail="Awaiting a human decision"
            label="Needs review"
            tone={counts.needsReview > 0 ? "danger" : undefined}
            value={String(counts.needsReview)}
          />
          <Metric detail="Awaiting change" label="Monitoring" value={String(counts.monitoring)} />
          <Metric
            detail="License found and linked"
            label="Verified licensed"
            tone="good"
            value={String(counts.licensed)}
          />
          <Metric
            detail="Recovery payments received"
            label="Recovered"
            tone="good"
            value={formatMoney({ minor: recovered, currency: "USD" })}
          />
        </div>

        <div className="panel-grid">
          <Panel
            action={<span className="muted">Grouped by asset and publisher</span>}
            title="Match queue"
          >
            {!hasMatches && (
              <div className="panel-body">
                <p className="section-note">
                  No observed uses recorded. Monitoring sources are connected in a later phase.
                </p>
              </div>
            )}
            <TableScroll label="Observed uses">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Publisher</th>
                    <th scope="col">Asset</th>
                    <th scope="col">First observed</th>
                    <th scope="col">Confidence</th>
                    <th scope="col">License check</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((match, index) => (
                    <tr key={match.id}>
                      <td>
                        <strong>{match.publisherName}</strong>
                        <small>{match.pageTitle}</small>
                      </td>
                      <td>
                        <Link className="text-link" href={routes.asset(match.assetId)}>
                          {assets[index]?.canonicalFilename ?? match.assetId}
                        </Link>
                      </td>
                      <td>{formatDateTime(match.firstObservedAt)}</td>
                      <td>
                        {formatConfidence(match.confidence)}
                        <small>{match.matchMethod}</small>
                      </td>
                      <td>{humanizeStatus(match.licenseCheck)}</td>
                      <td>
                        <Badge tone={STATUS_TONE[match.status] ?? "neutral"}>
                          {humanizeStatus(match.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <p className="section-note panel-body">
              Confidence is a machine observation and is stored separately from the human status. A
              license check result of “no linked license found” is a fact about the Mastline record,
              not a legal conclusion.
            </p>
          </Panel>

          {selected && (
            <Panel title="Selected match">
              <div className="side-card">
                <Badge tone="danger">{formatConfidence(selected.confidence)} visual match</Badge>
                <h3>{selected.publisherName}</h3>
                <p>
                  “{selected.pageTitle}” · first observed {formatDateTime(selected.firstObservedAt)}
                  .
                </p>
                <div aria-hidden="true" className="mini-photo" />
              </div>
              <div className="side-card">
                <h3>Evidence</h3>
                <p>
                  {selected.hasEvidence
                    ? "Screenshot captured, URL preserved, page title recorded, and the image compared against the original."
                    : "No evidence package has been captured yet."}{" "}
                  Method: {selected.matchMethod}. Asset:{" "}
                  {selectedAsset?.canonicalFilename ?? selected.assetId}.
                </p>
                <p>
                  <strong>License check:</strong> {humanizeStatus(selected.licenseCheck)}.
                </p>
                <div className="actions">
                  <PendingButton small>Licensed</PendingButton>
                  <PendingButton small>Ignore</PendingButton>
                  <PendingButton small>Monitor</PendingButton>
                  <PendingButton className="blue" small>
                    Create review case
                  </PendingButton>
                </div>
                <p className="section-note">
                  Mastline records evidence and routes decisions. It does not make a universal legal
                  determination, and it never sends a demand or takedown without an approved human
                  workflow.
                </p>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </AppShell>
  );
}
