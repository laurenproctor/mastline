"use client";

import { useActionState } from "react";
import { Field } from "@/components/primitives";
import { type SignInState, signIn } from "./actions";

const INITIAL: SignInState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, INITIAL);

  return (
    <form action={formAction} className="auth-form">
      <input name="next" type="hidden" value={next} />

      <Field autoComplete="email" label="Email" name="email" required type="email" />
      <div className="spacer" />
      <Field
        autoComplete="current-password"
        label="Password"
        name="password"
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
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
