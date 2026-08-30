import "@/styles/mastline-dashboard-surfaces.css";
import { useId } from "react";
import { classes, type SurfaceTone } from "./shared";

/**
 * Where something is between nothing and done: captions written, checks
 * passed, storage used.
 *
 * Determinate only. The bar's width is the value's share of the maximum,
 * clamped so a value past the end or below zero cannot draw off the track;
 * the accessible value is the real one, unclamped only where the platform
 * would reject it. The figure is always written beside the bar, so the bar's
 * length is never the only way to read it.
 */
export function Progress({
  label,
  value,
  max = 100,
  valueText,
  showValue = true,
  tone,
  className,
}: {
  /** What is being measured: "Captions written". Always visible. */
  label: string;
  value: number;
  /** Must be positive; anything else is treated as 100. */
  max?: number;
  /** What to say and show instead of a percentage: "12 of 20". */
  valueText?: string;
  showValue?: boolean;
  tone?: SurfaceTone;
  className?: string;
}) {
  const id = useId();
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = Number.isFinite(value) ? Math.min(safeMax, Math.max(0, value)) : 0;
  const percent = Math.round((safeValue / safeMax) * 100);
  const shown = valueText ?? `${percent}%`;

  return (
    <div className={classes("ml-progress-block", className)} data-tone={tone}>
      <div className="ml-progress-block__head">
        <span className="ml-progress-block__label" id={`${id}-label`}>
          {label}
        </span>
        {showValue && (
          <span className="ml-progress-block__value" id={`${id}-value`}>
            {shown}
          </span>
        )}
      </div>
      <div
        aria-labelledby={`${id}-label`}
        aria-valuemax={safeMax}
        aria-valuemin={0}
        aria-valuenow={safeValue}
        aria-valuetext={valueText}
        className="ml-progress"
        role="progressbar"
      >
        <div className="ml-progress__bar" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
