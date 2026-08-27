"use client";

import { useActionState, useState, useTransition } from "react";
import { Badge, Field } from "@/components/primitives";
import { formatSecretForTyping, type MfaStanding } from "@/lib/mfa";
import { formatRecoveryCode } from "@/lib/recovery-codes";
import {
  type ConfirmState,
  type EnrollState,
  confirmEnrollmentAction,
  disableMfaAction,
  generateRecoveryCodesAction,
  setMfaPolicyAction,
  startEnrollmentAction,
} from "../mfa-actions";

/**
 * The codes, shown once.
 *
 * Deliberately blunt about that: there is no second chance to read them, and a
 * person who closes this without saving them has no way back from a lost phone
 * except an administrator.
 */
function RecoveryCodes({
  workspaceSlug,
  codes,
}: {
  workspaceSlug: string;
  codes: readonly string[];
}) {
  return (
    <div className="recovery-codes" role="group" aria-label="Recovery codes">
      <p className="section-note">
        <strong>Save these now.</strong> Each one opens the account once if the device is lost, and
        they cannot be shown again. Print them, or put them somewhere that is not the phone holding
        the authenticator.
      </p>
      <ul className="recovery-code-list">
        {codes.map((code) => (
          <li key={code}>
            <code>{formatRecoveryCode(code)}</code>
          </li>
        ))}
      </ul>
      <a className="button small" href={`/${workspaceSlug}/settings`}>
        I have saved them
      </a>
    </div>
  );
}

/**
 * The workspace switch, shown only to an owner.
 *
 * Turning it on locks out any owner or finance member who has not enrolled, so
 * the consequence is stated on the button rather than discovered by whoever is
 * next to sign in.
 */
export function MfaPolicy({
  workspaceSlug,
  required,
  canEnforce,
}: {
  workspaceSlug: string;
  required: boolean;
  canEnforce: boolean;
}) {
  const [state, formAction, pending] = useActionState(setMfaPolicyAction.bind(null, workspaceSlug), INITIAL);
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
 * The secret is shown as a QR code and as text, not one or the other. Scanning
 * is what most people do; a photographer reading this on the same phone that
 * holds the authenticator cannot scan their own screen, and that is common
 * enough here that the typed key is not a fallback so much as the other half.
 */
export function TwoFactor({
  workspaceSlug,
  standing,
  email,
  remainingCodes,
}: {
  workspaceSlug: string;
  standing: MfaStanding;
  email: string;
  /** A line saying how many are left, without listing them. */
  remainingCodes?: string;
}) {
  const [enrollment, setEnrollment] = useState<EnrollState | null>(null);
  const [starting, startEnrollment] = useTransition();
  const [confirmState, confirmAction, confirming] = useActionState(confirmEnrollmentAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [removeState, removeAction, removing] = useActionState(disableMfaAction.bind(null, workspaceSlug), INITIAL);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [newCodes, setNewCodes] = useState<{ codes?: readonly string[]; error?: string }>({});
  const [issuing, issueCodes] = useTransition();

  if (confirmState.codes) {
    return (
      <div className="panel-body">
        <Badge tone="good">Two-factor on</Badge>
        <RecoveryCodes workspaceSlug={workspaceSlug} codes={confirmState.codes} />
      </div>
    );
  }

  if (newCodes.codes) {
    return (
      <div className="panel-body">
        <Badge tone="good">New recovery codes</Badge>
        <RecoveryCodes workspaceSlug={workspaceSlug} codes={newCodes.codes} />
      </div>
    );
  }

  if (standing === "protected") {
    return (
      <div className="panel-body">
        <Badge tone="good">Two-factor on</Badge>
        <p className="section-note">
          Signing in on a new device needs a code from the authenticator app as well as the
          password.
        </p>
        <p className="section-note">{remainingCodes}</p>
        {!removeOpen ? (
          <div className="actions">
            <button
              className="button small"
              disabled={issuing}
              onClick={() =>
                issueCodes(async () => {
                  setNewCodes(await generateRecoveryCodesAction());
                })
              }
              type="button"
            >
              {issuing ? "Making them…" : "Show new recovery codes"}
            </button>
            <button className="button small" onClick={() => setRemoveOpen(true)} type="button">
              Turn off two-factor
            </button>
          </div>
        ) : (
          <form action={removeAction}>
            <Field
              autoComplete="one-time-code"
              hint="Confirming with a current code means a borrowed session cannot strip this off the account."
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
          : "Adds a code from an authenticator app on top of the password. Recommended for anyone holding confidential sources."}
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
            {enrollment.qr
              ? "Scan this with an authenticator app for "
              : "Add this key to an authenticator app for "}
            <strong>{email}</strong>, then enter the code it shows.
          </p>
          {enrollment.qr && (
            <svg
              aria-label="Enrolment QR code"
              className="mfa-qr"
              role="img"
              shapeRendering="crispEdges"
              viewBox={`0 0 ${enrollment.qr.size} ${enrollment.qr.size}`}
            >
              <path d={enrollment.qr.path} fill="currentColor" />
            </svg>
          )}
          <p className="section-note">
            {enrollment.qr
              ? "Reading this on the phone that holds the authenticator? Type the key instead."
              : "Type this key into the app."}
          </p>
          <p className="mfa-secret">
            <code>{formatSecretForTyping(enrollment.secret)}</code>
          </p>
          <Field
            autoComplete="one-time-code"
            hint="Six digits. It changes every 30 seconds."
            inputMode="numeric"
            label="Code from the app"
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
