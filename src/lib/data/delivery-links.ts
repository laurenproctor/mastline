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
  /** Who the link was made for. Stored here, never rendered into the URL. */
  readonly recipientLabel?: string;
  /** An internal contact or buyer-contact id. Also never put in the URL. */
  readonly contactReference?: string;
  /** The attribution snapshot taken when the link was made. */
  readonly customParameters: Readonly<Record<string, string>>;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  /** Set when the photographer recorded passing this link on. */
  readonly sharedAt?: string;
  readonly sharedBy?: string;
  readonly createdAt: string;
  /** A plain-text note shown on the delivery page. Not an email. */
  readonly deliveryNote?: string;
  /** Whether this link offers the full-resolution files at all. */
  readonly allowFullResolution: boolean;
  /** Whether the frames wait for the terms to be accepted. */
  readonly requireAcceptanceToView: boolean;
}

const DELIVERY_COLUMNS =
  "id, token, recipient_label, contact_reference, custom_parameters, expires_at, revoked_at, shared_at, shared_by, created_at, delivery_note, allow_full_resolution, require_acceptance_to_view";

/**
 * A stored parameter snapshot, defended on the way out as well as in.
 *
 * The database already refuses a dangerous key, but this is the boundary
 * between a JSON column and a JavaScript object, and a value arriving from
 * anywhere other than the constraint-checked column should not be able to reach
 * `Object.prototype` on the strength of having been in a database once.
 */
function toParameters(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safe = Object.create(null) as Record<string, string>;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (typeof entry === "string") safe[key] = entry;
  }
  return { ...safe };
}

function toDeliveryLink(row: Record<string, unknown>): DeliveryLink {
  return {
    id: row.id as string,
    token: row.token as string,
    recipientLabel: (row.recipient_label as string | null) ?? undefined,
    contactReference: (row.contact_reference as string | null) ?? undefined,
    customParameters: toParameters(row.custom_parameters),
    expiresAt: row.expires_at as string,
    revokedAt: (row.revoked_at as string | null) ?? undefined,
    sharedAt: (row.shared_at as string | null) ?? undefined,
    sharedBy: (row.shared_by as string | null) ?? undefined,
    createdAt: row.created_at as string,
    deliveryNote: (row.delivery_note as string | null) ?? undefined,
    allowFullResolution: row.allow_full_resolution !== false,
    requireAcceptanceToView: row.require_acceptance_to_view === true,
  };
}

