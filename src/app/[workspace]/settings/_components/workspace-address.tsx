"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/primitives";
import { RENAME_LIMIT_PER_YEAR, SLUG_MAX_LENGTH, slugProblem } from "@/lib/slug";
import { type AddressState, renameWorkspaceAddressAction } from "../actions";

const INITIAL: AddressState = {};

/**
 * Change the address the workspace lives at.
 *
 * Kept behind a button and shown with its consequences, because this is not a
 * settings field like a timezone: it is the URL somebody has been sending to
 * picture desks. Two things are said before the input rather than after the
 * mistake -- that old links keep working, and that there is a limit on how
 * often this can be done -- so the decision is made with both in view.
 *
 * A success redirects, so the only thing rendered here is a refusal. The shape
 * and reserved-word checks run as the address is typed, which is everything
 * that can be known without asking; whether it is already taken is the
 * database's answer and arrives on submit.
 */
export function WorkspaceAddress({ workspaceSlug, slug }: { workspaceSlug: string; slug: string }) {
  const [state, formAction, pending] = useActionState(
    renameWorkspaceAddressAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(slug);

  const problem = value === "" ? null : slugProblem(value);
  const unchanged = value === slug;

  if (!open) {
    return (
      <>
        <p className="section-note">
          Workspace address <strong>mastline.co/{slug}</strong>
        </p>
        <button className="button small" onClick={() => setOpen(true)} type="button">
          Change address
        </button>
      </>
    );
  }

  return (
    <form action={formAction}>
      <Field
        autoCapitalize="none"
        autoCorrect="off"
        hint={
          problem === "reserved"
            ? "That address is reserved for Mastline. Choose another."
            : problem === "invalid"
              ? `Lowercase letters, numbers and hyphens, up to ${SLUG_MAX_LENGTH} characters.`
              : `Your workspace will be at mastline.co/${value || slug}`
        }
        label="Workspace address"
        maxLength={SLUG_MAX_LENGTH}
        name="slug"
        onChange={(event) =>
          // Constrained as it is typed, so a value the database would refuse
          // cannot be submitted in the first place.
          setValue(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
        }
        required
        spellCheck={false}
        value={value}
      />

      <p className="section-note">
        Anyone following your old address is sent to the new one, so links you have already shared
        keep working. Nobody else can take the old address afterwards. You can change this{" "}
        {RENAME_LIMIT_PER_YEAR} times a year.
      </p>

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="spacer" />
      <div className="actions">
        <button
          className="button blue small"
          disabled={pending || problem !== null || unchanged || value === ""}
          type="submit"
        >
          {pending ? "Changing…" : "Change address"}
        </button>
        <button
          className="button small"
          onClick={() => {
            setValue(slug);
            setOpen(false);
          }}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
