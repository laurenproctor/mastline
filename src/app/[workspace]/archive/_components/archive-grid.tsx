import Link from "next/link";
import { TableScroll } from "@/components/primitives";
import styles from "../archive.module.css";
import type { ArchiveCard } from "../archive-view-model";
import { ArchiveAssetCard } from "./archive-asset-card";

/** The results as a contact sheet. */
export function ArchiveGrid({ cards }: { cards: readonly ArchiveCard[] }) {
  return (
    <ul className={styles.grid}>
      {cards.map((card) => (
        <li key={card.assetId}>
          <ArchiveAssetCard card={card} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The same records as a table.
 *
 * Commercial facts read better in columns: the eye can run down "Earned" and
 * see which frames paid. Same rows, same order, same links as the grid.
 */
export function ArchiveList({ cards }: { cards: readonly ArchiveCard[] }) {
  return (
    <TableScroll label="Archive results">
      <table className={styles.list}>
        <thead>
          <tr>
            <th scope="col">
              <span className={styles.srOnly}>Preview</span>
            </th>
            <th scope="col">Photograph</th>
            <th scope="col">Captured</th>
            <th className={styles.num} scope="col">
              Packages
            </th>
            <th className={styles.num} scope="col">
              Earned
            </th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => {
            const { commercial } = card;
            return (
              <tr key={card.assetId}>
                <td className={styles.listThumbCell}>
                  {card.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      className={styles.listThumb}
                      decoding="async"
                      loading="lazy"
                      src={card.previewUrl}
                    />
                  ) : (
                    <div aria-hidden="true" className={styles.listThumbEmpty} />
                  )}
                </td>
                <td>
                  <Link
                    className={`${styles.listTitle}${card.titleIsFilename ? ` ${styles.cardFilename}` : ""}`}
                    href={card.href}
                  >
                    {card.title}
                  </Link>
                  {card.caption && <span className={styles.listCaption}>{card.caption}</span>}
                </td>
                <td className={styles.quiet}>
                  {card.capturedAt && card.capturedLabel ? (
                    <time dateTime={card.capturedAt}>{card.capturedLabel}</time>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={styles.num}>
                  {commercial.kind === "never_sent" ? (
                    <span className={styles.quiet}>Never sent</span>
                  ) : commercial.kind === "sent" ? (
                    commercial.label
                  ) : (
                    (commercial.detail ?? "—")
                  )}
                </td>
                <td className={styles.num}>
                  {commercial.amount ? (
                    <span className={styles.earned}>{commercial.amount}</span>
                  ) : (
                    <span className={styles.quiet}>No recorded sale</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}
