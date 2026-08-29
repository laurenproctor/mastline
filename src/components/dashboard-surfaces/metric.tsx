import "@/styles/mastline-dashboard-surfaces.css";
import type { ReactNode } from "react";
import { classes, type SurfaceTone } from "./shared";

export type MetricTrend = { direction: "up" | "down" | "flat"; label: ReactNode };

/**
 * A single named figure: label over value, with an optional line of context
 * and an optional trend or status.
 *
 * The value arrives already formatted. Money, percentages, and counts are
 * formatted by the code that knows the currency and the rounding rule
 * (formatMoney and friends), never here; this component only draws what it
 * is given, in tabular figures so a column of metrics lines up. A tone or a
 * trend is spoken in the text -- "1 overdue", "down 4% on last month" -- and
 * the colour repeats it.
 */
export function Metric({
  label,
  value,
  detail,
  trend,
  tone,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  trend?: MetricTrend;
  /** A state for the detail line. */
  tone?: SurfaceTone;
  className?: string;
}) {
  return (
    <div className={classes("ml-metric", className)}>
      <dt className="ml-metric__label">{label}</dt>
      <dd className="ml-metric__body">
        <strong className="ml-metric__value">{value}</strong>
        {trend && (
          <span className="ml-metric__trend" data-direction={trend.direction}>
            <span aria-hidden="true" className="ml-metric__trend-mark">
              {trend.direction === "up" ? "▲" : trend.direction === "down" ? "▼" : "▬"}
            </span>{" "}
            {trend.label}
          </span>
        )}
        {detail && (
          <span className="ml-metric__detail" data-tone={tone}>
            {detail}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * The row of figures at the top of a screen. A description list, because
 * each figure is a term and its value, which is what a screen reader reads
 * it as.
 */
export function MetricGroup({
  label,
  className,
  children,
}: {
  /** Names the group: "This period". */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <dl aria-label={label} className={classes("ml-metric-group", className)}>
      {children}
    </dl>
  );
}
