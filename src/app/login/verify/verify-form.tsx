"use client";

import { useActionState } from "react";
import { Field } from "@/components/primitives";
import { type ChallengeState, verifySignIn } from "../actions";

const INITIAL: ChallengeState = {};

export function VerifyForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(verifySignIn, INITIAL);

  return (
    <form action={formAction} className="auth-form">
      <input name="next" type="hidden" value={next} />
      <Field
        autoComplete="one-time-code"
        autoFocus
        inputMode="numeric"
        label="Six-digit code"
        name="code"
        required
      />
      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="spacer" />
      <button className="button primary auth-submit" disabled={pending} type="submit">
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
