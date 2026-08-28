import Link from "next/link";
import type { WorkQueueMoneySummary } from "@/lib/data/work-queue";
import { formatMoney } from "@/lib/money";
import type { WorkspaceRoutes } from "@/lib/workspace-routes";

/**
 * Three factual sums, from recorded payment and submission states alone.
 * No forecasts, no potential value: money that is awaited, money that
 * arrived unattributed, and submissions still without an outcome.
 */
export function MoneyReconcile({
  money,
  routes,
}: {
  money: WorkQueueMoneySummary;
  routes: WorkspaceRoutes;
}) {
  return (
    <section aria-labelledby="money-reconcile-heading" className="panel work-money-strip">
      <h2 className="work-money-label" id="money-reconcile-heading">
        Money to reconcile
      </h2>

      <div className="work-money-cell">
        <strong>
          {formatMoney(money.expectedNet)} <span>expected</span>
        </strong>
        <p>
          {money.expectedCount} {money.expectedCount === 1 ? "payment" : "payments"} awaiting
          receipt
        </p>
        <Link className="text-link" href={routes.money()}>
          View money <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="work-money-cell">
        <strong>
          {formatMoney(money.unallocatedNet)} <span>received but unallocated</span>
        </strong>
        <p>
          {money.unallocatedCount}{" "}
          {money.unallocatedCount === 1 ? "payment needs" : "payments need"} allocation
        </p>
        <Link className="text-link" href={routes.money()}>
          Allocate payment <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="work-money-cell">
        <strong>
          {money.awaitingOutcomeCount} <span>awaiting outcome</span>
        </strong>
        <p>
          {money.awaitingOutcomeCount === 1 ? "Submission" : "Submissions"} with no sale or no-sale
          recorded
        </p>
        <Link className="text-link" href={routes.submissions()}>
          View submissions <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
