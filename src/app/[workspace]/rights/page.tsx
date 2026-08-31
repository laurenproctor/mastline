import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { TextLink } from "@/components/button";
import {
  Card,
  DataTable,
  EmptyState,
  Metric,
  MetricGroup,
  Panel,
  PanelBody,
  PanelHeader,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/dashboard-surfaces";
import { PageHeader } from "@/components/page-header";
import "@/styles/mastline-dashboard-screens.css";
import { formatConfidence, formatDateTime, humanizeStatus } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getAsset } from "@/lib/data/assets";
import { listPayments } from "@/lib/data/money";
import {
  DECISION_NOTE_MAX,
  DECISION_NOTE_MIN,
  LICENSE_REQUIRED_MESSAGE,
  type TriageStatus,
  allowedTransitions,
  isTriageStatus,
  listRightsMatches,
} from "@/lib/data/rights";
import { listWorkspaceMembers } from "@/lib/data/workspace";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { ReviewNotice, TriagePanel } from "./_components/triage-panel";

const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "danger" | "blue"> = {
  new: "danger",
  reviewing: "warn",
  licensed: "good",
  ignored: "neutral",
  monitoring: "blue",
  escalated: "danger",
  resolved: "good",
};

/**
 * What an unusable `?match=` does.
 *
 * A malformed id, an id belonging to another workspace, and an id that has
 * never existed all get the same answer: no record is selected, and a short
 * notice says the match is not in this workspace. One wording for all three, so
 * the address bar cannot be used to find out whether a record exists somewhere
 * else. The queue stays on screen, because the reviewer's next move is to pick
 * a different match from it.
 */
const NOT_IN_WORKSPACE = "That match is not in this workspace. Choose one from the queue.";

