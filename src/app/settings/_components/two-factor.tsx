"use client";

import { useActionState, useState, useTransition } from "react";
import { Badge, Field } from "@/components/primitives";
import { formatSecretForTyping, type MfaStanding } from "@/lib/mfa";
import {
  type ConfirmState,
  type EnrollState,
  confirmEnrollmentAction,
  disableMfaAction,
  setMfaPolicyAction,
  startEnrollmentAction,
} from "../mfa-actions";

/**
 * The workspace switch, shown only to an owner.
 *
 * Turning it on locks out any owner or finance member who has not enrolled, so
 * the consequence is stated on the button rather than discovered by whoever is
 * next to sign in.
 */
export function MfaPolicy({ required, canEnforce }: { required: boolean; canEnforce: boolean }) {
  const [state, formAction, pending] = useActionState(setMfaPolicyAction, INITIAL);
  if (!canEnforce) return null;

  return (
    <form action={formAction} className="panel-body">
      <input name="required" type="hidden" value={required ? "off" : "on"} />
      <p className="section-note">
        {required
          ? "Owners and finance must hold a second factor to use this workspace."
          : "Two-factor is optional here. Requiring it applies to owners and finance, the two roles that can export the whole record."}
      </p>
      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="button small" disabled={pending} type="submit">
        {pending
          ? "Saving…"
          : required
            ? "Stop requiring two-factor"
            : "Require for owners and finance"}
      </button>
      {!required && (
        <p className="section-note">
          Anyone in those roles without an authenticator will be asked to set one up before they can
          continue.
        </p>
      )}
    </form>
  );
}

const INITIAL: ConfirmState = {};

/**
 * Setting up, and turning off, a second factor.
 *
 * The secret is shown as text rather than only as a QR code. A photographer
 * reading this on the same phone that holds the authenticator cannot scan their
 * own screen, and that is the common case here.
 */
export function TwoFactor({ standing, email }: { standing: MfaStanding; email: string }) {
  const [enrollment, setEnrollment] = useState<EnrollState | null>(null);
  const [starting, startEnrollment] = useTransition();
  const [confirmState, confirmAction, confirming] = useActionState(
    confirmEnrollmentAction,
    INITIAL,
  );
  const [removeState, removeAction, removing] = useActionState(disableMfaAction, INITIAL);
  const [removeOpen, setRemoveOpen] = useState(false);

  if (standing === "protected") {
    return (
      <div className="panel-body">
        <Badge tone="good">Two-factor on</Badge>
        <p className="section-note">
          Signing in on a new device needs a code from your authenticator app as well as your
          password.
        </p>
        {!removeOpen ? (
          <button className="button small" onClick={() => setRemoveOpen(true)} type="button">
            Turn off two-factor
          </button>
        ) : (
          <form action={removeAction}>
            <Field
              autoComplete="one-time-code"
              hint="Confirming with a current code means a borrowed session cannot strip this off your account."
              inputMode="numeric"
              label="Current code"
              name="code"
              required
            />
            {removeState.error && (
              <p className="auth-error" role="alert">
                {removeState.error}
              </p>
            )}
            <div className="spacer" />
            <div className="actions">
              <button className="button small" disabled={removing} type="submit">
                {removing ? "Checking…" : "Turn it off"}
              </button>
              <button className="button small" onClick={() => setRemoveOpen(false)} type="button">
                Keep it on
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="panel-body">
      {standing === "required" ? (
        <Badge tone="warn">Two-factor required</Badge>
      ) : (
        <Badge>Two-factor off</Badge>
      )}
      <p className="section-note">
        {standing === "required"
          ? "This workspace requires a second factor for owners and finance. Set one up to keep working."
          : "Add a code from an authenticator app to your password. Recommended for anyone holding confidential sources."}
      </p>

      {!enrollment?.secret ? (
        <>
          <button
            className="button blue small"
            disabled={starting}
            onClick={() =>
              startEnrollment(async () => {
                setEnrollment(await startEnrollmentAction());
              })
            }
            type="button"
          >
            {starting ? "Preparing…" : "Set up two-factor"}
          </button>
          {enrollment?.error && (
            <p className="auth-error" role="alert">
              {enrollment.error}
            </p>
          )}
        </>
      ) : (
        <form action={confirmAction}>
          <input name="factorId" type="hidden" value={enrollment.factorId} />
          <p className="section-note">
            Add this key to your authenticator app for <strong>{email}</strong>, then enter the code
            it shows.
          </p>
          <p className="mfa-secret">
            <code>{formatSecretForTyping(enrollment.secret)}</code>
          </p>
          <Field
            autoComplete="one-time-code"
            hint="Six digits. It changes every 30 seconds."
            inputMode="numeric"
            label="Code from your app"
            name="code"
            required
          />
          {confirmState.error && (
            <p className="auth-error" role="alert">
              {confirmState.error}
            </p>
          )}
          <div className="spacer" />
          <div className="actions">
            <button className="button blue small" disabled={confirming} type="submit">
              {confirming ? "Checking…" : "Confirm and turn on"}
            </button>
            <button className="button small" onClick={() => setEnrollment(null)} type="button">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
