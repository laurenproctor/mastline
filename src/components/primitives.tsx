import Link from "next/link";

export type Tone = "neutral" | "good" | "warn" | "danger" | "blue";

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
          <PendingButton className="primary">{action}</PendingButton>
        ))}
    </header>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`badge ${tone}`}>{children}</span>;
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

type FieldControl = "input" | "textarea" | "select";

/**
 * A labelled form control.
 *
 * `name` is required and the label is bound to the control by a derived id, so
 * a bare `<label>` sitting next to a bare `<input>` cannot happen. The name is
 * also what a Server Action will read the value under in a later phase, so it
 * has to be unique within a form regardless.
 */
export function Field({
  label,
  name,
  control = "input",
  full = false,
  hint,
  error,
  children,
  ...rest
}: {
  label: string;
  name: string;
  control?: FieldControl;
  full?: boolean;
  hint?: string;
  /** A validation message. Bound to the control and announced when it appears. */
  error?: string;
  children?: React.ReactNode;
  // ComponentPropsWithRef rather than InputHTMLAttributes so a caller can hold
  // the control itself. Setting a default on an uncontrolled input from an
  // effect is a DOM write, not a state update, and keeps the field the
  // operator's to type in.
} & Omit<React.ComponentPropsWithRef<"input">, "children" | "name">) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  // A required field is marked in the label as well as on the control, so the
  // obligation is visible before the form is submitted. The asterisk is
  // decorative -- `required` is what a screen reader announces -- so it is
  // hidden from the accessibility tree rather than read out as punctuation.
  const isRequired = Boolean((rest as { required?: boolean }).required);

  const shared = {
    id,
    name,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
    ...(rest as Record<string, unknown>),
  };

  return (
    <div className={full ? "field full" : "field"}>
      <label htmlFor={id}>
        {label}
        {isRequired && (
          <span aria-hidden="true" className="required-mark">
            *
          </span>
        )}
      </label>
      {control === "textarea" ? (
        <textarea {...(shared as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} />
      ) : control === "select" ? (
        <select {...(shared as React.SelectHTMLAttributes<HTMLSelectElement>)}>{children}</select>
      ) : (
        <input {...(shared as React.InputHTMLAttributes<HTMLInputElement>)} />
      )}
      {error && (
        <small className="field-error" id={errorId} role="alert">
          {error}
        </small>
      )}
      {hint && (
        <small className="section-note" id={hintId}>
          {hint}
        </small>
      )}
    </div>
  );
}

/**
 * A button for an action this phase has not wired up yet.
 *
 * It stays in the tab order so the layout can be reviewed by keyboard, but it
 * announces itself as unavailable rather than silently doing nothing.
 */
export function PendingButton({
  children,
  className = "",
  small = false,
}: {
  children: React.ReactNode;
  className?: string;
  small?: boolean;
}) {
  return (
    <button
      aria-disabled="true"
      className={`button${small ? " small" : ""}${className ? ` ${className}` : ""}`}
      title="Not available in this preview"
      type="button"
    >
      {children}
    </button>
  );
}
