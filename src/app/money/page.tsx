import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, Metric, PageHeader, Panel, PendingButton } from "@/components/primitives";
import { formatDate, humanizeStatus } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import {
  allocatedTotal,
  getBuyer,
  getMoneySummary,
  getRevenueBySource,
  listPayments,
  listReceivables,
  unallocatedRemainder,
} from "@/lib/mock/queries";

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

export default async function MoneyPage() {
  const [summary, sources, receivables, payments] = await Promise.all([
    getMoneySummary(),
    getRevenueBySource(),
    listReceivables(),
    listPayments(),
  ]);

  const reconciliation = payments.filter(
    (payment) => payment.source === "statement" || payment.status === "disputed",
  );
  const recent = payments
    .filter((payment) => payment.receivedAt)
    .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""))
    .slice(0, 4);

  const buyerNames = new Map(
    await Promise.all(
      [...new Set(payments.map((payment) => payment.buyerId))].map(
        async (id) => [id, (await getBuyer(id))?.name ?? "—"] as const,
      ),
    ),
  );

  const largest = Math.max(...sources.map((source) => source.amount.minor), 1);

  return (
    <AppShell active="Money">
      <div className="page">
        <PageHeader
          action="Import statement"
          description="Track what was reported, received, delayed, deducted, or lost."
          eyebrow="August 1–20, 2026"
          title="Revenue & payments"
        />

        <div className="metrics">
          <Metric
            label="Net received"
            tone="good"
            value={formatMoney(summary.netReceived)}
            detail="Across all sources"
          />
          <Metric
            detail={`${summary.overdueCount} overdue`}
            label="Outstanding"
            tone={summary.overdueCount > 0 ? "danger" : undefined}
            value={formatMoney(summary.outstanding)}
          />
          <Metric
            detail="Unallocated statement value"
            label="Unmatched sales"
            value={formatMoney(summary.unmatchedStatementTotal)}
          />
          <Metric
            detail="From expected to received"
            label="Average time to payment"
            value={`${summary.averageDaysToPayment} days`}
          />
        </div>

        <div className="panel-grid">
          <div className="stack">
            <Panel
              action={<span className="muted">{reconciliation.length} lines</span>}
              title="Reconciliation queue"
            >
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Status</th>
                      <th scope="col">Reference</th>
                      <th scope="col">Agency / buyer</th>
                      <th scope="col">Reported</th>
                      <th scope="col">Allocated</th>
                      <th scope="col">Difference</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconciliation.map((payment) => {
                      const remainder = unallocatedRemainder(payment);
                      return (
                        <tr key={payment.id}>
                          <td>
                            <Badge tone={STATUS_TONE[payment.status] ?? "neutral"}>
                              {humanizeStatus(payment.status)}
                            </Badge>
                          </td>
                          <td>
                            <strong>{payment.reference ?? "—"}</strong>
                            <small>
                              {remainder.minor > 0 ? "Not fully allocated" : "Fully allocated"}
                            </small>
                          </td>
                          <td>{buyerNames.get(payment.buyerId) ?? "—"}</td>
                          <td>{formatMoney(payment.net)}</td>
                          <td>{formatMoney(allocatedTotal(payment))}</td>
                          <td>{remainder.minor > 0 ? formatMoney(remainder) : "—"}</td>
                          <td>
                            <PendingButton small>
                              {remainder.minor > 0 ? "Match" : "View"}
                            </PendingButton>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Recent payments">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Received</th>
                      <th scope="col">Source</th>
                      <th scope="col">Gross</th>
                      <th scope="col">Deductions</th>
                      <th scope="col">Sales Engine</th>
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
                          <strong>{buyerNames.get(payment.buyerId) ?? "—"}</strong>
                          <small>{payment.reference}</small>
                        </td>
                        <td>{formatMoney(payment.gross)}</td>
                        <td>{formatMoney(payment.deductions)}</td>
                        <td>{formatMoney(payment.platformFee)}</td>
                        <td>
                          <strong>{formatMoney(payment.net)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="section-note panel-body">
                Gross, deductions, the Sales Engine share, and net stay separately inspectable. The
                30% share applies only to a license generated inside Mastline.
              </p>
            </Panel>
          </div>

          <div className="stack">
            <Panel title="Receivables">
              {receivables.map((receivable) => (
                <div className="side-card" key={receivable.payment.id}>
                  <h3>
                    {receivable.buyerName} · {formatMoney(receivable.payment.net)}
                  </h3>
                  {receivable.daysOverdue > 0 ? (
                    <p className="danger-text">
                      Overdue {receivable.daysOverdue}{" "}
                      {receivable.daysOverdue === 1 ? "day" : "days"}
                    </p>
                  ) : (
                    <p>
                      Due{" "}
                      {receivable.payment.dueAt
                        ? formatDate(receivable.payment.dueAt, { withYear: true })
                        : "—"}
                    </p>
                  )}
                  <PendingButton small>
                    {receivable.daysOverdue > 0 ? "Prepare follow-up" : "View invoice"}
                  </PendingButton>
                </div>
              ))}
            </Panel>

            <Panel title="This period by source">
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
                <Link className="text-link" href="/archive">
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
