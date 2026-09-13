import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type {
  BuyerRequest,
  Id,
  IsoTimestamp,
  LicenseStatus,
  RequestChannel,
  RequestOrientation,
  RequestSensitiveNote,
  RequestSource,
  RequestStatus,
  RequestType,
} from "../domain";
import { type CurrencyCode, type Money, money } from "../money";
import { RequestError, checkTransition, isClosed } from "../requests";
import { createClient } from "../supabase/server";
import { isRecordId } from "../validation";
import type { RequestIntakeInput } from "../validation";
import { recordEventWith } from "./activity";

/**
 * Reading and writing inbound demand.
 *
 * Every function here takes an organization id resolved from the URL by
 * `workspaceContext`, never a value that arrived in a form. Row level security
 * is the boundary underneath; the explicit `.eq("organization_id", ...)` on top
 * of it is so that a bug in a policy costs a wrong answer rather than a
 * cross-tenant one.
 *
 * Nothing in this module sends anything to anybody. A request is a record of a
 * conversation that happened elsewhere -- on a phone, in a text, over WhatsApp
 * -- and recording, assigning, or closing one produces exactly one database
 * write and one activity event.
 */

/**
 * One round trip for a request and the two things always rendered beside it.
 *
 * The buyer's name and whether a confidential note exists were two extra
 * queries per read, which the work queue -- the screen an operator opens every
 * morning -- pays for on top of everything else it fetches. Both are embedded
 * instead, and both stay honest under row level security: the embed is
 * evaluated with the caller's policies, so a dispatcher reading a request with
 * a source note gets an empty `request_sensitive_notes` array rather than a
 * flag they were not entitled to. Absence of the flag is not evidence of
 * absence of a note, which is the same contract shoots have.
 *
 * `request_sensitive_notes` embeds unambiguously because that table carries
 * exactly one foreign key back to this one. See the migration.
 */
const REQUEST_COLUMNS =
  "id, organization_id, buyer_id, created_by, assigned_to, assigned_at, assigned_by, reference, source, received_via, request_type, status, title, brief, subject_or_event, subject_names, topics, event_at, location_name, response_deadline, expires_at, deliverables, requested_formats, orientation, approximate_quantity, usage_media, territory, usage_duration, exclusivity, budget_disclosed, budget_min_minor, budget_max_minor, currency, embargo_until, delivery_requirements, usage_restrictions, closed_reason, created_at, updated_at, qualified_at, closed_at, buyers(name), request_sensitive_notes(request_id)";

interface RequestRow {
  id: string;
  organization_id: string;
  buyer_id: string | null;
  created_by: string;
  assigned_to: string | null;
  assigned_at: string | null;
  assigned_by: string | null;
  reference: string;
  source: RequestSource;
  received_via: RequestChannel | null;
  request_type: RequestType;
  status: RequestStatus;
  title: string;
  brief: string | null;
  subject_or_event: string | null;
  subject_names: string[] | null;
  topics: string[] | null;
  event_at: string | null;
  location_name: string | null;
  response_deadline: string | null;
  expires_at: string | null;
  deliverables: string | null;
  requested_formats: string[] | null;
  orientation: RequestOrientation | null;
  approximate_quantity: number | null;
  usage_media: string | null;
  territory: string | null;
  usage_duration: string | null;
  exclusivity: string | null;
  budget_disclosed: boolean;
  budget_min_minor: number | string | null;
  budget_max_minor: number | string | null;
  currency: string;
  embargo_until: string | null;
  delivery_requirements: string | null;
  usage_restrictions: string | null;
  closed_reason: string | null;
  created_at: string;
  updated_at: string;
  qualified_at: string | null;
  closed_at: string | null;
  /** Embedded. Null when no buyer has been identified yet. */
  buyers: { name: string } | null;
  /** Embedded, and empty for a role whose policies cannot see the notes table. */
  request_sensitive_notes: { request_id: string }[] | null;
}

/** `bigint` arrives as a string once it exceeds what JSON can hold safely. */
function minorUnits(value: number | string | null): number | undefined {
  if (value === null) return undefined;
  return typeof value === "string" ? Number(value) : value;
}

