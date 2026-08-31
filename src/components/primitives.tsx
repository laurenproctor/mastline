import Link from "next/link";
import { PendingButton } from "./button";

/*
 * The controls moved into files of their own -- button.tsx, badge.tsx,
 * field.tsx -- and are re-exported here so the forty-odd files that import
 * them from primitives keep compiling unchanged. Panel, Metric, Progress,
 * TableScroll, and PhotoTile stay here until their own migration stage.
 */
export { Badge, type BadgeTone, type Tone } from "./badge";
export { Field } from "./field";
export { PendingButton };

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  href,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: string;
  href?: string;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action &&
        (href ? (
          <Link className="button primary" href={href}>
            {action}
          </Link>
        ) : (
          <PendingButton variant="primary">{action}</PendingButton>
        ))}
    </header>
  );
}

export function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "good" | "danger";
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small className={tone}>{detail}</small>}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || action) && (
        <div className="panel-head">
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A wide table's scroll container.
 *
 * A table that has to be dragged sideways can only be read with a mouse or a
 * finger; a keyboard has no gesture for it. Focusable, so arrow keys work, and
 * named, so it is announced as something rather than as an unlabelled stop.
 */
export function TableScroll({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div aria-label={label} className="table-scroll" role="region" tabIndex={0}>
      {children}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="progress-wrap">
      {label && <span id={`${label}-progress`}>{label}</span>}
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ? undefined : "Progress"}
        aria-labelledby={label ? `${label}-progress` : undefined}
      >
        <i style={{ width: `${clamped}%` }} />
      </div>
      <small>{clamped}%</small>
    </div>
  );
}

/**
 * A placeholder for image content the scaffold cannot show yet.
 *
 * Marked `aria-hidden` because it carries no information a screen reader needs;
 * the surrounding record supplies the filename and caption.
 */
export function PhotoTile({
  index,
  selected = false,
  warning = false,
  label,
}: {
  index: number;
  selected?: boolean;
  warning?: boolean;
  label?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`photo-tile photo-${(index % 6) + 1}${selected ? " selected" : ""}`}
    >
      <span className="photo-index">{String(index).padStart(3, "0")}</span>
      {selected && <span className="select-mark">✓</span>}
      {warning && <span className="warning-mark">!</span>}
      {label && <em>{label}</em>}
    </div>
  );
}
