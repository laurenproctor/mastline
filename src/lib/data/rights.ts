import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id, LicenseCheck, RightsMatch, RightsMatchStatus } from "../domain";
import { createClient } from "../supabase/server";
import { isRecordId } from "../validation";
import { recordEventWith } from "./activity";

/**
 * Observed uses of an asset, and the human triage decisions recorded against
 * them.
 *
 * Four things are deliberately kept apart in this file, because collapsing any
 * two of them is how a product like this starts making claims it cannot
 * support:
 *
 *   1. A machine-generated match -- confidence, match method, observation
 *      times. Written by whatever observed the use; never edited here.
 *   2. A search of Mastline's own license records -- `license_check`. A fact
 *      about our records. "No linked license found" is not infringement.
 *   3. A human reviewer's decision -- `status`, `decision_note`, and who
 *      decided when. That is all this module writes.
 *   4. A legal conclusion or an external enforcement action. Not in this
 *      product yet. Nothing here sends a demand, a takedown, or a message to a
 *      publisher, and `escalated` is deliberately unreachable from the
 *      application (see TRIAGE_STATUSES).
 */

const MATCH_COLUMNS =
  "id, organization_id, asset_id, status, source_url, publisher_name, publisher_domain, page_title, first_observed_at, last_observed_at, match_method, confidence, license_check, evidence_object_key, decision_note, reviewed_by, reviewed_at, updated_at";

/**
 * A match with the review fields the triage screen needs.
 *
 * `RightsMatch` in domain.ts describes the observation. The three fields added
 * here belong to the human decision and to concurrency control, and they are
 * declared alongside the code that uses them rather than widening the shared
 * type for one screen.
 *
 * `updatedAt` is the raw database string, not a re-serialised Date. Postgres
 * stores microseconds and `Date` keeps milliseconds, so round-tripping it
 * through JavaScript would round the value and every optimistic-concurrency
 * check would then fail against the row it came from.
 */
export interface RightsMatchDetail extends RightsMatch {
  readonly reviewedBy?: Id;
  readonly reviewedAt?: string;
  readonly updatedAt: string;
}

interface MatchRow {
  id: string;
  organization_id: string;
  asset_id: string;
  status: string;
  source_url: string;
  publisher_name: string | null;
  page_title: string | null;
  first_observed_at: string;
  last_observed_at: string;
  match_method: string | null;
  confidence: number | string | null;
  license_check: string;
  evidence_object_key: string | null;
  decision_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  updated_at: string;
}

