"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/primitives";
// A type-only import: `@/lib/data/rights` is server-only, and the erased form
// carries none of it into the client bundle. Every value this component needs
// from that module -- the note limits, the blocked-license wording -- arrives as
// a prop from the page, so the policy still has exactly one home.
import type { TriageStatus } from "@/lib/data/rights";
import { type RightsActionState, recordRightsDecisionAction } from "../actions";

const INITIAL: RightsActionState = {};

/**
 * The triage controls on a selected match.
 *
 * Every control here records an internal human decision on Mastline's own
 * record. None of them contacts a publisher, sends a demand or a takedown,
 * captures new evidence, or concludes that infringement occurred, and the copy
 * on each one says so rather than leaving a reviewer to assume otherwise.
 *
 * Each decision owns its own form and its own action state, so a refusal is
 * shown beside the control that caused it and only the control being submitted
 * is disabled.
 */

interface DecisionCommon {
  readonly workspaceSlug: string;
  readonly matchId: string;
  /** The row version the reviewer is looking at. Guards the lost update. */
  readonly expectedUpdatedAt: string;
  readonly noteMin: number;
  readonly noteMax: number;
}

function Decision({
  workspaceSlug,
  matchId,
  expectedUpdatedAt,
  status,
  heading,
  description,
  startLabel,
  confirmLabel,
  pendingLabel,
  confirmHeading,
  noteLabel,
  noteHint,
  noteRequired,
  noteMax,
  emphasis = false,
}: Omit<DecisionCommon, "noteMin"> & {
  readonly status: TriageStatus;
  readonly heading: string;
  readonly description: React.ReactNode;
  readonly startLabel: string;
  /** Present when this decision takes two motions. */
  readonly confirmLabel?: string;
  readonly pendingLabel: string;
  readonly confirmHeading?: string;
  readonly noteLabel?: string;
  readonly noteHint?: string;
  readonly noteRequired?: boolean;
  readonly emphasis?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    recordRightsDecisionAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [confirming, setConfirming] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const twoStep = Boolean(confirmLabel);

  // Revealing the confirmation moves focus to the first thing to be filled in,
  // so a keyboard or screen-reader user is not left where the button used to be.
  useEffect(() => {
    if (confirming) noteRef.current?.focus();
  }, [confirming]);

  const noteId = `rights-note-${status}`;
  const errorId = `rights-error-${status}`;
  const hintId = noteHint ? `rights-hint-${status}` : undefined;

  if (twoStep && !confirming) {
    return (
      <div className="side-card">
        <h3>{heading}</h3>
        <p>{description}</p>
        {state.error && (
          <p className="auth-error" id={errorId} role="alert">
            {state.error}
          </p>
        )}
        <div className="actions">
          <button className="button" onClick={() => setConfirming(true)} type="button">
            {startLabel}
          </button>
        </div>
        <p className="section-note">Nothing is recorded until you confirm.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className={twoStep ? "side-card confirm-card" : "side-card"}>
      <input name="matchId" type="hidden" value={matchId} />
      <input name="status" type="hidden" value={status} />
      <input name="expectedUpdatedAt" type="hidden" value={expectedUpdatedAt} />
      {twoStep && <input name="confirmed" type="hidden" value="yes" />}

      {twoStep && <Badge tone="warn">Confirm</Badge>}
      <h3>{twoStep ? (confirmHeading ?? heading) : heading}</h3>
      <p>{description}</p>

      {noteLabel && (
        <div className="field">
          <label htmlFor={noteId}>
            {noteLabel}
            {noteRequired && (
              <span aria-hidden="true" className="required-mark">
                *
              </span>
            )}
          </label>
          <textarea
            aria-describedby={[state.error ? errorId : undefined, hintId].filter(Boolean).join(" ") || undefined}
            aria-invalid={state.error ? true : undefined}
            id={noteId}
            maxLength={noteMax}
            name="note"
            ref={noteRef}
            required={noteRequired}
            rows={3}
          />
          {noteHint && (
            <small className="section-note" id={hintId}>
              {noteHint}
            </small>
          )}
        </div>
      )}

      {state.error && (
        <p className="auth-error" id={errorId} role="alert">
          {state.error}
        </p>
      )}

      <div className="actions">
        <button
          className={emphasis ? "button blue" : "button"}
          disabled={pending}
          type="submit"
        >
          {pending ? pendingLabel : (confirmLabel ?? startLabel)}
        </button>
        {twoStep && (
          <button
            className="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
            type="button"
          >
            Go back
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * The confirmation of a decision that has just been recorded.
 *
 * It takes focus once, because the redirect that carries it has rebuilt the
 * page and dropped focus back to the top of the document.
 */
const DONE_MESSAGES: Record<TriageStatus, string> = {
  reviewing: "Internal review started. This match is now yours to work through.",
  monitoring: "Held for monitoring. Nothing is scheduled; the match waits for another observation.",
  ignored: "Set aside. The observation, its evidence, and this decision all remain on the record.",
  licensed: "Recorded as licensed against the linked license found in your records.",
  resolved: "Review closed. The observation and its evidence remain on the record.",
};

export function ReviewNotice({ done }: { done: TriageStatus }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <p className="inspector-saved" ref={ref} role="status" tabIndex={-1}>
      {DONE_MESSAGES[done]}
    </p>
  );
}

/**
 * The blocked licensed control.
 *
 * Left visible and disabled rather than hidden, because the reason it cannot be
 * used is the useful part: the license-linking workflow does not exist yet, so
 * there is currently no way to satisfy this from inside Mastline.
 */
function LicensedBlocked({ message }: { message: string }) {
  return (
    <div className="side-card">
      <h3>Mark licensed</h3>
      <p>{message}</p>
      <div className="actions">
        <button className="button" disabled type="button">
          Mark licensed
        </button>
      </div>
      <p className="section-note">
        The license check on this match did not find a linked license in your records, so calling
        this use licensed would be an assertion Mastline cannot support. Linking a license to a
        match is not built yet, so this control stays blocked until it is.
      </p>
    </div>
  );
}

export function TriagePanel({
  workspaceSlug,
  matchId,
  expectedUpdatedAt,
  noteMin,
  noteMax,
  allowed,
  hasLinkedLicense,
  licenseRequiredMessage,
}: DecisionCommon & {
  readonly allowed: readonly TriageStatus[];
  readonly hasLinkedLicense: boolean;
  readonly licenseRequiredMessage: string;
}) {
  const common = { workspaceSlug, matchId, expectedUpdatedAt, noteMax };

  if (allowed.length === 0) {
    return (
      <div className="side-card">
        <h3>This decision is recorded</h3>
        <p>
          A match that has been marked licensed, ignored, or resolved is not reopened in place. The
          record stands as it was decided; a new observation of the same use starts a new match.
        </p>
      </div>
    );
  }

  return (
    <>
      {allowed.includes("reviewing") && (
        <Decision
          {...common}
          description="Take this match on for internal review. Nothing leaves Mastline, and no claim is made about the use."
          emphasis
          heading="Start review"
          pendingLabel="Starting…"
          startLabel="Start review"
          status="reviewing"
        />
      )}

      {allowed.includes("monitoring") && (
        <Decision
          {...common}
          description="Hold this match while you wait for more information or another observation of the same use."
          heading="Monitor"
          noteHint="Optional. What you are waiting for, so the next reviewer knows."
          noteLabel="Why this is being held"
          pendingLabel="Recording…"
          startLabel="Hold for monitoring"
          status="monitoring"
        />
      )}

      {allowed.includes("monitoring") && (
        <p className="section-note">
          Monitoring is a note to your own team. This sprint starts no crawler, schedule, or
          automatic re-check, and Mastline will not observe this page again on its own.
        </p>
      )}

      {allowed.includes("licensed") &&
        (hasLinkedLicense ? (
          <Decision
            {...common}
            confirmHeading="Confirm this use is licensed"
            confirmLabel="Yes, record this as licensed"
            description="Your records show a linked license covering this use. Recording that is a statement your workspace will rely on later."
            heading="Mark licensed"
            noteLabel="Which license covers this, and how you checked"
            noteRequired
            pendingLabel="Recording…"
            startLabel="Mark licensed"
            status="licensed"
          />
        ) : (
          <LicensedBlocked message={licenseRequiredMessage} />
        ))}

      {allowed.includes("resolved") && (
        <Decision
          {...common}
          confirmHeading="Confirm this review is closed"
          confirmLabel="Yes, close this review"
          description="Close the review because the question behind it has been answered. Resolved is not a finding that the use was licensed, that it was infringing, or that it should be ignored."
          heading="Resolve"
          noteLabel="What was concluded"
          noteRequired
          pendingLabel="Recording…"
          startLabel="Resolve"
          status="resolved"
        />
      )}

      {allowed.includes("ignored") && (
        <Decision
          {...common}
          confirmHeading="Confirm this match is set aside"
          confirmLabel="Yes, ignore this match"
          description="Take this match out of the review queue. Nothing is deleted: the observation, the source URL, the page title, the evidence, and the whole activity history stay exactly as they are."
          heading="Ignore"
          noteLabel="Why this is being set aside"
          noteHint={`At least ${noteMin} characters. This note is the reason the next person will read.`}
          noteRequired
          pendingLabel="Recording…"
          startLabel="Ignore this match"
          status="ignored"
        />
      )}
    </>
  );
}
