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
      <div className="su-sent" role="status">
        <h2>Check your email</h2>
        <p>
          A confirmation link is on its way to <strong>{state.email}</strong>. Open it and the
          workspace is waiting.
        </p>
        <Link className="btn ghost" href="/login">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="su-form">
      <h2>Create your account</h2>

      <div className="su-names">
        <Field autoComplete="given-name" label="First name" name="firstName" />
        <Field autoComplete="family-name" label="Last name" name="lastName" />
      </div>

      <Field autoComplete="email" label="Email" name="email" required type="email" />

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
        <p className="su-error" role="alert">
          {state.error}
        </p>
      )}

      <button className="btn primary" disabled={pending} type="submit">
        {pending ? "Creating your account…" : "Create account"}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>

      <p className="su-fine">
        By creating an account you agree to the <Link href="/terms">Terms of Service</Link> and the{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </form>
  );
}
