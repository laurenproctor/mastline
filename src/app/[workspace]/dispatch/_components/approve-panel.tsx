"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/components/primitives";
import { type DispatchState, approveAndSendAction } from "../actions";

const INITIAL: DispatchState = {};

/**
 * The send gate.
 *
 * Approval is deliberately two motions. The first reveals exactly what is about
 * to become permanent -- how many frames, to whom, under which terms -- and the
 * second commits it. The constitution requires a fresh human confirmation
 * before a consequential action, and a single button is not that.
 */
export function ApprovePanel({
  workspaceSlug,
  packageId,
  buyerName,
  assetCount,
  terms,
  restrictions,
  isApprovable,
  blockingTitles,
  defaultRecipient,
}: {
  workspaceSlug: string;
  packageId: string;
  buyerName: string | null;
  assetCount: number;
  terms: string | null;
  restrictions: string | null;
  isApprovable: boolean;
  blockingTitles: readonly string[];
  defaultRecipient: string | null;
}) {
  const [state, formAction, pending] = useActionState(approveAndSendAction.bind(null, workspaceSlug), INITIAL);
  const [confirming, setConfirming] = useState(false);

  if (!isApprovable) {
    return (
      <div className="side-card">
        <Badge tone="warn">Not ready</Badge>
        <h3>Dispatch is blocked</h3>
        <p>
          Resolve {blockingTitles.map((title) => title.toLowerCase()).join(", ")} before this can be
          sent.
        </p>
        <button className="button" disabled type="button">
          Approve and record dispatch
        </button>
        <p className="section-note">
          The approval control stays disabled until every blocking check passes.
        </p>
      </div>
    );
  }

  if (!confirming) {
    return (
      <div className="side-card">
        <Badge tone="good">Ready</Badge>
        <h3>Every check passes</h3>
        <p>
          {assetCount} {assetCount === 1 ? "frame" : "frames"} to{" "}
          {buyerName ?? "the selected buyer"}.
        </p>
        <button className="button blue" onClick={() => setConfirming(true)} type="button">
          Approve and record dispatch
        </button>
        <p className="section-note">Nothing is recorded without a confirmation step.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="side-card confirm-card">
      <input name="packageId" type="hidden" value={packageId} />
      <input name="confirmed" type="hidden" value="yes" />

      <Badge tone="danger">Confirm</Badge>
      <h3>This becomes permanent</h3>

      <dl className="confirm-list">
        <div>
          <dt>Frames</dt>
          <dd>{assetCount}</dd>
        </div>
        <div>
          <dt>Buyer</dt>
          <dd>{buyerName ?? "—"}</dd>
        </div>
        <div>
          <dt>Terms</dt>
          <dd>{terms ?? "—"}</dd>
        </div>
        <div>
          <dt>Restrictions</dt>
          <dd>{restrictions ?? "None recorded"}</dd>
        </div>
      </dl>

      <div className="field">
        <label htmlFor="field-recipientLabel">Recipient desk</label>
        <input
          defaultValue={defaultRecipient ?? ""}
          id="field-recipientLabel"
          name="recipientLabel"
          placeholder="New York picture desk"
        />
      </div>

      <div className="field">
        <label htmlFor="field-followUpAt">Follow up on</label>
        <input id="field-followUpAt" name="followUpAt" type="date" />
      </div>

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="actions">
        <button className="button blue" disabled={pending} type="submit">
          {pending ? "Recording…" : "Yes, record this dispatch"}
        </button>
        <button
          className="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          type="button"
        >
          Go back
        </button>
      </div>

      <p className="section-note">
        The exact frames, versions, and terms above are frozen on the submission and cannot be
        edited afterwards. Mastline records the dispatch; it does not transmit to the buyer’s
        systems yet.
      </p>
    </form>
  );
}
