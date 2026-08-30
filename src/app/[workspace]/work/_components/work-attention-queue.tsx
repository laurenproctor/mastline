import { Badge } from "@/components/badge";
import { ActionLink } from "@/components/button";
import {
  EmptyState,
  OperationalList,
  OperationalListRow,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/dashboard-surfaces";
import type { WorkQueueCounts, WorkQueueFilter, WorkQueueItem } from "@/lib/data/work-queue";
import { formatElapsed } from "@/lib/format";
import { QueueFilters } from "./queue-filters";
import { KIND_TONE } from "./tones";

/**
 * The ranked queue behind its filters. Every row is a record with a stated
 * basis and one explicit action; the row itself is never a control.
 */
export function WorkAttentionQueue({
  basePath,
  counts,
  filter,
  now,
  params,
  rows,
}: {
  basePath: string;
  counts: WorkQueueCounts;
  filter: WorkQueueFilter;
  now: Date;
  params: URLSearchParams;
  /** The queue already narrowed to `filter`, in ranking order. */
  rows: readonly WorkQueueItem[];
}) {
  return (
    <Panel aria-labelledby="work-attention">
      <PanelHeader id="work-attention" meta={`Now · ${counts.all}`} title="Needs attention" />
      <QueueFilters basePath={basePath} counts={counts} current={filter} params={params} />
      <PanelBody flush>
        {rows.length === 0 ? (
          counts.all === 0 ? (
            <EmptyState
              compact
              description="Nothing is blocked. Create a shoot, or record an outcome when a buyer replies."
              level={3}
              title="Everything is up to date"
            />
          ) : (
            <EmptyState
              compact
              description="Choose another filter, or All, to see the rest of the queue."
              level={3}
              title="Nothing in this part of the queue"
            />
          )
        ) : (
          <OperationalList label="Ranked queue">
            {rows.map((item) => (
              <OperationalListRow
                action={
                  <ActionLink href={item.href} size="sm" variant="secondary">
                    {item.actionLabel}
                  </ActionLink>
                }
                date={
                  item.urgent
                    ? "Urgent"
                    : item.occurredAt
                      ? formatElapsed(item.occurredAt, now)
                      : "—"
                }
                key={item.id}
                level={3}
                meta={
                  <>
                    <span>{item.detail}</span>
                    <span className="ml-work-queue-basis">{item.rankingBasis}</span>
                  </>
                }
                priority={item.urgent ? "high" : "normal"}
                priorityLabel="Urgent"
                status={<Badge tone={KIND_TONE[item.kind]}>{item.kind}</Badge>}
                title={item.title}
              />
            ))}
          </OperationalList>
        )}
      </PanelBody>
    </Panel>
  );
}
