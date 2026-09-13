"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  assignRequest,
  connectLicense,
  createRequest,
  getRequest,
  transitionRequest,
  updateRequest,
} from "@/lib/data/requests";
import { REQUEST_STATUSES, type RequestStatus } from "@/lib/domain";
import { PermissionError } from "@/lib/permissions";
import { RequestError } from "@/lib/requests";
import { requireWorkspaceContext } from "@/lib/session-context";
import { type FieldErrors, isRecordId, parseRequestIntake } from "@/lib/validation";
import type { RequestIntakeInput } from "@/lib/validation";
import { workspaceRoutes } from "@/lib/workspace-routes";

/**
 * Recording and moving inbound demand.
 *
 * Nothing in this file contacts anybody. Saving a request writes one row and
 * one activity event; there is no code path from here to a dispatch, a delivery
 * link, or a message to a buyer, and the forms say so in as many words.
 *
 * The workspace is a lookup key in every one of these, never the authorization.
 * It arrives bound at render time, where it may since have gone stale, so it is
 * only ever used to resolve a membership -- and membership, plus the role that
 * comes back with it, is what decides.
 */

export interface RequestActionState {
  readonly ok?: boolean;
  readonly message?: string;
  readonly error?: string;
  /** Which refusal this was, so a form can point at the right control. */
  readonly reason?: string;
  readonly errors?: FieldErrors<RequestIntakeInput>;
}

/** Turn any failure into something a form can render, or rethrow it. */
function asActionState(error: unknown): RequestActionState {
  if (error instanceof RequestError) return { error: error.message, reason: error.reason };
  if (error instanceof PermissionError) {
    return { error: "Your role may not change requests.", reason: "denied" };
  }
  throw error;
}

/**
 * Record one request.
 *
 * `intent` chooses between the two states a request can be born in: `draft`
 * keeps it private, `post` puts it in the inbox. Nothing else is creatable --
 * a request cannot arrive already qualified or already lost, because those are
 * histories nobody recorded.
 *
 * The idempotency key comes from the form and is minted once per open form, so
 * a double tap, a resubmitted POST, or a second tab lands on the request the
 * first attempt made. A repeat redirects to that request rather than reporting
 * an error: the operator meant "this request", not "a new one".
 */
export async function createRequestAction(
  workspaceSlug: string,
  _previous: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const parsed = parseRequestIntake(formData);
  if (!parsed.ok) return { errors: parsed.errors };

  const idempotencyKey = String(formData.get("clientToken") ?? "").slice(0, 128);
  if (idempotencyKey.length < 8) {
    return {
      error: "This form lost track of itself. Reload the page and enter the request again.",
      reason: "unknown",
    };
  }

  let context;
  try {
    context = await requireWorkspaceContext(workspaceSlug, "request.write");
  } catch (error) {
    return asActionState(error);
  }
  const { organizationId, actorId, canonicalSlug } = context;

  let created;
  try {
    created = await createRequest({
      organizationId,
      actorId,
      intake: parsed.value,
      idempotencyKey,
      status: formData.get("intent") === "draft" ? "draft" : "new",
    });
  } catch (error) {
    return asActionState(error);
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.requests());
  revalidatePath(routes.work());
  redirect(routes.request(created.id, { query: { recorded: created.existed ? "again" : "1" } }));
}

/**
 * Edit the facts of a request.
 *
 * Deliberately cannot move the status: what a buyer asked for and where the
 * request has got to are different questions, and a form that changes both is
 * how a corrected deadline gets recorded as a decision.
 */
export async function updateRequestAction(
  workspaceSlug: string,
  _previous: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const expectedUpdatedAt = String(formData.get("expectedUpdatedAt") ?? "");

  if (!isRecordId(requestId)) {
    return { error: "That request is not in this workspace.", reason: "not_found" };
  }
  if (!expectedUpdatedAt) {
    return {
      error: "Reload the request and try again: this form no longer knows which version you read.",
      reason: "conflict",
    };
  }

  const parsed = parseRequestIntake(formData);
  if (!parsed.ok) return { errors: parsed.errors };

  let context;
  try {
    context = await requireWorkspaceContext(workspaceSlug, "request.write");
  } catch (error) {
    return asActionState(error);
  }
  const { organizationId, actorId, canonicalSlug } = context;

  try {
    await updateRequest({
      organizationId,
      actorId,
      requestId,
      intake: parsed.value,
      expectedUpdatedAt,
    });
  } catch (error) {
    return asActionState(error);
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.requests());
  revalidatePath(routes.request(requestId));
  redirect(routes.request(requestId, { query: { saved: "1" } }));
}