export default async function RightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ match?: string; done?: string }>;
}) {
  const { workspace: requestedWorkspace } = await params;
  const { organizationId, canonicalSlug, workspace } = await workspaceContext(requestedWorkspace);
  const routes = workspaceRoutes(canonicalSlug);
  /*
   * Everything below builds on the address the workspace holds NOW, not the one
   * the request arrived on. A request may land on a retired address, and a link
   * rendered from that would send the next click back through the rename
   * redirect; a slug that was never resolved at all would be a value the
   * browser supplied, sitting in a destination.
   */
  const workspaceSlug = canonicalSlug;
  const { match: requestedMatch, done: doneParam } = await searchParams;

  const matches = await listRightsMatches(organizationId);
  const assets = await Promise.all(matches.map((match) => getAsset(organizationId, match.assetId)));
  const payments = await listPayments(organizationId);

  const recovered = payments
    .filter((payment) => payment.source === "recovery")
    .reduce((total, payment) => total + payment.net.minor, 0);

  /*
   * The selection is resolved against the list this workspace can already see,
   * so an id from another organization matches nothing here for the same reason
   * it would match nothing in the database.
   */
  const requested = requestedMatch
    ? (matches.find((match) => match.id === requestedMatch) ?? null)
    : undefined;
  const selected = requested === undefined ? matches[0] : (requested ?? undefined);
  const selectedIndex = selected ? matches.findIndex((match) => match.id === selected.id) : -1;
  const selectedAsset = selectedIndex >= 0 ? assets[selectedIndex] : undefined;
  const unknownMatch = requested === null;
  const hasMatches = matches.length > 0;

  const mayTriage = can(workspace.role, "rights.triage");
  /*
   * The confirmation is only shown for the match the address actually names.
   * A hand-typed `?done=licensed` on its own would otherwise put a decision
   * message above whichever match happened to be first.
   */
  const done: TriageStatus | undefined =
    doneParam && isTriageStatus(doneParam) && selected && selected.id === requestedMatch
      ? doneParam
      : undefined;

  // Only looked up when there is a decision to attribute.
  const reviewer = selected?.reviewedBy
    ? ((await listWorkspaceMembers(organizationId)).find(
        (member) => member.userId === selected.reviewedBy,
      )?.displayName ?? selected.reviewedBy.slice(0, 8))
    : undefined;

  const counts = {
    needsReview: matches.filter((match) => match.status === "new").length,
    monitoring: matches.filter((match) => match.status === "monitoring").length,
    licensed: matches.filter((match) => match.status === "licensed").length,
  };

  return (
    <AppShell active="Rights" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          description="Review possible uses against licenses, provenance, and publisher evidence."
          eyebrow="Evidence before action"
          primaryAction={{ label: "Add monitored domain", href: routes.settings() }}
          title="Rights matches"
        />

        <MetricGroup label="Rights summary">
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
            tone="success"
            value={String(counts.licensed)}
          />
          <Metric
            detail="Recovery payments received"
            label="Recovered"
            tone="success"
            value={formatMoney({ minor: recovered, currency: "USD" })}
          />
        </MetricGroup>

        <div className="ml-dashboard-grid">
          <Panel aria-labelledby="rights-queue">
            <PanelHeader
              id="rights-queue"
              meta="Grouped by asset and publisher"
              title="Match queue"
            />
            {unknownMatch && (
              <PanelBody>
                <div className="ml-callout" data-tone="danger" role="alert">
                  {NOT_IN_WORKSPACE}
                </div>
              </PanelBody>
            )}
            <PanelBody flush>
              {!hasMatches ? (
                <EmptyState
                  compact
                  description="Monitoring sources are connected in a later phase. When a use is observed, it appears here with its evidence."
                  level={3}
                  title="No observed uses recorded"
                />
              ) : (
                <DataTable caption="Observed uses" captionHidden>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Publisher</TableHeaderCell>
                      <TableHeaderCell>Asset</TableHeaderCell>
                      <TableHeaderCell>First observed</TableHeaderCell>
                      <TableHeaderCell>Confidence</TableHeaderCell>
                      <TableHeaderCell>License check</TableHeaderCell>
                      <TableHeaderCell kind="status">Status</TableHeaderCell>
                      <TableHeaderCell kind="action">Review</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {matches.map((match, index) => {
                      const isSelected = selected?.id === match.id;
                      return (
                        <TableRow
                          // Announced as the current row rather than only drawn as
                          // one, so the selection is not carried by styling alone.
                          aria-current={isSelected ? "true" : undefined}
                          key={match.id}
                        >
                          <TableCell>
                            <strong>{match.publisherName}</strong>
                            <div className="ml-meta">{match.pageTitle}</div>
                          </TableCell>
                          <TableCell>
                            <TextLink href={routes.asset(match.assetId)}>
                              {assets[index]?.canonicalFilename ?? match.assetId}
                            </TextLink>
                          </TableCell>
                          <TableCell>{formatDateTime(match.firstObservedAt)}</TableCell>
                          <TableCell>
                            {formatConfidence(match.confidence)}
                            <div className="ml-meta">{match.matchMethod}</div>
                          </TableCell>
                          <TableCell>{humanizeStatus(match.licenseCheck)}</TableCell>
                          <TableCell kind="status">
                            <Badge tone={STATUS_TONE[match.status] ?? "neutral"}>
                              {humanizeStatus(match.status)}
                            </Badge>
                          </TableCell>
                          <TableCell kind="action">
                            {isSelected ? (
                              <Badge tone="blue">Selected</Badge>
                            ) : (
                              <TextLink href={routes.rights({ query: { match: match.id } })}>
                                Select
                                <span className="ml-visually-hidden">
                                  {" "}
                                  {match.publisherName} match
                                </span>
                              </TextLink>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </DataTable>
              )}
            </PanelBody>
            <PanelBody>
              <p className="ml-caption">
                Confidence is a machine observation and is stored separately from the human status.
                A license check result of “no linked license found” is a fact about the Mastline
                record, not a legal conclusion.
              </p>
            </PanelBody>
          </Panel>

          {selected && (
            <Panel aria-labelledby="rights-selected">
              <PanelHeader id="rights-selected" title="Selected match" />
              <PanelBody>
                <div className="ml-stack">
                  <Card className="ml-stack">
                    <div>
                      <Badge tone={STATUS_TONE[selected.status] ?? "neutral"}>
                        {humanizeStatus(selected.status)}
                      </Badge>
                    </div>
                    <h3 className="ml-title">{selected.publisherName}</h3>
                    <p className="ml-body">
                      “{selected.pageTitle ?? "No page title recorded"}” ·{" "}
                      {formatConfidence(selected.confidence)} machine confidence.
                    </p>
                    {done && <ReviewNotice done={done} />}
                  </Card>

                  <Card className="ml-stack">
                    <h3 className="ml-subtitle">What was observed</h3>
                    <dl className="ml-metadata">
                      <dt>Publisher</dt>
                      <dd>{selected.publisherName}</dd>
                      <dt>Source URL</dt>
                      <dd>
                        <a
                          className="ml-text-link rights-source-url"
                          href={selected.sourceUrl}
                          rel="noreferrer nofollow"
                          target="_blank"
                        >
                          {selected.sourceUrl}
                        </a>
                      </dd>
                      <dt>Page title</dt>
                      <dd>{selected.pageTitle ?? "Not recorded"}</dd>
                      <dt>Asset</dt>
                      <dd>
                        <TextLink href={routes.asset(selected.assetId)}>
                          {selectedAsset?.canonicalFilename ?? selected.assetId}
                        </TextLink>
                      </dd>
                      <dt>First observed</dt>
                      <dd>{formatDateTime(selected.firstObservedAt)}</dd>
                      <dt>Most recent observation</dt>
                      <dd>{formatDateTime(selected.lastObservedAt)}</dd>
                      <dt>Match method</dt>
                      <dd>{selected.matchMethod}</dd>
                      <dt>Confidence</dt>
                      <dd>{formatConfidence(selected.confidence)}</dd>
                      <dt>License check</dt>
                      <dd>{humanizeStatus(selected.licenseCheck)}</dd>
                      <dt>Evidence</dt>
                      <dd>
                        {selected.hasEvidence
                          ? "Captured and stored privately"
                          : "None captured yet"}
                      </dd>
                    </dl>
                    <p className="ml-caption">
                      Confidence and the match method are machine observations. “No linked license
                      found” means Mastline searched your own license records and found nothing
                      connected; it is not a finding that the use was unlicensed or infringing.
                    </p>
                  </Card>

                  <Card className="ml-stack">
                    <h3 className="ml-subtitle">Human decision</h3>
                    <dl className="ml-metadata">
                      <dt>Status</dt>
                      <dd>{humanizeStatus(selected.status)}</dd>
                      <dt>Reviewer</dt>
                      <dd>{reviewer ?? "Not reviewed yet"}</dd>
                      <dt>Reviewed</dt>
                      <dd>
                        {selected.reviewedAt
                          ? formatDateTime(selected.reviewedAt)
                          : "Not reviewed yet"}
                      </dd>
                      <dt>Decision note</dt>
                      <dd>{selected.decisionNote ?? "None recorded"}</dd>
                    </dl>
                  </Card>

                  {mayTriage ? (
                    <TriagePanel
                      allowed={allowedTransitions(selected.status)}
                      expectedUpdatedAt={selected.updatedAt}
                      hasLinkedLicense={selected.licenseCheck === "linked_license_found"}
                      licenseRequiredMessage={LICENSE_REQUIRED_MESSAGE}
                      matchId={selected.id}
                      noteMax={DECISION_NOTE_MAX}
                      noteMin={DECISION_NOTE_MIN}
                      workspaceSlug={workspaceSlug}
                    />
                  ) : (
                    <Card className="ml-stack">
                      <h3 className="ml-subtitle">Review is read-only for your role</h3>
                      <p className="ml-body">
                        You can read every match and the evidence behind it. Recording a decision is
                        limited to an owner or a rights reviewer.
                      </p>
                    </Card>
                  )}

                  <p className="ml-caption">
                    Mastline records evidence and routes decisions. Nothing on this screen sends a
                    demand, a takedown, or any message to a publisher, and no decision here is a
                    legal conclusion.
                  </p>
                </div>
              </PanelBody>
            </Panel>
          )}
        </div>
      </div>
    </AppShell>
  );
}
