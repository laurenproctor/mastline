"use client";

import { useActionState, useState } from "react";
import { type AcceptState, acceptDeliveryAction } from "../accept-actions";

const INITIAL: AcceptState = {};

/**
 * The gate a delivery shows when the photographer asked for the yes first.
 *
 * The same acceptance as the inline form — the same action, the same record,
 * the same one-per-link rule — dressed as the front door: name, the delivery
 * terms in plain rows, an explicit agreement, and one button. The photographs
 * are deliberately not on this screen; the database returns no frames for a
 * gated link until the acceptance exists, so there is nothing here to leak.
 *
 * The checkbox is presentation, not the record. What is recorded is the name,
 * the time, the address, and the exact terms shown — same as it always was.
 */
export function DeliveryGate({
  token,
  usage,
  downloadLine,
}: {
  token: string;
  /** The usage line shown in the terms rows, e.g. the restrictions snapshot. */
  usage?: string;
  /** What downloading offers on this link, stated honestly. */
  downloadLine: string;
}) {
  const [state, formAction, pending] = useActionState(acceptDeliveryAction, INITIAL);
  const [agreed, setAgreed] = useState(false);

  return (
    <form action={formAction} className="delivery-gate-form">
      <input name="token" type="hidden" value={token} />

      <h2>Open this delivery</h2>
      <p className="section-note">
        Enter your name to view and download the photographs. Your activity is recorded for the
        photographer&rsquo;s delivery record.
      </p>

      <label className="delivery-gate-form__name" htmlFor="acceptedBy">
        Your name
        <input
          autoComplete="name"
          id="acceptedBy"
          name="acceptedBy"
          placeholder="Who is opening this delivery"
          required
        />
      </label>

      <div className="delivery-gate-form__terms">
        <h3>Delivery terms</h3>
        <dl>
          <div>
            <dt>Usage</dt>
            <dd>{usage ?? "As stated by the photographer."}</dd>
          </div>
          <div>
            <dt>Download</dt>
            <dd>{downloadLine}</dd>
          </div>
        </dl>
      </div>

      <label className="delivery-gate-form__agree" htmlFor="gate-agree">
        <input
          checked={agreed}
          id="gate-agree"
          onChange={(event) => setAgreed(event.target.checked)}
          type="checkbox"
        />
        <span>I agree to these delivery terms.</span>
      </label>

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}

      <button className="delivery-gate-form__open" disabled={pending || !agreed} type="submit">
        {pending ? "Recording…" : "Open delivery"}
        <span aria-hidden="true"> →</span>
      </button>

      <p className="section-note">
        Opening records your name, the time, and the terms shown here, and releases the photographs.
      </p>
    </form>
  );
}
