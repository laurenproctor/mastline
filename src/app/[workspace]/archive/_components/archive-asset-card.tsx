import Link from "next/link";
import styles from "../archive.module.css";
import type { ArchiveCard } from "../archive-view-model";

/**
 * One photograph, as a contact-sheet record.
 *
 * Top to bottom: the picture, when it was taken, what it is called, and what
 * has happened to it commercially. Nothing on the card is inferred -- the date
 * is the capture time, the money is what payments allocated to this asset, and
 * a card with no preview says so rather than borrowing one.
 *
 * The headline is the card's single link, stretched over the whole record in
 * the stylesheet, so a photograph is one stop in the tab order and the image
 * is clickable without a second anchor.
 */
export function ArchiveAssetCard({ card }: { card: ArchiveCard }) {
  const { commercial } = card;
  const earned = commercial.kind === "earned";

  return (
    <article className={styles.card} data-commercial={commercial.kind}>
      <figure className={styles.cardFigure}>
        {card.previewUrl ? (
          // The preview is a private derivative behind a short-lived signed
          // link; next/image would put its address through an optimizer that
          // cannot read it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className={styles.cardImage}
            decoding="async"
            loading="lazy"
            src={card.previewUrl}
          />
        ) : (
          <div aria-hidden="true" className={styles.cardPlaceholder}>
            No preview
          </div>
        )}
        {card.capturedAt && card.capturedLabel && (
          <time className={styles.cardDate} dateTime={card.capturedAt}>
            {card.capturedLabel}
          </time>
        )}
      </figure>

      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>
          <Link
            className={`${styles.cardTitleLink}${card.titleIsFilename ? ` ${styles.cardFilename}` : ""}`}
            href={card.href}
          >
            {card.title}
          </Link>
        </h3>
        {card.caption && <p className={styles.cardCaption}>{card.caption}</p>}
      </div>

      <div className={`${styles.cardCommercial}${earned ? ` ${styles.cardCommercialEarned}` : ""}`}>
        <p className={styles.cardState}>
          <strong>{commercial.label}</strong>
          {commercial.amount && <span className={styles.cardAmount}>{commercial.amount}</span>}
        </p>
        {commercial.detail && <p className={styles.cardDetail}>{commercial.detail}</p>}
      </div>
    </article>
  );
}
