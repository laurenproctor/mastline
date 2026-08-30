import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id, IsoTimestamp, OpportunityKind } from "../domain";
import {
  type ConfirmedShootFields,
  type HandoffOutcome,
  type SelectionReason,
  isHandoffOutcome,
  isRequestKey,
  isSelectionReason,
} from "../news-radar-handoff";
import { createClient } from "../supabase/server";
import { isRecordId } from "../validation";

/**
 * News Radar handoffs against the database.
 *
 * Two operations, each one call to one SECURITY INVOKER function that does
 * the whole handoff in one transaction; one read of what a path was handed
 * off into; and the per-photograph facts an archive selection needs that the
 * match rows do not carry (which shoot, whether a file exists).
 *
 * Every write runs as the caller. The function answers with a classified
 * outcome, never with database text; anything that is not a recognised
 * answer is reported as `failed` and logged by class only.
 */

export type HandoffAction = "package_draft" | "shoot_draft";

export interface HandoffRecord {
  readonly id: Id;
  readonly opportunityId: Id;
  readonly kind: OpportunityKind;
  readonly action: HandoffAction;
  readonly evaluatorVersion: string;
  readonly inputHash: string;
  readonly packageId?: Id;
  readonly shootId?: Id;
  /** The shoot the package sits on, so the dispatch route can be built. */
  readonly packageShootId?: Id;
  readonly createdBy: Id;
  readonly createdAt: IsoTimestamp;
  readonly details: Record<string, unknown>;
}

const HANDOFF_COLUMNS =
  "id, opportunity_id, opportunity_kind, action_type, evaluator_version, input_hash, package_id, shoot_id, created_by, created_at, details, packages(shoot_id)";

interface HandoffRow {
  id: string;
  opportunity_id: string;
  opportunity_kind: string;
  action_type: string;
  evaluator_version: string;
  input_hash: string;
  package_id: string | null;
  shoot_id: string | null;
  created_by: string;
  created_at: string;
  details: Record<string, unknown> | null;
  packages: { shoot_id: string } | { shoot_id: string }[] | null;
}

function toRecord(row: HandoffRow): HandoffRecord {
  const pkg = Array.isArray(row.packages) ? row.packages[0] : row.packages;
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    kind: row.opportunity_kind as OpportunityKind,
    action: row.action_type as HandoffAction,
    evaluatorVersion: row.evaluator_version,
    inputHash: row.input_hash,
    packageId: row.package_id ?? undefined,
    shootId: row.shoot_id ?? undefined,
    packageShootId: pkg?.shoot_id ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    details: row.details ?? {},
  };
}

