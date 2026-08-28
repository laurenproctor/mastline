import Link from "next/link";

/**
 * A link-shaped action for the header. Given as data rather than markup so a
 * page cannot accidentally hand the header two primary buttons: there is one
 * `primaryAction` slot, and everything else is secondary by construction.
 */
export interface HeaderAction {
  readonly label: string;
  readonly href: string;
}

type HeadingLevel = 1 | 2 | 3;

/**
 * The page header every dashboard screen shares.
 *
 * Eyebrow, one display title, optional explanation, and the actions -- one
 * dark primary, the rest outlined. Filters do not belong in here; they go
 * below the header on the page that owns them.
 *
 * A server component: nothing in it needs state, so it costs no hydration.
 * The heading level is configurable because a header can also sit at the top
 * of a section inside a page that already has its h1, but the default is the
 * page title, and the acceptance suite counts on every route having one.
 *
 * The legacy header in primitives.tsx keeps serving the screens that have not
 * moved to the design system yet. New screens, and migrated ones, use this.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryActions = [],
  className,
  level = 1,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  primaryAction?: HeaderAction;
  secondaryActions?: readonly HeaderAction[];
  className?: string;
  level?: HeadingLevel;
}) {
  const Heading = `h${level}` as const;
  const hasActions = primaryAction !== undefined || secondaryActions.length > 0;

  return (
    <header className={className ? `ml-page-header ${className}` : "ml-page-header"}>
      <div className="ml-page-header__copy">
        {eyebrow && <p className="ml-eyebrow">{eyebrow}</p>}
        <Heading className="ml-display">{title}</Heading>
        {description && <p className="ml-page-header__description">{description}</p>}
      </div>
      {hasActions && (
        <div className="ml-page-header__actions">
          {secondaryActions.map((action) => (
            <Link className="ml-button ml-button--secondary" href={action.href} key={action.href}>
              {action.label}
            </Link>
          ))}
          {primaryAction && (
            <Link className="ml-button" href={primaryAction.href}>
              {primaryAction.label}
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
