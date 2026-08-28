"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/components/primitives";
import type { BuyerRequest, RequestStatus } from "@/lib/domain";
import {
  REASON_MAX_LENGTH,
  allowedTransitions,
  isClosed,
  requiresReason,
  statusLabel,
  statusTone,
} from "@/lib/requests";
import { type RequestActionState, transitionRequestAction } from "../actions";

const INITIAL: RequestActionState = {};

/** Closing decisions, which get a second look before they are recorded. */
const CLOSING: readonly RequestStatus[] = ["lost", "declined", "cancelled", "expired"];

/**
 * What each closing state actually means, so the two that are easy to confuse
 * stay apart.
 *
 * Cancelled and declined are opposite facts about the same ending: cancelled is
 * the buyer withdrawing, declined is the photographer saying no. Collapsing
 * them would make a workspace unable to answer "how often do we turn work
 * down", which is one of the few numbers an independent operator can act on.
 */
const MEANINGS: Partial<Record<RequestStatus, string>> = {
  lost: "The buyer went elsewhere, or the work went to somebody else.",
  declined: "You turned it down.",
  cancelled: "The buyer withdrew the request.",
  expired: "It went past the point of being worth answering.",
  needs_clarification: "You have asked the buyer something and are waiting.",
  qualified: "You understand what they want and it is worth pursuing.",
};

/**
 * Move a request along.
 *
 * The controls offered are the ones the transition table allows from where the
 * request actually is, so nobody is shown a button that will be refused. That
 * is a convenience, not the boundary: the Server Action re-reads the row and
 * checks the same table, because the page that rendered this may be an hour
 * old.
 *
 * A closed request gets no controls at all and says why. Reopening is not a
 * permission this interface withholds -- the database refuses it outright, so
 * offering it would be a lie.
 */
export function LifecyclePanel({
  workspaceSlug,
  request,
  canWrite,
}: {
  workspaceSlug: string;
  request: BuyerRequest;
  canWrite: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    transitionRequestAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [target, setTarget] = useState<RequestStatus | "">("");

  const options = allowedTransitions(request.status);
  const closing = target !== "" && CLOSING.includes(target);
  const needsReason = target !== "" && requiresReason(target);

  if (isClosed(request.status)) {
    return (
      <div className="panel-body">
        <p className="section-note">
          This request is closed as <strong>{statusLabel(request.status).toLowerCase()}</strong> and
          its record is kept as it was. A closed request cannot be reopened, here or in the
          database.
        </p>
        {request.closedReason && (
          <p>
            <strong>Reason recorded:</strong> {request.closedReason}
          </p>
        )}
      </div>
    );
  }

  if (!canWrite) {
    return (
      <div className="panel-body">
        <p className="section-note">
          Currently <Badge tone={statusTone(request.status)}>{statusLabel(request.status)}</Badge>.
          Your role can read requests but not move them.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="panel-body lifecycle-panel">
      <input name="requestId" type="hidden" value={request.id} />
      {/*
        The version this control was rendered from. The update is conditional on
        it, so two people working the same inbox cannot silently overwrite one
        another: the second one matches no row and is told what happened.
      */}
      <input name="expectedUpdatedAt" type="hidden" value={request.updatedAt} />

      <p className="section-note">
        Currently <Badge tone={statusTone(request.status)}>{statusLabel(request.status)}</Badge>
      </p>

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field">
        <label htmlFor="transition-status">Move this request to</label>
        <select
          id="transition-status"
          name="status"
          onChange={(event) => setTarget(event.target.value as RequestStatus | "")}
          value={target}
        >
          <option value="">Choose a state…</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {statusLabel(option)}
            </option>
          ))}
        </select>
        {target !== "" && MEANINGS[target] && (
          <small className="section-note">{MEANINGS[target]}</small>
        )}
      </div>

      {/*
        Won is absent from the list above and named here instead, because an
        operator who is looking for it deserves to be told why it is missing
        rather than left to conclude the feature is broken.
      */}
      {(request.status === "submitted" || request.status === "negotiating") && (
        <p className="section-note">
          Recording a win is not available yet: it means connecting this request to a license, and
          that connection does not exist in Mastline so far.
        </p>
      )}

      {target !== "" && (
        <div className="field">
          <label htmlFor="transition-reason">
            Reason
            {needsReason && (
              <span aria-hidden="true" className="required-mark">
                *
              </span>
            )}
          </label>
          <textarea
            aria-describedby="transition-reason-hint"
            id="transition-reason"
            maxLength={REASON_MAX_LENGTH}
            name="reason"
            required={needsReason}
            rows={3}
          />
          <small className="section-note" id="transition-reason-hint">
            {needsReason
              ? "Required. A request recorded as lost or declined with no reason attached teaches nobody anything the next time."
              : "Optional. Anything the next person reading this record would want to know."}
          </small>
        </div>
      )}

      {closing && (
        <label className="checkbox">
          <input name="confirmed" type="checkbox" value="yes" />
          <span>
            I understand this closes the request permanently and it cannot be reopened.
          </span>
        </label>
      )}

      <div className="actions">
        <button
          className="button primary"
          disabled={pending || target === ""}
          type="submit"
        >
          {pending ? "Recording…" : "Record"}
        </button>
      </div>

      <p className="section-note">
        Moving a request changes this workspace&rsquo;s record and nothing else. The buyer is not
        told, and no file leaves the workspace.
      </p>
    </form>
  );
}
