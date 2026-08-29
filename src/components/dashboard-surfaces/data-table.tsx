import "@/styles/mastline-dashboard-surfaces.css";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { classes } from "./shared";

/**
 * A table of records the reader compares: payments, submissions, matches.
 *
 * A real <table> with a <caption> and header cells, because that is what
 * gives a screen reader the column a value belongs to. Wide tables scroll
 * inside their own region, which is focusable and named so a keyboard can
 * reach it and a reader knows what it is. Nothing here is an ARIA grid: a
 * table that is read, not edited, keeps the table semantics.
 */
export function DataTable({
  caption,
  captionHidden = false,
  label,
  compact = false,
  className,
  children,
}: {
  /** What the table is: "Payments this period". Rendered as <caption>. */
  caption: ReactNode;
  /** Keep the caption for readers but off the screen when a heading already says it. */
  captionHidden?: boolean;
  /** Names the scroll region. Defaults to the caption when that is a string. */
  label?: string;
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const regionLabel = label ?? (typeof caption === "string" ? caption : undefined);
  return (
    <div
      aria-label={regionLabel}
      className={classes(
        "ml-table-wrap",
        "ml-data-table",
        compact && "ml-data-table--compact",
        className,
      )}
      role="region"
      tabIndex={0}
    >
      <table className="ml-table">
        <caption
          className={classes("ml-data-table__caption", captionHidden && "ml-visually-hidden")}
        >
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TableRow({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & Omit<
  ComponentPropsWithoutRef<"tr">,
  "className" | "children"
>) {
  return (
    <tr className={className} {...rest}>
      {children}
    </tr>
  );
}

type CellKind = "text" | "numeric" | "status" | "action";

const CELL_CLASS: Record<CellKind, string | undefined> = {
  text: undefined,
  numeric: "is-numeric ml-data-table__cell--numeric",
  status: "ml-data-table__cell--status",
  action: "ml-data-table__cell--action",
};

export function TableHeaderCell({
  kind = "text",
  scope = "col",
  className,
  children,
  ...rest
}: {
  kind?: CellKind;
  scope?: "col" | "row";
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"th">, "className" | "children" | "scope">) {
  return (
    <th className={classes(CELL_CLASS[kind], className)} scope={scope} {...rest}>
      {children}
    </th>
  );
}

export function TableCell({
  kind = "text",
  className,
  children,
  ...rest
}: {
  kind?: CellKind;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<"td">, "className" | "children">) {
  return (
    <td className={classes(CELL_CLASS[kind], className)} {...rest}>
      {children}
    </td>
  );
}

/**
 * The one row a table shows when it has nothing to show. Inside the table,
 * so the caption and headers stay and the reader is told, in the table's own
 * voice, that it is empty rather than broken.
 */
export function TableEmptyRow({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <tr className="ml-data-table__empty">
      <td className="ml-data-table__empty-cell" colSpan={columns}>
        {children}
      </td>
    </tr>
  );
}
