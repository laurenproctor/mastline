import "@/styles/mastline-dashboard-surfaces.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { classes, type HeadingLevel } from "./shared";

/**
 * A list of things that each have one obvious next action: the queue, the
 * recent activity, the delivery links on a submission.
 *
 * Each row is a set of named regions -- status, title and metadata, date,
 * action -- laid out on one line where there is room and wrapped in reading
 * order where there is not. The row itself is never the control: the title
 * may be a link and the action is a link or button, and they sit beside each
 * other, so a keyboard reaches each one and a click lands where it looks.
 */
export function OperationalList({
  label,
  compact = false,
  className,
  children,
}: {
  /** Names the list for assistive technology when the heading does not. */
  label?: string;
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul
      aria-label={label}
      className={classes(
        "ml-list",
        "ml-operational-list",
        compact && "ml-operational-list--compact",
        className,
      )}
    >
      {children}
    </ul>
  );
}

export type RowPriority = "normal" | "high";

export function OperationalListRow({
  title,
  href,
  level = 3,
  meta,
  status,
  date,
  action,
  priority = "normal",
  priorityLabel = "Urgent",
  className,
}: {
  title: ReactNode;
  /** Makes the title a link to the object. The action stays separate. */
  href?: string;
  level?: HeadingLevel;
  /** The explanation under the title: why this needs attention. */
  meta?: ReactNode;
  /** A Badge, usually. Sits before the title, where a state belongs. */
  status?: ReactNode;
  /** An age or a timestamp, immediately before the action. */
  date?: ReactNode;
  /** The row's one next action, as given: an ActionLink, a TextLink, a Button. */
  action?: ReactNode;
  priority?: RowPriority;
  /** Said in words for a high-priority row, since the red rule is not words. */
  priorityLabel?: string;
  className?: string;
}) {
  const Heading = `h${level}` as const;
  return (
    <li
      className={classes("ml-list-row", "ml-operational-row", className)}
      data-priority={priority === "high" ? "high" : undefined}
    >
      {status && <div className="ml-operational-row__status">{status}</div>}
      <div className="ml-operational-row__body">
        <Heading className="ml-list-row__title ml-operational-row__title">
          {priority === "high" && <span className="ml-visually-hidden">{priorityLabel}: </span>}
          {href ? (
            <Link className="ml-operational-row__title-link" href={href}>
              {title}
            </Link>
          ) : (
            title
          )}
        </Heading>
        {meta && <p className="ml-list-row__meta ml-operational-row__meta">{meta}</p>}
      </div>
      {date && <div className="ml-operational-row__date">{date}</div>}
      {action && <div className="ml-operational-row__action">{action}</div>}
    </li>
  );
}
