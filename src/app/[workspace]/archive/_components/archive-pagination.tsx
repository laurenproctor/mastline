import Link from "next/link";
import type { WorkspaceRoutes } from "@/lib/workspace-routes";
import styles from "../archive.module.css";
import {
  type ArchiveState,
  archiveHref,
  formatCount,
  pageWindow,
  resultRange,
} from "../archive-view-model";

/**
 * Moving through a large archive.
 *
 * The page size is the search function's, and the numbers are the database's
 * count for this query, so "Showing 25–48 of 6,842" is a statement about the
 * rows, not about the screen.
 */
export function ArchivePagination({
  routes,
  state,
  page,
  pageSize,
  total,
  totalPages,
}: {
  routes: WorkspaceRoutes;
  state: ArchiveState;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}) {
  const range = resultRange(page, pageSize, total);
  const previous = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);

  return (
    <nav aria-label="Archive pages" className={styles.pagination}>
      <p>
        Showing {formatCount(range.from)}–{formatCount(range.to)} of {formatCount(total)}{" "}
        {total === 1 ? "asset" : "assets"}
      </p>
      <div className={styles.pageLinks}>
        <Link
          aria-disabled={page <= 1 ? "true" : undefined}
          aria-label="Previous page"
          className={styles.pageLink}
          href={archiveHref(routes, state, { page: previous })}
          tabIndex={page <= 1 ? -1 : undefined}
        >
          ‹
        </Link>
        {pageWindow(page, totalPages).map((token, index) =>
          token === "gap" ? (
            <span aria-hidden="true" className={styles.pageGap} key={`gap-${index}`}>
              …
            </span>
          ) : (
            <Link
              aria-current={token === page ? "page" : undefined}
              aria-label={`Page ${token}`}
              className={styles.pageLink}
              href={archiveHref(routes, state, { page: token })}
              key={token}
            >
              {formatCount(token)}
            </Link>
          ),
        )}
        <Link
          aria-disabled={page >= totalPages ? "true" : undefined}
          aria-label="Next page"
          className={styles.pageLink}
          href={archiveHref(routes, state, { page: next })}
          tabIndex={page >= totalPages ? -1 : undefined}
        >
          ›
        </Link>
      </div>
    </nav>
  );
}
