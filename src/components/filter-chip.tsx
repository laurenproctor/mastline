import Link from "next/link";
import type { ComponentProps, ComponentPropsWithRef } from "react";

/**
 * Filter chips narrow a collection without leaving it. Two kinds, because
 * the two behave differently and assistive technology has to be told which:
 *
 * - FilterChip is a toggle button. It carries aria-pressed, and the page it
 *   sits on owns the state -- the chip renders what it is told.
 * - FilterLink is a link whose destination is the same page with a different
 *   query string. The server does the filtering, the URL is shareable, and
 *   the current one is marked with aria-current.
 *
 * Neither uses aria-selected: that belongs to a selectable composite with a
 * managed selection, and a row of independent chips is not one.
 */
export function FilterBar({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className ? `ml-filter-bar ${className}` : "ml-filter-bar"}>{children}</div>
  );
}

export type FilterChipProps = {
  pressed: boolean;
  className?: string;
} & Omit<ComponentPropsWithRef<"button">, "aria-pressed" | "type">;

export function FilterChip({ pressed, className, children, ...rest }: FilterChipProps) {
  return (
    <button
      aria-pressed={pressed}
      className={className ? `ml-filter-chip ${className}` : "ml-filter-chip"}
      type="button"
      {...rest}
    >
      {children}
    </button>
  );
}

export type FilterLinkProps = {
  /** Whether the collection is already filtered this way. */
  current: boolean;
  className?: string;
} & ComponentProps<typeof Link>;

export function FilterLink({ current, className, children, ...rest }: FilterLinkProps) {
  return (
    <Link
      aria-current={current ? "true" : undefined}
      className={className ? `ml-filter-chip ${className}` : "ml-filter-chip"}
      {...rest}
    >
      {children}
    </Link>
  );
}
