import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Asset, AssetVersion, CaptionRevision, Id } from "../domain";
import type { AssetMetadataInput } from "../validation";
import { money } from "../money";
import { createClient } from "../supabase/server";
import { recordEvent } from "./activity";

/**
 * Assets, their versions, and their caption history.
 *
 * Lifetime earnings come from the asset_lifetime_earnings view rather than a
 * stored counter, so the figure cannot drift from the allocations that produced
 * it.
 */

const ASSET_COLUMNS =
  "id, organization_id, shoot_id, status, asset_kind, canonical_filename, captured_at, headline, caption, subjects, location_name, keywords, creator_name, copyright_notice, copyright_owner, credit_line, usage_restrictions, selected, rating, currency, created_at, updated_at";

const VERSION_COLUMNS =
  "id, asset_id, version_kind, storage_bucket, object_key, sha256, bytes, mime_type, width, height, created_at";

interface AssetRow {
  id: string;
  organization_id: string;
  shoot_id: string | null;
  status: string;
  asset_kind: string;
  canonical_filename: string;
  captured_at: string | null;
  headline: string | null;
  caption: string | null;
  subjects: unknown;
  location_name: string | null;
  keywords: unknown;
  creator_name: string | null;
  copyright_notice: string | null;
  credit_line: string | null;
  usage_restrictions: string | null;
  selected: boolean;
  rating: number | null;
  currency: string;
}

const list = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);

function toAsset(
  row: AssetRow,
  versions: readonly AssetVersion[],
  captionHistory: readonly CaptionRevision[],
  earningsMinor: number,
): Asset {
  return {
    id: row.id,
    organizationId: row.organization_id,
    shootId: row.shoot_id ?? undefined,
    status: row.status as Asset["status"],
    canonicalFilename: row.canonical_filename,
    capturedAt: row.captured_at ?? undefined,
    headline: row.headline ?? undefined,
    caption: row.caption ?? undefined,
    subjects: list(row.subjects),
    locationName: row.location_name ?? undefined,
    keywords: list(row.keywords),
    creatorName: row.creator_name ?? undefined,
    copyrightNotice: row.copyright_notice ?? undefined,
    creditLine: row.credit_line ?? undefined,
    usageRestrictions: row.usage_restrictions ?? undefined,
    selected: row.selected,
    rating: row.rating ?? undefined,
    versions,
    captionHistory,
    lifetimeEarnings: money(earningsMinor, (row.currency as "USD") ?? "USD"),
  };
}

function toVersion(row: Record<string, unknown>): AssetVersion {
  return {
    id: row.id as string,
    assetId: row.asset_id as string,
    versionKind: row.version_kind as AssetVersion["versionKind"],
    storageBucket: row.storage_bucket as AssetVersion["storageBucket"],
    objectKey: row.object_key as string,
    sha256: row.sha256 as string,
    bytes: Number(row.bytes),
    mimeType: row.mime_type as string,
    width: (row.width as number | null) ?? undefined,
    height: (row.height as number | null) ?? undefined,
    createdAt: row.created_at as string,
  };
}

