"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field } from "@/components/primitives";
import { type UpdatePasswordState, updatePasswordAction } from "../actions";

const INITIAL: UpdatePasswordState = {};

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState(updatePasswordAction, INITIAL);

  if (state.ok) {
    return (
      <div className="gate-sent" role="status">
        <h2>Password updated</h2>
        <p className="gate-note">You can sign in with your new password now.</p>
        <Link className="btn primary" href="/login">
          Sign in
        </Link>
      </div>
    );
  }

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
