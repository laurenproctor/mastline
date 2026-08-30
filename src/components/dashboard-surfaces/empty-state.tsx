import "@/styles/mastline-dashboard-surfaces.css";
import type { ReactNode } from "react";
import { ActionLink } from "@/components/button";
import { classes, type HeadingLevel } from "./shared";

/** A link-shaped action given as data, so the primitive draws it correctly. */
export type EmptyStateAction = { label: string; href: string };

/**
 * What a surface says when there is nothing in it.
 *
 * The words are the caller's -- what belongs here, why it is empty, and what
 * to do next -- because the honest message for an empty archive and for a
 * failed import are different, and neither is "Nothing to see here". The
 * primitive gives them a title at the right heading level, room for one
 * primary action and one secondary, and a restrained place for a mark.
 */
export function EmptyState({
  title,
  level = 2,
  description,
  primaryAction,
  secondaryAction,
  visual,
  compact = false,
  className,
}: {
  title: ReactNode;
  level?: HeadingLevel;
  description?: ReactNode;
  /** As data it renders a dark ActionLink; as a node it is rendered as given (a Button, say). */
  primaryAction?: EmptyStateAction | ReactNode;
  secondaryAction?: EmptyStateAction | ReactNode;
  /** An icon or a small illustration. Decorative: hidden from readers. */
  visual?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const Heading = `h${level}` as const;
  const primary = renderAction(primaryAction, "primary");
  const secondary = renderAction(secondaryAction, "secondary");
  return (
    <div className={classes("ml-empty-state", compact && "ml-empty-state--compact", className)}>
      {visual && (
        <div aria-hidden="true" className="ml-empty-state__visual">
          {visual}
        </div>
      )}
      <Heading className="ml-empty-state__title">{title}</Heading>
      {description && <p className="ml-empty-state__copy">{description}</p>}
      {(primary || secondary) && (
        <div className="ml-empty-state__actions">
          {primary}
          {secondary}
        </div>
      )}
    </div>
  );
}

function isActionData(action: EmptyStateAction | ReactNode): action is EmptyStateAction {
  return (
    typeof action === "object" &&
    action !== null &&
    "href" in action &&
    "label" in action &&
    typeof (action as EmptyStateAction).href === "string"
  );
}

function renderAction(
  action: EmptyStateAction | ReactNode | undefined,
  variant: "primary" | "secondary",
): ReactNode {
  if (action === undefined || action === null || action === false) return null;
  if (isActionData(action)) {
    return (
      <ActionLink href={action.href} variant={variant}>
        {action.label}
      </ActionLink>
    );
  }
  return action;
}