export interface AccessEvent {
  readonly kind: "opened" | "downloaded" | "refused" | "accepted";
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
    .select(DELIVERY_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load delivery links: ${error.message}`);
  return (data ?? []).map((row) => toDeliveryLink(row as Record<string, unknown>));
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
 * Create a link for one recipient.
 *
 * The token never leaves this function in any form but the row: it is not
 * derived from the submission, so knowing one link tells you nothing about
 * another. A submission can carry as many of these as the photographer needs --
 * one per desk, agency, or channel -- and each accumulates its own opens,
 * sessions, views, acceptances, and downloads, which is the entire point of
 * making them separate rather than reusing one.
 *
 * Creating a link sends nothing and claims nothing. The submission stays
 * `queued`, `sent_at` stays null, the package stays `approved`, and the shoot
 * is untouched. All of that changes only when a person says they passed it on,
 * or when somebody opens it.
 *
 * The package has to be approved first. A link into a package that can still be
 * edited would be a link whose contents could change under the recipient.
 */
export async function createDelivery(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  submissionId: Id;
  recipientLabel?: string;
  contactReference?: string;
  customParameters?: Readonly<Record<string, string>>;
  windowDays: DeliveryWindowDays;
  /** Plain-text note shown on the delivery page. Trimmed; 500 characters. */
  deliveryNote?: string;
  /** Defaults to true: today's behavior. */
  allowFullResolution?: boolean;
  /** Defaults to false: today's behavior. */
  requireAcceptanceToView?: boolean;
  now?: Date;
}): Promise<DeliveryLink> {
  const supabase = input.client ?? (await createClient());
  const now = input.now ?? new Date();
  const token = newDeliveryToken();

  /*
   * Read the submission through the caller's own client, so row level security
   * decides whether they may see it at all. This is what makes a forged
   * submission id from another workspace come back as "not found" rather than
   * as a link. The composite foreign key in the database is the second line:
   * even a caller that bypasses RLS cannot attach a link to a submission in a
   * different organization.
   */
  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    /*
     * The relationship is named explicitly because there are now two foreign
     * keys from submissions to packages -- the original single-column one and
     * the composite `(organization_id, package_id)` that enforces they share an
     * organization -- and PostgREST refuses to guess between them.
     */
    .select("id, package_id, packages!submissions_package_id_fkey(status)")
    .eq("organization_id", input.organizationId)
    .eq("id", input.submissionId)
    .maybeSingle();

  if (submissionError) {
    throw new Error(`Could not read the submission: ${submissionError.message}`);
  }
  if (!submission) throw new Error("That submission could not be found in this workspace.");

  const packageStatus = (submission.packages as unknown as { status: string } | null)?.status;
  if (!packageStatus || !["approved", "sending", "delivered"].includes(packageStatus)) {
    throw new Error("Approve the package before creating a delivery link for it.");
  }

  const { data, error } = await supabase
    .from("submission_deliveries")
    .insert({
      organization_id: input.organizationId,
      submission_id: input.submissionId,
      token,
      recipient_label: input.recipientLabel ?? null,
      contact_reference: input.contactReference ?? null,
      custom_parameters: input.customParameters ?? {},
      expires_at: expiryFrom(input.windowDays, now).toISOString(),
      created_by: input.actorId,
      delivery_note: input.deliveryNote?.trim().slice(0, 500) || null,
      allow_full_resolution: input.allowFullResolution ?? true,
      require_acceptance_to_view: input.requireAcceptanceToView ?? false,
    })
    .select(DELIVERY_COLUMNS)
    .single();

  if (error || !data) throw new Error(`Could not create the link: ${error?.message}`);

  await recordEventWith(supabase, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    entityType: "submission",
    entityId: input.submissionId,
    action: "delivery.link_created",
    data: {
      summary: `Delivery link created for ${input.recipientLabel ?? "a recipient"}, open ${input.windowDays} days. Nothing sent.`,
      window_days: input.windowDays,
      delivery_id: data.id as string,
    },
  });

  return toDeliveryLink(data as Record<string, unknown>);
}

/**
 * One tracked link per recipient, idempotently.
 *
 * The flow's "Create private delivery" must survive a double-click, a retry
 * after a half-failure, and a refresh, and there is no schema slot for a
 * client idempotency key -- so the link is addressed deterministically, the
 * same way the draft package is: the earliest live, unshared link on this
 * submission made for this recipient IS the delivery, and asking again
 * returns it. Two racing calls may both insert; both re-read, agree on the
 * earliest, and the loser withdraws its own untouched insert.
 *
 * A link that was already shared, withdrawn, or has expired is never reused:
 * asking again after any of those is a new delivery on purpose -- that is
 * exactly what "Share with another recipient" does.
 */
export async function createPrivateDeliveryLink(
  input: Parameters<typeof createDelivery>[0],
): Promise<{ link: DeliveryLink; reused: boolean }> {
  const supabase = input.client ?? (await createClient());
  const now = input.now ?? new Date();
  const label = input.recipientLabel?.trim() || null;

  const earliestMatching = async (): Promise<DeliveryLink | null> => {
    let query = supabase
      .from("submission_deliveries")
      .select(DELIVERY_COLUMNS)
      .eq("organization_id", input.organizationId)
      .eq("submission_id", input.submissionId)
      .is("revoked_at", null)
      .is("shared_at", null)
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1);
    query = label === null ? query.is("recipient_label", null) : query.eq("recipient_label", label);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Could not look for the link: ${error.message}`);
    return data ? toDeliveryLink(data as Record<string, unknown>) : null;
  };

  const existing = await earliestMatching();
  if (existing) return { link: existing, reused: true };

  const created = await createDelivery({ ...input, client: supabase, now });

  const winner = await earliestMatching();
  if (winner && winner.id !== created.id) {
    // A concurrent call made the link first. Ours was never handed to anyone;
    // withdraw it so the submission carries one delivery per recipient.
    await revokeDelivery({
      client: supabase,
      organizationId: input.organizationId,
      actorId: input.actorId,
      submissionId: input.submissionId,
      deliveryId: created.id,
    });
    return { link: winner, reused: true };
  }

  return { link: created, reused: false };
}

/**
 * The photographer recording that they passed a specific link on.
 *
 * This is the only thing in Mastline that will say a package was sent, and it
 * says so because a person pressed a button meaning "I have shared this",
 * not because a row was inserted. Copying the link does not reach here.
 *
 * The whole lifecycle move happens inside one security-definer function so it
 * cannot half-succeed: the link is stamped, the submission becomes `sent`, the
 * package moves to `sending` -- not `delivered`, because nothing has been
 * delivered until somebody opens it -- and the shoot becomes `dispatched`.
 *
 * Idempotent by construction. Pressing it twice is one share, and the second
 * press returns the first timestamp rather than moving it.
 */