/** What a path was handed off into, or null when it has not been. */
export async function getHandoff(
  organizationId: Id,
  opportunityId: Id,
  client?: SupabaseClient,
): Promise<HandoffRecord | null> {
  if (!isRecordId(opportunityId)) return null;
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("opportunity_handoffs")
    .select(HANDOFF_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("opportunity_id", opportunityId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the handoff: ${error.message}`);
  return data ? toRecord(data as unknown as HandoffRow) : null;
}

/** One handoff by the package or shoot it made, for screens that show the source. */
export async function getHandoffByResult(
  organizationId: Id,
  result: { packageId: Id } | { shootId: Id },
  client?: SupabaseClient,
): Promise<HandoffRecord | null> {
  const supabase = client ?? (await createClient());
  let query = supabase
    .from("opportunity_handoffs")
    .select(HANDOFF_COLUMNS)
    .eq("organization_id", organizationId);
  if ("packageId" in result) {
    if (!isRecordId(result.packageId)) return null;
    query = query.eq("package_id", result.packageId);
  } else {
    if (!isRecordId(result.shootId)) return null;
    query = query.eq("shoot_id", result.shootId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not read the handoff: ${error.message}`);
  return data ? toRecord(data as unknown as HandoffRow) : null;
}

// ---------------------------------------------------------------------------
// Per-photograph facts for the archive selection
// ---------------------------------------------------------------------------

export interface MatchPlacement {
  readonly assetId: Id;
  readonly shootId?: Id;
  readonly shootTitle?: string;
  readonly hasFile: boolean;
}

/**
 * Which shoot each matched photograph sits on, and whether it has a stored
 * file. Read as the caller: a photograph the caller cannot see is reported
 * as absent, which the interface shows as unreadable.
 */
export async function listMatchPlacements(
  organizationId: Id,
  assetIds: readonly Id[],
  client?: SupabaseClient,
): Promise<ReadonlyMap<Id, MatchPlacement>> {
  const placements = new Map<Id, MatchPlacement>();
  if (assetIds.length === 0) return placements;
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("assets")
    .select("id, shoot_id, shoots(title), asset_versions(id)")
    .eq("organization_id", organizationId)
    .in("id", [...assetIds]);
  if (error) throw new Error(`Could not read the photographs' shoots: ${error.message}`);
  for (const row of data ?? []) {
    const shoot = Array.isArray(row.shoots) ? row.shoots[0] : row.shoots;
    const versions = (row.asset_versions ?? []) as { id: string }[];
    placements.set(row.id as string, {
      assetId: row.id as string,
      shootId: (row.shoot_id as string | null) ?? undefined,
      shootTitle: (shoot as { title?: string } | null)?.title ?? undefined,
      hasFile: versions.length > 0,
    });
  }
  return placements;
}

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

export type HandoffResult =
  | {
      readonly outcome: "created" | "existing";
      readonly handoffId?: Id;
      readonly packageId?: Id;
      readonly shootId?: Id;
      readonly frameCount?: number;
      /** `existing` only: whether this exact request was seen before. */
      readonly sameRequest?: boolean;
    }
  | {
      readonly outcome: "stale_evaluation";
      readonly currentEvaluatorVersion?: string;
      readonly currentInputHash?: string;
    }
  | {
      readonly outcome: "invalid_selection";
      readonly reason?: SelectionReason;
      readonly assetIds: readonly Id[];
    }
  | { readonly outcome: "needs_context" | "path_closed" | "forbidden" | "not_found" | "failed" };

export interface HandoffInput {
  readonly organizationId: Id;
  readonly opportunityId: Id;
  /** The evaluation the person confirmed against. */
  readonly evaluatorVersion: string;
  readonly inputHash: string;
  readonly requestKey: string;
  readonly client?: SupabaseClient;
}

function classify(raw: unknown, action: HandoffAction): HandoffResult {
  const value = (raw ?? {}) as Record<string, unknown>;
  const outcome = value.outcome;
  if (!isHandoffOutcome(outcome)) {
    console.error(`news radar handoff (${action}): unrecognised_result`);
    return { outcome: "failed" };
  }
  switch (outcome) {
    case "created":
    case "existing":
      return {
        outcome,
        handoffId: typeof value.handoff_id === "string" ? value.handoff_id : undefined,
        packageId: typeof value.package_id === "string" ? value.package_id : undefined,
        shootId: typeof value.shoot_id === "string" ? value.shoot_id : undefined,
        frameCount: typeof value.frame_count === "number" ? value.frame_count : undefined,
        sameRequest: typeof value.same_request === "boolean" ? value.same_request : undefined,
      };
    case "stale_evaluation":
      return {
        outcome,
        currentEvaluatorVersion:
          typeof value.current_evaluator_version === "string"
            ? value.current_evaluator_version
            : undefined,
        currentInputHash:
          typeof value.current_input_hash === "string" ? value.current_input_hash : undefined,
      };
    case "invalid_selection":
      return {
        outcome,
        reason: isSelectionReason(value.reason) ? value.reason : undefined,
        assetIds: Array.isArray(value.asset_ids)
          ? value.asset_ids.filter((id): id is string => typeof id === "string")
          : [],
      };
    default:
      return { outcome };
  }
}

/**
 * One call, retried once on a transport failure.
 *
 * A gateway can drop a connection after the database has committed, or
 * before it ever saw the request. The request key makes both cases safe: the
 * function answers a repeat of a request it already served with `existing`
 * and `same_request = true`, which the caller reports as the creation it was.
 * A PostgREST error carries a code and is not retried: the database has
 * already said no.
 */
async function callOnce(
  supabase: SupabaseClient,
  fn: "handoff_archive_package" | "handoff_shoot_draft",
  args: Record<string, unknown>,
  action: HandoffAction,
  opportunityId: Id,
): Promise<HandoffResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase.rpc(fn, args);
    if (!error) {
      const result = classify(data, action);
      if (attempt > 0 && result.outcome === "existing" && result.sameRequest) {
        return { ...result, outcome: "created" };
      }
      return result;
    }
    if (error.code === "42501") return { outcome: "forbidden" };
    // No database text reaches the interface; the class is enough to act on.
    console.error(
      `news radar handoff (${action}): rpc_failed ${error.code ?? "transport"} for path ${opportunityId}${error.code ? "" : attempt === 0 ? " (retrying once)" : ""}`,
    );
    if (error.code) return { outcome: "failed" };
  }
  return { outcome: "failed" };
}

