"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { NewsMode } from "@/lib/news-radar";
import { type DecisionState, decideOpportunityAction } from "../actions";

const INITIAL: DecisionState = {};

/**
 * The lifecycle controls on one opportunity: watch, and dismiss.
 *
 * Both record an internal decision on the workspace's own radar. Neither
 * contacts anyone, creates anything, or sends anything. Watching is one
 * motion because it is freely reversible into a dismissal or an act later;
 * dismissing is two motions because it is final -- a dismissed story does not
 * come back, and re-raising it is a fresh, deliberate entry.
 *
 * Rendered in two shapes: `compact` inside a queue row, and full-width cards
 * on the detail screen. Same actions, same rules, different clothes.
 */
export function OpportunityDecisions({
  workspaceSlug,
  opportunityId,
  mode,
  returnTo,
  canWatch,
  canDismiss,
  reasonMax,
  compact = false,
}: {
  readonly workspaceSlug: string;
  readonly opportunityId: string;
  readonly mode: NewsMode;
  readonly returnTo: "list" | "detail";
  /** Whether the current status allows each decision. Rechecked on the server. */
  readonly canWatch: boolean;
  readonly canDismiss: boolean;
  readonly reasonMax: number;
  readonly compact?: boolean;
}) {
  const [watchState, watchAction, watchPending] = useActionState(
    decideOpportunityAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [dismissState, dismissAction, dismissPending] = useActionState(
    decideOpportunityAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [confirming, setConfirming] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  // Revealing the confirmation moves focus into it, so a keyboard or
  // screen-reader user is not left where the button used to be.
  useEffect(() => {
    if (confirming) reasonRef.current?.focus();
  }, [confirming]);

  if (!canWatch && !canDismiss) return null;

  const error = dismissState.error ?? watchState.error;
  const errorId = `decision-error-${opportunityId}`;

  const hidden = (
    <>
      <input name="opportunityId" type="hidden" value={opportunityId} />
      <input name="mode" type="hidden" value={mode} />
      <input name="returnTo" type="hidden" value={returnTo} />
    </>
  );

  if (confirming && canDismiss) {
    return (
      <form
        action={dismissAction}
        className={compact ? "dismiss-confirm" : "side-card dismiss-confirm"}
      >
        {hidden}
        <input name="decision" type="hidden" value="dismissed" />
        <input name="confirmed" type="hidden" value="yes" />
        <p className="dismiss-warning">
          <strong>Dismissing is final.</strong> The story and this decision stay on the record, but
          a dismissed opportunity does not return to the queue.
        </p>
        <label className="visually-hidden" htmlFor={`dismiss-reason-${opportunityId}`}>
          Why this is being set aside (optional)
        </label>
        <textarea
          aria-describedby={error ? errorId : undefined}
          id={`dismiss-reason-${opportunityId}`}
          maxLength={reasonMax}
          name="dismissalReason"
          placeholder="Why set this aside? Optional, kept on the record."
          ref={reasonRef}
          rows={compact ? 2 : 3}
        />
        {error && (
          <p className="auth-error" id={errorId} role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="button small" disabled={dismissPending} type="submit">
            {dismissPending ? "Dismissing…" : "Confirm dismiss"}
          </button>
          <button
            className="button small"
            disabled={dismissPending}
            onClick={() => setConfirming(false)}
            type="button"
          >
            Go back
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={compact ? "row-decisions" : "side-card"}>
      {!compact && <h3>Work this opportunity</h3>}
      {error && (
        <p className="auth-error" id={errorId} role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {canWatch && (
          <form action={watchAction}>
            {hidden}
            <input name="decision" type="hidden" value="watching" />
            <button className="button small" disabled={watchPending} type="submit">
              {watchPending ? "Recording…" : "Watch"}
            </button>
          </form>
        )}
        {canDismiss && (
          <button className="button small" onClick={() => setConfirming(true)} type="button">
            Dismiss
          </button>
        )}
      </div>
      {!compact && (
        <p className="section-note">
          Watching holds the story here — nothing is scheduled and nothing re-checks it. Dismissing
          sets it aside for good, with your reason on the record.
        </p>
      )}
    </div>
  );
}

/**
 * The confirmation of a decision that has just been recorded, taking focus
 * once because the redirect that carries it rebuilt the page.
 */
const DONE_MESSAGES: Record<string, string> = {
  watching: "Held on watch. Nothing is scheduled; the story waits for you to act or dismiss.",
  dismissed: "Set aside. The story and your reason stay on the record.",
};

export function DecisionNotice({ done }: { readonly done: string }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const message = DONE_MESSAGES[done];
  if (!message) return null;

  return (
    <p className="inspector-saved" ref={ref} role="status" tabIndex={-1}>
      {message}
    </p>
  );
}
