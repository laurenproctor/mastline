import Link from "next/link";
import type { WorkspaceRoutes } from "@/lib/workspace-routes";
import styles from "../archive.module.css";
import { type ArchiveState, activeConstraints, archiveHref, plural } from "../archive-view-model";

/**
 * What is narrowing the results, and how many there are.
 *
 * Each constraint is a chip with its own remove link, so a search can be
 * loosened one term at a time without retyping. The row is a summary of the
 * state, not another toolbar: it holds only what is actually constraining the
 * results, and nothing when nothing is.
 *
 * The count is a heading because it is what the results section is called:
 * "3 matches" when something narrowed them, "89 assets" when nothing did.
 */
export function ArchiveActiveFilters({
  routes,
  state,
  total,
}: {
  routes: WorkspaceRoutes;
  state: ArchiveState;
  total: number;
}) {
  const constraints = activeConstraints(routes, state);
  const searching = constraints.length > 0;

  return (
    <div className={styles.resultsRow}>
      {searching && (
        <div aria-label="Active filters" className={styles.chips} role="group">
          {constraints.map((constraint) => (
            <span className={styles.chip} key={constraint.key}>
              {constraint.label}
              <Link
                aria-label={`Remove ${constraint.label}`}
                className={styles.chipRemove}
                href={constraint.removeHref}
              >
                ×
              </Link>
            </span>
          ))}
          {constraints.length > 1 && (
            <Link
              className={styles.clearAll}
              href={archiveHref(routes, state, { query: "", filter: "all" })}
            >
              Clear all
            </Link>
          )}
        </div>
      )}
      <h2 className={styles.count}>
        {searching ? plural(total, "match", "matches") : plural(total, "asset", "assets")}
      </h2>
    </div>
  );
}
