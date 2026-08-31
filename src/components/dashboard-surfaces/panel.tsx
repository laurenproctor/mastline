import "@/styles/mastline-dashboard-surfaces.css";
import type { ReactNode } from "react";
import { classes, type HeadingLevel } from "./shared";

/**
 * A panel holds a collection, a table, a list, a form section, or a work
 * area. It is a bordered surface with an optional header row; what goes in
 * the body is the caller's, and the body decides whether it is padded (prose,
 * forms) or flush (a list or table that draws its own rows).
 */
export function Panel({
  as: Tag = "section",
  compact = false,
  className,
  children,
  ...rest
}: {
  as?: "section" | "div" | "article" | "aside";
  /** Tighter header and body spacing, for a rail or a dense dashboard. */
  compact?: boolean;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  id?: string;
}) {
  return (
    <Tag className={classes("ml-panel", compact && "ml-panel--compact", className)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * The title row of a section: one heading at the level the page needs, an
 * optional line under it, optional metadata beside it, and the actions that
 * belong to the section as a whole. Stands alone above a table or a grid, or
 * sits at the top of a Panel as PanelHeader.
 */
export function SectionHeader({
  title,
  level = 2,
  description,
  meta,
  actions,
  className,
  id,
}: {
  title: ReactNode;
  level?: HeadingLevel;
  description?: ReactNode;
  /** A count, a timestamp, a status badge: facts about the section. */
  meta?: ReactNode;
  /** Controls for the section: rendered as given, so they keep their own semantics. */
  actions?: ReactNode;
  className?: string;
  /** Put on the heading, so a Panel can be labelled by it. */
  id?: string;
}) {
  const Heading = `h${level}` as const;
  return (
    <div className={classes("ml-section-header", "ml-surface-header", className)}>
      <div className="ml-section-header__copy">
        <div className="ml-section-header__title-row">
          <Heading className="ml-section-title" id={id}>
            {title}
          </Heading>
          {meta !== undefined && meta !== null && (
            <div className="ml-section-header__meta">{meta}</div>
          )}
        </div>
        {description && <p className="ml-section-header__description">{description}</p>}
      </div>
      {actions && <div className="ml-section-header__actions">{actions}</div>}
    </div>
  );
}

export function PanelHeader(props: Parameters<typeof SectionHeader>[0]) {
  return <SectionHeader {...props} className={classes("ml-panel__header", props.className)} />;
}

export function PanelBody({
  flush = false,
  className,
  children,
}: {
  /** No padding: the content draws its own rows, as a list or table does. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={classes("ml-panel__body", flush && "ml-panel__body--flush", className)}>
      {children}
    </div>
  );
}
