import Link from "next/link";
import styles from "../archive.module.css";
import { filterLabel } from "../archive-view-model";
import type { ArchiveState } from "../archive-view-model";

/**
 * Nothing to show, for one of three reasons that must not be confused.
 *
 * An empty archive has no photographs at all. Zero results means the archive
 * has plenty, and this search excluded them all. A page past the end means
 * the address asked for more pages than there are. Each says which, and offers
 * the way out of that one.
 */
export function ArchiveEmptyState({
  kind,
  state,
  importHref,
  clearSearchHref,
  clearFilterHref,
  firstPageHref,
}: {
  kind: "empty" | "no-results" | "past-end";
  state: ArchiveState;
  /** Present only when the caller may import. */
  importHref?: string;
  clearSearchHref?: string;
  clearFilterHref?: string;
  firstPageHref?: string;
}) {
  if (kind === "empty") {
    return (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>No photographs yet</h2>
        <p>
          Import a shoot and its originals, captions, and every later package, submission, and
          payment are kept here, together.
        </p>
        {importHref && (
          <div className={styles.emptyActions}>
            <Link className="button primary" href={importHref}>
              Import a shoot
            </Link>
          </div>
        )}
      </div>
    );
  }

  if (kind === "past-end") {
    return (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>No more results</h2>
        <p>This page is past the end of the results.</p>
        {firstPageHref && (
          <div className={styles.emptyActions}>
            <Link className="button" href={firstPageHref}>
              Back to the first page
            </Link>
          </div>
        )}
      </div>
    );
  }

  const parts: string[] = [];
  if (state.query) parts.push(`“${state.query}”`);
  if (state.filter !== "all") parts.push(filterLabel(state.filter).toLowerCase());

  return (
    <div className={styles.empty}>
      <h2 className={styles.emptyTitle}>Nothing matches</h2>
      <p>
        No asset in this archive matches {parts.join(" with ")}. The photographs are still here;
        loosen the search to see them.
      </p>
      <div className={styles.emptyActions}>
        {clearSearchHref && (
          <Link className="button" href={clearSearchHref}>
            Clear search
          </Link>
        )}
        {clearFilterHref && (
          <Link className="button" href={clearFilterHref}>
            Clear filters
          </Link>
        )}
      </div>
    </div>
  );
}