function toRequest(row: RequestRow): BuyerRequest {
  const currency = row.currency as CurrencyCode;
  const min = minorUnits(row.budget_min_minor);
  const max = minorUnits(row.budget_max_minor);

  return {
    id: row.id,
    organizationId: row.organization_id,
    buyerId: row.buyer_id ?? undefined,
    buyerName: row.buyers?.name ?? undefined,
    createdBy: row.created_by,
    assignedTo: row.assigned_to ?? undefined,
    assignedAt: row.assigned_at ?? undefined,
    assignedBy: row.assigned_by ?? undefined,
    reference: row.reference,
    source: row.source,
    receivedVia: row.received_via ?? undefined,
    requestType: row.request_type,
    status: row.status,
    title: row.title,
    brief: row.brief ?? undefined,
    subjectOrEvent: row.subject_or_event ?? undefined,
    subjectNames: row.subject_names ?? [],
    topics: row.topics ?? [],
    eventAt: row.event_at ?? undefined,
    locationName: row.location_name ?? undefined,
    responseDeadline: row.response_deadline ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    deliverables: row.deliverables ?? undefined,
    requestedFormats: row.requested_formats ?? [],
    orientation: row.orientation ?? undefined,
    approximateQuantity: row.approximate_quantity ?? undefined,
    usageMedia: row.usage_media ?? undefined,
    territory: row.territory ?? undefined,
    usageDuration: row.usage_duration ?? undefined,
    exclusivity: row.exclusivity ?? undefined,
    budgetDisclosed: row.budget_disclosed,
    // Undefined rather than a zero Money: the difference between a budget
    // nobody mentioned and a budget of nothing is the whole point of the pair.
    budgetMin: min === undefined ? undefined : money(min, currency),
    budgetMax: max === undefined ? undefined : money(max, currency),
    currency,
    embargoUntil: row.embargo_until ?? undefined,
    deliveryRequirements: row.delivery_requirements ?? undefined,
    usageRestrictions: row.usage_restrictions ?? undefined,
    closedReason: row.closed_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    qualifiedAt: row.qualified_at ?? undefined,
    closedAt: row.closed_at ?? undefined,
    hasSensitiveNote: (row.request_sensitive_notes ?? []).length > 0,
  };
}

/**
 * How many references to draw before giving up.
 *
 * The tail is four digits and the constraint is per workspace, so a collision
 * needs the same workspace, the same day, and the same number. Six independent
 * draws all landing on a taken number is not something a photographer will
 * meet; grinding past that would be a storm rather than a retry. Same reasoning
 * as `MAX_REFERENCE_ATTEMPTS` in submissions.ts.
 */
const MAX_REFERENCE_ATTEMPTS = 6;

/** A reference somebody can read down a phone, e.g. REQ-0827-4417. */
function buildReference(at: Date): string {
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  const tail = String(Math.floor(Math.random() * 9000) + 1000);
  return `REQ-${month}${day}-${tail}`;
}

/** 23505 on the idempotency key rather than on the reference. */
function isIdempotencyCollision(error: PostgrestError): boolean {
  return error.code === "23505" && /idempotency/i.test(`${error.message} ${error.details ?? ""}`);
}

/**
 * Turn a driver error into something a person can act on.
 *
 * Never the driver's own text: it names columns, constraints and policies, and
 * a request screen is not the place to publish the schema.
 */
function describeWriteError(error: PostgrestError): RequestError {
  if (error.code === "23503") {
    // The two composite foreign keys are the only ones a caller can trip: a
    // buyer in another workspace, or an assignee who is not a member of this
    // one. Both are the same class of mistake and neither is worth confirming
    // the existence of the record they point at.
    if (/assigned_to|memberships/i.test(`${error.message} ${error.details ?? ""}`)) {
      return new RequestError(
        "not_a_member",
        "That person is not an active member of this workspace.",
      );
    }
    return new RequestError("cross_workspace", "That buyer is not in this workspace.");
  }

  if (error.code === "42501" || error.code === "PGRST301") {
    return new RequestError("denied", "Your role may not change requests.");
  }

  return new RequestError("unknown", "That change could not be saved.");
}

