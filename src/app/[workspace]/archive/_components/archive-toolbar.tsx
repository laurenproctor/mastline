import Link from "next/link";
import type { WorkspaceRoutes } from "@/lib/workspace-routes";
import styles from "../archive.module.css";
import { type ArchiveState, COMMERCIAL_FILTERS, archiveHref } from "../archive-view-model";
import { GridIcon, ListIcon } from "./archive-icons";

/**
 * The persistent controls: commercial state, the order, and the view.
 *
 * Commercial state has three values, so it can afford to stay on screen. The
 * high-cardinality dimensions -- who, where, what -- are what the search field
 * is for; they are not offered as menus.
 *
 * The order is shown, not chosen. The search returns newest capture first and
 * nothing else, so a menu with one entry would be a control that does nothing.
 */
export function ArchiveToolbar({
  routes,
  state,
}: {
  routes: WorkspaceRoutes;
  state: ArchiveState;
}) {
  return (
    <div className={styles.toolbar}>
      <nav aria-label="Commercial state" className={styles.segmented}>
        {COMMERCIAL_FILTERS.map((entry) => (
          <Link
            aria-current={state.filter === entry.value ? "true" : undefined}
            className={styles.segment}
            href={archiveHref(routes, state, { filter: entry.value })}
            key={entry.value}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      <div className={styles.toolbarRight}>
        <p className={styles.sort} title="The archive is ordered by capture time, newest first.">
          Sort: <strong>Newest captured</strong>
        </p>
        <div aria-label="View" className={styles.viewToggle} role="group">
          <Link
            aria-current={state.view === "grid" ? "true" : undefined}
            aria-label="Grid view"
            className={styles.viewButton}
            href={archiveHref(routes, state, { view: "grid" })}
            title="Grid"
          >
            <GridIcon />
          </Link>
          <Link
            aria-current={state.view === "list" ? "true" : undefined}
            aria-label="List view"
            className={styles.viewButton}
            href={archiveHref(routes, state, { view: "list" })}
            title="List"
          >
            <ListIcon />
          </Link>
        </div>
      </div>
    </div>
  );
}
