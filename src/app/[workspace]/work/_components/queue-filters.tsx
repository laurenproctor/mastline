import { FilterBar, FilterLink } from "@/components/filter-chip";
import {
  WORK_QUEUE_FILTERS,
  type WorkQueueCounts,
  type WorkQueueFilter,
} from "@/lib/data/work-queue";

/**
 * The `?queue=` filters: links to the same page with a different query, so
 * the server filters, the address is shareable, and the current one is
 * marked with aria-current. Nothing else in the query string is touched --
 * a filter narrows the queue, it does not reset the rest of the address.
 */

const COUNT_KEY: Record<WorkQueueFilter, keyof WorkQueueCounts> = {
  all: "all",
  "in-preparation": "inPreparation",
  "ready-to-send": "readyToSend",
  "awaiting-outcome": "awaitingOutcome",
  money: "money",
};

/** The address for a filter, keeping every other parameter as it was. */
export function queueFilterHref(
  basePath: string,
  params: URLSearchParams,
  filter: WorkQueueFilter,
): string {
  const next = new URLSearchParams(params);
  if (filter === "all") next.delete("queue");
  else next.set("queue", filter);
  const query = next.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function QueueFilters({
  basePath,
  counts,
  current,
  params,
}: {
  basePath: string;
  counts: WorkQueueCounts;
  current: WorkQueueFilter;
  params: URLSearchParams;
}) {
  return (
    <nav aria-label="Queue filters" className="ml-work-queue-filters">
      <FilterBar>
        {WORK_QUEUE_FILTERS.map((filter) => (
          <FilterLink
            current={filter.key === current}
            href={queueFilterHref(basePath, params, filter.key)}
            key={filter.key}
          >
            {filter.label}
            <span className="ml-work-queue-filters__count">{counts[COUNT_KEY[filter.key]]}</span>
          </FilterLink>
        ))}
      </FilterBar>
    </nav>
  );
}
