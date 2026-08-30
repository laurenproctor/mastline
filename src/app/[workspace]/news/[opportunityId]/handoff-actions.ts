"use server";

import { revalidatePath } from "next/cache";
import { getEvaluation, getShootBrief } from "@/lib/data/news-radar-evaluations";
import {
  type HandoffResult,
  handoffArchivePackage,
  handoffShootDraft,
} from "@/lib/data/news-radar-handoffs";
import { getOpportunity } from "@/lib/data/opportunities";
import {
  type ConfirmedShootErrors,
  briefFacts,
  composeShootNotes,
  isRequestKey,
  parseShootConfirmation,
} from "@/lib/news-radar-handoff";
import { PermissionError } from "@/lib/permissions";
import { requireWorkspaceContext } from "@/lib/session-context";
import { isRecordId } from "@/lib/validation";
import { workspaceRoutes } from "@/lib/workspace-routes";

/**
 * Server Actions for the two handoffs on one opportunity's detail screen.
 *
 * Each one revalidates the caller and the workspace, reads the path, and
 * hands the confirmed request to the one database function that does the
 * whole handoff in a transaction. The answer is a typed outcome the client
 * component renders; nothing here redirects, so a `stale_evaluation` or an
 * `existing` is shown in place with the path to continue, and a `created`
 * offers the link rather than moving the person before they have read what
 * was made.
 *
 * Both need `opportunity.review` -- the same owner-and-editor rule that
 * records a decision on a path -- and the database repeats it.
 */

export interface HandoffState {
  readonly result?: HandoffResult;
  /** Where the created (or existing) draft is continued. */
  readonly continueHref?: string;
  readonly continueLabel?: string;
  /** Field-level problems on the shoot confirmation form. */
  readonly errors?: ConfirmedShootErrors;
  /** The request key the form should keep using, so a retry stays a repeat. */
  readonly requestKey?: string;
}

const REVIEW_CAPABILITY = "opportunity.review" as const;

function readKey(formData: FormData): string {
  const key = String(formData.get("requestKey") ?? "");
  return isRequestKey(key) ? key : "";
}

function readHash(formData: FormData): { evaluatorVersion: string; inputHash: string } {
  return {
    evaluatorVersion: String(formData.get("evaluatorVersion") ?? "").slice(0, 40),
    inputHash: String(formData.get("inputHash") ?? "").slice(0, 64),
  };
}

async function resolve(workspaceSlug: string, opportunityId: string) {
  const context = await requireWorkspaceContext(workspaceSlug, REVIEW_CAPABILITY);
  const opportunity = isRecordId(opportunityId)
    ? await getOpportunity(context.organizationId, opportunityId)
    : null;
  return { context, opportunity };
}

function continueTo(
  routes: ReturnType<typeof workspaceRoutes>,
  result: HandoffResult,
): Pick<HandoffState, "continueHref" | "continueLabel"> {
  if (result.outcome !== "created" && result.outcome !== "existing") return {};
  if (result.packageId && result.shootId) {
    return {
      continueHref: routes.dispatch({ shootId: result.shootId, packageId: result.packageId }),
      continueLabel: "Continue in the package review",
    };
  }
  if (result.shootId) {
    return {
      continueHref: routes.shoot(result.shootId),
      continueLabel: "Continue in the shoot",
    };
  }
  return {};
}

export async function createArchivePackageAction(
  workspaceSlug: string,
  opportunityId: string,
  _previous: HandoffState,
  formData: FormData,
): Promise<HandoffState> {
  const requestKey = readKey(formData);
  const selectedAssetIds = formData
    .getAll("assetIds")
    .map(String)
    .filter((id) => isRecordId(id));
  const { evaluatorVersion, inputHash } = readHash(formData);

  let resolved;
  try {
    resolved = await resolve(workspaceSlug, opportunityId);
  } catch (error) {
    if (error instanceof PermissionError) return { result: { outcome: "forbidden" }, requestKey };
    throw error;
  }
  const { context, opportunity } = resolved;
  if (!opportunity || opportunity.kind !== "archive_match") {
    return { result: { outcome: "not_found" }, requestKey };
  }
  if (!requestKey) {
    return {
      result: { outcome: "invalid_selection", reason: "request_key", assetIds: [] },
      requestKey,
    };
  }

  let result: HandoffResult;
  try {
    result = await handoffArchivePackage({
      organizationId: context.organizationId,
      opportunityId: opportunity.id,
      evaluatorVersion,
      inputHash,
      requestKey,
      selectedAssetIds,
    });
  } catch {
    console.error(`news radar handoff (package_draft): action_failed for path ${opportunity.id}`);
    result = { outcome: "failed" };
  }

  const routes = workspaceRoutes(context.canonicalSlug);
  if (result.outcome === "created" || result.outcome === "existing") {
    revalidatePath(routes.newsOpportunity(opportunity.id));
    revalidatePath(routes.news());
    revalidatePath(routes.work());
    if (result.shootId) revalidatePath(routes.dispatch({ shootId: result.shootId }));
  }
  return { result, requestKey, ...continueTo(routes, result) };
}

export async function createShootDraftAction(
  workspaceSlug: string,
  opportunityId: string,
  _previous: HandoffState,
  formData: FormData,
): Promise<HandoffState> {
  const requestKey = readKey(formData);
  const { evaluatorVersion, inputHash } = readHash(formData);

  let resolved;
  try {
    resolved = await resolve(workspaceSlug, opportunityId);
  } catch (error) {
    if (error instanceof PermissionError) return { result: { outcome: "forbidden" }, requestKey };
    throw error;
  }
  const { context, opportunity } = resolved;
  if (!opportunity || opportunity.kind !== "shoot_opportunity") {
    return { result: { outcome: "not_found" }, requestKey };
  }
  if (!requestKey) {
    return {
      result: { outcome: "invalid_selection", reason: "request_key", assetIds: [] },
      requestKey,
    };
  }

  // What may be confirmed is bounded by the brief on record, read again here
  // rather than trusted from the form; and the brief must be the one the
  // person saw, which the database checks by evaluator and input hash.
  const [brief, evaluation] = await Promise.all([
    getShootBrief(context.organizationId, opportunity.id),
    getEvaluation(context.organizationId, opportunity.id),
  ]);
  if (!brief || !evaluation?.resultAt) {
    return { result: { outcome: "needs_context" }, requestKey };
  }
  const facts = briefFacts(brief);
  const parsed = parseShootConfirmation(formData, facts);
  if (!parsed.ok) return { errors: parsed.errors, requestKey };

  let result: HandoffResult;
  try {
    result = await handoffShootDraft({
      organizationId: context.organizationId,
      opportunityId: opportunity.id,
      evaluatorVersion,
      inputHash,
      requestKey,
      confirmed: parsed.value,
      notes: composeShootNotes(parsed.value, opportunity.story.title),
    });
  } catch {
    console.error(`news radar handoff (shoot_draft): action_failed for path ${opportunity.id}`);
    result = { outcome: "failed" };
  }

  const routes = workspaceRoutes(context.canonicalSlug);
  if (result.outcome === "created" || result.outcome === "existing") {
    revalidatePath(routes.newsOpportunity(opportunity.id));
    revalidatePath(routes.news());
    revalidatePath(routes.shoots());
    revalidatePath(routes.work());
  }
  return { result, requestKey, ...continueTo(routes, result) };
}
