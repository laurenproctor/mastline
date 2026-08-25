"use client";

import { useActionState } from "react";
import { type AcceptState, acceptDeliveryAction } from "../accept-actions";

const INITIAL: AcceptState = {};

/**
 * The one button the marketing copy promises an editor.
 *
 * Deliberately plain and deliberately explicit: the name typed here goes into
 * the record, and the terms above it are the terms being agreed to. Nobody
 * should be able to say afterwards that they did not know what this did.
 */
export function AcceptTerms({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptDeliveryAction, INITIAL);

  return (
    <form action={formAction} className="delivery-accept">
      <input name="token" type="hidden" value={token} />
      <label htmlFor="acceptedBy">
        Name
        <input
          autoComplete="name"
          id="acceptedBy"
          name="acceptedBy"
          placeholder="Who is accepting"
          required
        />
      </label>
      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="button blue" disabled={pending} type="submit">
        {pending ? "Recording…" : "Accept these terms"}
      </button>
      <p className="section-note">
        Accepting records the name entered, the time, and the terms above, and releases the
        full-resolution files.
      </p>
    </form>
  );
}