/** The fields shared by creation and editing, as database columns. */
function intakeColumns(intake: RequestIntakeInput): Record<string, unknown> {
  return {
    buyer_id: intake.buyerId ?? null,
    request_type: intake.requestType,
    received_via: intake.receivedVia ?? null,
    title: intake.title,
    brief: intake.brief ?? null,
    subject_or_event: intake.subjectOrEvent ?? null,
    subject_names: intake.subjectNames,
    topics: intake.topics,
    event_at: intake.eventAt ?? null,
    location_name: intake.locationName ?? null,
    response_deadline: intake.responseDeadline ?? null,
    expires_at: intake.expiresAt ?? null,
    deliverables: intake.deliverables ?? null,
    requested_formats: intake.requestedFormats,
    orientation: intake.orientation ?? null,
    approximate_quantity: intake.approximateQuantity ?? null,
    usage_media: intake.usageMedia ?? null,
    territory: intake.territory ?? null,
    usage_duration: intake.usageDuration ?? null,
    exclusivity: intake.exclusivity ?? null,
    budget_disclosed: intake.budgetDisclosed,
    budget_min_minor: intake.budgetMinMinor ?? null,
    budget_max_minor: intake.budgetMaxMinor ?? null,
    currency: intake.currency,
    embargo_until: intake.embargoUntil ?? null,
    delivery_requirements: intake.deliveryRequirements ?? null,
    usage_restrictions: intake.usageRestrictions ?? null,
  };
}

/** True when any of the three confidential fields was filled in. */
function hasConfidentialContent(intake: RequestIntakeInput): boolean {
  return Boolean(intake.sourceNote || intake.confidentialLocation || intake.confidentialIdentity);
}

export interface CreatedRequest {
  readonly id: Id;
  readonly reference: string;
  /** True when this key had already produced a request and that one came back. */
  readonly existed: boolean;
}

export interface CreateRequestInput {
  readonly organizationId: Id;
  readonly actorId: Id;
  readonly intake: RequestIntakeInput;
  /**
   * Stable per capture attempt, supplied by the form. A resubmit -- a flaky
   * connection, a double tap, a second tab -- lands on the request it already
   * made rather than a duplicate somebody has to notice and clean up.
   */
  readonly idempotencyKey: string;
  /**
   * `new` puts it in the inbox; `draft` keeps it private until somebody posts
   * it. Nothing else is creatable: a request cannot be born qualified, lost, or
   * anything else with a history it did not have.
   */
  readonly status?: Extract<RequestStatus, "draft" | "new">;
  readonly client?: SupabaseClient;
}

/**
 * Record one inbound request.
 *
 * Idempotency is by unique constraint rather than by a check the application
 * performs, because the case that matters is a retry racing its own timeout,
 * and a select followed by an insert loses that race by construction. The read
 * below the insert is the fast path for the ordinary resubmit; the constraint
 * is what actually guarantees it.
 *
 * Confidential material never touches the request row. If any of the three
 * confidential fields was filled in, a second write puts them in
 * request_sensitive_notes, which finance, dispatch, rights and viewer roles
 * cannot read at all. A caller whose role cannot write that table still gets
 * the request -- the note is refused, not the record -- and the refusal is
 * reported rather than swallowed.
 */
export async function createRequest(input: CreateRequestInput): Promise<CreatedRequest> {
  const { organizationId, actorId, intake, idempotencyKey } = input;
  const supabase = input.client ?? (await createClient());
  const status = input.status ?? "new";

  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new RequestError("unknown", "That submission could not be identified. Try again.");
  }

  const existing = await requestForKey(organizationId, idempotencyKey, supabase);
  if (existing) return { ...existing, existed: true };

  const base = {
    organization_id: organizationId,
    created_by: actorId,
    idempotency_key: idempotencyKey,
    source: "manual" as const,
    status,
    ...intakeColumns(intake),
  };

  let created: { id: string; reference: string } | null = null;
  let lastError: PostgrestError | null = null;

  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
    /*
     * Draw a reference and let the database be the one that says it is free.
     * Checking first would not help: another request can take the number
     * between the select and the insert, and the draws are independent, so
     * redrawing converges immediately.
     */
    const { data, error } = await supabase
      .from("buyer_requests")
      .insert({ ...base, reference: buildReference(new Date()) })
      .select("id, reference")
      .single();

    if (!error && data) {
      created = { id: data.id as string, reference: data.reference as string };
      break;
    }

    lastError = error;
    if (!error) break;

    if (isIdempotencyCollision(error)) {
      // Lost the race to another attempt with the same key. That attempt's
      // request is the answer, which is exactly what idempotency promises.
      const raced = await requestForKey(organizationId, idempotencyKey, supabase);
      if (raced) return { ...raced, existed: true };
      throw describeWriteError(error);
    }

    // A reference collision is the only other 23505 this insert can raise.
    if (error.code !== "23505") throw describeWriteError(error);
  }

  if (!created) {
    throw lastError
      ? describeWriteError(lastError)
      : new RequestError("unknown", "That request could not be recorded.");
  }

  if (hasConfidentialContent(intake)) {
    const { error } = await supabase.from("request_sensitive_notes").insert({
      request_id: created.id,
      organization_id: organizationId,
      source_note: intake.sourceNote ?? null,
      confidential_location: intake.confidentialLocation ?? null,
      confidential_identity: intake.confidentialIdentity ?? null,
      created_by: actorId,
    });

    if (error) {
      throw new RequestError(
        "denied",
        `Request ${created.reference} was saved, but the confidential note was not: your role cannot write source material.`,
      );
    }
  }

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "buyer_request",
    entityId: created.id,
    action: "request.created",
    data: {
      summary: `Recorded request ${created.reference}: ${intake.title}`,
      reference: created.reference,
      status,
      requestType: intake.requestType,
      budgetDisclosed: intake.budgetDisclosed,
      // The note's CONTENT never enters the activity stream: an event is read
      // by every member, and the note is not.
      confidentialNoteRecorded: hasConfidentialContent(intake),
    },
  });

  return { id: created.id, reference: created.reference, existed: false };
}