export async function listAssets(
  organizationId: Id,
  filter: { shootId?: Id; selectedOnly?: boolean } = {},
  client?: SupabaseClient,
): Promise<readonly Asset[]> {
  const supabase = client ?? (await createClient());

  let query = supabase
    .from("assets")
    .select(ASSET_COLUMNS)
    .eq("organization_id", organizationId)
    .neq("status", "tombstoned")
    .order("captured_at", { ascending: true, nullsFirst: false })
    .order("canonical_filename", { ascending: true });

  if (filter.shootId) query = query.eq("shoot_id", filter.shootId);
  if (filter.selectedOnly) query = query.eq("selected", true);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load assets: ${error.message}`);

  const rows = (data ?? []) as unknown as AssetRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [versions, earnings] = await Promise.all([
    supabase.from("asset_versions").select(VERSION_COLUMNS).in("asset_id", ids),
    supabase
      .from("asset_lifetime_earnings")
      .select("asset_id, lifetime_earnings_minor")
      .in("asset_id", ids),
  ]);

  const versionsByAsset = new Map<string, AssetVersion[]>();
  for (const row of versions.data ?? []) {
    const version = toVersion(row as Record<string, unknown>);
    const bucket = versionsByAsset.get(version.assetId) ?? [];
    bucket.push(version);
    versionsByAsset.set(version.assetId, bucket);
  }

  const earningsByAsset = new Map<string, number>(
    (earnings.data ?? []).map((row) => [
      row.asset_id as string,
      Number(row.lifetime_earnings_minor ?? 0),
    ]),
  );

  return rows.map((row) =>
    toAsset(row, versionsByAsset.get(row.id) ?? [], [], earningsByAsset.get(row.id) ?? 0),
  );
}

export async function getAsset(
  organizationId: Id,
  assetId: Id,
  client?: SupabaseClient,
): Promise<Asset | null> {
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase
    .from("assets")
    .select(ASSET_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", assetId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the asset: ${error.message}`);
  if (!data) return null;

  const [versions, revisions, earnings] = await Promise.all([
    supabase
      .from("asset_versions")
      .select(VERSION_COLUMNS)
      .eq("asset_id", assetId)
      .order("created_at", { ascending: true }),
    listCaptionHistory(organizationId, assetId, supabase),
    supabase
      .from("asset_lifetime_earnings")
      .select("lifetime_earnings_minor")
      .eq("asset_id", assetId)
      .maybeSingle(),
  ]);

  return toAsset(
    data as unknown as AssetRow,
    (versions.data ?? []).map((row) => toVersion(row as Record<string, unknown>)),
    revisions,
    Number(earnings.data?.lifetime_earnings_minor ?? 0),
  );
}

export async function listCaptionHistory(
  organizationId: Id,
  assetId: Id,
  client?: SupabaseClient,
): Promise<readonly CaptionRevision[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("asset_caption_revisions")
    .select("id, asset_id, headline, caption, edited_by, created_at")
    .eq("organization_id", organizationId)
    .eq("asset_id", assetId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load caption history: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    assetId: row.asset_id as string,
    headline: (row.headline as string | null) ?? undefined,
    caption: (row.caption as string | null) ?? undefined,
    editedBy: row.edited_by as string,
    editedAt: row.created_at as string,
  }));
}

/**
 * Edit an asset's current metadata.
 *
 * The previous values are written to the append-only revision log FIRST. If
 * that write fails the edit is abandoned, because an edit that destroys history
 * is worse than an edit that does not happen. The log is only written when
 * something described by it actually changed.
 */
export async function updateAssetMetadata(input: {
  organizationId: Id;
  actorId: Id;
  assetId: Id;
  metadata: AssetMetadataInput;
}): Promise<void> {
  const { organizationId, actorId, assetId, metadata } = input;
  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("assets")
    .select("headline, caption, subjects, keywords, usage_restrictions")
    .eq("organization_id", organizationId)
    .eq("id", assetId)
    .maybeSingle();

  if (readError) throw new Error(`Could not read the asset: ${readError.message}`);
  if (!current) throw new Error("That asset could not be found in this workspace.");

  const describedFieldsChanged =
    (current.headline ?? undefined) !== metadata.headline ||
    (current.caption ?? undefined) !== metadata.caption ||
    list(current.subjects).join("|") !== metadata.subjects.join("|") ||
    list(current.keywords).join("|") !== metadata.keywords.join("|") ||
    (current.usage_restrictions ?? undefined) !== metadata.usageRestrictions;

  if (describedFieldsChanged) {
    const { error: historyError } = await supabase.from("asset_caption_revisions").insert({
      organization_id: organizationId,
      asset_id: assetId,
      headline: current.headline,
      caption: current.caption,
      subjects: current.subjects ?? [],
      keywords: current.keywords ?? [],
      usage_restrictions: current.usage_restrictions,
      edited_by: actorId,
    });
    if (historyError) {
      throw new Error(
        `The edit was not saved because the previous version could not be preserved: ${historyError.message}`,
      );
    }
  }

  const { error } = await supabase
    .from("assets")
    .update({
      headline: metadata.headline ?? null,
      caption: metadata.caption ?? null,
      subjects: metadata.subjects,
      location_name: metadata.locationName ?? null,
      keywords: metadata.keywords,
      credit_line: metadata.creditLine ?? null,
      copyright_notice: metadata.copyrightNotice ?? null,
      usage_restrictions: metadata.usageRestrictions ?? null,
    })
    .eq("organization_id", organizationId)
    .eq("id", assetId);

  if (error) throw new Error(`Could not save the metadata: ${error.message}`);

  if (describedFieldsChanged) {
    await recordEvent({
      organizationId,
      actorId,
      entityType: "asset",
      entityId: assetId,
      action: "asset.metadata_edited",
      data: { summary: "Asset metadata edited" },
    });
  }
}

