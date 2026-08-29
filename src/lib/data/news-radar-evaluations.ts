import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetStatus, Id, IsoTimestamp, OpportunityKind } from "../domain";
import { selectByIds } from "../in-batches";
import {
  type ArchiveCandidate,
  type ArchiveEvaluation,
  type ArchiveMatchBreakdown,
  type ContextProvenance,
  EMPTY_CONTEXT,
  type EntityKind,
  EVALUATOR_VERSION,
  type EvaluationFailureCode,
  type EvaluationState,
  type RightsFact,
  type ShootBrief,
  type ShootBriefBreakdown,
  type SignalContext,
  type SignalEntity,
  type WindowState,
  archiveInputKey,
  evaluateArchive,
  evaluateShoot,
  metadataIsComplete,
  normalizeTerm,
  rightsFacts,
  shootInputKey,
} from "../news-radar-evaluation";
import type { ContextInput, ContextSuggestion } from "../news-radar-context";
import { entityKindForSuggestion } from "../news-radar-context";
import { createClient } from "../supabase/server";
import { isRecordId } from "../validation";
import { recordEventWith } from "./activity";
import { type RadarOpportunity, getOpportunity } from "./opportunities";

/**
 * News Radar evaluation: the data layer.
 *
 * Reads the canonical signal's context and the workspace's own photographs,
 * runs the pure evaluator in src/lib/news-radar-evaluation.ts, and records
 * the result through one SECURITY INVOKER function so the write is
 * all-or-nothing under the caller's own row level security.
 *
 * What this module never does: write to `assets` (not even `selected`),
 * create a package, a shoot, a submission, a buyer or a delivery, contact
 * anyone, or call anything outside this database. The archive is READ
 * through a narrow query of its own rather than through the asset module,
 * because that module is being reshaped by concurrent work and because the
 * evaluator needs a dozen columns, not versions and earnings.
 */

export type EvaluationFailure = EvaluationFailureCode | "invalid_input" | "conflict";

/** A refusal written for an operator. No database text reaches it. */
export class EvaluationError extends Error {
  readonly reason: EvaluationFailure;

  constructor(reason: EvaluationFailure, message: string) {
    super(message);
    this.name = "EvaluationError";
    this.reason = reason;
  }
}

/**
 * Update a keyed row, or insert it when it does not exist.
 *
 * Not an upsert. PostgREST writes an upsert as `insert ... on conflict do
 * update set <every payload column>`, and Postgres checks the UPDATE
 * privilege on every column in that SET list whether or not a conflict
 * happens -- so with the column-scoped update grants these tables carry
 * (identity columns are not updatable by any client) an upsert is refused
 * outright. Update first, over the fact columns only; insert the whole row
 * when nothing was there; if two writers race, the loser updates.
 *
 * Returns false when the row is neither updatable nor insertable, which
 * under row level security means the role, not the record.
 */