async function requestForKey(
  organizationId: Id,
  idempotencyKey: string,
  supabase: SupabaseClient,
): Promise<{ id: Id; reference: string } | null> {
  const { data } = await supabase
    .from("buyer_requests")
    .select("id, reference")
    .eq("organization_id", organizationId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  return data ? { id: data.id as string, reference: data.reference as string } : null;
}

export interface RequestFilter {
  readonly status?: readonly RequestStatus[];
  readonly buyerId?: Id;
  readonly assignedTo?: Id;
  /** "open" hides everything closed; "past_deadline" is derived, see below. */
  readonly deadline?: "any" | "past_deadline" | "next_24h" | "next_7d";
  readonly limit?: number;
}

/**
 * The inbox.
 *
 * Ordered by whether the buyer's deadline has gone by, then by how soon it is,
 * then newest first. That ordering is done here rather than in SQL because
 * "past deadline" depends on the current instant, and a database index cannot
 * be built on `now()`; the alternative -- a stored `is_overdue` column -- is a
 * fact that becomes wrong while nobody is writing to it, which is exactly what
 * this feature refuses to do with `expired`.
 *
 * The candidate set is still narrowed in SQL, so the sort runs over one
 * workspace's open requests rather than its history.
 */
export async function listRequests(
  organizationId: Id,
  filter: RequestFilter = {},
  client?: SupabaseClient,
): Promise<readonly BuyerRequest[]> {
  const supabase = client ?? (await createClient());

  let query = supabase
    .from("buyer_requests")
    .select(REQUEST_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 200);

  if (filter.status && filter.status.length > 0) query = query.in("status", filter.status);
  if (filter.buyerId) query = query.eq("buyer_id", filter.buyerId);
  if (filter.assignedTo) query = query.eq("assigned_to", filter.assignedTo);

  const now = new Date();
  if (filter.deadline === "past_deadline") {
    query = query.lt("response_deadline", now.toISOString());
  } else if (filter.deadline === "next_24h" || filter.deadline === "next_7d") {
    const horizon = new Date(
      now.getTime() + (filter.deadline === "next_24h" ? 24 : 24 * 7) * 3_600_000,
    );
    query = query
      .gte("response_deadline", now.toISOString())
      .lte("response_deadline", horizon.toISOString());
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load requests: ${error.message}`);

  return sortForInbox(
    (data ?? []).map((row) => toRequest(row as unknown as RequestRow)),
    now,
  );
}

/**
 * Inbox order: what is late, then what is nearly late, then what is new.
 *
 * Exported so the ordering can be tested without a database, and so the work
 * queue can reuse it rather than inventing a second idea of urgency.
 */
export function sortForInbox(
  requests: readonly BuyerRequest[],
  now: Date,
): readonly BuyerRequest[] {
  const rank = (request: BuyerRequest): number => {
    if (isClosed(request.status)) return 3;
    if (!request.responseDeadline) return 2;
    return new Date(request.responseDeadline).getTime() < now.getTime() ? 0 : 1;
  };

  return [...requests].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;

    // Within a rank, the nearer deadline first; a request with no deadline at
    // all sorts after every request that has one.
    if (a.responseDeadline && b.responseDeadline) {
      const byDeadline = a.responseDeadline.localeCompare(b.responseDeadline);
      if (byDeadline !== 0) return byDeadline;
    } else if (a.responseDeadline !== b.responseDeadline) {
      return a.responseDeadline ? -1 : 1;
    }

    return b.createdAt.localeCompare(a.createdAt);
  });
}

export async function getRequest(
  organizationId: Id,
  requestId: Id,
  client?: SupabaseClient,
): Promise<BuyerRequest | null> {
  // A malformed id is "no such record", not a database error.
  if (!isRecordId(requestId)) return null;

  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("buyer_requests")
    .select(REQUEST_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", requestId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the request: ${error.message}`);
  if (!data) return null;
  return toRequest(data as unknown as RequestRow);
}

/** Returns null when the caller's role cannot read source material. */
export async function getRequestSensitiveNote(
  organizationId: Id,
  requestId: Id,
  client?: SupabaseClient,
): Promise<RequestSensitiveNote | null> {
  if (!isRecordId(requestId)) return null;
  const supabase = client ?? (await createClient());

  const { data } = await supabase
    .from("request_sensitive_notes")
    .select("source_note, confidential_location, confidential_identity")
    .eq("organization_id", organizationId)
    .eq("request_id", requestId)
    .maybeSingle();

  if (!data) return null;
  return {
    sourceNote: (data.source_note as string | null) ?? undefined,
    confidentialLocation: (data.confidential_location as string | null) ?? undefined,
    confidentialIdentity: (data.confidential_identity as string | null) ?? undefined,
  };
}

/**
 * Read a zero-row write back and say which of three things it was.
 *
 * Row level security answers a forbidden update with no rows rather than an
 * error, so "nothing happened" covers a request that is gone, a role that may
 * not write, and a genuine race with somebody else. Telling them apart needs a
 * second read, and a person who has just lost an edit deserves to know which.
 */
async function explainEmptyWrite(
  organizationId: Id,
  requestId: Id,
  expectedUpdatedAt: string,
  supabase: SupabaseClient,
): Promise<RequestError> {
  const now = await getRequest(organizationId, requestId, supabase);
  if (!now) return new RequestError("not_found", "That request is not in this workspace.");
  if (now.updatedAt === expectedUpdatedAt) {
    return new RequestError("denied", "Your role may not change requests.");
  }
  return new RequestError(
    "conflict",
    "Somebody else changed this request while you were reading it. Reload and look at the current state before saving again.",
  );
}

export interface UpdateRequestInput {
  readonly organizationId: Id;
  readonly actorId: Id;
  readonly requestId: Id;
  readonly intake: RequestIntakeInput;
  /** The `updated_at` the editor was looking at. Guards against a lost update. */
  readonly expectedUpdatedAt: string;
  readonly client?: SupabaseClient;
}

/**
 * Edit the facts of a request.
 *
 * The status is not touched here: what a buyer asked for and where the request
 * has got to are different questions, and letting one form move both is how a
 * typo in a deadline ends up recorded as a decision. Transitions go through
 * `transitionRequest`.
 *
 * A closed request is not editable. The database refuses a status change out of
 * a closed state; this refuses the rest of the row too, because rewriting the
 * terms of a request that has already been lost changes what was lost.
 */
export async function updateRequest(input: UpdateRequestInput): Promise<BuyerRequest> {
  const { organizationId, actorId, requestId, intake, expectedUpdatedAt } = input;
  const supabase = input.client ?? (await createClient());

  const current = await getRequest(organizationId, requestId, supabase);
  if (!current) throw new RequestError("not_found", "That request is not in this workspace.");
  if (isClosed(current.status)) {
    throw new RequestError(
      "invalid_transition",
      "This request is closed. Its record is kept as it was.",
    );
  }

  const { data, error } = await supabase
    .from("buyer_requests")
    .update(intakeColumns(intake))
    .eq("organization_id", organizationId)
    .eq("id", requestId)
    .eq("updated_at", expectedUpdatedAt)
    .select("id");

  if (error) throw describeWriteError(error);
  if ((data ?? []).length === 0) {
    throw await explainEmptyWrite(organizationId, requestId, expectedUpdatedAt, supabase);
  }

  await writeSensitiveNote({ organizationId, actorId, requestId, intake, supabase });

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "buyer_request",
    entityId: requestId,
    action: "request.updated",
    data: { summary: `Updated request ${current.reference}`, reference: current.reference },
  });

  const saved = await getRequest(organizationId, requestId, supabase);
  if (!saved) throw new RequestError("not_found", "That request is not in this workspace.");
  return saved;
}

