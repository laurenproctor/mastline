"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field } from "@/components/primitives";
import { type SignInState, signIn } from "./actions";

const INITIAL: SignInState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, INITIAL);

  return (
    <form action={formAction} className="gate-form">
      <h2>Sign in</h2>
      <input name="next" type="hidden" value={next} />

      {/* The address is what a returning photographer types first, so it is
          what the cursor is already in. */}
      <Field autoComplete="email" autoFocus label="Email" name="email" required type="email" />

      <div className="gate-labelled">
        <Field
          autoComplete="current-password"
          label="Password"
          name="password"
          required
          type="password"
        />
        <Link className="gate-aside-link" href="/reset-password">
          Forgot it?
        </Link>
      </div>

      {state.error && (
        <p className="gate-error" role="alert">
          {state.error}
        </p>
      )}

      <button className="btn primary" disabled={pending} type="submit">
        {pending ? "Signing in…" : "Sign in"}
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
    </form>
  );
}
