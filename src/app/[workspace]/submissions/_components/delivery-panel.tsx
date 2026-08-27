"use client";

import { useActionState } from "react";
import { Badge } from "@/components/primitives";
import { formatDateTime } from "@/lib/format";
import { type DispatchState, retryDeliveryAction } from "@/app/[workspace]/dispatch/actions";

const INITIAL: DispatchState = {};

export interface AttemptView {
  readonly id: string;
  readonly attemptNumber: number;
  readonly status: "sending" | "delivered" | "failed";
  readonly errorCode?: string;
  readonly errorDetail?: string;
  readonly attemptedAt: string;
  readonly byPerson: boolean;
}

/**
 * Delivery attempts and retry.
 *
 * A failure shows the provider's own error rather than a generic message, so
 * the operator can tell a bad password from a rejected file.
 */
export function DeliveryPanel({
  workspaceSlug,
  submissionId,
  status,
  attempts,
  canRetry,
}: {
  workspaceSlug: string;
  submissionId: string;
  status: string;
  attempts: readonly AttemptView[];
  canRetry: boolean;
}) {
  const [state, formAction, pending] = useActionState(retryDeliveryAction.bind(null, workspaceSlug), INITIAL);
  const failed = status === "failed";

  return (
    <div className="side-card">
      <div className="inspector-head">
        <h3>Delivery</h3>
        {failed ? <Badge tone="danger">Failed</Badge> : <Badge tone="neutral">{status}</Badge>}
      </div>

      {attempts.length === 0 ? (
        <p className="section-note">No delivery attempts recorded.</p>
      ) : (
        <ol className="attempt-list">
          {attempts.map((attempt) => (
            <li className={`attempt ${attempt.status}`} key={attempt.id}>
              <div className="attempt-head">
                <strong>Attempt {attempt.attemptNumber}</strong>
                <span>{attempt.status}</span>
              </div>
              <small>
                {formatDateTime(attempt.attemptedAt)}
                {attempt.byPerson ? " · by an operator" : " · reported by the buyer's system"}
              </small>
              {attempt.errorCode && (
                <p className="attempt-error">
                  {attempt.errorCode}
                  {attempt.errorDetail ? ` — ${attempt.errorDetail}` : ""}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="inspector-saved" role="status">
          {state.message}
        </p>
      )}

      {failed && canRetry && (
        <form action={formAction}>
          <input name="submissionId" type="hidden" value={submissionId} />
          <button className="button blue" disabled={pending} type="submit">
            {pending ? "Queuing…" : "Retry delivery"}
          </button>
          <p className="section-note">
            Retrying sends exactly what was sent before. The submission record does not change.
          </p>
        </form>
      )}
    </div>
  );
}
