import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id } from "../domain";
import {
  type DeliveryWindowDays,
  callerAddress,
  callerAgent,
  expiryFrom,
  newDeliveryToken,
} from "../delivery";
import { createClient } from "../supabase/server";
import { recordEventWith } from "./activity";

export interface DeliveryLink {
  readonly id: Id;
  readonly token: string;
  readonly recipientLabel?: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly createdAt: string;
}

export interface AccessEvent {
  readonly kind: "opened" | "downloaded" | "refused";
  readonly assetId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly detail?: string;
  readonly occurredAt: string;
}

export async function listDeliveries(
  organizationId: Id,
  submissionId: Id,
  client?: SupabaseClient,
): Promise<readonly DeliveryLink[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("submission_deliveries")
    .select("id, token, recipient_label, expires_at, revoked_at, created_at")
    .eq("organization_id", organizationId)
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load delivery links: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    token: row.token as string,
    recipientLabel: (row.recipient_label as string | null) ?? undefined,
    expiresAt: row.expires_at as string,
    revokedAt: (row.revoked_at as string | null) ?? undefined,
    createdAt: row.created_at as string,
  }));
}

/** What the recipient did, newest first. Evidence, so it is never trimmed. */
export async function listAccessEvents(
  organizationId: Id,
  deliveryIds: readonly Id[],
  client?: SupabaseClient,
): Promise<readonly AccessEvent[]> {
  if (deliveryIds.length === 0) return [];
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("delivery_access_events")
    .select("kind, asset_id, ip_address, user_agent, detail, occurred_at")
    .eq("organization_id", organizationId)
    .in("delivery_id", [...deliveryIds])
    .order("occurred_at", { ascending: false });

  if (error) throw new Error(`Could not load the access record: ${error.message}`);
  return (data ?? []).map((row) => ({
    kind: row.kind as AccessEvent["kind"],
    assetId: (row.asset_id as string | null) ?? undefined,
    ipAddress: (row.ip_address as string | null) ?? undefined,
    userAgent: (row.user_agent as string | null) ?? undefined,
    detail: (row.detail as string | null) ?? undefined,
    occurredAt: row.occurred_at as string,
  }));
}

/**
 * Create a link for a submission.
 *
 * The token never leaves this function in any form but the row: it is not
 * derived from the submission, so knowing one link tells you nothing about
 * another.
 */
export async function createDelivery(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  submissionId: Id;
  recipientLabel?: string;
  windowDays: DeliveryWindowDays;
  now?: Date;
}): Promise<DeliveryLink> {
  const supabase = input.client ?? (await createClient());
  const now = input.now ?? new Date();
  const token = newDeliveryToken();

  const { data, error } = await supabase
    .from("submission_deliveries")
    .insert({
      organization_id: input.organizationId,
      submission_id: input.submissionId,
      token,
      recipient_label: input.recipientLabel ?? null,
      expires_at: expiryFrom(input.windowDays, now).toISOString(),
      created_by: input.actorId,
    })
    .select("id, token, recipient_label, expires_at, revoked_at, created_at")
    .single();

  if (error || !data) throw new Error(`Could not create the link: ${error?.message}`);

  await recordEventWith(supabase, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    entityType: "submission",
    entityId: input.submissionId,
    action: "delivery.link_created",
    data: {
      summary: `Delivery link created for ${input.recipientLabel ?? "a recipient"}, open ${input.windowDays} days`,
      window_days: input.windowDays,
    },
  });

  return {
    id: data.id as string,
    token: data.token as string,
    recipientLabel: (data.recipient_label as string | null) ?? undefined,
    expiresAt: data.expires_at as string,
    revokedAt: undefined,
    createdAt: data.created_at as string,
  };
}

/** Withdraw a link. The row stays, because the offer having existed is history. */
export async function revokeDelivery(input: {
  organizationId: Id;
  actorId: Id;
  submissionId: Id;
  deliveryId: Id;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("submission_deliveries")
    .update({ revoked_at: new Date().toISOString(), revoked_by: input.actorId })
    .eq("organization_id", input.organizationId)
    .eq("id", input.deliveryId);

  if (error) throw new Error(`Could not withdraw the link: ${error.message}`);

  await recordEventWith(supabase, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    entityType: "submission",
    entityId: input.submissionId,
    action: "delivery.link_revoked",
    data: { summary: "Delivery link withdrawn" },
  });
}

/**
 * Open a link as the recipient.
 *
 * Anonymous: this runs with no session, and everything it can reach is decided
 * by the security-definer function behind it. Returns null when the token is
 * unknown, withdrawn, or out of date -- deliberately the same answer for all
 * three, because telling a stranger which of those it was is telling them
 * something about a link they do not hold.
 */
export interface DeliveryFrame {
  readonly assetId: string;
  readonly filename: string;
  readonly headline?: string;
  readonly caption?: string;
  readonly capturedAt?: string;
  readonly previewKey?: string;
}

export interface OpenedDelivery {
  readonly submissionId: string;
  readonly packageName: string;
  readonly headline?: string;
  readonly creditLine?: string;
  readonly terms?: string;
  readonly restrictions?: string;
  readonly embargoUntil?: string;
  readonly expiresAt: string;
  readonly assets: readonly DeliveryFrame[];
}

export async function openDelivery(
  token: string,
  headers: Headers,
): Promise<OpenedDelivery | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_delivery", {
    delivery_token: token,
    caller_ip: callerAddress(headers),
    caller_agent: callerAgent(headers),
  });

  if (error) throw new Error(`Could not open the delivery: ${error.message}`);
  const row = (data ?? [])[0];
  if (!row) return null;

  const assets = await supabase.rpc("delivery_assets", { delivery_token: token });

  return {
    submissionId: row.submission_id as string,
    packageName: row.package_name as string,
    headline: (row.headline as string | null) ?? undefined,
    creditLine: (row.credit_line as string | null) ?? undefined,
    terms: (row.terms as string | null) ?? undefined,
    restrictions: (row.restrictions as string | null) ?? undefined,
    embargoUntil: (row.embargo_until as string | null) ?? undefined,
    expiresAt: row.expires_at as string,
    assets: (assets.data ?? []).map((asset: Record<string, unknown>) => ({
      assetId: asset.asset_id as string,
      filename: asset.canonical_filename as string,
      headline: (asset.headline as string | null) ?? undefined,
      caption: (asset.caption as string | null) ?? undefined,
      capturedAt: (asset.captured_at as string | null) ?? undefined,
      previewKey: (asset.preview_key as string | null) ?? undefined,
    })),
  };
}
