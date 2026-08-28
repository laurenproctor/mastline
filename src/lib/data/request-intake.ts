import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callerAddress, callerAgent } from "../delivery";
import type { Id } from "../domain";
import { type IntakeSubmission, type IntakeWindowDays, intakeExpiryFrom } from "../request-intake";
import { createClient } from "../supabase/server";
import { recordEventWith } from "./activity";

/**
 * The two sides of an intake link.
 *
 * One side is a workspace member creating and managing a door. The other is a
 * stranger holding a token, who has no session and reaches nothing except two
 * security-definer functions.
 *
 * The raw token exists in this module and nowhere else. It is generated,
 * hashed, the hash is stored, and the raw value is handed back to the caller
 * exactly once so it can be put in a URL. Nothing writes it to a column, a log,
 * or an activity event.
 */

/** 32 bytes, base64url. The same source and length as a delivery token. */
export function newIntakeToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What actually gets stored.
 *
 * sha256, matching the `sha256(convert_to(token,'UTF8'))` the database does on
 * the way in, so a link created here opens there.
 */
export function hashIntakeToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export type IntakeStatus = "ok" | "invalid" | "rate_limited";

export interface OpenedIntakeLink {
  readonly status: IntakeStatus;
  readonly workspaceName?: string;
  readonly recipientLabel?: string;
  readonly expiresAt?: string;
  readonly alreadySubmitted: boolean;
  readonly requestReference?: string;
}

/**
 * What a visitor sees.
 *
 * Errors are not distinguished on the way out. An unknown token, a withdrawn
 * link and an expired one are one answer, because telling a stranger which it
 * was tells them something about a link they do not hold. A transport failure
 * is the one exception and it throws, because that is the page's fault and not
 * the visitor's.
 */
export async function openRequestLink(
  token: string,
  headers: Headers,
  client?: SupabaseClient,
): Promise<OpenedIntakeLink> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase.rpc("open_request_link", {
    link_token: token,
    caller: callerAddress(headers),
  });

  if (error) throw new Error(`Could not open the request link: ${error.message}`);

  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return { status: "invalid", alreadySubmitted: false };

  return {
    status: row.status as IntakeStatus,
    workspaceName: (row.workspace_name as string | null) ?? undefined,
    recipientLabel: (row.recipient_label as string | null) ?? undefined,
    expiresAt: (row.expires_at as string | null) ?? undefined,
    alreadySubmitted: Boolean(row.already_submitted),
    requestReference: (row.request_reference as string | null) ?? undefined,
  };
}

export type SubmitStatus = "created" | "already_submitted" | "invalid" | "rate_limited";

export interface SubmittedIntake {
  readonly status: SubmitStatus;
  readonly requestReference?: string;
}

/**
 * A stranger submitting one request.
 *
 * The payload carries what they typed and nothing about where it goes: the
 * workspace and the buyer are read from the link row inside the function, so
 * there is no field here that could redirect a request into another workspace
 * even if this module were called wrongly.
 */
export async function submitRequestLink(
  token: string,
  submission: IntakeSubmission,
  headers: Headers,
  client?: SupabaseClient,
): Promise<SubmittedIntake> {
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase.rpc("submit_request_link", {
    link_token: token,
    payload: {
      title: submission.title,
      brief: submission.brief ?? null,
      subject_or_event: submission.subjectOrEvent ?? null,
      event_at: submission.eventAt ?? null,
      location_name: submission.locationName ?? null,
      response_deadline: submission.responseDeadline ?? null,
      deliverables: submission.deliverables ?? null,
      requested_formats: submission.requestedFormats ?? [],
      usage_media: submission.usageMedia ?? null,
      territory: submission.territory ?? null,
      usage_duration: submission.usageDuration ?? null,
      exclusivity: submission.exclusivity ?? null,
      budget_disclosed: submission.budgetDisclosed,
      budget_min_minor: submission.budgetMinMinor ?? null,
      budget_max_minor: submission.budgetMaxMinor ?? null,
      currency: submission.currency ?? "USD",
      embargo_until: submission.embargoUntil ?? null,
      usage_restrictions: submission.usageRestrictions ?? null,
      asserted_submitter_name: submission.submitterName ?? null,
    },
    caller: callerAddress(headers),
    caller_user_agent: callerAgent(headers),
  });

  /*
   * A database message must not reach this page. It can name a constraint, a
   * column, or a function, and the person reading it is a stranger holding a
   * token. Log the detail server-side; answer the visitor generically.
   */
  if (error) {
    console.error("submit_request_link failed", { message: error.message, code: error.code });
    return { status: "invalid" };
  }

  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return { status: "invalid" };

  return {
    status: row.status as SubmitStatus,
    requestReference: (row.request_reference as string | null) ?? undefined,
  };
}

