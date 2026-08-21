"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field } from "@/components/primitives";
import { type ResetState, requestResetAction } from "./actions";

const INITIAL: ResetState = {};

export function ResetForm() {
  const [state, formAction, pending] = useActionState(requestResetAction, INITIAL);

  if (state.sent) {
    return (
      <div className="auth-confirm" role="status">
        <h2>Check your email</h2>
        <p className="section-note">
          If that address has an account, a reset link is on its way. The link works once and
          expires shortly.
        </p>
        <Link className="text-link" href="/login">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="auth-form">
      <Field autoComplete="email" label="Email" name="email" required type="email" />

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="spacer" />
      <button className="button primary auth-submit" disabled={pending} type="submit">
        {pending ? "Sending…" : "Send reset link"}
      </button>
      <p className="section-note">
        <Link className="text-link" href="/login">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