async function writeKeyed(
  supabase: SupabaseClient,
  table: string,
  key: Record<string, string>,
  identity: Record<string, string>,
  facts: Record<string, unknown>,
): Promise<boolean> {
  const update = async () => {
    let query = supabase.from(table).update(facts);
    for (const [column, value] of Object.entries(key)) query = query.eq(column, value);
    const { data, error } = await query.select(Object.keys(key).join(", "));
    return !error && (data?.length ?? 0) > 0;
  };
  if (await update()) return true;

  const { error } = await supabase.from(table).insert({ ...key, ...identity, ...facts });
  if (!error) return true;
  // 23505: somebody inserted it first. The update is the correct write now.
  if (error.code === "23505") return update();
  return false;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const CONTEXT_COLUMNS =
  "news_signal_id, organization_id, location_name, location_provenance, location_basis, location_confidence, event_starts_at, event_ends_at, event_time_provenance, event_time_basis, event_time_confidence, window_note, updated_by, created_at, updated_at";

const ENTITY_COLUMNS =
  "id, organization_id, news_signal_id, entity_kind, value, normalized_value, provenance, basis, confidence, created_by, created_at";

interface ContextRow {
  news_signal_id: string;
  organization_id: string;
  location_name: string | null;
  location_provenance: string;
  location_basis: string | null;
  location_confidence: number | string | null;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_time_provenance: string;
  event_time_basis: string | null;
  event_time_confidence: number | string | null;
  window_note: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface EntityRow {
  id: string;
  organization_id: string;
  news_signal_id: string;
  entity_kind: string;
  value: string;
  normalized_value: string;
  provenance: string;
  basis: string | null;
  confidence: number | string | null;
  created_by: string | null;
  created_at: string;
}

const numberOrUndefined = (value: number | string | null | undefined) =>
  value === null || value === undefined ? undefined : Number(value);

export interface StoredEntity extends SignalEntity {
  readonly id: Id;
  readonly createdBy?: Id;
  readonly createdAt: IsoTimestamp;
}

export interface StoredContext {
  readonly context: SignalContext;
  readonly entities: readonly StoredEntity[];
  /** True when a context row exists at all. */
  readonly recorded: boolean;
  readonly updatedAt?: IsoTimestamp;
  readonly updatedBy?: Id;
}

function toContext(row: ContextRow | null): SignalContext {
  if (!row) return EMPTY_CONTEXT;
  return {
    locationName: row.location_name ?? undefined,
    locationProvenance: row.location_provenance as ContextProvenance,
    locationBasis: row.location_basis ?? undefined,
    locationConfidence: numberOrUndefined(row.location_confidence),
    eventStartsAt: row.event_starts_at ?? undefined,
    eventEndsAt: row.event_ends_at ?? undefined,
    eventTimeProvenance: row.event_time_provenance as ContextProvenance,
    eventTimeBasis: row.event_time_basis ?? undefined,
    eventTimeConfidence: numberOrUndefined(row.event_time_confidence),
    windowNote: row.window_note ?? undefined,
  };
}

function toEntity(row: EntityRow): StoredEntity {
  return {
    id: row.id,
    kind: row.entity_kind as EntityKind,
    value: row.value,
    provenance: row.provenance as ContextProvenance,
    basis: row.basis ?? undefined,
    confidence: numberOrUndefined(row.confidence),
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
  };
}

/** The story's structured context, or the empty context when none was recorded. */
export async function getSignalContext(
  organizationId: Id,
  newsSignalId: Id,
  client?: SupabaseClient,
): Promise<StoredContext> {
  const supabase = client ?? (await createClient());
  const [contextResult, entityResult] = await Promise.all([
    supabase
      .from("news_signal_context")
      .select(CONTEXT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("news_signal_id", newsSignalId)
      .maybeSingle(),
    supabase
      .from("news_signal_entities")
      .select(ENTITY_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("news_signal_id", newsSignalId)
      .order("entity_kind")
      .order("normalized_value"),
  ]);

  if (contextResult.error) {
    throw new EvaluationError("context_read_failed", "The story's context could not be read.");
  }
  if (entityResult.error) {
    throw new EvaluationError("context_read_failed", "The story's context could not be read.");
  }

  const row = (contextResult.data as unknown as ContextRow | null) ?? null;
  return {
    context: toContext(row),
    entities: ((entityResult.data ?? []) as unknown as EntityRow[]).map(toEntity),
    recorded: row !== null,
    updatedAt: row?.updated_at,
    updatedBy: row?.updated_by ?? undefined,
  };
}

export interface SaveContextInput {
  readonly organizationId: Id;
  readonly actorId: Id;
  readonly newsSignalId: Id;
  readonly input: ContextInput;
  readonly client?: SupabaseClient;
}

const LIST_KINDS: readonly { readonly kind: EntityKind; readonly field: keyof ContextInput }[] = [
  { kind: "person", field: "people" },
  { kind: "organization", field: "organizations" },
  { kind: "topic", field: "topics" },
  { kind: "keyword", field: "keywords" },
];

/**
 * Record what a person typed.
 *
 * The typed columns are upserted with authorship pinned to the caller (the
 * insert and update policies both require it). Entities are reconciled
 * against what is stored: an entry that is already recorded keeps its row
 * and its provenance -- an accepted suggestion stays an accepted suggestion
 * -- a new entry is inserted as manual, and an entry the person removed is
 * deleted. Location and event time typed here are manual; the system
 * provenance is only ever set by acceptSuggestion.
 */
export async function saveSignalContext(input: SaveContextInput): Promise<StoredContext> {
  const { organizationId, actorId, newsSignalId } = input;
  const supabase = input.client ?? (await createClient());
  if (!isRecordId(newsSignalId)) {
    throw new EvaluationError("not_found", "That story is not in this workspace.");
  }

  const current = await getSignalContext(organizationId, newsSignalId, supabase);
  const typed = input.input;

  // Provenance: a location or event time that is unchanged keeps what it
  // had; anything typed differently is the person's own.
  const locationUnchanged =
    (current.context.locationName ?? undefined) === (typed.locationName ?? undefined);
  const eventUnchanged =
    (current.context.eventStartsAt ?? undefined) === (typed.eventStartsAt ?? undefined) &&
    (current.context.eventEndsAt ?? undefined) === (typed.eventEndsAt ?? undefined);

  const facts = {
    location_name: typed.locationName ?? null,
    location_provenance: locationUnchanged ? current.context.locationProvenance : "manual",
    location_basis: locationUnchanged ? (current.context.locationBasis ?? null) : null,
    location_confidence: locationUnchanged ? (current.context.locationConfidence ?? null) : null,
    event_starts_at: typed.eventStartsAt ?? null,
    event_ends_at: typed.eventEndsAt ?? null,
    event_time_provenance: eventUnchanged ? current.context.eventTimeProvenance : "manual",
    event_time_basis: eventUnchanged ? (current.context.eventTimeBasis ?? null) : null,
    event_time_confidence: eventUnchanged ? (current.context.eventTimeConfidence ?? null) : null,
    window_note: typed.windowNote ?? null,
    updated_by: actorId,
  };

  const saved = await writeKeyed(
    supabase,
    "news_signal_context",
    { news_signal_id: newsSignalId },
    { organization_id: organizationId },
    facts,
  );
  if (!saved) {
    throw new EvaluationError("denied", "Your role may not edit a story's context.");
  }

  // Reconcile the entities.
  const wanted = new Map<string, { kind: EntityKind; value: string }>();
  for (const { kind, field } of LIST_KINDS) {
    for (const value of typed[field] as readonly string[]) {
      wanted.set(`${kind}:${normalizeTerm(value)}`, { kind, value });
    }
  }
  const have = new Map(current.entities.map((e) => [`${e.kind}:${normalizeTerm(e.value)}`, e]));

  const removals = current.entities.filter(
    (entity) => !wanted.has(`${entity.kind}:${normalizeTerm(entity.value)}`),
  );
  const additions = [...wanted.entries()]
    .filter(([key]) => !have.has(key))
    .map(([, entry]) => entry);

  if (removals.length > 0) {
    const { error: removeError } = await supabase
      .from("news_signal_entities")
      .delete()
      .eq("organization_id", organizationId)
      .in(
        "id",
        removals.map((entity) => entity.id),
      );
    if (removeError) {
      throw new EvaluationError("denied", "Your role may not edit a story's context.");
    }
  }
  if (additions.length > 0) {
    const { error: addError } = await supabase.from("news_signal_entities").insert(
      additions.map((entry) => ({
        organization_id: organizationId,
        news_signal_id: newsSignalId,
        entity_kind: entry.kind,
        value: entry.value,
        provenance: "manual",
        created_by: actorId,
      })),
    );
    if (addError) {
      throw new EvaluationError("denied", "Your role may not edit a story's context.");
    }
  }

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "news_signal",
    entityId: newsSignalId,
    action: "news_signal.context_edited",
    data: {
      summary: `Story context edited (${additions.length} added, ${removals.length} removed)`,
      added: additions.length,
      removed: removals.length,
      locationRecorded: Boolean(typed.locationName),
      eventTimeRecorded: Boolean(typed.eventStartsAt),
    },
  });

  return getSignalContext(organizationId, newsSignalId, supabase);
}

export interface AcceptSuggestionInput {
  readonly organizationId: Id;
  readonly actorId: Id;
  readonly newsSignalId: Id;
  readonly suggestion: ContextSuggestion;
  readonly client?: SupabaseClient;
}

/**
 * A person accepts a suggestion: it becomes a recorded fact with provenance
 * `system`, carrying the basis and confidence that were on screen. Accepting
 * the same suggestion twice is answered with the record as it stands.
 */
export async function acceptSuggestion(input: AcceptSuggestionInput): Promise<StoredContext> {
  const { organizationId, actorId, newsSignalId, suggestion } = input;
  const supabase = input.client ?? (await createClient());
  if (!isRecordId(newsSignalId)) {
    throw new EvaluationError("not_found", "That story is not in this workspace.");
  }

  const kind = entityKindForSuggestion(suggestion.kind);
  if (kind) {
    const { error } = await supabase.from("news_signal_entities").insert({
      organization_id: organizationId,
      news_signal_id: newsSignalId,
      entity_kind: kind,
      value: suggestion.value,
      provenance: "system",
      basis: suggestion.basis,
      confidence: suggestion.confidence,
      created_by: actorId,
    });
    // 23505 is the unique constraint: already recorded, nothing to add.
    if (error && error.code !== "23505") {
      throw new EvaluationError("denied", "Your role may not edit a story's context.");
    }
    if (error) return getSignalContext(organizationId, newsSignalId, supabase);
  } else {
    const current = await getSignalContext(organizationId, newsSignalId, supabase);
    if (
      current.context.locationName &&
      normalizeTerm(current.context.locationName) === normalizeTerm(suggestion.value)
    ) {
      return current;
    }
    const saved = await writeKeyed(
      supabase,
      "news_signal_context",
      { news_signal_id: newsSignalId },
      { organization_id: organizationId },
      {
        location_name: suggestion.value,
        location_provenance: "system",
        location_basis: suggestion.basis,
        location_confidence: suggestion.confidence,
        updated_by: actorId,
      },
    );
    if (!saved) {
      throw new EvaluationError("denied", "Your role may not edit a story's context.");
    }
  }

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "news_signal",
    entityId: newsSignalId,
    action: "news_signal.suggestion_accepted",
    data: {
      summary: `Suggested ${suggestion.kind} accepted: ${suggestion.value}`,
      kind: suggestion.kind,
      basis: suggestion.basis,
      confidence: suggestion.confidence,
    },
  });

  return getSignalContext(organizationId, newsSignalId, supabase);
}