export async function markDeliveryShared(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  submissionId: Id;
  deliveryId: Id;
}): Promise<{ sharedAt: string; alreadyShared: boolean }> {
  const supabase = input.client ?? (await createClient());

  /*
   * Re-resolve the link against the workspace before doing anything with it.
   * The function below checks the caller's role in the link's own organization
   * too, but a delivery id from another workspace should come back as "not
   * found" here rather than as a permission error there -- the two answers tell
   * a caller different things, and only one of them is any of their business.
   */
  const { data: link, error: linkError } = await supabase
    .from("submission_deliveries")
    .select("id, submission_id")
    .eq("organization_id", input.organizationId)
    .eq("submission_id", input.submissionId)
    .eq("id", input.deliveryId)
    .maybeSingle();

  if (linkError) throw new Error(`Could not read the delivery link: ${linkError.message}`);
  if (!link) throw new Error("That delivery link could not be found on this submission.");

  const { data, error } = await supabase.rpc("mark_delivery_shared", {
    target_delivery: input.deliveryId,
  });

  if (error) throw new Error(`Could not record the share: ${error.message}`);
  const row = (data ?? [])[0] as { shared_at: string; already_shared: boolean } | undefined;
  if (!row) throw new Error("Could not record the share.");

  return { sharedAt: row.shared_at, alreadyShared: row.already_shared };
}

/** Withdraw a link. The row stays, because the offer having existed is history. */
export async function revokeDelivery(input: {
  /** The caller's client, so row level security applies. Every other function
   *  in this module takes one; this was the only one that always built its own,
   *  which made it the only one that could not be exercised as a real user. */
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  submissionId: Id;
  deliveryId: Id;
}): Promise<void> {
  const supabase = input.client ?? (await createClient());
  const { error } = await supabase
    .from("submission_deliveries")
    .update({ revoked_at: new Date().toISOString(), revoked_by: input.actorId })
    .eq("organization_id", input.organizationId)
    .eq("submission_id", input.submissionId)
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
 *
 * Every frame comes from the submission's approved snapshot: the filename,
 * headline, caption, people, and capture time as they stood when the
 * photographer approved them. Nothing here reads the live asset, the current
 * package membership, or whichever derivative is preferred today.
 */
export interface DeliveryFrame {
  readonly assetId: string;
  readonly filename: string;
  readonly headline?: string;
  readonly caption?: string;
  /** Who is in the frame, as the photographer recorded it at approval. */
  readonly people: readonly string[];
  readonly capturedAt?: string;
  /**
   * Whether the exact approved object can be rendered as a preview. A frame
   * whose approved object is a RAW original has none; nothing else is
   * substituted for it. No storage location ever reaches this type.
   */
  readonly hasPreview: boolean;
}

export interface OpenedDelivery {
  /** Set once a recipient has agreed to the terms as they were shown. */
  readonly acceptedAt?: string;
  readonly acceptedBy?: string;
  readonly submissionId: string;
  readonly packageName: string;
  readonly headline?: string;
  readonly creditLine?: string;
  readonly terms?: string;
  readonly restrictions?: string;
  readonly embargoUntil?: string;
  readonly expiresAt: string;
  /** The photographer's plain-text note to this recipient, when one exists. */
  readonly deliveryNote?: string;
  /** Whether this link offers full-resolution downloads at all. */
  readonly allowFullResolution: boolean;
  /** Whether the frames are withheld until the terms are accepted. */
  readonly requireAcceptanceToView: boolean;
  /**
   * How many frames the link carries. With the acceptance gate on and no
   * acceptance yet, `assets` is empty while this stays the honest count.
   */
  readonly assetCount: number;
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
    acceptedAt: (row.accepted_at as string | null) ?? undefined,
    acceptedBy: (row.accepted_by as string | null) ?? undefined,
    deliveryNote: (row.delivery_note as string | null) ?? undefined,
    allowFullResolution: row.allow_full_resolution !== false,
    requireAcceptanceToView: row.require_acceptance_to_view === true,
    assetCount: Number(row.asset_count ?? 0),
    assets: (assets.data ?? []).map((asset: Record<string, unknown>) => ({
      assetId: asset.asset_id as string,
      filename: asset.canonical_filename as string,
      headline: (asset.headline as string | null) ?? undefined,
      caption: (asset.caption as string | null) ?? undefined,
      people: Array.isArray(asset.people)
        ? (asset.people as unknown[]).filter((p): p is string => typeof p === "string")
        : [],
      capturedAt: (asset.captured_at as string | null) ?? undefined,
      hasPreview: asset.has_preview === true,
    })),
  };
}

/**
 * A recipient agreeing to the terms.
 *
 * Anonymous, like everything else on this surface, and the same deliberate
 * vagueness on failure: a name too short, a withdrawn link, and a token that
 * never existed all come back as "not accepted", because the person holding a
 * bad link should not learn which kind of bad it is.
 */