/**
 * Write or clear the confidential note.
 *
 * Absent fields clear the note rather than leaving a stale one behind: an
 * editor who removes an address from the confidential box means it to be gone.
 * A role that cannot write the table is refused loudly, because silently
 * dropping source material is the failure mode this table exists to prevent.
 */
async function writeSensitiveNote(input: {
  organizationId: Id;
  actorId: Id;
  requestId: Id;
  intake: RequestIntakeInput;
  supabase: SupabaseClient;
}): Promise<void> {
  const { organizationId, actorId, requestId, intake, supabase } = input;

  if (!hasConfidentialContent(intake)) {
    const { error } = await supabase
      .from("request_sensitive_notes")
      .delete()
      .eq("organization_id", organizationId)
      .eq("request_id", requestId);
    // A role that cannot read the table cannot delete from it either, and has
    // nothing to clear: a no-op refusal is not worth an error.
    if (error && error.code !== "42501") {
      throw new RequestError("unknown", "The confidential note could not be updated.");
    }
    return;
  }

  const { error } = await supabase.from("request_sensitive_notes").upsert(
    {
      request_id: requestId,
      organization_id: organizationId,
      source_note: intake.sourceNote ?? null,
      confidential_location: intake.confidentialLocation ?? null,
      confidential_identity: intake.confidentialIdentity ?? null,
      created_by: actorId,
    },
    { onConflict: "request_id" },
  );

  if (error) {
    throw new RequestError(
      "denied",
      "The request was saved, but the confidential note was not: your role cannot write source material.",
    );
  }
}