function toMatch(row: MatchRow): RightsMatchDetail {
  return {
    id: row.id,
    organizationId: row.organization_id,
    assetId: row.asset_id,
    status: row.status as RightsMatchStatus,
    sourceUrl: row.source_url,
    publisherName: row.publisher_name ?? "Unknown publisher",
    pageTitle: row.page_title ?? undefined,
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    matchMethod: row.match_method ?? "Unrecorded method",
    confidence: Number(row.confidence ?? 0),
    licenseCheck: row.license_check as LicenseCheck,
    hasEvidence: Boolean(row.evidence_object_key),
    decisionNote: row.decision_note ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

export async function listRightsMatches(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<readonly RightsMatchDetail[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("rights_matches")
    .select(MATCH_COLUMNS)
    .eq("organization_id", organizationId)
    .order("last_observed_at", { ascending: false });

  if (error) throw new Error(`Could not load rights matches: ${error.message}`);

  return (data ?? []).map((row) => toMatch(row as unknown as MatchRow));
}

/**
 * One match, scoped to the workspace that asked for it.
 *
 * The organization filter is applied in SQL as well as by row level security,
 * and a malformed id is answered as "no such record" rather than as a database
 * error -- the caller must not be able to tell a bad id from an id belonging to
 * somebody else's workspace.
 */
export async function getRightsMatch(
  organizationId: Id,
  matchId: Id,
  client?: SupabaseClient,
): Promise<RightsMatchDetail | null> {
  if (!isRecordId(matchId)) return null;

  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("rights_matches")
    .select(MATCH_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", matchId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the rights match: ${error.message}`);
  return data ? toMatch(data as unknown as MatchRow) : null;
}

/**
 * The statuses a human reviewer may choose in this sprint.
 *
 * `new` is the machine's starting state and is not a decision anyone makes.
 * `escalated` exists in the enum for a later approved workflow -- sending a
 * demand or a takedown -- and is deliberately absent here, so no form, action,
 * or call site in the application can reach it.
 */
export const TRIAGE_STATUSES = ["reviewing", "monitoring", "ignored", "licensed", "resolved"] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

export function isTriageStatus(value: string): value is TriageStatus {
  return (TRIAGE_STATUSES as readonly string[]).includes(value);
}

/**
 * Which decisions may follow which.
 *
 * Reopening policy: completed decisions are forward-only. `licensed`,
 * `ignored`, and `resolved` have no outgoing transitions, so a recorded
 * decision cannot be quietly replaced by a different one -- the history stays a
 * history. Nothing in the product rules requires reopening, and the honest way
 * to revisit a closed match once the workflow exists is a new observation or an
 * explicit, separately audited reopen action, not an in-place overwrite.
 *
 * `licensed` is additionally gated on the license check having actually found a
 * linked license; see requiresLinkedLicense below.
 */
const ALLOWED_TRANSITIONS: Record<RightsMatchStatus, readonly TriageStatus[]> = {
  new: ["reviewing", "monitoring", "ignored", "licensed"],
  reviewing: ["monitoring", "ignored", "licensed", "resolved"],
  monitoring: ["reviewing", "ignored", "licensed", "resolved"],
  licensed: [],
  ignored: [],
  resolved: [],
  // Reachable only by a future approved workflow. Triage does not unwind it.
  escalated: [],
};

export function allowedTransitions(from: RightsMatchStatus): readonly TriageStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

/** Only a match whose license check found a linked license may be called licensed. */
export function requiresLinkedLicense(status: TriageStatus): boolean {
  return status === "licensed";
}

/** Decisions that close a match, and therefore need a reviewer to say why. */
const NOTE_REQUIRED: readonly TriageStatus[] = ["ignored", "licensed", "resolved"];

export const DECISION_NOTE_MIN = 10;
export const DECISION_NOTE_MAX = 1000;

export function noteIsRequired(status: TriageStatus): boolean {
  return NOTE_REQUIRED.includes(status);
}

export type RightsReviewFailure =
  | "invalid_status"
  | "invalid_transition"
  | "license_required"
  | "note_required"
  | "note_too_short"
  | "note_too_long"
  | "not_found"
  | "denied"
  | "conflict";

/**
 * A refusal with a reason the interface can act on.
 *
 * The message is written for a reviewer to read. No database text reaches it:
 * a Postgres error string can name columns, constraints, and policies, and
 * none of that belongs on a screen.
 */
export class RightsReviewError extends Error {
  readonly reason: RightsReviewFailure;

  constructor(reason: RightsReviewFailure, message: string) {
    super(message);
    this.name = "RightsReviewError";
    this.reason = reason;
  }
}

export const LICENSE_REQUIRED_MESSAGE =
  "Link and verify the applicable license before marking this use as licensed.";

/**
 * Validate a decision note for a target status.
 *
 * Local to the Rights feature on purpose: these are the rules for this
 * decision, not a general-purpose text check, and the shared validation module
 * is outside this change.
 */
export function parseDecisionNote(
  status: TriageStatus,
  raw: string | undefined | null,
): { readonly ok: true; readonly note?: string } | { readonly ok: false; readonly error: RightsReviewError } {
  const note = typeof raw === "string" ? raw.trim() : "";

  if (note === "") {
    return noteIsRequired(status)
      ? {
          ok: false,
          error: new RightsReviewError(
            "note_required",
            `Record why this match is being marked ${status}. A closing decision needs a reason on the record.`,
          ),
        }
      : { ok: true };
  }

  if (note.length < DECISION_NOTE_MIN && noteIsRequired(status)) {
    return {
      ok: false,
      error: new RightsReviewError(
        "note_too_short",
        `Give at least ${DECISION_NOTE_MIN} characters of reasoning.`,
      ),
    };
  }

  if (note.length > DECISION_NOTE_MAX) {
    return {
      ok: false,
      error: new RightsReviewError(
        "note_too_long",
        `Keep the note under ${DECISION_NOTE_MAX} characters.`,
      ),
    };
  }

  return { ok: true, note };
}

export interface ReviewRightsMatchInput {
  readonly organizationId: Id;
  readonly actorId: Id;
  readonly matchId: Id;
  readonly status: TriageStatus;
  readonly note?: string | null;
  /** The `updated_at` the reviewer was looking at. Guards against a lost update. */
  readonly expectedUpdatedAt: string;
  /** A caller-held client, for database-backed tests. Never a service-role one. */
  readonly client?: SupabaseClient;
}

/**
 * Record one human triage decision.
 *
 * Everything the machine observed is left exactly as it was. This writes the
 * status, the note, and who decided when -- nothing else -- and then appends
 * one activity event, on the same client and only if the write actually landed.
 *
 * The update is conditional on the `updated_at` the reviewer saw, so two people
 * working the same queue cannot silently overwrite one another: the second one
 * matches no row, is told what happened, and writes no event.
 */
export async function reviewRightsMatch(
  input: ReviewRightsMatchInput,
): Promise<RightsMatchDetail> {
  const { organizationId, actorId, matchId, status, expectedUpdatedAt } = input;
  const supabase = input.client ?? (await createClient());

  if (!isTriageStatus(status)) {
    throw new RightsReviewError("invalid_status", "That is not a decision this review records.");
  }

  const parsed = parseDecisionNote(status, input.note);
  if (!parsed.ok) throw parsed.error;
  const note = parsed.note;

  const current = await getRightsMatch(organizationId, matchId, supabase);
  if (!current) {
    throw new RightsReviewError("not_found", "That match is not in this workspace.");
  }

  if (!allowedTransitions(current.status).includes(status)) {
    throw new RightsReviewError(
      "invalid_transition",
      `A match recorded as ${current.status} cannot be moved to ${status}.`,
    );
  }

  if (requiresLinkedLicense(status) && current.licenseCheck !== "linked_license_found") {
    throw new RightsReviewError("license_required", LICENSE_REQUIRED_MESSAGE);
  }

  const reviewedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("rights_matches")
    .update({
      status,
      // An omitted optional note leaves the previous one standing rather than
      // erasing a colleague's reasoning.
      ...(note === undefined ? {} : { decision_note: note }),
      reviewed_by: actorId,
      reviewed_at: reviewedAt,
    })
    .eq("organization_id", organizationId)
    .eq("id", matchId)
    .eq("updated_at", expectedUpdatedAt)
    .select(MATCH_COLUMNS);

  if (error) {
    // Never the driver's text: it names columns, constraints, and policies.
    throw new RightsReviewError("denied", "That decision could not be recorded.");
  }

  const updated = (data ?? [])[0] as unknown as MatchRow | undefined;
  if (!updated) {
    /*
     * Zero rows means one of three different things, and a reviewer deserves to
     * be told which. Row level security answers a forbidden update with no rows
     * rather than an error, so the row is read back to tell a permission
     * refusal from a genuine race.
     */
    const now = await getRightsMatch(organizationId, matchId, supabase);
    if (!now) throw new RightsReviewError("not_found", "That match is not in this workspace.");
    if (now.updatedAt === expectedUpdatedAt) {
      throw new RightsReviewError("denied", "Your role may not record rights decisions.");
    }
    throw new RightsReviewError(
      "conflict",
      "Somebody else reviewed this match while you were reading it. Reload and look at the current decision before recording another.",
    );
  }

  const saved = toMatch(updated);

  /*
   * One event, after the write, on the same client. The note itself stays on
   * the match, which is where the authoritative copy lives -- an event stream
   * is a wider audience than the record it describes, and a decision note can
   * name a person or a source.
   */
  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "rights_match",
    entityId: matchId,
    action: `rights_match.${status}`,
    data: {
      summary: SUMMARIES[status],
      previousStatus: current.status,
      status,
      noteRecorded: note !== undefined,
    },
  });

  return saved;
}

const SUMMARIES: Record<TriageStatus, string> = {
  reviewing: "Internal review started",
  monitoring: "Held for another observation",
  ignored: "Set aside by a reviewer",
  licensed: "Matched to a linked license",
  resolved: "Review closed",
};
