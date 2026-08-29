import Link from "next/link";
import type { ComponentPropsWithRef, ComponentProps } from "react";

/**
 * The action vocabulary of the dashboard.
 *
 * Two components, not one: a Button does something on this page and renders
 * a <button>; an ActionLink takes you somewhere and renders a Next <Link>. A
 * single polymorphic component would let a call site forget which of the two
 * it is asking for, and the difference is the whole accessibility contract --
 * a link that only looks like a button still opens in a new tab, still shows
 * its destination on hover, and can never be "disabled" honestly.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "highlight" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "",
  secondary: "ml-button--secondary",
  quiet: "ml-button--quiet",
  highlight: "ml-button--highlight",
  danger: "ml-button--danger",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "ml-button--sm",
  md: "",
  lg: "ml-button--lg",
};

/**
 * The classes for one action, in a fixed order so the same props always
 * produce the same string. A caller's class is appended, never substituted:
 * `.ml-button` is what makes it an action, and no call site may take it away.
 */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return ["ml-button", VARIANT_CLASS[variant], SIZE_CLASS[size], className]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
} & ComponentPropsWithRef<"button">;

/**
 * A native button.
 *
 * `type` defaults to "button" so a control dropped inside a form does not
 * submit it by accident; a submit button says so explicitly, which is also
 * what a Server Action needs. Every other native attribute -- disabled,
 * aria-*, form, formAction, onClick, ref -- passes straight through.
 */
export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={buttonClasses(variant, size, className)} type={type} {...rest}>
      {children}
    </button>
  );
}

export type ActionLinkProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} & ComponentProps<typeof Link>;

/**
 * A navigation drawn as an action: the "Create shoot" in a page header, the
 * "Open shoot" on a card.
 *
 * There is deliberately no `disabled` here. A link either exists or it does
 * not; an aria-disabled link that still navigates lies to the reader, and one
 * that swallows the click is a button. Render nothing, or a Button, instead.
 */
export function ActionLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: ActionLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

export type TextLinkProps = { className?: string } & ComponentProps<typeof Link>;

/** An inline navigation set as text: "View archive", "View money". */
export function TextLink({ className, children, ...rest }: TextLinkProps) {
  return (
    <Link className={className ? `ml-text-link ${className}` : "ml-text-link"} {...rest}>
      {children}
    </Link>
  );
}

export type IconButtonProps = {
  /** The accessible name. Required: an icon alone names nothing. */
  label: string;
} & Omit<ComponentPropsWithRef<"button">, "aria-label" | "children"> & {
    children: React.ReactNode;
  };

/** A square button holding only an icon. The label is what it is called. */
export function IconButton({
  label,
  className,
  type = "button",
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={className ? `ml-icon-button ${className}` : "ml-icon-button"}
      type={type}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * A button for an action this phase has not wired up yet.
 *
 * It stays in the tab order so the layout can be reviewed by keyboard, but it
 * announces itself as unavailable rather than silently doing nothing. Outlined
 * by default -- the dark treatment is reserved for the one action on a screen
 * that actually works.
 */
export function PendingButton({
  children,
  className,
  small = false,
  variant = "secondary",
}: {
  children: React.ReactNode;
  className?: string;
  small?: boolean;
  variant?: ButtonVariant;
}) {
  return (
    <Button
      aria-disabled="true"
      className={className}
      size={small ? "sm" : "md"}
      title="Not available in this preview"
      variant={variant}
    >
      {children}
    </Button>
  );
}