export interface AssignRequestInput {
  readonly organizationId: Id;
  readonly actorId: Id;
  readonly requestId: Id;
  /** Null releases it. A workspace member id; anything else the database refuses. */
  readonly assignedTo: Id | null;
  readonly expectedUpdatedAt: string;
  readonly client?: SupabaseClient;
}

/**
 * Say who is answering a request.
 *
 * Cross-workspace assignment is refused by the database, not by this function:
 * (organization_id, assigned_to) is a composite foreign key onto the
 * memberships primary key, so a member of another studio fails the constraint
 * whatever this code believes. What is checked here is only the shape.
 */
export async function assignRequest(input: AssignRequestInput): Promise<BuyerRequest> {
  const { organizationId, actorId, requestId, assignedTo, expectedUpdatedAt } = input;
  const supabase = input.client ?? (await createClient());

  if (assignedTo !== null && !isRecordId(assignedTo)) {
    throw new RequestError("not_a_member", "That person is not a member of this workspace.");
  }

  const current = await getRequest(organizationId, requestId, supabase);
  if (!current) throw new RequestError("not_found", "That request is not in this workspace.");
  if (isClosed(current.status)) {
    throw new RequestError(
      "invalid_transition",
      "This request is closed, so it cannot be reassigned.",
    );
  }

  const { data, error } = await supabase
    .from("buyer_requests")
    .update({
      assigned_to: assignedTo,
      // The trigger clears both of these when the assignee is removed, so a
      // released request never keeps a time attached to nobody.
      assigned_by: assignedTo === null ? null : actorId,
    })
    .eq("organization_id", organizationId)
    .eq("id", requestId)
    .eq("updated_at", expectedUpdatedAt)
    .select("id");

  if (error) throw describeWriteError(error);
  if ((data ?? []).length === 0) {
    throw await explainEmptyWrite(organizationId, requestId, expectedUpdatedAt, supabase);
  }

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "buyer_request",
    entityId: requestId,
    action: assignedTo === null ? "request.unassigned" : "request.assigned",
    data: {
      summary:
        assignedTo === null
          ? `Released ${current.reference}`
          : `Assigned ${current.reference} to a workspace member`,
      reference: current.reference,
      assignedTo,
      previousAssignee: current.assignedTo ?? null,
    },
  });

  const saved = await getRequest(organizationId, requestId, supabase);
  if (!saved) throw new RequestError("not_found", "That request is not in this workspace.");
  return saved;
}

/** One connected license, as the request screen renders it. */
export interface ConnectedLicense {
  readonly id: Id;
  readonly licenseId: Id;
  readonly linkedAt: IsoTimestamp;
  readonly licenseeName: string;
  readonly licenseStatus: LicenseStatus;
  readonly saleBase: Money;
}

/**
 * The licenses connected to a request -- for a won request, the answer to
 * "which sale closed this". The money figures come from the license row
 * itself: the connection carries none, deliberately, so there is exactly one
 * answer to what a license earned.
 */
