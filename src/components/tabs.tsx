import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Tabs that are routes.
 *
 * Each tab is a link to a URL and the current one says so with
 * aria-current="page" -- the same contract as the sidebar. There is no
 * role="tab" here on purpose: that role promises arrow-key movement, a
 * tablist, and a tabpanel the tab controls, and a row of links promises none
 * of it. A page that needs in-page tab switching with panels gets a separate
 * component once it exists; this one is only for navigation.
 */
export function Tabs({
  label,
  className,
  children,
}: {
  /** Names the landmark: "Packages on this shoot". */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <nav aria-label={label} className={className ? `ml-tabs ${className}` : "ml-tabs"}>
      {children}
    </nav>
  );
}

export type TabLinkProps = {
  /** Whether this tab is the page being shown. Exactly one should be. */
  current?: boolean;
  className?: string;
} & ComponentProps<typeof Link>;

export function TabLink({ current = false, className, children, ...rest }: TabLinkProps) {
  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={className ? `ml-tab ${className}` : "ml-tab"}
      {...rest}
    >
      {children}
    </Link>
  );
}
