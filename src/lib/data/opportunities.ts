import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Id,
  Opportunity,
  OpportunityKind,
  OpportunitySignal,
  OpportunityStatus,
} from "../domain";
import { createClient } from "../supabase/server";
import { isRecordId } from "../validation";
import { recordEventWith } from "./activity";

/**
 * The News Radar record: stories, and what a workspace decided to do about
 * them.
 *
 * Three things stay separate here, on the same principle as rights triage:
 *
 *   1. Source facts -- headline, source, publication time, summary. Typed by
 *      an operator in this release; written by an ingestion pass later. Never
 *      edited by a lifecycle decision.
 *   2. Inference -- signal, confidence, and the stated basis. Suggestions with
 *      a reason attached, or absent. Never silently derived.
 *   3. The operator's decision -- status, dismissal reason, acted time. That
 *      is all the lifecycle functions below write.
 *
 * Nothing in this module contacts a buyer, creates a shoot, builds a package,
 * or sends anything anywhere. Acting on an opportunity is a deliberate,
 * separate operator action, and in this stage even `markOpportunityActed`
 * only records that a person said they acted.
 */

const OPPORTUNITY_COLUMNS =
  "id, organization_id, opportunity_kind, title, source_name, source_url, source_published_at, summary, signal, confidence, suggestion_basis, status, window_closes_at, dismissal_reason, acted_at, created_by, created_at, updated_at";

interface OpportunityRow {
  id: string;
  organization_id: string;
  opportunity_kind: string;
  title: string;
  source_name: string | null;
  source_url: string | null;
  source_published_at: string | null;
  summary: string | null;
  signal: string;
  confidence: number | string | null;
  suggestion_basis: Record<string, unknown> | null;
  status: string;
  window_closes_at: string | null;
  dismissal_reason: string | null;
  acted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toOpportunity(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    organizationId: row.organization_id,
    kind: row.opportunity_kind as OpportunityKind,
    title: row.title,
    sourceName: row.source_name ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    sourcePublishedAt: row.source_published_at ?? undefined,
    summary: row.summary ?? undefined,
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
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
): Promise<readonly Opportunity[]> {
  const supabase = client ?? (await createClient());
  let query = supabase
    .from("opportunities")
    .select(OPPORTUNITY_COLUMNS)
    .eq("organization_id", organizationId)
    .order("source_published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (filter.kind) query = query.eq("opportunity_kind", filter.kind);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load the news radar: ${error.message}`);

  return (data ?? []).map((row) => toOpportunity(row as unknown as OpportunityRow));
}

/**
 * One opportunity, scoped to the workspace that asked.
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
): Promise<Opportunity | null> {
  if (!isRecordId(opportunityId)) return null;

  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("opportunities")
    .select(OPPORTUNITY_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", opportunityId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the opportunity: ${error.message}`);
  return data ? toOpportunity(data as unknown as OpportunityRow) : null;
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

export interface CreateManualOpportunityInput {
  readonly organizationId: Id;
  readonly actorId: Id;
  readonly kind: OpportunityKind;
  readonly title: string;
  readonly sourceName?: string;
  readonly sourceUrl?: string;
  readonly sourcePublishedAt?: string;
  readonly summary?: string;
  readonly signal: OpportunitySignal;
  readonly windowClosesAt?: string;
  readonly suggestionBasis?: string;
  /** 0 to 1. Refused without a basis; the database repeats that rule. */
  readonly confidence?: number;
  /** A caller-held client, for database-backed tests. Never a service-role one. */
  readonly client?: SupabaseClient;
}

const KIND_LABELS: Record<OpportunityKind, string> = {
  archive_match: "an archive match",
  shoot_opportunity: "a shoot opportunity",
};

/**
 * Enter one story by hand.
 *
 * This creates a private workspace record and writes one activity event.
 * It contacts nobody, creates no shoot, builds no package, and sends nothing.
 *
 * The same story may be entered once per kind -- the two modes are different
 * jobs -- and a second entry of the same kind with the same source URL is
 * refused as a duplicate rather than quietly doubled.
 */
export async function createManualOpportunity(
  input: CreateManualOpportunityInput,
): Promise<Opportunity> {
  const supabase = input.client ?? (await createClient());

  const { data, error } = await supabase
    .from("opportunities")
    .insert({
      organization_id: input.organizationId,
      opportunity_kind: input.kind,
      title: input.title,
      source_name: input.sourceName ?? null,
      source_url: input.sourceUrl ?? null,
      source_published_at: input.sourcePublishedAt ?? null,
      summary: input.summary ?? null,
      signal: input.signal,
      confidence: input.confidence ?? null,
      suggestion_basis: input.suggestionBasis ? { summary: input.suggestionBasis } : {},
      status: "new",
      window_closes_at: input.windowClosesAt ?? null,
      created_by: input.actorId,
    })
    .select(OPPORTUNITY_COLUMNS);

  if (error) {
    // Unique violation on (organization, kind, source URL).
    if (error.code === "23505") {
      throw new OpportunityError(
        "duplicate",
        `That story is already on the radar as ${KIND_LABELS[input.kind]}. Open it from the queue instead of entering it twice.`,
      );
    }
    throw new OpportunityError("denied", "That story could not be recorded.");
  }

  const created = (data ?? [])[0] as unknown as OpportunityRow | undefined;
  if (!created) {
    // Row level security answers a forbidden insert with no rows.
    throw new OpportunityError("denied", "Your role may not add stories to the radar.");
  }

  const saved = toOpportunity(created);

  await recordEventWith(supabase, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    entityType: "opportunity",
    entityId: saved.id,
    action: "opportunity.created",
    data: {
      summary: `Story entered by hand as ${KIND_LABELS[input.kind]}`,
      kind: input.kind,
      sourceRecorded: Boolean(input.sourceUrl),
    },
  });