export async function listConnectedLicenses(
  organizationId: Id,
  requestId: Id,
  client?: SupabaseClient,
): Promise<readonly ConnectedLicense[]> {
  if (!isRecordId(requestId)) return [];
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase
    .from("request_licenses")
    .select("id, license_id, linked_at, licenses(licensee_name, status, sale_base_minor, currency)")
    .eq("organization_id", organizationId)
    .eq("request_id", requestId)
    .order("linked_at", { ascending: true });

  if (error) throw new Error(`Could not load the connected licenses: ${error.message}`);

  return (data ?? []).map((row) => {
    const license = row.licenses as unknown as {
      licensee_name: string;
      status: string;
      sale_base_minor: number | string;
      currency: string;
    };
    return {
      id: row.id as string,
      licenseId: row.license_id as string,
      linkedAt: row.linked_at as string,
      licenseeName: license.licensee_name,
      licenseStatus: license.status as LicenseStatus,
      saleBase: money(minorUnits(license.sale_base_minor) ?? 0, license.currency as CurrencyCode),
    };
  });
}

export interface ConnectLicenseInput {
  readonly organizationId: Id;
  readonly actorId: Id;
  readonly requestId: Id;
  readonly licenseId: Id;
  readonly expectedUpdatedAt: string;
  readonly client?: SupabaseClient;
}

/**
 * Record a win: connect the license that closed the request, then move it.
 *
 * One human act, two writes. The connection row names the license; the status
 * change is the same audited transition every other move goes through, with
 * the database's evidence gate underneath re-checking that a qualifying
 * connected license really exists. Nothing here creates or edits a license --
 * money is recorded on the money screen and only pointed at from here.
 *
 * If the transition loses a concurrency race after the link is written, the
 * link stands and the caller is told what happened; retrying converges,
 * because the insert is idempotent per (request, license). A connection
 * without a won status is an ordinary open state, not a corruption.
 */
export async function connectLicense(input: ConnectLicenseInput): Promise<BuyerRequest> {
  const { organizationId, actorId, requestId, licenseId, expectedUpdatedAt } = input;
  const supabase = input.client ?? (await createClient());

  if (!isRecordId(licenseId)) {
    throw new RequestError("not_found", "That license is not in this workspace.");
  }

  const current = await getRequest(organizationId, requestId, supabase);
  if (!current) throw new RequestError("not_found", "That request is not in this workspace.");

  // Refuse before writing anything: a closed request, or one that has not been
  // submitted, gets the same typed refusal the generic move control would get.
  const check = checkTransition({ from: current.status, to: "won", connectedLicenseId: licenseId });
  if (!check.ok) throw check.error;

  const { data: license, error: licenseError } = await supabase
    .from("licenses")
    .select("id, status, licensee_name, sale_base_minor")
    .eq("organization_id", organizationId)
    .eq("id", licenseId)
    .maybeSingle();

  if (licenseError) throw new RequestError("unknown", "That license could not be read.");
  // The same answer for a license in another workspace and one that never
  // existed, for the same reason getRequest gives it.
  if (!license) throw new RequestError("not_found", "That license is not in this workspace.");

  /*
   * Mirror the database's qualifying rule so the refusal lands next to the
   * control instead of surfacing as an opaque trigger error: a cancelled
   * license is not a win, and a proposed license with no figure is an offer.
   * An active license qualifies even at zero -- a rights-for-credit deal is a
   * real outcome somebody negotiated.
   */
  const base = minorUnits(license.sale_base_minor as number | string) ?? 0;
  const status = license.status as LicenseStatus;
  if (status === "cancelled" || (base <= 0 && status !== "active")) {
    throw new RequestError(
      "license_ineligible",
      status === "cancelled"
        ? "That license was cancelled, and a cancelled license cannot record a win."
        : "That license is a proposal with no figure on it -- an offer, not a win. Record the agreed sale on it first.",
    );
  }

  const { error: linkError } = await supabase.from("request_licenses").insert({
    organization_id: organizationId,
    request_id: requestId,
    license_id: licenseId,
    linked_by: actorId,
  });

  // 23505 is this exact pair already connected -- a retry, a double click, a
  // second tab. The connection it wants exists, which is what it asked for.
  const alreadyConnected = linkError?.code === "23505";
  if (linkError && !alreadyConnected) {
    if (linkError.code === "23503") {
      throw new RequestError("cross_workspace", "That license is not in this workspace.");
    }
    if (linkError.code === "42501") {
      throw new RequestError("denied", "Your role may not change requests.");
    }
    throw new RequestError("unknown", "That connection could not be recorded.");
  }

  if (!alreadyConnected) {
    await recordEventWith(supabase, {
      organizationId,
      actorId,
      entityType: "buyer_request",
      entityId: requestId,
      action: "request.license_connected",
      data: {
        summary: `Connected a license to ${current.reference}: ${license.licensee_name as string}`,
        reference: current.reference,
        licenseId,
      },
    });
  }

  return transitionRequest({
    organizationId,
    actorId,
    requestId,
    status: "won",
    connectedLicenseId: licenseId,
    expectedUpdatedAt,
    client: supabase,
  });
}

