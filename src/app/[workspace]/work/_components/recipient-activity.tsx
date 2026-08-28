import Link from "next/link";
import type { RecipientActivityItem } from "@/lib/data/work-queue";
import type { WorkspaceRoutes } from "@/lib/workspace-routes";
import { elapsedLabel } from "./next-up";

/**
 * What recipients demonstrably did with delivery links: opens, acceptances,
 * refusals, and authorized downloads. Evidence only -- there is no per-photo
 * view event in the record, and none is invented here. IP addresses and user
 * agents stay on the submission's own record.
 */
export function RecipientActivity({
  items,
  routes,
  now,
}: {
  items: readonly RecipientActivityItem[];
  routes: WorkspaceRoutes;
  now: Date;
}) {
  return (
    <section aria-labelledby="recipient-activity-heading" className="panel work-recipient-activity">
      <div className="panel-head">
        <h2 id="recipient-activity-heading">Recent recipient activity</h2>
        <Link className="text-link" href={routes.submissions()}>
          View submissions <span aria-hidden="true">→</span>
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="panel-body">
          <p className="section-note">
            No recipient activity yet. Opens, acceptances, refusals, and authorized downloads will
            appear here.
          </p>
        </div>
      ) : (
        <ul className="work-recipient-list">
          {items.map((item) => (
            <li key={item.id}>
              <Link className="work-recipient-row" href={item.href}>
                <span className="work-recipient-text">
                  <strong>{item.recipient}</strong> {item.description}
                </span>
                <span className="age">{elapsedLabel(item.occurredAt, now)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
