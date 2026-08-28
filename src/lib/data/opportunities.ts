import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Id,
  NewsSignal,
  Opportunity,
  OpportunityKind,
  OpportunitySignal,
  OpportunityStatus,
} from "../domain";
import { createClient } from "../supabase/server";
import { isRecordId } from "../validation";
import { recordEventWith } from "./activity";

/**
 * The News Radar record: one canonical news signal, evaluated through two
 * independent commercial paths.
 *
 * Three things stay separate here, on the same principle as rights triage:
 *
 *   1. Source facts -- the news signal. Typed once by an operator in this
 *      release; written by an ingestion pass later. Never edited by a
 *      lifecycle decision, and never copied onto a path.
 *   2. Inference -- each path's signal strength, confidence, and stated
 *      basis. Suggestions with a reason attached, or absent.
 *   3. The operator's decisions -- each path's status, dismissal reason, and
 *      acted time, decided independently of the other path.
 *
 * Nothing in this module contacts a buyer, creates a shoot, builds a package,
 * or sends anything anywhere. Even `markOpportunityActed` only records that a
 * person said they acted; the real handoffs arrive in a later stage.
 */

const SIGNAL_COLUMNS =
  "id, organization_id, title, source_name, source_url, source_published_at, summary, created_by, created_at, updated_at";

const PATH_COLUMNS =
  "id, organization_id, news_signal_id, opportunity_kind, signal, confidence, suggestion_basis, status, window_closes_at, dismissal_reason, acted_at, created_at, updated_at";

const PATH_WITH_SIGNAL = `${PATH_COLUMNS}, news_signals!inner(${SIGNAL_COLUMNS})`;

