"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  LICENSE_REQUIRED_MESSAGE,
  RightsReviewError,
  type TriageStatus,
  allowedTransitions,
  getRightsMatch,
  isTriageStatus,
  requiresLinkedLicense,
  reviewRightsMatch,
} from "@/lib/data/rights";
import { PermissionError } from "@/lib/permissions";
import { requireWorkspaceContext } from "@/lib/session-context";
import { isRecordId } from "@/lib/validation";
import { workspaceRoutes } from "@/lib/workspace-routes";

/**
 * Recording a triage decision.
 *
 * This is internal human review and nothing else. No demand, no takedown, no
 * message to a publisher, no new evidence capture, and no finding that
 * infringement occurred. `escalated` is not reachable from here: the data layer
 * accepts only the five triage statuses, and this action rejects anything else
 * before it gets that far.
 *
 * What the browser sends is a match id, a target status, a note, and the
 * `updated_at` the reviewer was looking at. Everything that decides whether the
 * write may happen -- the organization, the actor, the current status, the
 * license check -- is read on the server from the workspace context and the
 * database row.
 */

export interface RightsActionState {
  readonly ok?: boolean;
  readonly message?: string;
  readonly error?: string;
  /** Which refusal this was, so a form can point at the right field. */
  readonly reason?: string;
}

/** Decisions that close a match and therefore need a fresh confirmation. */
const NEEDS_CONFIRMATION: readonly TriageStatus[] = ["ignored", "licensed", "resolved"];

export async function recordRightsDecisionAction(
  workspaceSlug: string,
  _previous: RightsActionState,
  formData: FormData,
): Promise<RightsActionState> {
  const matchId = String(formData.get("matchId") ?? "");
  const requestedStatus = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "");
  const expectedUpdatedAt = String(formData.get("expectedUpdatedAt") ?? "");
  const confirmed = formData.get("confirmed") === "yes";

  if (!isTriageStatus(requestedStatus)) {
    return { error: "That is not a decision this review records.", reason: "invalid_status" };
  }
  const status: TriageStatus = requestedStatus;

  if (!isRecordId(matchId)) {
    return { error: "That match is not in this workspace.", reason: "not_found" };
  }
  if (!expectedUpdatedAt) {
    return {
      error: "Reload the match and try again: this form no longer knows which version you read.",
      reason: "conflict",
    };
  }

  let context;
  try {
    // The slug is a lookup key, never the authorization. Membership and role
    // are what decide, and both come back from here.
    context = await requireWorkspaceContext(workspaceSlug, "rights.triage");
  } catch (error) {
    if (error instanceof PermissionError) {
      return { error: "Your role may not record rights decisions.", reason: "denied" };
    }
    throw error;
  }
  const { organizationId, actorId, canonicalSlug } = context;

  if (NEEDS_CONFIRMATION.includes(status) && !confirmed) {
    return {
      error: "This decision needs an explicit confirmation before it is recorded.",
      reason: "unconfirmed",
    };
  }

  /*
   * Read the row before deciding anything about it. The page that rendered the
   * form may be minutes old, and its idea of the status and the license check
   * is a claim by the browser either way.
   */
  const current = await getRightsMatch(organizationId, matchId);
  if (!current) {
    // The same answer for a match in another workspace, a deleted one, and one
    // that never existed. Anything more specific tells the caller where to look.
    return { error: "That match is not in this workspace.", reason: "not_found" };
  }
  if (!allowedTransitions(current.status).includes(status)) {
    return {
      error: `A match recorded as ${current.status} cannot be moved to ${status}.`,
      reason: "invalid_transition",
    };
  }
  if (requiresLinkedLicense(status) && current.licenseCheck !== "linked_license_found") {
    return { error: LICENSE_REQUIRED_MESSAGE, reason: "license_required" };
  }

  try {
    await reviewRightsMatch({
      organizationId,
      actorId,
      matchId,
      status,
      note,
      expectedUpdatedAt,
    });
  } catch (error) {
    if (error instanceof RightsReviewError) {
      return { error: error.message, reason: error.reason };
    }
    return { error: "That decision could not be recorded.", reason: "unknown" };
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.rights());
  // Back to the match that was just decided, with the confirmation carried in
  // the address so it survives the fresh request that shows the new state.
  redirect(routes.rights({ query: { match: matchId, done: status } }));
}