/**
 * How often the workspace turns work down, as the two numbers that make the
 * rate readable: requests declined, out of requests ever recorded.
 *
 * DECISIONS.md keeps cancelled and declined separate precisely so this can be
 * answered; the inbox surfaces it because a number nobody sees moves nobody.
 * Both are HEAD count queries -- no rows travel -- so the inbox pays two round
 * trips of a few bytes, not a scan it renders nothing from.
 */
export async function countRequestOutcomes(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<{ declined: number; recorded: number }> {
  const supabase = client ?? (await createClient());

  const [declined, recorded] = await Promise.all([
    supabase
      .from("buyer_requests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "declined"),
    supabase
      .from("buyer_requests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
  ]);

  if (declined.error) throw new Error(`Could not count requests: ${declined.error.message}`);
  if (recorded.error) throw new Error(`Could not count requests: ${recorded.error.message}`);

  return { declined: declined.count ?? 0, recorded: recorded.count ?? 0 };
}

export interface TransitionRequestInput {
  readonly organizationId: Id;
  readonly actorId: Id;
  readonly requestId: Id;
  readonly status: RequestStatus;
  /** Required for `lost` and `declined`; optional elsewhere. */
  readonly reason?: string | null;
  /**
   * The license whose connection this move rides on. Supplied only by
   * `connectLicense`, which has just written the connection; a `won` without
   * it is refused here, and a `won` without the actual row is refused by the
   * database's evidence gate whatever this field claims.
   */
  readonly connectedLicenseId?: Id;
  readonly expectedUpdatedAt: string;
  readonly client?: SupabaseClient;
}

/**
 * Move a request along, once.
 *
 * Everything that decides whether the move may happen is read on the server:
 * the current status from the row, the transition table from src/lib/requests,
 * the role from the membership. What the browser supplies is a target and the
 * `updated_at` it was looking at.
 *
 * The update is conditional on that timestamp, so two people working the same
 * inbox cannot silently overwrite one another: the second one matches no row,
 * is told what happened, and writes no event.
 */
export async function transitionRequest(input: TransitionRequestInput): Promise<BuyerRequest> {
  const { organizationId, actorId, requestId, status, expectedUpdatedAt } = input;
  const supabase = input.client ?? (await createClient());

  const current = await getRequest(organizationId, requestId, supabase);
  if (!current) throw new RequestError("not_found", "That request is not in this workspace.");

  const check = checkTransition({
    from: current.status,
    to: status,
    reason: input.reason,
    connectedLicenseId: input.connectedLicenseId,
  });
  if (!check.ok) throw check.error;

  const { data, error } = await supabase
    .from("buyer_requests")
    .update({
      status,
      // An omitted optional reason leaves the previous one standing rather than
      // erasing a colleague's note.
      ...(check.reason === undefined ? {} : { closed_reason: check.reason }),
    })
    .eq("organization_id", organizationId)
    .eq("id", requestId)
    .eq("updated_at", expectedUpdatedAt)
    .select("id");

  if (error) throw describeWriteError(error);
  if ((data ?? []).length === 0) {
    throw await explainEmptyWrite(organizationId, requestId, expectedUpdatedAt, supabase);
  }

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "buyer_request",
    entityId: requestId,
    action: `request.${status}`,
    data: {
      summary: `${current.reference} moved from ${current.status} to ${status}`,
      reference: current.reference,
      previousStatus: current.status,
      status,
      // The reason itself stays on the request. An event stream is read by
      // every member; a closing note can name a desk or a person.
      reasonRecorded: check.reason !== undefined,
      // A win names the license it rode in on, so the history answers "which
      // sale" without a second lookup.
      ...(input.connectedLicenseId ? { licenseId: input.connectedLicenseId } : {}),
    },
  });

  const saved = await getRequest(organizationId, requestId, supabase);
  if (!saved) throw new RequestError("not_found", "That request is not in this workspace.");
  return saved;
}
