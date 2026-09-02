"use client";

import "@/styles/mastline-dashboard-screens.css";
import { useActionState } from "react";
import { Button } from "@/components/button";
import type { DispatchState } from "../actions";
import { setFlowFollowUpAction } from "../flow-actions";

const INITIAL: DispatchState = {};

/**
 * The follow-up reminder on the Shared stage.
 *
 * Uses the submission's existing follow_up_at column — the one field that is
 * meant to keep moving after the snapshot froze, because it is about the
 * photographer's attention rather than about what was sent. A set reminder
 * surfaces the submission on the Work Queue when the date arrives.
 */
export function FollowUpForm({
  workspaceSlug,
  shootId,
  packageId,
  submissionId,
  followUpAt,
}: {
  workspaceSlug: string;
  shootId: string;
  packageId: string;
  submissionId: string;
  followUpAt?: string;
}) {
  const [state, formAction, pending] = useActionState(
    setFlowFollowUpAction.bind(null, workspaceSlug),
    INITIAL,
  );

  return (
    <form action={formAction} className="ml-delivery-followup">
      <input name="shootId" type="hidden" value={shootId} />
      <input name="packageId" type="hidden" value={packageId} />
      <input name="submissionId" type="hidden" value={submissionId} />

      <label className="ml-label" htmlFor="flow-follow-up">
        {followUpAt ? "Follow-up scheduled" : "No follow-up scheduled"}
      </label>
      <div className="ml-delivery-followup__row">
        <input
          className="ml-input"
          defaultValue={followUpAt ? followUpAt.slice(0, 10) : ""}
          id="flow-follow-up"
          name="followUpAt"
          type="date"
        />
        <Button disabled={pending} size="sm" type="submit" variant="secondary">
          {pending ? "Saving…" : followUpAt ? "Update reminder" : "Set reminder"}
        </Button>
      </div>
      <p className="ml-help">
        A reminder puts this delivery back on the Work Queue on that date. Clearing the field
        removes it.
      </p>
      {state.error && (
        <p className="ml-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