/** Say who is answering a request, or release it. */
export async function assignRequestAction(
  workspaceSlug: string,
  _previous: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const expectedUpdatedAt = String(formData.get("expectedUpdatedAt") ?? "");
  const raw = String(formData.get("assignedTo") ?? "");
  const assignedTo = raw === "" ? null : raw;

  if (!isRecordId(requestId)) {
    return { error: "That request is not in this workspace.", reason: "not_found" };
  }
  if (!expectedUpdatedAt) {
    return {
      error: "Reload the request and try again: this form no longer knows which version you read.",
      reason: "conflict",
    };
  }

  let context;
  try {
    context = await requireWorkspaceContext(workspaceSlug, "request.write");
  } catch (error) {
    return asActionState(error);
  }
  const { organizationId, actorId, canonicalSlug } = context;

  try {
    await assignRequest({ organizationId, actorId, requestId, assignedTo, expectedUpdatedAt });
  } catch (error) {
    return asActionState(error);
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.requests());
  revalidatePath(routes.work());
  redirect(routes.request(requestId, { query: { assigned: assignedTo ? "1" : "released" } }));
}

function isRequestStatus(value: string): value is RequestStatus {
  return (REQUEST_STATUSES as readonly string[]).includes(value);
}

/** Closing decisions, which get a second look before they are recorded. */
const NEEDS_CONFIRMATION: readonly RequestStatus[] = ["lost", "declined", "cancelled", "expired"];

/**
 * Move a request along.
 *
 * The browser sends a target, a reason, and the `updated_at` it was looking at.
 * Everything that decides whether the move may happen -- the workspace, the
 * role, the current status, the transition table -- is read on the server.
 */
export async function transitionRequestAction(
  workspaceSlug: string,
  _previous: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const requestedStatus = String(formData.get("status") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const expectedUpdatedAt = String(formData.get("expectedUpdatedAt") ?? "");
  const confirmed = formData.get("confirmed") === "yes";

  if (!isRecordId(requestId)) {
    return { error: "That request is not in this workspace.", reason: "not_found" };
  }
  if (!isRequestStatus(requestedStatus)) {
    return { error: "That is not a state a request can be in.", reason: "invalid_status" };
  }
  if (!expectedUpdatedAt) {
    return {
      error: "Reload the request and try again: this form no longer knows which version you read.",
      reason: "conflict",
    };
  }

  let context;
  try {
    context = await requireWorkspaceContext(workspaceSlug, "request.write");
  } catch (error) {
    return asActionState(error);
  }
  const { organizationId, actorId, canonicalSlug } = context;

  if (NEEDS_CONFIRMATION.includes(requestedStatus) && !confirmed) {
    return {
      error: "Closing a request cannot be undone. Confirm before recording it.",
      reason: "unconfirmed",
    };
  }

  /*
   * Read the row before deciding anything about it. The page that rendered this
   * control may be an hour old, and its idea of the current status is a claim
   * by the browser either way.
   */
  const current = await getRequest(organizationId, requestId);
  if (!current) {
    // The same answer for a request in another workspace, a deleted one, and
    // one that never existed. Anything more specific tells the caller where to
    // look, and these are people whose working relationships are worth hiding.
    return { error: "That request is not in this workspace.", reason: "not_found" };
  }

  try {
    await transitionRequest({
      organizationId,
      actorId,
      requestId,
      status: requestedStatus,
      reason,
      expectedUpdatedAt,
    });
  } catch (error) {
    return asActionState(error);
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.requests());
  revalidatePath(routes.work());
  redirect(routes.request(requestId, { query: { moved: requestedStatus } }));
}

/**
 * Record a win by connecting the license that closed the request.
 *
 * This is the only way a request reaches `won`: a person picks the license,
 * confirms that winning closes the request permanently, and one act writes the
 * connection and performs the move. Nothing is automatic -- there is no
 * matching, no suggestion, and no path from a license existing to a request
 * closing without somebody choosing it. The license itself is read, never
 * written: money is recorded on the Money screen and only pointed at here.
 */
export async function connectLicenseAction(
  workspaceSlug: string,
  _previous: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const licenseId = String(formData.get("licenseId") ?? "");
  const expectedUpdatedAt = String(formData.get("expectedUpdatedAt") ?? "");
  const confirmed = formData.get("confirmed") === "yes";

  if (!isRecordId(requestId)) {
    return { error: "That request is not in this workspace.", reason: "not_found" };
  }
  if (!isRecordId(licenseId)) {
    return { error: "Choose the license that closed this request.", reason: "not_found" };
  }
  if (!expectedUpdatedAt) {
    return {
      error: "Reload the request and try again: this form no longer knows which version you read.",
      reason: "conflict",
    };
  }

  // Won is a closing decision like lost or declined, and gets the same second
  // look before it is recorded.
  if (!confirmed) {
    return {
      error: "Recording a win closes this request permanently. Confirm before recording it.",
      reason: "unconfirmed",
    };
  }

  let context;
  try {
    context = await requireWorkspaceContext(workspaceSlug, "request.write");
  } catch (error) {
    return asActionState(error);
  }
  const { organizationId, actorId, canonicalSlug } = context;

  try {
    await connectLicense({ organizationId, actorId, requestId, licenseId, expectedUpdatedAt });
  } catch (error) {
    return asActionState(error);
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.requests());
  revalidatePath(routes.request(requestId));
  revalidatePath(routes.work());
  redirect(routes.request(requestId, { query: { moved: "won" } }));
}
