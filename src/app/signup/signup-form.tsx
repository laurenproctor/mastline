"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field } from "@/components/primitives";
import { type SignUpState, signUpAction } from "./actions";

const INITIAL: SignUpState = {};

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpAction, INITIAL);

  if (state.checkEmail) {
    return (
      <div className="auth-confirm" role="status">
        <h2>Check your email</h2>
        <p className="section-note">
          We sent a confirmation link to <strong>{state.email}</strong>. Open it to finish setting
          up your account.
        </p>
        <Link className="text-link" href="/login">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="auth-form">
      <Field autoComplete="name" label="Your name" name="fullName" />
      <div className="spacer" />
      <Field autoComplete="email" label="Email" name="email" required type="email" />
      <div className="spacer" />
      <Field
        autoComplete="new-password"
        hint="At least 10 characters."
        label="Password"
        minLength={10}
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
        {pending ? "Creating your account…" : "Create account"}
      </button>

      <p className="section-note">
        Already have an account?{" "}
        <Link className="text-link" href="/login">
          Sign in
        </Link>
      </p>
    </form>
  );
}
