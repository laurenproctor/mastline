import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { TextLink } from "@/components/button";
import {
  DataTable,
  EmptyState,
  Metric,
  MetricGroup,
  OperationalList,
  OperationalListRow,
  Panel,
  PanelBody,
  PanelHeader,
  Progress,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/dashboard-surfaces";
import { PageHeader } from "@/components/page-header";
import "@/styles/mastline-dashboard-screens.css";
import { getMoneySummary, getRevenueBySource, listLicenses, listPayments } from "@/lib/data/money";
import { listSubmissions } from "@/lib/data/submissions";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { formatDate, humanizeStatus } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { listStatementImports } from "@/lib/data/statements";
import { AllocateForm } from "./_components/allocate";
import { RecordPayment } from "./_components/record-payment";
import { ConfirmLine, ImportStatement } from "./_components/statement-import";

const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "danger" | "blue"> = {
  expected: "neutral",
  invoiced: "blue",
  reported: "warn",
  partial: "warn",
  received: "good",
  overdue: "danger",
  disputed: "danger",
  written_off: "neutral",
};

const OUTSTANDING = new Set(["expected", "invoiced", "partial", "overdue"]);

export default async function MoneyPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: requestedWorkspace } = await params;
  const { session, organizationId, canonicalSlug } = await workspaceContext(requestedWorkspace);
  const routes = workspaceRoutes(canonicalSlug);
  /*
   * Everything below builds on the address the workspace holds NOW, not the one
   * the request arrived on. A request may land on a retired address, and a link
   * rendered from that would send the next click back through the rename
   * redirect; a slug that was never resolved at all would be a value the
   * browser supplied, sitting in a destination.
   */
  const workspaceSlug = canonicalSlug;
  const role = session.activeWorkspace.role;

  const [summary, sources, payments, licenses, submissions, buyers] = await Promise.all([
    getMoneySummary(organizationId),
    getRevenueBySource(organizationId),
    listPayments(organizationId),
    listLicenses(organizationId),
    listSubmissions(organizationId),
    listWorkspaceBuyers(organizationId),
  ]);

  // Statements are money, so only finance and owner can read them at all.
  const statements = can(role, "payment.write") ? await listStatementImports(organizationId) : [];
  const openLines = statements.flatMap((statement) =>
    statement.lines
      .filter((line) => line.matchStatus === "suggested" || line.matchStatus === "unmatched")
      .map((line) => ({ statement, line })),
  );

  const buyerNames = new Map(buyers.map((buyer) => [buyer.id, buyer.name]));
  const mayWrite = can(role, "payment.write");

  const needsAttention = payments.filter(
    (payment) => payment.unallocated.minor > 0 || payment.status === "disputed",
  );
  const receivables = payments
    .filter((payment) => OUTSTANDING.has(payment.status))
    .sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  const recent = payments.filter((payment) => payment.receivedAt).slice(0, 5);
  const largest = Math.max(...sources.map((source) => source.amount.minor), 1);

  const licenseOptions = licenses.map((license) => ({
    id: license.id,
    label: `${license.licenseeName} · ${formatMoney(license.saleBase)}`,
  }));
  const submissionOptions = submissions.map((submission) => ({
    id: submission.id,
    label: `${submission.reference} · ${buyerNames.get(submission.buyerId ?? "") ?? "—"}`,
  }));

  return (
    <AppShell active="Money" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          description="Track what was reported, received, delayed, deducted, or lost."
          eyebrow="Revenue"
          title="Revenue & payments"
        />

        <MetricGroup label="Revenue summary">
          <Metric
            detail="Net that actually arrived"
            label="Net received"
            tone="success"
            value={formatMoney(summary.netReceived)}
          />
          <Metric
            detail={`${summary.overdueCount} overdue`}
            label="Outstanding"
            tone={summary.overdueCount > 0 ? "danger" : undefined}
            value={formatMoney(summary.outstanding)}
          />
          <Metric
            detail="Statement value not yet attributed"
            label="Unmatched"
            value={formatMoney(summary.unallocatedStatementTotal)}
          />
          <Metric
            detail="From expected to received"
            label="Average time to payment"
            value={`${summary.averageDaysToPayment} days`}
          />
        </MetricGroup>

        <div className="ml-dashboard-grid">
          <div className="ml-stack">
            {mayWrite && openLines.length > 0 && (
              <Panel aria-labelledby="money-statement-lines">
                <PanelHeader
                  id="money-statement-lines"
                  meta={`${openLines.length} lines`}
                  title="Statement lines awaiting confirmation"
                />
                <PanelBody flush>
                  <DataTable caption="Open statement lines" captionHidden>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Reference</TableHeaderCell>
                        <TableHeaderCell>Description</TableHeaderCell>
                        <TableHeaderCell kind="numeric">Gross</TableHeaderCell>
                        <TableHeaderCell kind="numeric">Deducted</TableHeaderCell>
                        <TableHeaderCell kind="numeric">Net</TableHeaderCell>
                        <TableHeaderCell>Why</TableHeaderCell>
                        <TableHeaderCell kind="action">Action</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {openLines.slice(0, 20).map(({ statement, line }) => (
                        <TableRow key={line.id}>
                          <TableCell>
                            <strong>{line.externalReference ?? "—"}</strong>
                            <div className="ml-meta">{statement.filename}</div>
                          </TableCell>
                          <TableCell>{line.description ?? "—"}</TableCell>
                          <TableCell kind="numeric">{formatMoney(line.gross)}</TableCell>
                          <TableCell kind="numeric">{formatMoney(line.deductions)}</TableCell>
                          <TableCell kind="numeric">
                            <strong>{formatMoney(line.net)}</strong>
                          </TableCell>
                          <TableCell>
                            <span className="ml-meta">
                              {line.matchBasis ?? "No basis recorded."}
                            </span>
                          </TableCell>
                          <TableCell kind="action">
                            <ConfirmLine
                              workspaceSlug={workspaceSlug}
                              disabled={!line.matchedSubmissionId && !line.matchedLicenseId}
                              lineId={line.id}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                </PanelBody>
                <PanelBody>
                  <p className="ml-caption">
                    Every proposed match states its basis. Confirming a line creates a payment and
                    attributes it; the imported figures are never rewritten.
                  </p>
                </PanelBody>
              </Panel>
            )}

            <Panel aria-labelledby="money-reconciliation">
              <PanelHeader
                id="money-reconciliation"
                meta={`${needsAttention.length} lines`}
                title="Reconciliation queue"
              />
              <PanelBody flush>
                {needsAttention.length === 0 ? (
                  <EmptyState
                    compact
                    description="Every payment is fully attributed to the work that earned it."
                    level={3}
                    title="Nothing to reconcile"
                  />
                ) : (
                  <DataTable caption="Payments with unattributed amounts" captionHidden>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell kind="status">Status</TableHeaderCell>
                        <TableHeaderCell>Reference</TableHeaderCell>
                        <TableHeaderCell>Buyer</TableHeaderCell>
                        <TableHeaderCell kind="numeric">Net</TableHeaderCell>
                        <TableHeaderCell kind="numeric">Attributed</TableHeaderCell>
                        <TableHeaderCell kind="numeric">Unattributed</TableHeaderCell>
                        {mayWrite && <TableHeaderCell kind="action">Action</TableHeaderCell>}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {needsAttention.map((payment) => (
                        <TableRow key={payment.id}>
                          <TableCell kind="status">
                            <Badge tone={STATUS_TONE[payment.status] ?? "neutral"}>
                              {humanizeStatus(payment.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <strong className="money-reference">{payment.reference ?? "—"}</strong>
                            <div className="ml-meta">{humanizeStatus(payment.source)}</div>
                          </TableCell>
                          <TableCell>{buyerNames.get(payment.buyerId ?? "") ?? "—"}</TableCell>
                          <TableCell kind="numeric">{formatMoney(payment.net)}</TableCell>
                          <TableCell kind="numeric">
                            {formatMoney(payment.allocatedTotal)}
                          </TableCell>
                          <TableCell kind="numeric">
                            {payment.unallocated.minor > 0 ? (
                              <strong>{formatMoney(payment.unallocated)}</strong>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          {mayWrite && (
                            <TableCell kind="action">
                              {payment.unallocated.minor > 0 ? (
                                <AllocateForm
                                  workspaceSlug={workspaceSlug}
                                  licenses={licenseOptions}
                                  paymentId={payment.id}
                                  reference={payment.reference ?? payment.id.slice(0, 8)}
                                  remainingMajor={payment.unallocated.minor / 100}
                                  submissions={submissionOptions}
                                />
                              ) : (
                                <span className="ml-meta">—</span>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                )}
              </PanelBody>
            </Panel>

            <Panel aria-labelledby="money-recent">
              <PanelHeader id="money-recent" title="Recent payments" />
              <PanelBody flush>
                <DataTable caption="Payments received, newest first" captionHidden>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Received</TableHeaderCell>
                      <TableHeaderCell>Source</TableHeaderCell>
                      <TableHeaderCell kind="numeric">Gross</TableHeaderCell>
                      <TableHeaderCell kind="numeric">Deductions</TableHeaderCell>
                      <TableHeaderCell kind="numeric">Sales Engine</TableHeaderCell>
                      <TableHeaderCell kind="numeric">Tax</TableHeaderCell>
                      <TableHeaderCell kind="numeric">Net</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {recent.length === 0 ? (
                      <TableEmptyRow columns={7}>No payments have been received yet.</TableEmptyRow>
                    ) : (
                      recent.map((payment) => (
                        <TableRow key={payment.id}>
                          <TableCell>
                            {payment.receivedAt
                              ? formatDate(payment.receivedAt, { withYear: true })
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <strong>{buyerNames.get(payment.buyerId ?? "") ?? "—"}</strong>
                            <div className="ml-meta money-reference">{payment.reference}</div>
                          </TableCell>
                          <TableCell kind="numeric">{formatMoney(payment.gross)}</TableCell>
                          <TableCell kind="numeric">{formatMoney(payment.deductions)}</TableCell>
                          <TableCell kind="numeric">{formatMoney(payment.platformFee)}</TableCell>
                          <TableCell kind="numeric">{formatMoney(payment.tax)}</TableCell>
                          <TableCell kind="numeric">
                            <strong>{formatMoney(payment.net)}</strong>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </DataTable>
              </PanelBody>
              <PanelBody>
                <p className="ml-caption">
                  Gross, deductions, the Sales Engine share, tax, and net stay separately
                  inspectable. The 30% share applies only to a license generated inside Mastline.
                </p>
              </PanelBody>
            </Panel>

            <Panel aria-labelledby="money-licenses">
              <PanelHeader id="money-licenses" meta={String(licenses.length)} title="Licenses" />
              <PanelBody flush>
                {licenses.length === 0 ? (
                  <EmptyState
                    compact
                    description="A license appears here once a sale is recorded against a submission or through the Sales Engine."
                    level={3}
                    title="No licenses recorded yet"
                  />
                ) : (
                  <DataTable caption="Licenses recorded" captionHidden>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Licensee</TableHeaderCell>
                        <TableHeaderCell kind="status">Origin</TableHeaderCell>
                        <TableHeaderCell kind="numeric">Sale base</TableHeaderCell>
                        <TableHeaderCell kind="numeric">Photographer</TableHeaderCell>
                        <TableHeaderCell kind="numeric">Mastline</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {licenses.map((license) => (
                        <TableRow key={license.id}>
                          <TableCell>
                            <strong>{license.licenseeName}</strong>
                            <div className="ml-meta">
                              {license.media ?? "—"}
                              {license.territory ? ` · ${license.territory}` : ""}
                            </div>
                          </TableCell>
                          <TableCell kind="status">
                            {license.origin === "mastline_sales_engine" ? (
                              <Badge tone="blue">Via Mastline</Badge>
                            ) : (
                              <Badge tone="neutral">Own relationship</Badge>
                            )}
                          </TableCell>
                          <TableCell kind="numeric">{formatMoney(license.saleBase)}</TableCell>
                          <TableCell kind="numeric">
                            <strong>{formatMoney(license.photographerShare)}</strong>
                          </TableCell>
                          <TableCell kind="numeric">
                            {formatMoney(license.salesEngineShare)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                )}
              </PanelBody>
            </Panel>
          </div>

          <div className="ml-stack">
            {mayWrite && (
              <Panel aria-labelledby="money-record">
                <PanelHeader id="money-record" title="Record" />
                <PanelBody>
                  <div className="ml-stack">
                    <RecordPayment
                      workspaceSlug={workspaceSlug}
                      buyers={buyers.map((buyer) => ({ id: buyer.id, name: buyer.name }))}
                    />
                    <ImportStatement
                      workspaceSlug={workspaceSlug}
                      buyers={buyers.map((buyer) => ({ id: buyer.id, name: buyer.name }))}
                    />
                    <div className="ml-card ml-stack">
                      <h3 className="ml-subtitle">Export everything</h3>
                      <p className="ml-body">
                        Assets, metadata, submissions, licenses, payments, allocations, and the full
                        activity record, as CSV.
                      </p>
                      <p>
                        {/* A file download, not a navigation: a plain anchor with `download`. */}
                        <a
                          className="ml-button ml-button--secondary"
                          download
                          href={`/api/workspaces/${workspaceSlug}/export`}
                        >
                          Download workspace export
                        </a>
                      </p>
                      <p className="ml-caption">
                        Confidential source notes are excluded. Exporting those is a deliberate,
                        separate them.
                      </p>
                    </div>
                  </div>
                </PanelBody>
              </Panel>
            )}

            <Panel aria-labelledby="money-receivables">
              <PanelHeader
                id="money-receivables"
                meta={receivables.length > 0 ? String(receivables.length) : undefined}
                title="Receivables"
              />
              <PanelBody flush>
                {receivables.length === 0 ? (
                  <EmptyState
                    compact
                    description="No payment is expected, invoiced, partly paid, or overdue."
                    level={3}
                    title="Nothing outstanding"
                  />
                ) : (
                  <OperationalList compact label="Receivables">
                    {receivables.map((payment) => (
                      <OperationalListRow
                        date={
                          payment.status === "overdue"
                            ? payment.dueAt
                              ? `Overdue since ${formatDate(payment.dueAt)}`
                              : "Overdue"
                            : payment.dueAt
                              ? `Due ${formatDate(payment.dueAt, { withYear: true })}`
                              : "Due unscheduled"
                        }
                        key={payment.id}
                        level={3}
                        meta={payment.reference}
                        priority={payment.status === "overdue" ? "high" : "normal"}
                        priorityLabel="Overdue"
                        status={
                          <Badge tone={STATUS_TONE[payment.status] ?? "neutral"}>
                            {humanizeStatus(payment.status)}
                          </Badge>
                        }
                        title={`${buyerNames.get(payment.buyerId ?? "") ?? "Unknown buyer"} · ${formatMoney(payment.net)}`}
                      />
                    ))}
                  </OperationalList>
                )}
              </PanelBody>
            </Panel>

            <Panel aria-labelledby="money-sources">
              <PanelHeader id="money-sources" title="Received by source" />
              <PanelBody>
                {sources.length === 0 ? (
                  <EmptyState compact level={3} title="No received payments yet" />
                ) : (
                  <div className="ml-stack">
                    {sources.map((source) => (
                      <Progress
                        key={source.label}
                        label={source.label}
                        max={largest}
                        value={source.amount.minor}
                        valueText={formatMoney(source.amount)}
                      />
                    ))}
                    <p className="ml-caption">
                      Each bar is that source&apos;s share of the largest.
                    </p>
                  </div>
                )}
                <p className="money-sources-foot">
                  <TextLink href={routes.archive()}>
                    Open the archive <span aria-hidden="true">→</span>
                  </TextLink>
                </p>
              </PanelBody>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
