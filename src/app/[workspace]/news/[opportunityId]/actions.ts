"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  EvaluationError,
  acceptSuggestion,
  evaluateOpportunity,
  getSignalContext,
  saveSignalContext,
} from "@/lib/data/news-radar-evaluations";
import { getOpportunity } from "@/lib/data/opportunities";
import {
  type ContextFieldErrors,
  findSuggestion,
  parseContextForm,
  suggestContext,
} from "@/lib/news-radar-context";
import { FAILURE_LABELS } from "@/lib/news-radar-evaluation";
import { PermissionError } from "@/lib/permissions";
import { requireWorkspaceContext } from "@/lib/session-context";
import { isRecordId } from "@/lib/validation";
import { workspaceRoutes } from "@/lib/workspace-routes";

/**
 * Server Actions for one opportunity's detail screen: recording context on
 * the story, accepting a suggestion, and running the evaluator.
 *
 * The workspace slug and the opportunity id are bound at render time and
 * used only as lookup keys; membership, role, and the record's workspace
 * are resolved on the server. All three actions need `opportunity.write`,
 * the same owner-and-editor rule that governs entering a story, and the
 * database repeats it in row level security.
 *
 * Nothing here contacts anyone, creates a shoot or a package, or writes an
 * asset. Evaluating reads the archive and writes the evaluation tables only.
 */

async function resolve(workspaceSlug: string, opportunityId: string) {
  const context = await requireWorkspaceContext(workspaceSlug, "opportunity.write");
  if (!isRecordId(opportunityId)) return { context, opportunity: null };
  const opportunity = await getOpportunity(context.organizationId, opportunityId);
  return { context, opportunity };
}

export interface ContextState {
  readonly errors?: ContextFieldErrors;
}

export async function saveContextAction(
  workspaceSlug: string,
  opportunityId: string,
  _previous: ContextState,
  formData: FormData,
): Promise<ContextState> {
  const parsed = parseContextForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };

  let resolved;
  try {
    resolved = await resolve(workspaceSlug, opportunityId);
  } catch (error) {
    if (error instanceof PermissionError) {
      return { errors: { _form: "Your role may not edit a story's context." } };
    }
    throw error;
  }
  const { context, opportunity } = resolved;
  if (!opportunity) {
    return { errors: { _form: "That opportunity is not in this workspace." } };
  }

  try {
    await saveSignalContext({
      organizationId: context.organizationId,
      actorId: context.actorId,
      newsSignalId: opportunity.newsSignalId,
      input: parsed.value,
    });
  } catch (error) {
    if (error instanceof EvaluationError) return { errors: { _form: error.message } };
    return { errors: { _form: "The context could not be saved." } };
  }

  const routes = workspaceRoutes(context.canonicalSlug);
  revalidatePath(routes.newsOpportunity(opportunity.id));
  redirect(routes.newsOpportunity(opportunity.id, { query: { context: "saved" } }));
}

export interface SuggestionState {
  readonly error?: string;
}

export async function acceptSuggestionAction(
  workspaceSlug: string,
  opportunityId: string,
  _previous: SuggestionState,
  formData: FormData,
): Promise<SuggestionState> {
  const kind = String(formData.get("kind") ?? "");
  const value = String(formData.get("value") ?? "");

  let resolved;
  try {
    resolved = await resolve(workspaceSlug, opportunityId);
  } catch (error) {
    if (error instanceof PermissionError) {
      return { error: "Your role may not edit a story's context." };
    }
    throw error;
  }
  const { context, opportunity } = resolved;
  if (!opportunity) return { error: "That opportunity is not in this workspace." };

  // The suggestion is re-derived from the story rather than trusted from the
  // form: the browser names WHICH suggestion, the rule supplies the basis.
  let stored;
  try {
    stored = await getSignalContext(context.organizationId, opportunity.newsSignalId);
  } catch {
    return { error: "The story's context could not be read." };
  }
  const suggestion = findSuggestion(suggestContext(opportunity.story, stored), kind, value);
  if (!suggestion) return { error: "That suggestion is no longer on offer." };

  try {
    await acceptSuggestion({
      organizationId: context.organizationId,
      actorId: context.actorId,
      newsSignalId: opportunity.newsSignalId,
      suggestion,
    });
  } catch (error) {
    if (error instanceof EvaluationError) return { error: error.message };
    return { error: "The suggestion could not be recorded." };
  }

  const routes = workspaceRoutes(context.canonicalSlug);
  revalidatePath(routes.newsOpportunity(opportunity.id));
  redirect(routes.newsOpportunity(opportunity.id, { query: { context: "accepted" } }));
}

export interface EvaluateState {
  readonly error?: string;
}

export async function evaluateAction(
  workspaceSlug: string,
  opportunityId: string,
  _previous: EvaluateState,
  _formData: FormData,
): Promise<EvaluateState> {
  let resolved;
  try {
    resolved = await resolve(workspaceSlug, opportunityId);
  } catch (error) {
    if (error instanceof PermissionError) {
      return { error: "Your role may not run the evaluator." };
    }
    throw error;
  }
  const { context, opportunity } = resolved;
  if (!opportunity) return { error: "That opportunity is not in this workspace." };

  let result;
  try {
    result = await evaluateOpportunity({
      organizationId: context.organizationId,
      actorId: context.actorId,
      opportunityId: opportunity.id,
    });
  } catch (error) {
    if (error instanceof EvaluationError) return { error: error.message };
    return { error: FAILURE_LABELS.evaluator_error };
  }

  const routes = workspaceRoutes(context.canonicalSlug);
  revalidatePath(routes.newsOpportunity(opportunity.id));
  redirect(
    routes.newsOpportunity(opportunity.id, {
      query:
        result.outcome === "failed"
          ? { evaluated: "failed", failure: result.failureCode ?? "write_failed" }
          : { evaluated: result.outcome },
    }),
  );
}
