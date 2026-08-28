import { Badge } from "@/components/primitives";
import { formatDateTime } from "@/lib/format";

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
 * Delivery attempts a provider reported. Read-only.
 *
 * There used to be a "Retry delivery" button here. Pressing it inserted a row
 * with status `sending` and told the operator "Attempt 2 recorded and queued."
 * Nothing was queued: Mastline has no email sender, no SFTP client, and no
 * portal integration, so there was no worker to drain a queue that did not
 * exist and no code path that would ever have moved that attempt off `sending`.
 * An operator retrying a failed delivery and watching it sit pending had no way
 * to discover that nothing had been tried.
 *
 * A database insert is not a transmission, so the control is gone rather than
 * disabled. What stays is the history: attempts an external system genuinely
 * made and reported through the delivery webhook are evidence and remain
 * visible. When there is a real provider behind it, the control comes back.
 *
 * This is no longer a client component -- with nothing to submit there is
 * nothing to hold state for.
 */
export function DeliveryPanel({
  status,
  attempts,
}: {
  status: string;
  attempts: readonly AttemptView[];
}) {
  const failed = status === "failed";

  return (
    <div className="side-card">
      <div className="inspector-head">
        <h3>Provider attempts</h3>
        {failed ? <Badge tone="danger">Failed</Badge> : <Badge tone="neutral">{status}</Badge>}
      </div>

      {attempts.length === 0 ? (
        <p className="section-note">
          No provider has reported a delivery attempt. Mastline does not transmit to a buyer&rsquo;s
          systems: a package reaches a recipient through a delivery link you share.
        </p>
      ) : (
        <>
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
          <p className="section-note">
            Reported by an external system. Mastline records these; it does not make them.
          </p>
        </>
      )}
    </div>
  );
}
