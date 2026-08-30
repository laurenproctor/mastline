import { Badge } from "@/components/badge";
import { ActionLink } from "@/components/button";
import { EmptyState, PriorityCard, SectionHeader } from "@/components/dashboard-surfaces";
import type { WorkQueueItem } from "@/lib/data/work-queue";
import { formatElapsed } from "@/lib/format";
import { KIND_TONE } from "./tones";

/**
 * The first item of the ranked queue, made unmissable. It is the same record
 * the list below starts with, not a separate idea: the card repeats the
 * item's own basis rather than inventing a reason of its own.
 */
export function WorkNextUp({ item, now }: { item: WorkQueueItem | null; now: Date }) {
  return (
    <section aria-labelledby="work-next-up" className="ml-work-queue-next">
      <SectionHeader
        description="The first item of the queue, ranked by what the record shows."
        id="work-next-up"
        title="Next up"
      />
      {item ? (
        <PriorityCard
          action={
            <ActionLink href={item.href} variant="primary">
              {item.actionLabel}
            </ActionLink>
          }
          description={item.detail}
          leading={<Badge tone={KIND_TONE[item.kind]}>{item.kind}</Badge>}
          meta={
            <>
              <span>{item.rankingBasis}</span>
              <span aria-hidden="true"> · </span>
              <span>
                {item.urgent
                  ? "Urgent"
                  : item.occurredAt
                    ? formatElapsed(item.occurredAt, now)
                    : "—"}
              </span>
            </>
          }
          title={item.title}
          tone={item.urgent ? "danger" : "neutral"}
        />
      ) : (
        <EmptyState
          compact
          description="Nothing is blocked. Create a shoot, or record an outcome when a buyer replies."
          level={3}
          title="Everything is up to date"
        />
      )}
    </section>
  );
}
