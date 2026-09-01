"use client";

import { useActionState } from "react";
import type { BuyerRequest } from "@/lib/domain";
import { isClosed } from "@/lib/requests";
import { type RequestActionState, assignRequestAction } from "../actions";

const INITIAL: RequestActionState = {};

export interface AssignableMember {
  readonly userId: string;
  readonly displayName: string;
  readonly role: string;
}

/**
 * Say who is answering this request.
 *
 * Only active members of this workspace appear, and only active members can be
 * stored: `(organization_id, assigned_to)` is a composite foreign key onto the
 * memberships primary key, so somebody from another studio is refused by the
 * database rather than by this list being right. The list is a convenience.
 *
 * A closed request cannot be reassigned. It is finished, and the person who was
 * answering it when it closed is part of what happened.
 */
export function AssignPanel({
  workspaceSlug,
  request,
  members,
  canWrite,
}: {
  workspaceSlug: string;
  request: BuyerRequest;
  members: readonly AssignableMember[];
  canWrite: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    assignRequestAction.bind(null, workspaceSlug),
    INITIAL,
  );

  const current = request.assignedTo
    ? (members.find((member) => member.userId === request.assignedTo)?.displayName ??
      "A workspace member")
    : "Nobody yet";

  if (isClosed(request.status) || !canWrite) {
    return (
      <div className="panel-body">
        <p className="section-note">
          Owner: <strong>{current}</strong>
          {isClosed(request.status) && " · This request is closed, so it cannot be reassigned."}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="panel-body">
      <input name="requestId" type="hidden" value={request.id} />
      <input name="expectedUpdatedAt" type="hidden" value={request.updatedAt} />

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field">
        <label htmlFor="assign-to">Owner</label>
        <select defaultValue={request.assignedTo ?? ""} id="assign-to" name="assignedTo">
          <option value="">Nobody — leave it in the inbox</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="actions">
        <button className="button" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save owner"}
        </button>
      </div>

      <p className="section-note">
        Assigning does not notify anybody. It records who owns answering this, in this workspace.
      </p>
    </form>
  );
}