export interface IntakeLink {
  readonly id: Id;
  readonly buyerId: Id;
  readonly buyerName?: string;
  readonly recipientLabel: string;
  readonly recipientReference?: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly submittedAt?: string;
  readonly resultingRequestId?: Id;
  readonly resultingRequestReference?: string;
  readonly firstAccessedAt?: string;
  readonly lastAccessedAt?: string;
  readonly accessCount: number;
  readonly assertedSubmitterName?: string;
  readonly createdAt: string;
}

const LINK_COLUMNS =
  "id, buyer_id, recipient_label, recipient_reference, expires_at, revoked_at, submitted_at, resulting_request_id, first_accessed_at, last_accessed_at, access_count, asserted_submitter_name, created_at, buyers(name), buyer_requests(reference)";

function toLink(row: Record<string, unknown>): IntakeLink {
  const buyer = row.buyers as { name?: string } | null;
  const request = row.buyer_requests as { reference?: string } | null;
  return {
    id: row.id as string,
    buyerId: row.buyer_id as string,
    buyerName: buyer?.name,
    recipientLabel: row.recipient_label as string,
    recipientReference: (row.recipient_reference as string | null) ?? undefined,
    expiresAt: row.expires_at as string,
    revokedAt: (row.revoked_at as string | null) ?? undefined,
    submittedAt: (row.submitted_at as string | null) ?? undefined,
    resultingRequestId: (row.resulting_request_id as string | null) ?? undefined,
    resultingRequestReference: request?.reference,
    firstAccessedAt: (row.first_accessed_at as string | null) ?? undefined,
    lastAccessedAt: (row.last_accessed_at as string | null) ?? undefined,
    accessCount: (row.access_count as number | null) ?? 0,
    assertedSubmitterName: (row.asserted_submitter_name as string | null) ?? undefined,
    createdAt: row.created_at as string,
  };
}

export async function listIntakeLinks(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<IntakeLink[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("request_intake_links")
    .select(LINK_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not read the intake links: ${error.message}`);
  return (data ?? []).map((row) => toLink(row as unknown as Record<string, unknown>));
}

/**
 * Open a door for one buyer.
 *
 * Returns the raw token once. The caller has one chance to put it in front of
 * the operator; there is no second read, because the row holds only the hash.
 * Creating a link is not sharing it -- the operator copies it and sends it
 * themselves, exactly as a delivery link works, and no event here says
 * otherwise.
 */
export async function createIntakeLink(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  buyerId: Id;
  recipientLabel: string;
  recipientReference?: string;
  windowDays: IntakeWindowDays;
}): Promise<{ link: IntakeLink; token: string }> {
  const supabase = input.client ?? (await createClient());
  const token = newIntakeToken();

  const { data, error } = await supabase
    .from("request_intake_links")
    .insert({
      organization_id: input.organizationId,
      buyer_id: input.buyerId,
      created_by: input.actorId,
      recipient_label: input.recipientLabel,
      recipient_reference: input.recipientReference ?? null,
      token_hash: `\\x${hashIntakeToken(token).toString("hex")}`,
      expires_at: intakeExpiryFrom(input.windowDays, new Date()).toISOString(),
    })
    .select(LINK_COLUMNS)
    .single();

  if (error) throw new Error(`Could not create the request link: ${error.message}`);

  await recordEventWith(supabase, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    entityType: "request_intake_link",
    entityId: data!.id as string,
    action: "request_link.created",
    data: { recipient_label: input.recipientLabel, buyer_id: input.buyerId },
  });

  return { link: toLink(data as unknown as Record<string, unknown>), token };
}

/** Close a door. The row stays, because the offer having existed is history. */
export async function revokeIntakeLink(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  linkId: Id;
}): Promise<void> {
  const supabase = input.client ?? (await createClient());

  const { error } = await supabase
    .from("request_intake_links")
    .update({ revoked_at: new Date().toISOString(), revoked_by: input.actorId })
    .eq("organization_id", input.organizationId)
    .eq("id", input.linkId)
    .is("revoked_at", null)
    .is("submitted_at", null);

  if (error) throw new Error(`Could not revoke the request link: ${error.message}`);

  await recordEventWith(supabase, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    entityType: "request_intake_link",
    entityId: input.linkId,
    action: "request_link.revoked",
    data: {},
  });
}
