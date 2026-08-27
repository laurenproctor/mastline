import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, Metric, PageHeader, Panel, TableScroll } from "@/components/primitives";
import { getMoneySummary, getRevenueBySource, listLicenses, listPayments } from "@/lib/data/money";
import { listSubmissions } from "@/lib/data/submissions";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { formatDate, humanizeStatus } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
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

export default async function MoneyPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: workspaceSlug } = await params;
  const { session, organizationId } = await workspaceContext(workspaceSlug);
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

        <div className="metrics">
          <Metric
            detail="Net that actually arrived"
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
            detail="Statement value not yet attributed"
            label="Unmatched"
            value={formatMoney(summary.unallocatedStatementTotal)}
          />
          <Metric
            detail="From expected to received"
            label="Average time to payment"
            value={`${summary.averageDaysToPayment} days`}
          />
        </div>

        <div className="panel-grid">
          <div className="stack">
            {mayWrite && openLines.length > 0 && (
              <Panel
                action={<span className="muted">{openLines.length} lines</span>}
                title="Statement lines awaiting confirmation"
              >
                <TableScroll label="Statement lines awaiting confirmation">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Reference</th>
                        <th scope="col">Description</th>
                        <th scope="col">Gross</th>
                        <th scope="col">Deducted</th>
                        <th scope="col">Net</th>
                        <th scope="col">Why</th>
                        <th scope="col">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openLines.slice(0, 20).map(({ statement, line }) => (
                        <tr key={line.id}>
                          <td>
                            <strong>{line.externalReference ?? "—"}</strong>
                            <small>{statement.filename}</small>
                          </td>
                          <td>{line.description ?? "—"}</td>
                          <td>{formatMoney(line.gross)}</td>
                          <td>{formatMoney(line.deductions)}</td>
                          <td>
                            <strong>{formatMoney(line.net)}</strong>
                          </td>
                          <td>
                            <small>{line.matchBasis ?? "No basis recorded."}</small>
                          </td>
                          <td>
                            <ConfirmLine
                              workspaceSlug={workspaceSlug}
                              disabled={!line.matchedSubmissionId && !line.matchedLicenseId}
                              lineId={line.id}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
                <p className="section-note panel-body">
                  Every proposed match states its basis. Confirming a line creates a payment and
                  attributes it; the imported figures are never rewritten.
                </p>
              </Panel>
            )}

            <Panel
              action={<span className="muted">{needsAttention.length} lines</span>}
              title="Reconciliation queue"
            >
              {needsAttention.length === 0 ? (
                <div className="panel-body">
                  <p className="section-note">
                    Every payment is fully attributed to the work that earned it.
                  </p>
                </div>
              ) : (
                <TableScroll label="Reconciliation queue">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Status</th>
                        <th scope="col">Reference</th>
                        <th scope="col">Buyer</th>
                        <th scope="col">Net</th>
                        <th scope="col">Attributed</th>
                        <th scope="col">Unattributed</th>
                        {mayWrite && <th scope="col">Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {needsAttention.map((payment) => (
                        <tr key={payment.id}>
                          <td>
                            <Badge tone={STATUS_TONE[payment.status] ?? "neutral"}>
                              {humanizeStatus(payment.status)}
                            </Badge>
                          </td>
                          <td>
                            <strong>{payment.reference ?? "—"}</strong>
                            <small>{humanizeStatus(payment.source)}</small>
                          </td>
                          <td>{buyerNames.get(payment.buyerId ?? "") ?? "—"}</td>
                          <td>{formatMoney(payment.net)}</td>
                          <td>{formatMoney(payment.allocatedTotal)}</td>
                          <td>
                            {payment.unallocated.minor > 0 ? (
                              <strong>{formatMoney(payment.unallocated)}</strong>
                            ) : (
                              "—"
                            )}
                          </td>
                          {mayWrite && (
                            <td>
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
                                <span className="muted">—</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </Panel>

            <Panel title="Recent payments">
              <TableScroll label="Recent payments">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Received</th>
                      <th scope="col">Source</th>
                      <th scope="col">Gross</th>
                      <th scope="col">Deductions</th>
                      <th scope="col">Sales Engine</th>
                      <th scope="col">Tax</th>
                      <th scope="col">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((payment) => (
                      <tr key={payment.id}>
                        <td>
                          {payment.receivedAt
                            ? formatDate(payment.receivedAt, { withYear: true })
                            : "—"}
                        </td>
                        <td>
                          <strong>{buyerNames.get(payment.buyerId ?? "") ?? "—"}</strong>
                          <small>{payment.reference}</small>
                        </td>
                        <td>{formatMoney(payment.gross)}</td>
                        <td>{formatMoney(payment.deductions)}</td>
                        <td>{formatMoney(payment.platformFee)}</td>
                        <td>{formatMoney(payment.tax)}</td>
                        <td>
                          <strong>{formatMoney(payment.net)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              <p className="section-note panel-body">
                Gross, deductions, the Sales Engine share, tax, and net stay separately inspectable.
                The 30% share applies only to a license generated inside Mastline.
              </p>
            </Panel>

            <Panel action={<span className="muted">{licenses.length}</span>} title="Licenses">
              {licenses.length === 0 ? (
                <div className="panel-body">
                  <p className="section-note">No licenses recorded yet.</p>
                </div>
              ) : (
                <TableScroll label="Licenses">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Licensee</th>
                        <th scope="col">Origin</th>
                        <th scope="col">Sale base</th>
                        <th scope="col">Photographer</th>
                        <th scope="col">Mastline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {licenses.map((license) => (
                        <tr key={license.id}>
                          <td>
                            <strong>{license.licenseeName}</strong>
                            <small>
                              {license.media ?? "—"}
                              {license.territory ? ` · ${license.territory}` : ""}
                            </small>
                          </td>
                          <td>
                            {license.origin === "mastline_sales_engine" ? (
                              <Badge tone="blue">Via Mastline</Badge>
                            ) : (
                              <Badge tone="neutral">Own relationship</Badge>
                            )}
                          </td>
                          <td>{formatMoney(license.saleBase)}</td>
                          <td>
                            <strong>{formatMoney(license.photographerShare)}</strong>
                          </td>
                          <td>{formatMoney(license.salesEngineShare)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </Panel>
          </div>

          <div className="stack">
            {mayWrite && (
              <Panel title="Record">
                <RecordPayment
                  workspaceSlug={workspaceSlug}
                  buyers={buyers.map((buyer) => ({ id: buyer.id, name: buyer.name }))}
                />
                <ImportStatement
                  workspaceSlug={workspaceSlug}
                  buyers={buyers.map((buyer) => ({ id: buyer.id, name: buyer.name }))}
                />
                <div className="side-card">
                  <h3>Export everything</h3>
                  <p>
                    Assets, metadata, submissions, licenses, payments, allocations, and the full
                    activity record, as CSV.
                  </p>
                  <a className="button" download href={`/api/workspaces/${workspaceSlug}/export`}>
                    Download workspace export
                  </a>
                  <p className="section-note">
                    Confidential source notes are excluded. Exporting those is a deliberate,
                    separate them.
                  </p>
                </div>
              </Panel>
            )}

            <Panel title="Receivables">
              {receivables.length === 0 && (
                <div className="side-card">
                  <p>Nothing outstanding.</p>
                </div>
              )}
              {receivables.map((payment) => (
                <div className="side-card" key={payment.id}>
                  <h3>
                    {buyerNames.get(payment.buyerId ?? "") ?? "Unknown buyer"} ·{" "}
                    {formatMoney(payment.net)}
                  </h3>
                  {payment.status === "overdue" ? (
                    <p className="danger-text">
                      Overdue{payment.dueAt ? ` since ${formatDate(payment.dueAt)}` : ""}
                    </p>
                  ) : (
                    <p>
                      Due{" "}
                      {payment.dueAt
                        ? formatDate(payment.dueAt, { withYear: true })
                        : "unscheduled"}
                    </p>
                  )}
                  <small className="muted">{payment.reference}</small>
                </div>
              ))}
            </Panel>

            <Panel title="Received by source">
              {sources.length === 0 && (
                <div className="side-card">
                  <p>No received payments yet.</p>
                </div>
              )}
              {sources.map((source) => (
                <div className="side-card" key={source.label}>
                  <div className="source-row">
                    <p>{source.label}</p>
                    <strong>{formatMoney(source.amount)}</strong>
                  </div>
                  <div
                    aria-hidden="true"
                    className="source-bar"
                    style={{ width: `${Math.round((source.amount.minor / largest) * 100)}%` }}
                  />
                </div>
              ))}
              <div className="side-card">
                <Link className="text-link" href={`/${workspaceSlug}/archive`}>
                  Open the archive <span aria-hidden="true">→</span>
                </Link>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