export async function acceptDelivery(
  token: string,
  name: string,
  headers: Headers,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_delivery", {
    delivery_token: token,
    accepted_by_name: name,
    caller_ip: callerAddress(headers),
    caller_agent: callerAgent(headers),
  });

  if (error) throw new Error(`Could not record the acceptance: ${error.message}`);
  return ((data ?? [])[0]?.accepted_at as string | undefined) ?? null;
}

export interface AcceptanceRecord {
  /** Which recipient's link this yes came through. */
  readonly deliveryId: string;
  readonly acceptedBy: string;
  readonly acceptedAt: string;
  readonly ipAddress?: string;
  readonly termsSnapshot?: string;
}

/** What the photographer sees: who said yes, when, and to what. */
export async function listAcceptances(
  organizationId: Id,
  submissionId: Id,
  client?: SupabaseClient,
): Promise<readonly AcceptanceRecord[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("delivery_acceptances")
    .select("delivery_id, accepted_by, accepted_at, ip_address, terms_snapshot")
    .eq("organization_id", organizationId)
    .eq("submission_id", submissionId)
    .order("accepted_at", { ascending: false });

  if (error) throw new Error(`Could not load the acceptance: ${error.message}`);
  return (data ?? []).map((row) => ({
    deliveryId: row.delivery_id as string,
    acceptedBy: row.accepted_by as string,
    acceptedAt: row.accepted_at as string,
    ipAddress: (row.ip_address as string | null) ?? undefined,
    termsSnapshot: (row.terms_snapshot as string | null) ?? undefined,
  }));
}

/**
 * Every delivery link in a workspace, for the export.
 *
 * A photographer's record of who they sent work to, and what came back, is
 * theirs. The constitution says they must be able to take their assets,
 * metadata, financial records, and history with them, and once a delivery link
 * carries the recipient, the attribution, and the engagement, it is part of
 * that history rather than an implementation detail of a screen.
 */
export async function listAllDeliveries(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<readonly (DeliveryLink & { submissionId: string })[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("submission_deliveries")
    .select(`submission_id, ${DELIVERY_COLUMNS}`)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load delivery links: ${error.message}`);
  return (data ?? []).map((row) => ({
    ...toDeliveryLink(row as Record<string, unknown>),
    submissionId: (row as Record<string, unknown>).submission_id as string,
  }));
}

/**
 * Change the recipient or the attribution on a link that has not gone out yet.
 *
 * The window is narrow on purpose. Before the photographer records sharing it,
 * a link is a draft and a typo in a campaign name is worth fixing. After, the
 * attribution is part of the evidence -- it is what the desk was told -- and
 * rewriting it would let a link be re-labelled to match whatever outcome turned
 * up. The database refuses the second case whatever this function does; the
 * check here exists so an operator gets a sentence rather than a constraint
 * violation.
 *
 * A withdrawn link is not editable either. It may have been opened before it
 * was withdrawn, and its record has to keep saying what it said then.
 */
export async function updateDeliveryAttribution(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  submissionId: Id;
  deliveryId: Id;
  recipientLabel?: string;
  contactReference?: string;
  customParameters: Readonly<Record<string, string>>;
}): Promise<void> {
  const supabase = input.client ?? (await createClient());

  const { data: link, error: readError } = await supabase
    .from("submission_deliveries")
    .select("id, shared_at, revoked_at")
    .eq("organization_id", input.organizationId)
    .eq("submission_id", input.submissionId)
    .eq("id", input.deliveryId)
    .maybeSingle();

  if (readError) throw new Error(`Could not read the delivery link: ${readError.message}`);
  if (!link) throw new Error("That delivery link could not be found on this submission.");
  if (link.shared_at) {
    throw new Error(
      "This link has been marked as shared, so its recipient and attribution are part of the record. Withdraw it and create a new one instead.",
    );
  }
  if (link.revoked_at) throw new Error("That link has been withdrawn.");

  const { error } = await supabase
    .from("submission_deliveries")
    .update({
      recipient_label: input.recipientLabel ?? null,
      contact_reference: input.contactReference ?? null,
      custom_parameters: input.customParameters,
    })
    .eq("organization_id", input.organizationId)
    .eq("id", input.deliveryId);

  if (error) throw new Error(`Could not update the link: ${error.message}`);

  await recordEventWith(supabase, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    entityType: "submission",
    entityId: input.submissionId,
    action: "delivery.link_updated",
    data: {
      summary: "Delivery link attribution changed before it was shared",
      delivery_id: input.deliveryId,
    },
  });
}
