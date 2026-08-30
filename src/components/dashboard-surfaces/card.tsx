import "@/styles/mastline-dashboard-surfaces.css";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  assertNoInteractiveChildren,
  classes,
  type HeadingLevel,
  type SurfaceTone,
} from "./shared";

/**
 * A card is one object: a shoot, a buyer, an opportunity, a figure. It is the
 * unit a grid is made of. It does not nest inside another card.
 */
export function Card({
  as: Tag = "div",
  compact = false,
  className,
  children,
  ...rest
}: {
  as?: "div" | "article" | "li";
  compact?: boolean;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  id?: string;
}) {
  return (
    <Tag className={classes("ml-card", compact && "ml-card--compact", className)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * A card that is a link.
 *
 * The whole surface is one anchor, so it has one accessible name -- `label`,
 * or the card's text content when no label is given -- and one target. It
 * therefore cannot contain a button or another link: that would be a control
 * inside a control, which the browser resolves by guesswork. The check runs
 * on the element tree it is handed; a control hidden inside a child component
 * is the caller's responsibility, and the stylesheet's job is to make the
 * card look like what it is.
 */
export function CardLink({
  href,
  label,
  compact = false,
  className,
  children,
}: {
  href: string;
  /** The accessible name, when the card's text is not already a good one. */
  label?: string;
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  assertNoInteractiveChildren(children, "CardLink");
  return (
    <Link
      aria-label={label}
      className={classes(
        "ml-card",
        "ml-card--interactive",
        "ml-card-link",
        compact && "ml-card--compact",
        className,
      )}
      href={href}
    >
      {children}
    </Link>
  );
}

/**
 * The one thing that deserves attention now, with a rule down its edge in
 * the tone of why. The tone is a meaning from a finite set; the title says
 * the same thing in words, so the rule is never the only signal.
 */
export function PriorityCard({
  tone = "neutral",
  title,
  level = 3,
  description,
  meta,
  leading,
  action,
  className,
}: {
  tone?: SurfaceTone;
  title: ReactNode;
  level?: HeadingLevel;
  description?: ReactNode;
  /** Facts beside the title: an age, a buyer, a count. */
  meta?: ReactNode;
  /** A badge or an icon before the copy. Decorative or already labelled. */
  leading?: ReactNode;
  /** The one control for this card, rendered as given. */
  action?: ReactNode;
  className?: string;
}) {
  const Heading = `h${level}` as const;
  return (
    <article className={classes("ml-priority-card", className)} data-tone={tone}>
      {leading !== undefined && leading !== null ? (
        <div className="ml-priority-card__leading">{leading}</div>
      ) : (
        <span
          aria-hidden="true"
          className="ml-priority-card__leading ml-priority-card__leading--empty"
        />
      )}
      <div className="ml-priority-card__copy">
        <Heading className="ml-priority-card__title">{title}</Heading>
        {description && <p className="ml-priority-card__description">{description}</p>}
        {meta && <div className="ml-priority-card__meta">{meta}</div>}
      </div>
      {action && <div className="ml-priority-card__action">{action}</div>}
    </article>
  );
}

export type StatDirection = "up" | "down" | "flat";

/**
 * A figure with its name, and optionally how it moved. The delta's label
 * carries the direction in words ("up 12% on last month"); the arrow and the
 * colour only repeat it.
 */
export function StatCard({
  label,
  value,
  detail,
  delta,
  tone,
  className,
}: {
  label: ReactNode;
  /** Already formatted by the caller: "$2,788", "30 min", "61%". */
  value: ReactNode;
  detail?: ReactNode;
  delta?: { direction: StatDirection; label: ReactNode };
  /** For the detail line, when it is a state: "1 overdue" in danger. */
  tone?: SurfaceTone;
  className?: string;
}) {
  return (
    <div className={classes("ml-stat-card", className)}>
      <span className="ml-stat-card__label">{label}</span>
      <strong className="ml-stat-card__value">{value}</strong>
      {(detail || delta) && (
        <div className="ml-stat-card__foot">
          {delta && (
            <span className="ml-stat-card__delta" data-direction={delta.direction}>
              <span aria-hidden="true" className="ml-stat-card__delta-mark">
                {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "▬"}
              </span>{" "}
              {delta.label}
            </span>
          )}
          {detail && (
            <span className="ml-stat-card__detail" data-tone={tone}>
              {detail}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
