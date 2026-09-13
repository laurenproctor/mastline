import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id } from "../domain";
import { isSha256, safeFilenameSegment } from "../validation";
import { recordEventWith } from "./activity";
import { ensureMetadataRecord } from "./asset-metadata";

/**
 * Importing files into a shoot.
 *
 * The sequence is deliberate, and follows the storage contract in
 * docs/DATA_MODEL.md: uploads are staged, hashed, and promoted only after the
 * record exists.
 *
 *   1. The browser hashes the bytes and uploads them to a staging key.
 *   2. registerImport() creates the asset and its immutable original version.
 *   3. Only then is the object moved to its canonical key.
 *
 * If step 2 fails, the staged object is removed and nothing authoritative was
 * ever written. If step 3 fails, the transaction is unwound rather than leaving
 * a version row pointing at a key that holds nothing.
 */

export const STAGING_PREFIX = "_staging";

export interface ImportFacts {
  readonly filename: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly mimeType: string;
  readonly capturedAt?: string;
  readonly width?: number;
  readonly height?: number;
  /** Where the browser put the bytes, relative to the originals bucket. */
  readonly stagingKey: string;
}

export interface ImportedAsset {
  readonly assetId: Id;
  readonly filename: string;
  readonly objectKey: string;
  /** True when the same bytes already exist in this workspace. */
  readonly duplicateOf?: Id;
}

export function stagingKeyFor(organizationId: Id, token: string): string {
  return `${organizationId}/${STAGING_PREFIX}/${token}`;
}

/** The key an original ends up at once promoted. Exported so tests can assert it. */
export function canonicalObjectKey(
  organizationId: Id,
  shootId: Id,
  sha256: string,
  filename: string,
): string {
  return canonicalKeyFor(organizationId, shootId, sha256, filename);
}

function canonicalKeyFor(
  organizationId: Id,
  shootId: Id,
  sha256: string,
  filename: string,
): string {
  // The digest prefix keeps two files of the same name from colliding while
  // leaving the human name readable in a storage listing.
  return `${organizationId}/${shootId}/${sha256.slice(0, 12)}-${safeFilenameSegment(filename)}`;
}

/** Strip the extension so the canonical filename reads like a frame number. */
function toCanonicalFilename(filename: string): string {
  return safeFilenameSegment(filename).replace(/\.[^.]+$/, "") || "untitled";
}

/**
 * Look for the same bytes already in this workspace.
 *
 * Reported as information, never acted on automatically: the same frame may
 * legitimately belong to two shoots, and deciding that is the operator's call.
 */
async function findDuplicate(
  supabase: SupabaseClient,
  organizationId: Id,
  sha256: string,
): Promise<Id | undefined> {
  const { data } = await supabase
    .from("asset_versions")
    .select("asset_id")
    .eq("organization_id", organizationId)
    .eq("sha256", sha256)
    .limit(1)
    .maybeSingle();
  return (data?.asset_id as string | undefined) ?? undefined;
}

/**
 * Register one staged upload as an asset with an immutable original version.
 *
 * The metadata defaults are inherited from the shoot so a fact is entered once:
 * the creator, credit, and copyright come from the workspace, and the location
 * from the shoot brief. Each can be overridden per asset afterwards.
 */