function invalidRequest(input: HandoffInput): HandoffResult | undefined {
  if (!isRecordId(input.opportunityId)) return { outcome: "not_found" };
  if (!isRequestKey(input.requestKey)) {
    return { outcome: "invalid_selection", reason: "request_key", assetIds: [] };
  }
  if (!/^[a-f0-9]{64}$/.test(input.inputHash) || !input.evaluatorVersion) {
    return { outcome: "stale_evaluation" };
  }
  return undefined;
}

/**
 * Create one draft package from selected archive matches, or return the one
 * that already exists. See handoff_archive_package in the migration for what
 * is checked and in which order.
 */
export async function handoffArchivePackage(
  input: HandoffInput & { readonly selectedAssetIds: readonly Id[] },
): Promise<HandoffResult> {
  const early = invalidRequest(input);
  if (early) return early;
  const selected = [...new Set(input.selectedAssetIds)].filter(isRecordId);
  if (selected.length === 0) return { outcome: "invalid_selection", reason: "empty", assetIds: [] };

  const supabase = input.client ?? (await createClient());
  return callOnce(
    supabase,
    "handoff_archive_package",
    {
      target_opportunity: input.opportunityId,
      evaluator: input.evaluatorVersion,
      input_digest: input.inputHash,
      selected_assets: selected,
      request_key: input.requestKey,
    },
    "package_draft",
    input.opportunityId,
  );
}

/**
 * Create one draft shoot from a confirmed brief, or return the one that
 * already exists. Only the confirmed fields travel; the notes were composed
 * by the caller from confirmed people and deliberately copied suggestions.
 */
export async function handoffShootDraft(
  input: HandoffInput & { readonly confirmed: ConfirmedShootFields; readonly notes?: string },
): Promise<HandoffResult> {
  const early = invalidRequest(input);
  if (early) return early;

  const supabase = input.client ?? (await createClient());
  const { confirmed } = input;
  return callOnce(
    supabase,
    "handoff_shoot_draft",
    {
      target_opportunity: input.opportunityId,
      evaluator: input.evaluatorVersion,
      input_digest: input.inputHash,
      confirmed: {
        title: confirmed.title,
        location_name: confirmed.locationName ?? null,
        starts_at: confirmed.startsAt ?? null,
        ends_at: confirmed.endsAt ?? null,
        timezone: confirmed.timezone ?? null,
        priority: confirmed.priority,
        people: confirmed.people,
        copied_suggestions: confirmed.copiedSuggestions,
        notes: input.notes ?? null,
      },
      request_key: input.requestKey,
    },
    "shoot_draft",
    input.opportunityId,
  );
}

export type { HandoffOutcome };