/**
 * Apply metadata across many assets, merging rather than replacing.
 *
 * Only the fields the caller supplied are written; anything absent keeps its
 * existing value. A bulk action that blanked untouched fields would quietly
 * destroy work across a whole card.
 */
export async function applyMetadataToMany(input: {
  organizationId: Id;
  actorId: Id;
  assetIds: readonly Id[];
  metadata: AssetMetadataInput;
}): Promise<{ updated: number }> {
  const { organizationId, actorId, assetIds, metadata } = input;
  let updated = 0;

  for (const assetId of assetIds) {
    const current = await getAsset(organizationId, assetId);
    if (!current) continue;

    await updateAssetMetadata({
      organizationId,
      actorId,
      assetId,
      metadata: {
        headline: metadata.headline ?? current.headline,
        caption: metadata.caption ?? current.caption,
        subjects: metadata.subjects.length > 0 ? metadata.subjects : [...current.subjects],
        locationName: metadata.locationName ?? current.locationName,
        keywords: metadata.keywords.length > 0 ? metadata.keywords : [...current.keywords],
        creditLine: metadata.creditLine ?? current.creditLine,
        copyrightNotice: metadata.copyrightNotice ?? current.copyrightNotice,
        usageRestrictions: metadata.usageRestrictions ?? current.usageRestrictions,
      },
    });
    updated += 1;
  }

  return { updated };
}

export async function setSelection(input: {
  organizationId: Id;
  actorId: Id;
  assetIds: readonly Id[];
  selected: boolean;
}): Promise<{ updated: number }> {
  const { organizationId, actorId, assetIds, selected } = input;
  if (assetIds.length === 0) return { updated: 0 };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .update({ selected })
    .eq("organization_id", organizationId)
    .in("id", assetIds)
    .select("id");

  if (error) throw new Error(`Could not change the selection: ${error.message}`);

  await recordEvent({
    organizationId,
    actorId,
    entityType: "asset",
    entityId: assetIds.length === 1 ? assetIds[0] : undefined,
    action: selected ? "asset.selected" : "asset.deselected",
    data: {
      summary: `${data?.length ?? 0} ${selected ? "selected" : "deselected"}`,
      count: data?.length ?? 0,
    },
  });

  return { updated: data?.length ?? 0 };
}

export async function setRating(input: {
  organizationId: Id;
  actorId: Id;
  assetId: Id;
  rating: number | null;
}): Promise<void> {
  const { organizationId, assetId, rating } = input;
  if (rating !== null && (rating < 0 || rating > 5)) {
    throw new RangeError("A rating must be between 0 and 5.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("assets")
    .update({ rating })
    .eq("organization_id", organizationId)
    .eq("id", assetId);

  if (error) throw new Error(`Could not set the rating: ${error.message}`);
}

/**
 * Tombstone an asset.
 *
 * Originals are never destroyed. The record is marked, the file is retained,
 * and the trigger stamps who did it and when.
 */
export async function tombstoneAsset(input: {
  organizationId: Id;
  actorId: Id;
  assetId: Id;
  reason: string;
}): Promise<void> {
  const { organizationId, actorId, assetId, reason } = input;
  const supabase = await createClient();

  const { error } = await supabase
    .from("assets")
    .update({ status: "tombstoned", tombstone_reason: reason, selected: false })
    .eq("organization_id", organizationId)
    .eq("id", assetId);

  if (error) throw new Error(`Could not tombstone the asset: ${error.message}`);

  await recordEvent({
    organizationId,
    actorId,
    entityType: "asset",
    entityId: assetId,
    action: "asset.tombstoned",
    data: { summary: `Asset tombstoned: ${reason}`, reason },
  });
}
