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
      <div className="gate-sent" role="status">
        <h2>Check the inbox</h2>
        <p className="gate-note">
          If that address has an account, a reset link is on its way. The link works once and
          expires shortly.
        </p>
        <Link className="gate-switch" href="/sign-in">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="gate-form">
      <h2>Reset password</h2>
      <Field autoComplete="email" autoFocus label="Email" name="email" required type="email" />

      {state.error && (
        <p className="gate-error" role="alert">
          {state.error}
        </p>
      )}

      <button className="btn primary" disabled={pending} type="submit">
        {pending ? "Sending…" : "Send link"}
      </button>
      <p className="gate-note">
        <Link className="gate-switch" href="/sign-in">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