// ---------------------------------------------------------------------------
// Evaluation state
// ---------------------------------------------------------------------------

const EVALUATION_COLUMNS =
  "opportunity_id, organization_id, opportunity_kind, state, evaluator_version, input_hash, evaluated_at, failure_code, score, explanation, result_state, result_evaluator_version, result_input_hash, result_at, created_at, updated_at";

interface EvaluationRow {
  opportunity_id: string;
  organization_id: string;
  opportunity_kind: string;
  state: string;
  evaluator_version: string | null;
  input_hash: string | null;
  evaluated_at: string | null;
  failure_code: string | null;
  score: number | null;
  explanation: string | null;
  result_state: string | null;
  result_evaluator_version: string | null;
  result_input_hash: string | null;
  result_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvaluationRecord {
  readonly opportunityId: Id;
  readonly kind: OpportunityKind;
  readonly state: EvaluationState;
  readonly evaluatorVersion?: string;
  readonly inputHash?: string;
  readonly evaluatedAt?: IsoTimestamp;
  readonly failureCode?: EvaluationFailureCode;
  readonly score?: number;
  readonly explanation?: string;
  readonly resultState?: "ready" | "needs_context";
  readonly resultEvaluatorVersion?: string;
  readonly resultInputHash?: string;
  readonly resultAt?: IsoTimestamp;
  /** A failed rerun with an earlier result still on the record. */
  readonly retainedPreviousResult: boolean;
  /** The result on the record came from a different evaluator version. */
  readonly resultFromOlderEvaluator: boolean;
}

function toEvaluation(row: EvaluationRow): EvaluationRecord {
  const resultAt = row.result_at ?? undefined;
  return {
    opportunityId: row.opportunity_id,
    kind: row.opportunity_kind as OpportunityKind,
    state: row.state as EvaluationState,
    evaluatorVersion: row.evaluator_version ?? undefined,
    inputHash: row.input_hash ?? undefined,
    evaluatedAt: row.evaluated_at ?? undefined,
    failureCode: (row.failure_code as EvaluationFailureCode | null) ?? undefined,
    score: row.score ?? undefined,
    explanation: row.explanation ?? undefined,
    resultState: (row.result_state as "ready" | "needs_context" | null) ?? undefined,
    resultEvaluatorVersion: row.result_evaluator_version ?? undefined,
    resultInputHash: row.result_input_hash ?? undefined,
    resultAt,
    retainedPreviousResult: row.state === "failed" && resultAt !== undefined,
    resultFromOlderEvaluator:
      resultAt !== undefined && row.result_evaluator_version !== EVALUATOR_VERSION,
  };
}

/** The not-yet-evaluated record, so screens always have something to read. */
export function unevaluated(opportunity: {
  readonly id: Id;
  readonly kind: OpportunityKind;
}): EvaluationRecord {
  return {
    opportunityId: opportunity.id,
    kind: opportunity.kind,
    state: "not_evaluated",
    retainedPreviousResult: false,
    resultFromOlderEvaluator: false,
  };
}

export async function getEvaluation(
  organizationId: Id,
  opportunityId: Id,
  client?: SupabaseClient,
): Promise<EvaluationRecord | null> {
  if (!isRecordId(opportunityId)) return null;
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("opportunity_evaluations")
    .select(EVALUATION_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("opportunity_id", opportunityId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the evaluation: ${error.message}`);
  return data ? toEvaluation(data as unknown as EvaluationRow) : null;
}

// ---------------------------------------------------------------------------
// The archive, read narrowly
// ---------------------------------------------------------------------------

const CANDIDATE_COLUMNS =
  "id, status, canonical_filename, headline, caption, subjects, keywords, location_name, captured_at, copyright_notice, credit_line, usage_restrictions";

interface CandidateRow {
  id: string;
  status: string;
  canonical_filename: string;
  headline: string | null;
  caption: string | null;
  subjects: unknown;
  keywords: unknown;
  location_name: string | null;
  captured_at: string | null;
  copyright_notice: string | null;
  credit_line: string | null;
  usage_restrictions: string | null;
}

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

function toCandidate(row: CandidateRow): ArchiveCandidate {
  return {
    assetId: row.id,
    status: row.status as AssetStatus,
    canonicalFilename: row.canonical_filename,
    headline: row.headline ?? undefined,
    caption: row.caption ?? undefined,
    subjects: list(row.subjects),
    keywords: list(row.keywords),
    locationName: row.location_name ?? undefined,
    capturedAt: row.captured_at ?? undefined,
    copyrightNotice: row.copyright_notice ?? undefined,
    creditLine: row.credit_line ?? undefined,
    usageRestrictions: row.usage_restrictions ?? undefined,
  };
}

/**
 * Every photograph the workspace owns that could be matched, read once.
 *
 * Tombstoned records are left out in SQL: they can never match and a large
 * archive should not carry them across the wire. Every other status is
 * returned and the evaluator decides (ingesting is excluded there, restricted
 * is flagged). Read-only; ordered by id so the input is stable.
 */
async function listCandidates(
  organizationId: Id,
  supabase: SupabaseClient,
): Promise<readonly ArchiveCandidate[]> {
  const { data, error } = await supabase
    .from("assets")
    .select(CANDIDATE_COLUMNS)
    .eq("organization_id", organizationId)
    .neq("status", "tombstoned")
    .order("id");
  if (error) {
    throw new EvaluationError("archive_read_failed", "The archive could not be read.");
  }
  return ((data ?? []) as unknown as CandidateRow[]).map(toCandidate);
}

async function workspacePreferences(
  organizationId: Id,
  supabase: SupabaseClient,
): Promise<{ baseCity?: string; specialties: readonly string[]; timeZone: string }> {
  const { data, error } = await supabase
    .from("organizations")
    .select("base_city, specialties, timezone")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) {
    throw new EvaluationError("context_read_failed", "The workspace profile could not be read.");
  }
  return {
    baseCity: (data.base_city as string | null) ?? undefined,
    specialties: list(data.specialties),
    timeZone: (data.timezone as string | null) ?? "UTC",
  };
}

// ---------------------------------------------------------------------------
// Running the evaluator
// ---------------------------------------------------------------------------

export function hashInputKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface EvaluateInput {
  readonly organizationId: Id;
  readonly actorId: Id;
  readonly opportunityId: Id;
  readonly client?: SupabaseClient;
  /** The clock, for tests. */
  readonly now?: Date;
}

export interface EvaluateResult {
  /** recorded: a new result was written. unchanged: same evaluator, same input, nothing written. */
  readonly outcome: "recorded" | "unchanged" | "failed";
  readonly state: EvaluationState;
  readonly failureCode?: EvaluationFailureCode;
  readonly evaluation: EvaluationRecord;
}

type Prepared =
  | {
      readonly kind: "archive_match";
      readonly hash: string;
      readonly run: () => ArchiveEvaluation;
    }
  | {
      readonly kind: "shoot_opportunity";
      readonly hash: string;
      readonly run: () => ShootBrief;
    };

async function prepare(
  opportunity: RadarOpportunity,
  organizationId: Id,
  supabase: SupabaseClient,
  now: Date,
): Promise<Prepared> {
  const stored = await getSignalContext(organizationId, opportunity.newsSignalId, supabase);
  const story = {
    title: opportunity.story.title,
    summary: opportunity.story.summary,
    sourceName: opportunity.story.sourceName,
    sourceUrl: opportunity.story.sourceUrl,
    sourcePublishedAt: opportunity.story.sourcePublishedAt,
  };
  const entities: SignalEntity[] = stored.entities.map((e) => ({
    kind: e.kind,
    value: e.value,
    provenance: e.provenance,
    basis: e.basis,
    confidence: e.confidence,
  }));

  if (opportunity.kind === "archive_match") {
    const candidates = await listCandidates(organizationId, supabase);
    const input = { story, context: stored.context, entities, candidates };
    return {
      kind: "archive_match",
      hash: hashInputKey(archiveInputKey(input)),
      run: () => evaluateArchive(input),
    };
  }

  const workspace = await workspacePreferences(organizationId, supabase);
  const input = {
    story,
    context: stored.context,
    entities,
    windowClosesAt: opportunity.windowClosesAt,
    workspace,
  };
  return {
    kind: "shoot_opportunity",
    hash: hashInputKey(shootInputKey(input)),
    run: () => evaluateShoot({ ...input, now }),
  };
}

async function markFailed(
  supabase: SupabaseClient,
  opportunity: RadarOpportunity,
  organizationId: Id,
  hash: string,
  failureCode: EvaluationFailureCode,
  at: Date,
): Promise<void> {
  // Best effort: the failure being recorded must not hide the failure.
  await writeKeyed(
    supabase,
    "opportunity_evaluations",
    { opportunity_id: opportunity.id },
    { organization_id: organizationId, opportunity_kind: opportunity.kind },
    {
      state: "failed",
      evaluator_version: EVALUATOR_VERSION,
      input_hash: hash,
      evaluated_at: at.toISOString(),
      failure_code: failureCode,
    },
  );
}

/**
 * Evaluate one path, now.
 *
 * Deterministic and idempotent: the inputs are reduced to a hash, and when
 * the same evaluator has already produced a result over the same hash,
 * nothing is written and nothing is logged. Otherwise the path is marked
 * `evaluating`, the pure evaluator runs, and the result is recorded in one
 * transaction. A failure at any point leaves the previous result rows in
 * place and marks the run failed with a classified code.
 */
export async function evaluateOpportunity(input: EvaluateInput): Promise<EvaluateResult> {
  const { organizationId, actorId, opportunityId } = input;
  const supabase = input.client ?? (await createClient());
  const now = input.now ?? new Date();

  const opportunity = await getOpportunity(organizationId, opportunityId, supabase);
  if (!opportunity) {
    throw new EvaluationError("not_found", "That opportunity is not in this workspace.");
  }

  const prepared = await prepare(opportunity, organizationId, supabase, now);
  const existing = await getEvaluation(organizationId, opportunityId, supabase);

  if (
    existing &&
    (existing.state === "ready" || existing.state === "needs_context") &&
    existing.resultEvaluatorVersion === EVALUATOR_VERSION &&
    existing.resultInputHash === prepared.hash
  ) {
    return { outcome: "unchanged", state: existing.state, evaluation: existing };
  }

  // Mark the run. Row level security answers a forbidden write with an
  // error or with no rows; both mean the role, not the record.
  const marked = await writeKeyed(
    supabase,
    "opportunity_evaluations",
    { opportunity_id: opportunity.id },
    { organization_id: organizationId, opportunity_kind: opportunity.kind },
    {
      state: "evaluating",
      evaluator_version: EVALUATOR_VERSION,
      input_hash: prepared.hash,
      evaluated_at: now.toISOString(),
      failure_code: null,
    },
  );
  if (!marked) {
    throw new EvaluationError("denied", "Your role may not run the evaluator.");
  }

  let outcome: "ready" | "needs_context";
  let payload: Record<string, unknown>;
  try {
    if (prepared.kind === "archive_match") {
      const result = prepared.run();
      outcome = result.outcome;
      payload = {
        score: result.score,
        explanation: result.explanation,
        matches: result.matches.map((match) => ({
          asset_id: match.assetId,
          score: match.score,
          rank: match.rank,
          reasons: match.reasons,
          breakdown: match.breakdown,
        })),
      };
    } else {
      const brief = prepared.run();
      outcome = brief.readiness;
      payload = {
        score: brief.readinessScore,
        explanation: brief.explanation,
        brief: {
          readiness_score: brief.readinessScore,
          why_now: brief.whyNow,
          known_people: brief.knownPeople,
          known_organizations: brief.knownOrganizations,
          known_location: brief.knownLocation ?? null,
          event_starts_at: brief.eventStartsAt ?? null,
          event_ends_at: brief.eventEndsAt ?? null,
          window_state: brief.windowState,
          window_closes_at: brief.windowClosesAt ?? null,
          geographic_relevance: brief.geographicRelevance,
          specialty_relevance: brief.specialtyRelevance ?? null,
          suggested_angle: brief.suggestedAngle ?? null,
          suggested_shots: brief.suggestedShots,
          missing_confirmations: brief.missingConfirmations,
          breakdown: brief.breakdown,
        },
      };
    }
  } catch {
    await markFailed(supabase, opportunity, organizationId, prepared.hash, "evaluator_error", now);
    const evaluation =
      (await getEvaluation(organizationId, opportunityId, supabase)) ?? unevaluated(opportunity);
    return { outcome: "failed", state: "failed", failureCode: "evaluator_error", evaluation };
  }

  const { data, error } = await supabase.rpc("record_opportunity_evaluation", {
    target_opportunity: opportunity.id,
    evaluator: EVALUATOR_VERSION,
    input_digest: prepared.hash,
    outcome,
    result: payload,
  });

  if (error) {
    await markFailed(supabase, opportunity, organizationId, prepared.hash, "write_failed", now);
    const evaluation =
      (await getEvaluation(organizationId, opportunityId, supabase)) ?? unevaluated(opportunity);
    return { outcome: "failed", state: "failed", failureCode: "write_failed", evaluation };
  }

  const answer = (data ?? {}) as { outcome?: string; failure_code?: string; written?: number };
  const evaluation =
    (await getEvaluation(organizationId, opportunityId, supabase)) ?? unevaluated(opportunity);

  if (answer.outcome === "recorded") {
    await recordEventWith(supabase, {
      organizationId,
      actorId,
      entityType: "opportunity",
      entityId: opportunity.id,
      action: "opportunity.evaluated",
      data: {
        summary:
          opportunity.kind === "archive_match"
            ? `Archive evaluated: ${answer.written ?? 0} ${answer.written === 1 ? "match" : "matches"} (${outcome.replace("_", " ")})`
            : `Shoot brief evaluated (${outcome.replace("_", " ")})`,
        kind: opportunity.kind,
        state: outcome,
        evaluatorVersion: EVALUATOR_VERSION,
        written: answer.written ?? 0,
      },
    });
    return { outcome: "recorded", state: outcome, evaluation };
  }

  if (answer.outcome === "unchanged") {
    return { outcome: "unchanged", state: evaluation.state, evaluation };
  }

  const failureCode = (
    answer.outcome === "failed" && answer.failure_code ? answer.failure_code : "write_failed"
  ) as EvaluationFailureCode;
  if (answer.outcome !== "failed") {
    // not_found or invalid_result came back without a row being marked.
    await markFailed(supabase, opportunity, organizationId, prepared.hash, failureCode, now);
  }
  return {
    outcome: "failed",
    state: "failed",
    failureCode,
    evaluation:
      (await getEvaluation(organizationId, opportunityId, supabase)) ?? unevaluated(opportunity),
  };
}

// ---------------------------------------------------------------------------
// Reading results
// ---------------------------------------------------------------------------

const MATCH_COLUMNS =
  "id, organization_id, opportunity_id, asset_id, score, rank, reasons, score_breakdown, evaluator_version, evaluated_at";

interface MatchRow {
  id: string;
  organization_id: string;
  opportunity_id: string;
  asset_id: string;
  score: number;
  rank: number;
  reasons: unknown;
  score_breakdown: Record<string, unknown> | null;
  evaluator_version: string;
  evaluated_at: string;
}

/** A match beside the photograph as it stands NOW, with its readiness stated precisely. */
export interface ArchiveMatchView {
  readonly assetId: Id;
  readonly score: number;
  readonly rank: number;
  readonly reasons: readonly string[];
  readonly breakdown: ArchiveMatchBreakdown;
  readonly evaluatorVersion: string;
  readonly evaluatedAt: IsoTimestamp;
  readonly asset?: {
    readonly status: AssetStatus;
    readonly canonicalFilename: string;
    readonly headline?: string;
    readonly caption?: string;
    readonly subjects: readonly string[];
    readonly capturedAt?: IsoTimestamp;
    readonly locationName?: string;
    readonly rights: readonly RightsFact[];
    readonly metadataComplete: boolean;
    readonly restricted: boolean;
  };
  /** A short-lived signed URL to a private derivative, when one exists and could be signed. */
  readonly previewUrl?: string;
}

const PREVIEW_TTL_SECONDS = 300;
const PREVIEW_ORDER: Record<string, number> = { thumbnail: 0, preview: 1, delivery: 2, edit: 3 };

function breakdownFrom(value: Record<string, unknown> | null): ArchiveMatchBreakdown {
  const n = (key: string) => Number(value?.[key] ?? 0);
  return {
    people: n("people"),
    organizations: n("organizations"),
    keywords: n("keywords"),
    location: n("location"),
    terms: n("terms"),
    time: n("time"),
    metadata: n("metadata"),
    rights: n("rights"),
  };
}

/**
 * Short-lived signed URLs for private derivatives, minted for the caller.
 *
 * The storage policies decide what the caller may sign: a key in another
 * workspace's prefix is refused there, so a URL is never produced for a
 * photograph the caller could not otherwise see. A missing object, a refusal,
 * and a transport failure all answer the same way -- no URL -- and the
 * interface says "preview unavailable".
 */
async function signPreviews(
  supabase: SupabaseClient,
  objectKeys: readonly string[],
): Promise<Map<string, string>> {
  if (objectKeys.length === 0) return new Map();
  const { data, error } = await supabase.storage
    .from("derivatives")
    .createSignedUrls([...objectKeys], PREVIEW_TTL_SECONDS);
  const urls = new Map<string, string>();
  if (error) return urls;
  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path && !entry.error) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}

export async function listArchiveMatches(
  organizationId: Id,
  opportunityId: Id,
  client?: SupabaseClient,
): Promise<readonly ArchiveMatchView[]> {
  if (!isRecordId(opportunityId)) return [];
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase
    .from("opportunity_asset_matches")
    .select(MATCH_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("opportunity_id", opportunityId)
    .order("rank");
  if (error) throw new Error(`Could not load the archive matches: ${error.message}`);

  const rows = (data ?? []) as unknown as MatchRow[];
  if (rows.length === 0) return [];
  const assetIds = rows.map((row) => row.asset_id);

  const [assetRows, versionRows] = await Promise.all([
    selectByIds<CandidateRow>(assetIds, "matched photographs", (batch) =>
      supabase
        .from("assets")
        .select(CANDIDATE_COLUMNS)
        .eq("organization_id", organizationId)
        .in("id", batch),
    ),
    selectByIds<{ asset_id: string; version_kind: string; object_key: string; mime_type: string }>(
      assetIds,
      "preview versions",
      (batch) =>
        supabase
          .from("asset_versions")
          .select("asset_id, version_kind, object_key, mime_type")
          .eq("organization_id", organizationId)
          .eq("storage_bucket", "derivatives")
          .in("asset_id", batch),
    ),
  ]);

  const assets = new Map(assetRows.map((row) => [row.id, toCandidate(row)]));

  // The best renderable derivative per asset: thumbnail, then preview, then
  // the delivery file. Only image derivatives; a clip's poster is a later job.
  const previewKey = new Map<string, { order: number; objectKey: string }>();
  for (const version of versionRows) {
    if (!version.mime_type.startsWith("image/")) continue;
    const order = PREVIEW_ORDER[version.version_kind];
    if (order === undefined) continue;
    const current = previewKey.get(version.asset_id);
    if (!current || order < current.order) {
      previewKey.set(version.asset_id, { order, objectKey: version.object_key });
    }
  }
  const signed = await signPreviews(
    supabase,
    [...previewKey.values()].map((entry) => entry.objectKey),
  );

  return rows.map((row) => {
    const asset = assets.get(row.asset_id);
    const key = previewKey.get(row.asset_id)?.objectKey;
    return {
      assetId: row.asset_id,
      score: row.score,
      rank: row.rank,
      reasons: list(row.reasons),
      breakdown: breakdownFrom(row.score_breakdown),
      evaluatorVersion: row.evaluator_version,
      evaluatedAt: row.evaluated_at,
      asset: asset
        ? {
            status: asset.status,
            canonicalFilename: asset.canonicalFilename,
            headline: asset.headline,
            caption: asset.caption,
            subjects: asset.subjects,
            capturedAt: asset.capturedAt,
            locationName: asset.locationName,
            rights: rightsFacts(asset),
            metadataComplete: metadataIsComplete(asset),
            restricted: asset.status === "restricted",
          }
        : undefined,
      previewUrl: key ? signed.get(key) : undefined,
    };
  });
}

const BRIEF_COLUMNS =
  "opportunity_id, organization_id, readiness, readiness_score, why_now, known_people, known_organizations, known_location, event_starts_at, event_ends_at, window_state, window_closes_at, geographic_relevance, specialty_relevance, suggested_angle, suggested_shots, missing_confirmations, score_breakdown, evaluator_version, evaluated_at";

interface BriefRow {
  opportunity_id: string;
  readiness: string;
  readiness_score: number;
  why_now: unknown;
  known_people: unknown;
  known_organizations: unknown;
  known_location: string | null;
  event_starts_at: string | null;
  event_ends_at: string | null;
  window_state: string;
  window_closes_at: string | null;
  geographic_relevance: string;
  specialty_relevance: string | null;
  suggested_angle: string | null;
  suggested_shots: unknown;
  missing_confirmations: unknown;
  score_breakdown: Record<string, unknown> | null;
  evaluator_version: string;
  evaluated_at: string;
}

export interface ShootBriefView extends Omit<ShootBrief, "explanation"> {
  readonly evaluatorVersion: string;
  readonly evaluatedAt: IsoTimestamp;
}

export async function getShootBrief(
  organizationId: Id,
  opportunityId: Id,
  client?: SupabaseClient,
): Promise<ShootBriefView | null> {
  if (!isRecordId(opportunityId)) return null;
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("opportunity_shoot_briefs")
    .select(BRIEF_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("opportunity_id", opportunityId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the shoot brief: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as BriefRow;
  const n = (key: string) => Number(row.score_breakdown?.[key] ?? 0);
  const breakdown: ShootBriefBreakdown = {
    eventTime: n("eventTime"),
    upcoming: n("upcoming"),
    location: n("location"),
    people: n("people"),
    source: n("source"),
    summary: n("summary"),
    baseCity: n("baseCity"),
    specialty: n("specialty"),
  };
  return {
    readiness: row.readiness as "ready" | "needs_context",
    readinessScore: row.readiness_score,
    whyNow: list(row.why_now),
    knownPeople: list(row.known_people),
    knownOrganizations: list(row.known_organizations),
    knownLocation: row.known_location ?? undefined,
    eventStartsAt: row.event_starts_at ?? undefined,
    eventEndsAt: row.event_ends_at ?? undefined,
    windowState: row.window_state as WindowState,
    windowClosesAt: row.window_closes_at ?? undefined,
    geographicRelevance: row.geographic_relevance,
    specialtyRelevance: row.specialty_relevance ?? undefined,
    suggestedAngle: row.suggested_angle ?? undefined,
    suggestedShots: list(row.suggested_shots),
    missingConfirmations: list(row.missing_confirmations),
    breakdown,
    evaluatorVersion: row.evaluator_version,
    evaluatedAt: row.evaluated_at,
  };
}