interface SignalRow {
  id: string;
  organization_id: string;
  title: string;
  source_name: string | null;
  source_url: string | null;
  source_published_at: string | null;
  summary: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface PathRow {
  id: string;
  organization_id: string;
  news_signal_id: string;
  opportunity_kind: string;
  signal: string;
  confidence: number | string | null;
  suggestion_basis: Record<string, unknown> | null;
  status: string;
  window_closes_at: string | null;
  dismissal_reason: string | null;
  acted_at: string | null;
  created_at: string;
  updated_at: string;
  news_signals?: SignalRow;
}

function toSignal(row: SignalRow): NewsSignal {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    sourceName: row.source_name ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    sourcePublishedAt: row.source_published_at ?? undefined,
    summary: row.summary ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPath(row: PathRow): Opportunity {
  return {
    id: row.id,
    organizationId: row.organization_id,
    newsSignalId: row.news_signal_id,
    kind: row.opportunity_kind as OpportunityKind,
    signal: row.signal as OpportunitySignal,
    confidence: row.confidence === null ? undefined : Number(row.confidence),
    suggestionBasis:
      typeof row.suggestion_basis?.summary === "string" && row.suggestion_basis.summary !== ""
        ? row.suggestion_basis.summary
        : undefined,
    status: row.status as OpportunityStatus,
    windowClosesAt: row.window_closes_at ?? undefined,
    dismissalReason: row.dismissal_reason ?? undefined,
    actedAt: row.acted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** One evaluation path, carrying the story it evaluates. */
export interface RadarOpportunity extends Opportunity {
  readonly story: NewsSignal;
}

function toRadarOpportunity(row: PathRow): RadarOpportunity {
  if (!row.news_signals) throw new Error("An opportunity path arrived without its news signal.");
  return { ...toPath(row), story: toSignal(row.news_signals) };
}

/** Whether the useful window has already closed. Derived, never stored. */
export function windowHasClosed(opportunity: Opportunity, now: Date): boolean {
  return Boolean(
    opportunity.windowClosesAt && new Date(opportunity.windowClosesAt).getTime() <= now.getTime(),
  );
}

export async function listOpportunities(
  organizationId: Id,
  filter: { kind?: OpportunityKind } = {},
  client?: SupabaseClient,
): Promise<readonly RadarOpportunity[]> {
  const supabase = client ?? (await createClient());
  let query = supabase
    .from("opportunities")
    .select(PATH_WITH_SIGNAL)
    .eq("organization_id", organizationId);

  if (filter.kind) query = query.eq("opportunity_kind", filter.kind);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load the news radar: ${error.message}`);

  // Newest story first. Sorted here rather than in SQL because the ordering
  // key lives on the joined signal, and at manual-entry volumes a workspace's
  // radar is small.
  return (data ?? [])
    .map((row) => toRadarOpportunity(row as unknown as PathRow))
    .sort((a, b) => {
      const aWhen = a.story.sourcePublishedAt ?? a.story.createdAt;
      const bWhen = b.story.sourcePublishedAt ?? b.story.createdAt;
      return bWhen.localeCompare(aWhen) || b.createdAt.localeCompare(a.createdAt);
    });
}

/**
 * One evaluation path, scoped to the workspace that asked.
 *
 * The organization filter is applied in SQL as well as by row level security,
 * and a malformed id is answered as "no such record" rather than a database
 * error -- the caller must not be able to tell a bad id from an id belonging
 * to somebody else's workspace.
 */
export async function getOpportunity(
  organizationId: Id,
  opportunityId: Id,
  client?: SupabaseClient,
): Promise<RadarOpportunity | null> {
  if (!isRecordId(opportunityId)) return null;

  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("opportunities")
    .select(PATH_WITH_SIGNAL)
    .eq("organization_id", organizationId)
    .eq("id", opportunityId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the opportunity: ${error.message}`);
  return data ? toRadarOpportunity(data as unknown as PathRow) : null;
}

/**
 * The same story's other evaluation, for the "view the other path" link.
 * Null when no counterpart exists -- historical signals may carry one path.
 */
export async function getSiblingPath(
  organizationId: Id,
  newsSignalId: Id,
  excludingOpportunityId: Id,
  client?: SupabaseClient,
): Promise<Opportunity | null> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("opportunities")
    .select(PATH_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("news_signal_id", newsSignalId)
    .neq("id", excludingOpportunityId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the story's other path: ${error.message}`);
  return data ? toPath(data as unknown as PathRow) : null;
}

export type OpportunityFailure =
  "duplicate" | "invalid_status" | "invalid_transition" | "not_found" | "denied" | "conflict";

/**
 * A refusal with a reason the interface can act on. The message is written for
 * an operator; no database text reaches it, because a Postgres error string
 * can name columns, constraints, and policies.
 */
export class OpportunityError extends Error {
  readonly reason: OpportunityFailure;

  constructor(reason: OpportunityFailure, message: string) {
    super(message);
    this.name = "OpportunityError";
    this.reason = reason;
  }
}

export interface CreateManualStoryInput {
  readonly organizationId: Id;
  readonly title: string;
  readonly sourceName?: string;
  readonly sourceUrl?: string;
  readonly sourcePublishedAt?: string;
  readonly summary?: string;
  /** Seeds BOTH paths; each is refined and decided independently afterwards. */
  readonly signal: OpportunitySignal;
  readonly windowClosesAt?: string;
  readonly suggestionBasis?: string;
  /** 0 to 1. Refused without a basis; the database repeats that rule. */
  readonly confidence?: number;
  /** A caller-held client, for database-backed tests. Never a service-role one. */
  readonly client?: SupabaseClient;
}

export interface CreateManualStoryResult {
  /** "created", or "duplicate" when the workspace already holds this story. */
  readonly outcome: "created" | "duplicate";
  readonly signalId: Id;
  readonly archiveOpportunityId?: Id;
  readonly shootOpportunityId?: Id;
}

/**
 * Enter one story by hand.
 *
 * One submission, one canonical signal, both evaluation paths -- atomically,
 * through the SECURITY INVOKER `create_news_story` function, so a failure
 * anywhere leaves nothing behind and row level security applies to every
 * insert exactly as it would to a direct write. Authorship comes from
 * `auth.uid()` inside the database, not from anything a browser sent.
 *
 * Entering the same source URL again is answered with the records as they
 * stand -- outcome "duplicate", carrying the existing ids -- rather than with
 * a second copy of the story.
 *
 * This contacts nobody, creates no shoot, builds no package, and sends
 * nothing.
 */
export async function createManualStory(
  input: CreateManualStoryInput,
): Promise<CreateManualStoryResult> {
  const supabase = input.client ?? (await createClient());

  const { data, error } = await supabase.rpc("create_news_story", {
    target_organization: input.organizationId,
    story_title: input.title,
    story_source_name: input.sourceName ?? null,
    story_source_url: input.sourceUrl ?? null,
    story_published_at: input.sourcePublishedAt ?? null,
    story_summary: input.summary ?? null,
    path_signal: input.signal,
    path_confidence: input.confidence ?? null,
    path_basis: input.suggestionBasis ?? null,
    path_window_closes_at: input.windowClosesAt ?? null,
  });

  if (error) {
    // Never the driver's text: it names columns, constraints, and policies.
    throw new OpportunityError("denied", "Your role may not add stories to the radar.");
  }

  const result = data as {
    outcome?: string;
    signal_id?: string;
    archive_opportunity_id?: string | null;
    shoot_opportunity_id?: string | null;
  } | null;

  if (!result?.signal_id || (result.outcome !== "created" && result.outcome !== "duplicate")) {
    throw new OpportunityError("denied", "That story could not be recorded.");
  }

  return {
    outcome: result.outcome,
    signalId: result.signal_id,
    archiveOpportunityId: result.archive_opportunity_id ?? undefined,
    shootOpportunityId: result.shoot_opportunity_id ?? undefined,
  };
}

/**
 * The lifecycle decisions an operator records in this release.
 *
 * `pitching` and `expired` exist in the status vocabulary but are deliberately
 * not reachable from here: pitching belongs to the pitch workflow that does
 * not exist yet, and expiry is a fact about the clock, not a decision anyone
 * makes.
 */
export const OPPORTUNITY_DECISIONS = ["watching", "dismissed", "acted"] as const;
export type OpportunityDecision = (typeof OPPORTUNITY_DECISIONS)[number];

export function isOpportunityDecision(value: string): value is OpportunityDecision {
  return (OPPORTUNITY_DECISIONS as readonly string[]).includes(value);
}

/**
 * Which decisions may follow which state.
 *
 * `acted`, `dismissed`, and `expired` are terminal: a record of what happened
 * to an evaluation is not quietly rewritten, and in particular a dismissed or
 * expired path can never slide back to looking new. The OTHER path of the
 * same story is untouched by any of this -- the two are decided
 * independently.
 */
const ALLOWED_TRANSITIONS: Record<OpportunityStatus, readonly OpportunityDecision[]> = {
  new: ["watching", "dismissed", "acted"],
  watching: ["dismissed", "acted"],
  pitching: ["watching", "dismissed", "acted"],
  acted: [],
  dismissed: [],
  expired: [],
};

export function allowedOpportunityDecisions(
  from: OpportunityStatus,
): readonly OpportunityDecision[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

export const DISMISSAL_REASON_MAX = 1000;

export interface OpportunityDecisionInput {
  readonly organizationId: Id;
  readonly actorId: Id;
  readonly opportunityId: Id;
  /** Only read when the decision is a dismissal. Optional even then. */
  readonly dismissalReason?: string;
  /** A caller-held client, for database-backed tests. Never a service-role one. */
  readonly client?: SupabaseClient;
}

const DECISION_SUMMARIES: Record<OpportunityDecision, string> = {
  watching: "Held on watch",
  dismissed: "Set aside by an operator",
  acted: "Recorded as acted on",
};

const KIND_EVENT_LABELS: Record<OpportunityKind, string> = {
  archive_match: "archive path",
  shoot_opportunity: "shoot path",
};

/**
 * Record one lifecycle decision on one path.
 *
 * Repeating a decision is safe: asking to watch a path that is already
 * watching (or dismiss a dismissed one, or act on an acted one) returns the
 * record as it stands, writes nothing, and logs nothing. Every other
 * disallowed move is refused out loud. The update is conditional on the
 * `updated_at` that was just read, so two operators working the same radar
 * cannot silently overwrite one another.
 */
export async function updateOpportunityStatus(
  input: OpportunityDecisionInput & { readonly decision: OpportunityDecision },
): Promise<RadarOpportunity> {
  const { organizationId, actorId, opportunityId, decision } = input;
  const supabase = input.client ?? (await createClient());

  if (!isOpportunityDecision(decision)) {
    throw new OpportunityError("invalid_status", "That is not a decision the radar records.");
  }

  const current = await getOpportunity(organizationId, opportunityId, supabase);
  if (!current) {
    throw new OpportunityError("not_found", "That opportunity is not in this workspace.");
  }

  // Idempotent: the decision is already on the record.
  if (current.status === decision) return current;

  if (!allowedOpportunityDecisions(current.status).includes(decision)) {
    throw new OpportunityError(
      "invalid_transition",
      `An opportunity recorded as ${current.status} cannot be moved to ${decision}.`,
    );
  }

  const reason =
    decision === "dismissed" && input.dismissalReason?.trim()
      ? input.dismissalReason.trim().slice(0, DISMISSAL_REASON_MAX)
      : null;

  const { data, error } = await supabase
    .from("opportunities")
    .update({
      status: decision,
      dismissal_reason: reason,
      acted_at: decision === "acted" ? new Date().toISOString() : null,
    })
    .eq("organization_id", organizationId)
    .eq("id", opportunityId)
    .eq("updated_at", current.updatedAt)
    .select(PATH_WITH_SIGNAL);

  if (error) {
    throw new OpportunityError("denied", "That decision could not be recorded.");
  }

  const updated = (data ?? [])[0] as unknown as PathRow | undefined;
  if (!updated) {
    /*
     * Zero rows is a permission refusal or a race, and the operator deserves
     * to know which. Row level security answers a forbidden update with no
     * rows rather than an error, so the row is read back to tell them apart.
     */
    const now = await getOpportunity(organizationId, opportunityId, supabase);
    if (!now) {
      throw new OpportunityError("not_found", "That opportunity is not in this workspace.");
    }
    if (now.updatedAt === current.updatedAt) {
      throw new OpportunityError("denied", "Your role may not record radar decisions.");
    }
    if (now.status === decision) return now;
    throw new OpportunityError(
      "conflict",
      "Somebody else worked this opportunity while you were reading it. Reload and look at the current state before deciding.",
    );
  }

  const saved = toRadarOpportunity(updated);

  // The event belongs to the PATH, so the history can say which evaluation
  // was decided; the signal's own history holds only its entry and edits.
  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "opportunity",
    entityId: opportunityId,
    action: `opportunity.${decision}`,
    data: {
      summary: `${DECISION_SUMMARIES[decision]} (${KIND_EVENT_LABELS[saved.kind]})`,
      newsSignalId: saved.newsSignalId,
      kind: saved.kind,
      previousStatus: current.status,
      status: decision,
      reasonRecorded: reason !== null,
    },
  });

  return saved;
}

/** Hold a path on watch. Nothing is scheduled and nothing re-checks it. */
export async function watchOpportunity(input: OpportunityDecisionInput): Promise<RadarOpportunity> {
  return updateOpportunityStatus({ ...input, decision: "watching" });
}

/** Set a path aside, with an optional reason on the record. */
export async function dismissOpportunity(
  input: OpportunityDecisionInput,
): Promise<RadarOpportunity> {
  return updateOpportunityStatus({ ...input, decision: "dismissed" });
}

/**
 * Record that the operator acted on this path.
 *
 * In this release the record is the whole act: nothing is created, sent, or
 * contacted from here, and no browser control reaches this. The shoot and
 * package handoffs arrive in a later stage and will call this after their own
 * deliberate confirmation succeeds.
 */
export async function markOpportunityActed(
  input: OpportunityDecisionInput,
): Promise<RadarOpportunity> {
  return updateOpportunityStatus({ ...input, decision: "acted" });
}
