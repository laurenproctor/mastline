"use client";

import { useActionState } from "react";
import { Field } from "@/components/primitives";
import { type UpdatePasswordState, updatePasswordAction } from "../actions";

const INITIAL: UpdatePasswordState = {};

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState(updatePasswordAction, INITIAL);

  return (
    <form action={formAction} className="gate-form">
      <h2>New password</h2>
      <Field
        autoComplete="new-password"
        autoFocus
        hint="At least 10 characters."
        label="New password"
        minLength={10}
        name="password"
        required
        type="password"
      />
      <Field
        autoComplete="new-password"
        label="Confirm new password"
        minLength={10}
        name="confirmPassword"
        required
        type="password"
      />

      {state.error && (
        <p className="gate-error" role="alert">
          {state.error}
        </p>
      )}

      <button className="btn primary" disabled={pending} type="submit">
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
