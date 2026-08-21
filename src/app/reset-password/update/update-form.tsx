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
      <div className="auth-confirm" role="status">
        <h2>Password updated</h2>
        <p className="section-note">You can sign in with your new password now.</p>
        <Link className="button primary" href="/login">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="auth-form">
      <Field
        autoComplete="new-password"
        hint="At least 10 characters."
        label="New password"
        minLength={10}
        name="password"
        required
        type="password"
      />
      <div className="spacer" />
      <Field
        autoComplete="new-password"
        label="Confirm new password"
        minLength={10}
        name="confirmPassword"
        required
        type="password"
      />

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="spacer" />
      <button className="button primary auth-submit" disabled={pending} type="submit">
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
