"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/primitives";
import { type ChallengeState, verifySignIn, verifyWithRecoveryCode } from "../actions";

const INITIAL: ChallengeState = {};

export function VerifyForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(verifySignIn, INITIAL);
  const [recoveryState, recoveryAction, recovering] = useActionState(
    verifyWithRecoveryCode,
    INITIAL,
  );
  const [useRecovery, setUseRecovery] = useState(false);

  if (useRecovery) {
    return (
      <form action={recoveryAction} className="gate-form">
        <h2>Use a recovery code</h2>
        <input name="next" type="hidden" value={next} />
        <Field
          autoComplete="one-time-code"
          autoFocus
          hint="One of the codes you saved when you set this up. Each one works once."
          label="Recovery code"
          name="code"
          required
        />
        {recoveryState.error && (
          <p className="gate-error" role="alert">
            {recoveryState.error}
          </p>
        )}
        <button className="btn primary" disabled={recovering} type="submit">
          {recovering ? "Checking…" : "Use this code"}
        </button>
        <p className="gate-note">
          Using a code turns two-factor authentication off, so you can sign in and set it up again
          on your new device.
        </p>
        <p className="gate-note">
          <button className="gate-switch" onClick={() => setUseRecovery(false)} type="button">
            Back to the app code
          </button>
        </p>
      </form>
    );
  }

  return (
    <form action={formAction} className="gate-form">
      <h2>Enter your code</h2>
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
        <p className="gate-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="btn primary" disabled={pending} type="submit">
        {pending ? "Checking…" : "Continue"}
      </button>
      <p className="gate-note">
        <button className="gate-switch" onClick={() => setUseRecovery(true)} type="button">
          Lost your device? Use a recovery code
        </button>
      </p>
    </form>
  );
}
