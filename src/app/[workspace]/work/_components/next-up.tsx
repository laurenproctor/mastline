import Link from "next/link";
import type { WorkQueueItem } from "@/lib/data/work-queue";
import { formatDate, formatElapsed } from "@/lib/format";

/** "42 min" reads as an amount; "Yesterday" already reads as a time. */
export function elapsedLabel(iso: string, now: Date): string {
  if (!iso) return "—";
  const text = formatElapsed(iso, now);
  return /^\d/.test(text) ? `${text} ago` : text;
}

function timeLine(item: WorkQueueItem, now: Date): string {
  if (!item.occurredAt) return "";
  if (item.priority === 2) return `Was due ${formatDate(item.occurredAt)}`;
  if (item.priority === 3) return `Follow-up date was ${formatDate(item.occurredAt)}`;
  if (item.priority === 4) return `Started ${elapsedLabel(item.occurredAt, now)}`;
  return elapsedLabel(item.occurredAt, now);
}

/**
 * The first item of the deterministic queue, made unmissable. Not a separate
 * recommendation: whatever ranks first is what renders here, red only when the
 * record itself is a failure, an overdue payment, or a passed follow-up date.
 */
export function NextUp({ item, now }: { item: WorkQueueItem | null; now: Date }) {
  if (!item) {
    return (
      <section aria-labelledby="next-up-heading" className="work-next-up complete">
        <h2 className="eyebrow" id="next-up-heading">
          Next up
        </h2>
        <div className="work-next-up-body">
          <div>
            <p className="work-next-up-title">Everything is up to date</p>
            <p className="work-next-up-detail">Import a shoot or wait for recipient activity.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="next-up-heading"
      className={item.urgent ? "work-next-up danger" : "work-next-up"}
    >
      <h2 className="eyebrow" id="next-up-heading">
        Next up
      </h2>
      <div className="work-next-up-body">
        <span aria-hidden="true" className="work-next-up-mark">
          →
        </span>
        <div className="work-next-up-text">
          <p className="work-next-up-title">{item.title}</p>
          <p className="work-next-up-detail">{item.detail}</p>
        </div>
        <span className="work-next-up-age">{timeLine(item, now)}</span>
        <Link className="row-action work-next-up-action" href={item.href}>
          {item.actionLabel} <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
