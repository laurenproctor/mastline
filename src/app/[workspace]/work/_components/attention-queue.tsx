import Link from "next/link";
import { Badge } from "@/components/primitives";
import {
  WORK_QUEUE_FILTERS,
  type WorkQueueCounts,
  type WorkQueueFilter,
  type WorkQueueItem,
} from "@/lib/data/work-queue";
import type { WorkspaceRoutes } from "@/lib/workspace-routes";
import { elapsedLabel } from "./next-up";

const KIND_TONE = {
  Shoot: "warn",
  Dispatch: "blue",
  Submission: "blue",
  Money: "warn",
} as const;

function countFor(counts: WorkQueueCounts, filter: WorkQueueFilter): number {
  switch (filter) {
    case "all":
      return counts.all;
    case "in-preparation":
      return counts.inPreparation;
    case "ready-to-send":
      return counts.readyToSend;
    case "awaiting-outcome":
      return counts.awaitingOutcome;
    case "money":
      return counts.money;
  }
}

/**
 * The ranked remainder of the queue, behind server-rendered filters.
 *
 * The first item of the queue is already on the Next up board, so under "All"
 * it is not repeated here; a chosen filter shows everything it matches. Counts
 * always describe the whole queue, so filtering cannot change what appears to
 * exist.
 */
export function AttentionQueue({
  items,
  counts,
  filter,
  nextUpId,
  routes,
  now,
}: {
  items: readonly WorkQueueItem[];
  counts: WorkQueueCounts;
  filter: WorkQueueFilter;
  nextUpId: string | null;
  routes: WorkspaceRoutes;
  now: Date;
}) {
  const visible =
    filter === "all"
      ? items.filter((item) => item.id !== nextUpId)
      : items.filter((item) => item.category === filter);

  return (
    <section aria-labelledby="attention-heading" className="panel work-attention">
      <div className="panel-head">
        <h2 id="attention-heading">Needs attention</h2>
      </div>

      <nav aria-label="Queue filters" className="work-filter-list">
        <ul>
          {WORK_QUEUE_FILTERS.map(({ key, label }) => (
            <li key={key}>
              <Link
                aria-current={filter === key ? "true" : undefined}
                className={filter === key ? "work-filter active" : "work-filter"}
                href={routes.work(key === "all" ? undefined : { query: { queue: key } })}
              >
                {label} <span className="work-filter-count">{countFor(counts, key)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {visible.length === 0 ? (
        <div className="panel-body">
          <p className="section-note">
            {filter === "all"
              ? "Nothing else needs attention."
              : "Nothing in this part of the queue needs attention."}
          </p>
        </div>
      ) : (
        <ol className="work-attention-list">
          {visible.map((item, index) => (
            <li
              className={item.urgent ? "work-attention-row danger" : "work-attention-row"}
              key={item.id}
            >
              <span aria-hidden="true" className="work-attention-rank">
                {index + 1}
              </span>
              <Badge tone={item.urgent ? "danger" : KIND_TONE[item.kind]}>{item.kind}</Badge>
              <div className="work-attention-text">
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </div>
              <span className="age">{elapsedLabel(item.occurredAt, now)}</span>
              <Link className="row-action" href={item.href}>
                {item.actionLabel} <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