  return saved;
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
 * to a story is not quietly rewritten, and in particular a dismissed or
 * expired opportunity can never slide back to looking new. Revisiting one is
 * a fresh entry of the story, made deliberately.
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

/**
 * Record one lifecycle decision.
 *
 * Repeating a decision is safe: asking to watch an opportunity that is already
 * watching (or dismiss a dismissed one, or act on an acted one) returns the
 * record as it stands, writes nothing, and logs nothing -- the decision is
 * already on the record and a second identical row would be noise. Every other
 * disallowed move is refused out loud.
 *
 * The update is conditional on the `updated_at` that was just read, so two
 * operators working the same radar cannot silently overwrite one another.
 */
export async function updateOpportunityStatus(
  input: OpportunityDecisionInput & { readonly decision: OpportunityDecision },
): Promise<Opportunity> {
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
    .select(OPPORTUNITY_COLUMNS);

  if (error) {
    throw new OpportunityError("denied", "That decision could not be recorded.");
  }

  const updated = (data ?? [])[0] as unknown as OpportunityRow | undefined;
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

  const saved = toOpportunity(updated);

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "opportunity",
    entityId: opportunityId,
    action: `opportunity.${decision}`,
    data: {
      summary: DECISION_SUMMARIES[decision],
      previousStatus: current.status,
      status: decision,
      reasonRecorded: reason !== null,
    },
  });

  return saved;
}

/** Hold an opportunity on watch. Nothing is scheduled and nothing re-checks it. */
export async function watchOpportunity(input: OpportunityDecisionInput): Promise<Opportunity> {
  return updateOpportunityStatus({ ...input, decision: "watching" });
}

/** Set an opportunity aside, with an optional reason on the record. */
export async function dismissOpportunity(input: OpportunityDecisionInput): Promise<Opportunity> {
  return updateOpportunityStatus({ ...input, decision: "dismissed" });
}

/**
 * Record that the operator acted on this opportunity.
 *
 * In this release the record is the whole act: nothing is created, sent, or
 * contacted from here. The shoot and package handoffs arrive in a later stage
 * and will call this after their own deliberate confirmation.
 */
export async function markOpportunityActed(input: OpportunityDecisionInput): Promise<Opportunity> {
  return updateOpportunityStatus({ ...input, decision: "acted" });
}
