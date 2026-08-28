"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  DISMISSAL_REASON_MAX,
  OpportunityError,
  createManualStory,
  dismissOpportunity,
  watchOpportunity,
} from "@/lib/data/opportunities";
import { MODE_FOR_KIND, type NewsMode, parseNewsMode } from "@/lib/news-radar";
import { PermissionError } from "@/lib/permissions";
import { requireWorkspaceContext } from "@/lib/session-context";
import {
  type FieldErrors,
  type ManualStoryInput,
  isRecordId,
  parseManualStory,
} from "@/lib/validation";
import { workspaceRoutes } from "@/lib/workspace-routes";

/**
 * News Radar Server Actions.
 *
 * The workspace slug is bound at render time and used only as a lookup key:
 * `requireWorkspaceContext` resolves membership and role, and the
 * active-workspace cookie is never a tenancy input. Everything that decides
 * whether a write may happen -- the organization, the actor, the current
 * status -- is read on the server.
 *
 * Nothing here contacts a buyer, creates a shoot, builds a package, or sends
 * anything anywhere. Entering a story creates one private canonical record
 * and its two evaluation paths; watching and dismissing record an operator's
 * decision about one path.
 */

export interface StoryEntryState {
  readonly errors?: FieldErrors<ManualStoryInput>;
}

export async function createStoryAction(
  workspaceSlug: string,
  _previous: StoryEntryState,
  formData: FormData,
): Promise<StoryEntryState> {
  const parsed = parseManualStory(formData);
  if (!parsed.ok) return { errors: parsed.errors };

  // Which mode the form was opened from. Only chooses which of the two
  // freshly created paths the redirect lands on; both always exist.
  const mode: NewsMode = parseNewsMode(String(formData.get("mode") ?? ""));

  let context;
  try {
    context = await requireWorkspaceContext(workspaceSlug, "opportunity.write");
  } catch (error) {
    if (error instanceof PermissionError) {
      return { errors: { _form: "Your role may not add stories to the radar." } };
    }
    throw error;
  }
  const { organizationId, canonicalSlug } = context;

  let result;
  try {
    // One atomic creation: the canonical signal and both paths, or nothing.
    // Authorship comes from auth.uid() inside the database.
    result = await createManualStory({ organizationId, ...parsed.value });
  } catch (error) {
    if (error instanceof OpportunityError) {
      return { errors: { _form: error.message } };
    }
    return { errors: { _form: "That story could not be recorded." } };
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.news());

  const target =
    (mode === "shoot" ? result.shootOpportunityId : result.archiveOpportunityId) ??
    result.archiveOpportunityId ??
    result.shootOpportunityId;
  if (!target) {
    // A duplicate of a historical one-path signal whose only path is gone
    // would land here. Nothing to open; the queue explains.
    redirect(routes.news({ query: { mode } }));
  }
  redirect(
    routes.newsOpportunity(target, {
      query: result.outcome === "duplicate" ? { already: "1" } : { created: "1" },
    }),
  );
}

export interface DecisionState {
  readonly error?: string;
  readonly reason?: string;
}

/**
 * The decisions reachable from a browser in this release.
 *
 * `acted` is deliberately absent: recording that an opportunity was acted on
 * belongs to the shoot and package handoffs of a later stage, where there is
 * an act to record. A form cannot claim one happened.
 */
const BROWSER_DECISIONS = ["watching", "dismissed"] as const;
type BrowserDecision = (typeof BROWSER_DECISIONS)[number];

export async function decideOpportunityAction(
  workspaceSlug: string,
  _previous: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const decisionRaw = String(formData.get("decision") ?? "");
  const dismissalReason = String(formData.get("dismissalReason") ?? "").trim();
  const confirmed = formData.get("confirmed") === "yes";
  // Where to land afterwards. Both values feed the route builder, never a raw
  // path, so the browser can choose between known destinations and nothing else.
  const returnTo = formData.get("returnTo") === "detail" ? "detail" : "list";
  const mode: NewsMode = parseNewsMode(String(formData.get("mode") ?? ""));

  if (!BROWSER_DECISIONS.includes(decisionRaw as BrowserDecision)) {
    return { error: "That is not a decision the radar records.", reason: "invalid_status" };
  }
  const decision = decisionRaw as BrowserDecision;

  if (!isRecordId(opportunityId)) {
    return { error: "That opportunity is not in this workspace.", reason: "not_found" };
  }

  if (decision === "dismissed" && !confirmed) {
    return {
      error: "Dismissing is final and needs an explicit confirmation.",
      reason: "unconfirmed",
    };
  }
  if (dismissalReason.length > DISMISSAL_REASON_MAX) {
    return {
      error: `Keep the reason under ${DISMISSAL_REASON_MAX} characters.`,
      reason: "reason_too_long",
    };
  }

  let context;
  try {
    context = await requireWorkspaceContext(workspaceSlug, "opportunity.review");
  } catch (error) {
    if (error instanceof PermissionError) {
      return { error: "Your role may not record radar decisions.", reason: "denied" };
    }
    throw error;
  }
  const { organizationId, actorId, canonicalSlug } = context;

  let landedMode = mode;
  try {
    const input = { organizationId, actorId, opportunityId };
    const saved =
      decision === "watching"
        ? await watchOpportunity(input)
        : await dismissOpportunity({ ...input, dismissalReason });
    // Land on the mode the record actually belongs to, whatever the form said.
    landedMode = MODE_FOR_KIND[saved.kind];
  } catch (error) {
    if (error instanceof OpportunityError) {
      return { error: error.message, reason: error.reason };
    }
    return { error: "That decision could not be recorded.", reason: "unknown" };
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.news());
  revalidatePath(routes.newsOpportunity(opportunityId));

  redirect(
    returnTo === "detail"
      ? routes.newsOpportunity(opportunityId, { query: { done: decision } })
      : routes.news({ query: { mode: landedMode, done: decision, story: opportunityId } }),
  );
}
