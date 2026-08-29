type FieldControl = "input" | "textarea" | "select";

/**
 * A labelled form control.
 *
 * `name` is required and the label is bound to the control by a derived id, so
 * a bare <label> sitting next to a bare <input> cannot happen. The name is
 * also what a Server Action reads the value under, so it has to be unique
 * within a form regardless.
 *
 * The control is the native one -- input, select, or textarea -- and nothing
 * in here replaces it: a phone's own date picker, a screen reader's own
 * listbox, and autofill all keep working because there is nothing to work
 * around.
 */
export function Field({
  label,
  name,
  control = "input",
  full = false,
  hint,
  error,
  idSuffix,
  className,
  children,
  ...rest
}: {
  label: string;
  name: string;
  control?: FieldControl;
  /** Spans the full width of a two-column form grid. */
  full?: boolean;
  hint?: string;
  /**
   * Distinguishes two fields with the same `name` on one page.
   *
   * The id is derived from the name, which is right until a screen renders the
   * same form more than once -- a submission with four delivery links offers
   * four "Recipient" fields. Without this they share a DOM id, every label
   * points at the first one, and clicking the fourth label focuses the wrong
   * input. Pass something stable and unique, usually the row's id.
   */
  idSuffix?: string;
  /** A validation message. Bound to the control and announced when it appears. */
  error?: string;
  /** Added to the wrapper, never to the control. */
  className?: string;
  children?: React.ReactNode;
  // ComponentPropsWithRef rather than InputHTMLAttributes so a caller can hold
  // the control itself. Setting a default on an uncontrolled input from an
  // effect is a DOM write, not a state update, and keeps the field the
  // operator's to type in.
} & Omit<React.ComponentPropsWithRef<"input">, "children" | "name" | "className">) {
  const id = idSuffix ? `field-${name}-${idSuffix}` : `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  // A required field is marked in the label as well as on the control, so the
  // obligation is visible before the form is submitted. The asterisk is
  // decorative -- `required` is what a screen reader announces -- so it is
  // hidden from the accessibility tree rather than read out as punctuation.
  const isRequired = Boolean((rest as { required?: boolean }).required);

  const controlClass =
    control === "textarea" ? "ml-textarea" : control === "select" ? "ml-select" : "ml-input";
  const shared = {
    id,
    name,
    className: controlClass,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
    ...(rest as Record<string, unknown>),
  };

  const wrapperClass = ["ml-field", full ? "ml-field--full" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapperClass} data-invalid={error ? "true" : undefined}>
      <label className="ml-label" htmlFor={id}>
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
        <small className="ml-error" id={errorId} role="alert">
          {error}
        </small>
      )}
      {hint && (
        <small className="ml-help" id={hintId}>
          {hint}
        </small>
      )}
    </div>
  );
}