export async function registerImport(input: {
  /** The caller's client, so row level security applies to every step. */
  supabase: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  shootId: Id;
  facts: ImportFacts;
  defaults: {
    creatorName?: string;
    creditLine?: string;
    copyrightNotice?: string;
    locationName?: string;
    usageRestrictions?: string;
  };
}): Promise<ImportedAsset> {
  const { supabase, organizationId, actorId, shootId, facts, defaults } = input;

  if (!isSha256(facts.sha256)) {
    throw new Error("The file digest was not a valid SHA-256 hex string.");
  }
  if (facts.bytes <= 0) {
    throw new Error("An imported file must have a size.");
  }
  if (!facts.stagingKey.startsWith(`${organizationId}/${STAGING_PREFIX}/`)) {
    throw new Error("That staging location does not belong to this workspace.");
  }

  const duplicateOf = await findDuplicate(supabase, organizationId, facts.sha256);
  const objectKey = canonicalKeyFor(organizationId, shootId, facts.sha256, facts.filename);

  // 1. The record first, so nothing authoritative points at unowned bytes.
  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .insert({
      organization_id: organizationId,
      shoot_id: shootId,
      status: "ingesting",
      asset_kind: facts.mimeType.startsWith("video/") ? "video" : "image",
      canonical_filename: toCanonicalFilename(facts.filename),
      captured_at: facts.capturedAt ?? null,
      location_name: defaults.locationName ?? null,
      creator_name: defaults.creatorName ?? null,
      credit_line: defaults.creditLine ?? null,
      copyright_notice: defaults.copyrightNotice ?? null,
      usage_restrictions: defaults.usageRestrictions ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (assetError || !asset) {
    await supabase.storage.from("originals").remove([facts.stagingKey]);
    throw new Error(`Could not create the asset record: ${assetError?.message}`);
  }

  const assetId = asset.id as string;

  const { error: versionError } = await supabase.from("asset_versions").insert({
    organization_id: organizationId,
    asset_id: assetId,
    version_kind: "original",
    storage_bucket: "originals",
    object_key: objectKey,
    sha256: facts.sha256,
    bytes: facts.bytes,
    mime_type: facts.mimeType,
    width: facts.width ?? null,
    height: facts.height ?? null,
    technical_metadata: {
      original_filename: facts.filename,
      imported_at: new Date().toISOString(),
    },
    created_by: actorId,
  });

  if (versionError) {
    await supabase.from("assets").delete().eq("id", assetId);
    await supabase.storage.from("originals").remove([facts.stagingKey]);
    throw new Error(`Could not record the original: ${versionError.message}`);
  }

  // 2. Promote the bytes now that the record owns them.
  const { error: moveError } = await supabase.storage
    .from("originals")
    .move(facts.stagingKey, objectKey);

  if (moveError) {
    // asset_versions is append-only, so the asset row cannot simply be deleted
    // while a version points at it. The purge routine is the one path that can
    // unwind this, and it is exactly the situation it exists for.
    // The RPC is service-role only, so this best-effort unwind will not run for
    // an ordinary caller. The asset is left in `ingesting` with no reachable
    // bytes, which is visible and repairable, rather than silently broken.
    try {
      await supabase.rpc("purge_asset_admin", { target_asset: assetId });
    } catch {
      // Nothing more to do here; the failure is reported below.
    }
    await supabase.storage.from("originals").remove([facts.stagingKey]);
    throw new Error(`Could not store the original: ${moveError.message}`);
  }

  const { error: statusError } = await supabase
    .from("assets")
    .update({ status: "active" })
    .eq("organization_id", organizationId)
    .eq("id", assetId);

  if (statusError) {
    throw new Error(
      `The file was imported but its status could not be set to active: ${statusError.message}`,
    );
  }

  // 3. The metadata record, seeded with what the container already told us.
  //
  // Created here rather than lazily, so a photograph is never in a state where
  // the panel has nothing to show and the queue has nothing to write to -- and
  // created HERE because every import path funnels through this function: the
  // shoot dropzone, the create-shoot form, and the resumable import queue all
  // land on the same insert. The EXIF pass and the generation run both come
  // later and both expect this row.
  //
  // A failure is reported and not thrown: the original is already stored and
  // its version row is append-only, so unwinding the import over a missing
  // metadata row would destroy more than it repaired. The record is recreated
  // by the job runner, which upserts.
  try {
    await ensureMetadataRecord({
      supabase,
      organizationId,
      assetId,
      seed: {
        originalFilename: facts.filename,
        mimeType: facts.mimeType,
        fileBytes: facts.bytes,
        width: facts.width,
        height: facts.height,
        capturedAt: facts.capturedAt,
        checksumSha256: facts.sha256,
      },
    });
  } catch (error) {
    console.warn(
      `Imported ${facts.filename} but could not create its metadata record: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "asset",
    entityId: assetId,
    action: "asset.imported",
    data: {
      summary: `Imported ${facts.filename}`,
      sha256: facts.sha256,
      bytes: facts.bytes,
      mime_type: facts.mimeType,
      object_key: objectKey,
      duplicate_of: duplicateOf ?? null,
    },
  });

  return { assetId, filename: facts.filename, objectKey, duplicateOf };
}

/**
 * Attach a browser-generated preview to an asset.
 *
 * Derivatives are separate objects in a separate bucket. Nothing here can touch
 * the original: the schema refuses a non-original version in the originals
 * bucket, and the trigger refuses a second original outright.
 */
export async function registerDerivative(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  assetId: Id;
  facts: Omit<ImportFacts, "capturedAt">;
  versionKind: "preview" | "thumbnail" | "delivery";
}): Promise<void> {
  const { supabase, organizationId, actorId, assetId, facts, versionKind } = input;

  const objectKey = `${organizationId}/derivatives/${assetId}/${versionKind}.jpg`;

  const { error: moveError } = await supabase.storage
    .from("derivatives")
    .move(facts.stagingKey, objectKey);

  if (moveError) {
    // Upload may have gone straight to the derivatives bucket already.
    const { error: copyError } = await supabase.storage
      .from("derivatives")
      .copy(facts.stagingKey, objectKey);
    if (copyError) throw new Error(`Could not store the ${versionKind}: ${moveError.message}`);
  }

  const { error } = await supabase.from("asset_versions").insert({
    organization_id: organizationId,
    asset_id: assetId,
    version_kind: versionKind,
    storage_bucket: "derivatives",
    object_key: objectKey,
    sha256: facts.sha256,
    bytes: facts.bytes,
    mime_type: facts.mimeType,
    width: facts.width ?? null,
    height: facts.height ?? null,
    created_by: actorId,
  });

  if (error && !error.message.includes("duplicate key")) {
    throw new Error(`Could not record the ${versionKind}: ${error.message}`);
  }
}

/**
 * Short-lived signed URLs for private objects.
 *
 * Nothing in these buckets is public. The URL is minted server-side for a
 * caller the policies already admitted, and expires quickly.
 */
export async function signedUrlsFor(
  supabase: SupabaseClient,
  bucket: "originals" | "derivatives" | "evidence",
  objectKeys: readonly string[],
  expiresInSeconds = 300,
): Promise<Map<string, string>> {
  if (objectKeys.length === 0) return new Map();

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls([...objectKeys], expiresInSeconds);

  if (error) return new Map();

  const urls = new Map<string, string>();
  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}
