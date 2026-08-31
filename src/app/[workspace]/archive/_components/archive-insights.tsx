import Link from "next/link";
import type { ArchiveInsights as Insights } from "@/lib/data/archive";
import { formatDate } from "@/lib/format";
import type { WorkspaceRoutes } from "@/lib/workspace-routes";
import styles from "../archive.module.css";
import { type ArchiveState, archiveHref, formatCount } from "../archive-view-model";

/**
 * The archive's own figures, for the whole workspace rather than the current
 * search.
 *
 * Each count is a fact the search function already answers, so clicking one
 * shows exactly the assets it counted. What is deliberately absent: a total
 * earned, which the data API will not aggregate for us and which would
 * otherwise be a sum over every asset; packages sent, whose meaning is being
 * settled on another branch; and a feed of activity, which the Work Queue
 * already shows. A rail with four true figures beats one with eight guesses.
 */
export function ArchiveInsights({
  insights,
  routes,
  state,
}: {
  insights: Insights;
  routes: WorkspaceRoutes;
  state: ArchiveState;
}) {
  const whole: ArchiveState = { ...state, query: "", page: 1 };

  return (
    <aside aria-labelledby="archive-insights-heading" className={styles.rail}>
      <div className={styles.railHead}>
        <h2 id="archive-insights-heading">Archive insights</h2>
        <span className={styles.railScope}>All time</span>
      </div>
      <ul className={styles.railList}>
        <li>
          <Link className={styles.railRow} href={archiveHref(routes, whole, { filter: "all" })}>
            <span className={styles.railValue}>{formatCount(insights.totalAssets)}</span>
            <span className={styles.railLabel}>Total assets</span>
          </Link>
        </li>
        <li>
          <Link className={styles.railRow} href={archiveHref(routes, whole, { filter: "earning" })}>
            <span className={`${styles.railValue} ${styles.earned}`}>
              {formatCount(insights.earningAssets)}
            </span>
            <span className={styles.railLabel}>Has earned</span>
          </Link>
        </li>
        <li>
          <Link className={styles.railRow} href={archiveHref(routes, whole, { filter: "unsold" })}>
            <span className={styles.railValue}>{formatCount(insights.unsoldAssets)}</span>
            <span className={styles.railLabel}>No recorded sale</span>
          </Link>
        </li>
        {insights.oldestCapturedAt && (
          <li>
            <div className={styles.railRow}>
              <span className={styles.railValue}>
                <time dateTime={insights.oldestCapturedAt}>
                  {formatDate(insights.oldestCapturedAt, { withYear: true })}
                </time>
              </span>
              <span className={styles.railLabel}>Oldest capture</span>
            </div>
          </li>
        )}
        {insights.latestCapturedAt && (
          <li>
            <div className={styles.railRow}>
              <span className={styles.railValue}>
                <time dateTime={insights.latestCapturedAt}>
                  {formatDate(insights.latestCapturedAt, { withYear: true })}
                </time>
              </span>
              <span className={styles.railLabel}>Latest capture</span>
            </div>
          </li>
        )}
      </ul>
      <p className={styles.railNote}>
        Counts are of live assets in this workspace. An asset has earned when a payment was
        allocated to it.
      </p>
    </aside>
  );
}
