import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type CommercialUseState,
  type ContentCategory,
  EDITORIAL_LIST_FIELDS,
  type MetadataGenerationStatus,
  type MetadataInput,
  type MetadataSource,
  type PhotographMetadata,
  type QualityEstimate,
  type ReleaseState,
  type Sensitivity,
  type TechnicalMetadata,
  mergeGeneratedMetadata,
  nextMetadataSource,
  resolveMetadata,
} from "../asset-metadata";
import type { Id, Shoot } from "../domain";
import type { ExifFacts } from "../exif";
import type { GeneratedMetadata } from "../metadata-suggestions";
import { createClient } from "../supabase/server";
import { isRecordId } from "../validation";
import { recordEventWith } from "./activity";
import { publishConfirmedMetadata } from "./assets";

/**
 * Reading and writing a photograph's metadata record.
 *
 * Three rules are enforced here rather than left to a caller, because every one
 * of them is a promise the product makes on screen:
 *
 *   1. A SAVE CARRIES A VERSION. Two tabs on one frame is ordinary in this
 *      product -- an inspector open beside a record screen -- and a caption
 *      about to reach a buyer must not be decided by whichever tab pressed
 *      Save second. A stale version is refused with the current values, not
 *      merged and not overwritten.
 *
 *   2. AN EDIT IS RECORDED AS AN EDIT. A field whose submitted value differs
 *      from what the screen showed becomes a manual override, permanently.
 *      That is what stops a later shoot change or a regeneration walking over
 *      it, and it is why deliberately CLEARING a field is different from never
 *      having filled one in.
 *
 *   3. GENERATION MERGES, IT DOES NOT REPLACE. applyGeneratedMetadata writes
 *      only what mergeGeneratedMetadata permits. The database repeats the
 *      confirmed-and-rights half of that rule as a trigger, because this path
 *      runs with the service role and bypasses row level security.
 */

const COLUMNS = `
  asset_id, organization_id, generation_status, generation_attempts,
  generation_requested_at, generated_at, failure_code, failure_detail,
  ai_model, ai_model_version, overall_confidence, field_confidence, generated_values,
  original_filename, mime_type, file_bytes, width, height, orientation, captured_at,
  camera_make, camera_model, lens, focal_length_mm, aperture_f, shutter_speed,
  shutter_speed_seconds, iso, gps_latitude, gps_longitude, gps_altitude_m,
  color_profile, checksum_sha256, technical_extracted_at, technical_source, technical_raw,
  headline, editorial_caption, alt_text, subjects, event_name, venue, city, region, country,
  scene, objects, clothing, brands, keywords, content_category, quality_estimate,
  sensitivity, photographer_notes,
  editorial_use_only, commercial_use_eligible, model_release_status, property_release_status,
  embargo_until, sensitive_or_minor, confirmed_at, confirmed_by,
  manual_overrides, metadata_source, version, updated_at
`;

type Row = Record<string, unknown>;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter((entry) => entry.length > 0) : [];

const optionalText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const optionalNumber = (value: unknown): number | undefined =>
  value === null || value === undefined ? undefined : Number(value);

function toMetadata(row: Row): PhotographMetadata {
  const technical: TechnicalMetadata = {
    originalFilename: optionalText(row.original_filename),
    mimeType: optionalText(row.mime_type),
    fileBytes: optionalNumber(row.file_bytes),
    width: optionalNumber(row.width),
    height: optionalNumber(row.height),
    orientation: optionalNumber(row.orientation),
    capturedAt: optionalText(row.captured_at),
    cameraMake: optionalText(row.camera_make),
    cameraModel: optionalText(row.camera_model),
    lens: optionalText(row.lens),
    focalLengthMm: optionalNumber(row.focal_length_mm),
    apertureF: optionalNumber(row.aperture_f),
    shutterSpeed: optionalText(row.shutter_speed),
    shutterSpeedSeconds: optionalNumber(row.shutter_speed_seconds),
    iso: optionalNumber(row.iso),
    gpsLatitude: optionalNumber(row.gps_latitude),
    gpsLongitude: optionalNumber(row.gps_longitude),
    gpsAltitudeM: optionalNumber(row.gps_altitude_m),
    colorProfile: optionalText(row.color_profile),
    checksumSha256: optionalText(row.checksum_sha256),
    extractedAt: optionalText(row.technical_extracted_at),
    source: (optionalText(row.technical_source) as TechnicalMetadata["source"]) ?? undefined,
    raw: (row.technical_raw as Record<string, unknown>) ?? {},
  };

  return {
    assetId: row.asset_id as string,
    organizationId: row.organization_id as string,
    generationStatus: row.generation_status as MetadataGenerationStatus,
    generationAttempts: Number(row.generation_attempts ?? 0),
    generationRequestedAt: optionalText(row.generation_requested_at),
    generatedAt: optionalText(row.generated_at),
    failureCode: optionalText(row.failure_code),
    failureDetail: optionalText(row.failure_detail),
    aiModel: optionalText(row.ai_model),
    aiModelVersion: optionalText(row.ai_model_version),
    overallConfidence: optionalNumber(row.overall_confidence),
    fieldConfidence: (row.field_confidence as Record<string, number>) ?? {},
    generatedValues: (row.generated_values as Record<string, unknown>) ?? {},
    technical,
    editorial: {
      headline: optionalText(row.headline),
      editorialCaption: optionalText(row.editorial_caption),
      altText: optionalText(row.alt_text),
      subjects: strings(row.subjects),
      eventName: optionalText(row.event_name),
      venue: optionalText(row.venue),
      city: optionalText(row.city),
      region: optionalText(row.region),
      country: optionalText(row.country),
      scene: optionalText(row.scene),
      objects: strings(row.objects),
      clothing: strings(row.clothing),
      brands: strings(row.brands),
      keywords: strings(row.keywords),
      contentCategory: optionalText(row.content_category) as ContentCategory | undefined,
      qualityEstimate: optionalText(row.quality_estimate) as QualityEstimate | undefined,
      sensitivity: (optionalText(row.sensitivity) as Sensitivity) ?? "none",
      photographerNotes: optionalText(row.photographer_notes),
    },
    rights: {
      editorialUseOnly: Boolean(row.editorial_use_only),
      commercialUseEligible: (row.commercial_use_eligible as CommercialUseState) ?? "unknown",
      modelReleaseStatus: (row.model_release_status as ReleaseState) ?? "unknown",
      propertyReleaseStatus: (row.property_release_status as ReleaseState) ?? "unknown",
      embargoUntil: optionalText(row.embargo_until),
      sensitiveOrMinor: Boolean(row.sensitive_or_minor),
    },
    confirmedAt: optionalText(row.confirmed_at),
    confirmedBy: optionalText(row.confirmed_by),
    manualOverrides: strings(row.manual_overrides),
    metadataSource: (row.metadata_source as MetadataSource) ?? "inherited",
    version: Number(row.version ?? 1),
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getMetadata(
  organizationId: Id,
  assetId: Id,
  client?: SupabaseClient,
): Promise<PhotographMetadata | null> {
  // A malformed id is "no such record", not a database error.
  if (!isRecordId(assetId)) return null;

  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("asset_metadata")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .eq("asset_id", assetId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the metadata: ${error.message}`);
  return data ? toMetadata(data as Row) : null;
}

/** Every record for a set of photographs, in one round trip. */
export async function listMetadata(
  organizationId: Id,
  assetIds: readonly Id[],
  client?: SupabaseClient,
): Promise<Map<Id, PhotographMetadata>> {
  if (assetIds.length === 0) return new Map();

  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("asset_metadata")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .in("asset_id", [...assetIds]);

  if (error) throw new Error(`Could not load metadata: ${error.message}`);

  return new Map(
    (data ?? []).map((row) => {
      const record = toMetadata(row as Row);
      return [record.assetId, record] as const;
    }),
  );
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface TechnicalSeed {
  readonly originalFilename?: string;
  readonly mimeType?: string;
  readonly fileBytes?: number;
  readonly width?: number;
  readonly height?: number;
  readonly capturedAt?: string;
  readonly checksumSha256?: string;
}

/**
 * Create the record that everything else attaches to.
 *
 * Called from the import, inside the same client the import already holds, so
 * a photograph is never without a metadata record for longer than one insert.
 * Idempotent: a re-import of the same asset id, or a job that arrives before
 * the import finished, must not fail here and must not blank what is already
 * recorded.
 *
 * The seed is only what the container already told us -- filename, type, size,
 * dimensions, digest. The EXIF pass runs later, from the original's own bytes,
 * and overwrites nothing it did not read.
 */
export async function ensureMetadataRecord(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  assetId: Id;
  seed?: TechnicalSeed;
}): Promise<void> {
  const { supabase, organizationId, assetId, seed } = input;

  const { error } = await supabase.from("asset_metadata").upsert(
    {
      asset_id: assetId,
      organization_id: organizationId,
      original_filename: seed?.originalFilename ?? null,
      mime_type: seed?.mimeType ?? null,
      file_bytes: seed?.fileBytes ?? null,
      width: seed?.width ?? null,
      height: seed?.height ?? null,
      captured_at: seed?.capturedAt ?? null,
      checksum_sha256: seed?.checksumSha256 ?? null,
      technical_source: "file",
      technical_extracted_at: new Date().toISOString(),
    },
    { onConflict: "asset_id", ignoreDuplicates: true },
  );

  if (error) throw new Error(`Could not create the metadata record: ${error.message}`);
}

/**
 * Write what the file's own tags said.
 *
 * Separate from the editorial write and never merged with it: these are the
 * only values in the record that are neither proposed nor typed, and mixing
 * them into the same update would make the trigger that guards generation
 * writes fire on a technical one.
 *
 * Existing values are not overwritten by absence. A second pass that reads
 * fewer tags than the first -- a truncated fetch, a different prefix -- must
 * not blank a camera body that was already recorded.
 */
export async function applyTechnicalMetadata(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  assetId: Id;
  exif: ExifFacts | null;
  seed?: TechnicalSeed;
}): Promise<void> {
  const { supabase, organizationId, assetId, exif, seed } = input;

  const patch: Record<string, unknown> = {
    technical_extracted_at: new Date().toISOString(),
    technical_source: exif && Object.keys(exif).length > 1 ? "exif" : "file",
  };

  const set = (column: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "") patch[column] = value;
  };

  set("original_filename", seed?.originalFilename);
  set("mime_type", seed?.mimeType);
  set("file_bytes", seed?.fileBytes);
  set("checksum_sha256", seed?.checksumSha256);

  if (exif) {
    set("camera_make", exif.cameraMake);
    set("camera_model", exif.cameraModel);
    set("lens", exif.lens);
    set("orientation", exif.orientation);
    set("captured_at", exif.capturedAt);
    set("focal_length_mm", exif.focalLengthMm);
    set("aperture_f", exif.apertureF);
    set("shutter_speed", exif.shutterSpeed);
    set("shutter_speed_seconds", exif.shutterSpeedSeconds);
    set("iso", exif.iso);
    set("gps_latitude", exif.gpsLatitude);
    set("gps_longitude", exif.gpsLongitude);
    set("gps_altitude_m", exif.gpsAltitudeM);
    set("color_profile", exif.colorProfile);
    set("width", exif.width ?? seed?.width);
    set("height", exif.height ?? seed?.height);

    const raw: Record<string, unknown> = { ...exif.extra };
    // The camera did not record a timezone. Say so, rather than letting a
    // wall-clock time read as an exact instant.
    if (exif.capturedAt && exif.capturedAtHasZone === false) raw.captured_at_zone = "not recorded";
    if (Object.keys(raw).length > 0) patch.technical_raw = raw;
  } else {
    set("width", seed?.width);
    set("height", seed?.height);
    set("captured_at", seed?.capturedAt);
  }

  const { error } = await supabase
    .from("asset_metadata")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("asset_id", assetId);

  if (error) throw new Error(`Could not record the technical metadata: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

const COLUMN_FOR: Readonly<Record<string, string>> = {
  headline: "headline",
  editorialCaption: "editorial_caption",
  altText: "alt_text",
  subjects: "subjects",
  eventName: "event_name",
  venue: "venue",
  city: "city",
  region: "region",
  country: "country",
  scene: "scene",
  objects: "objects",
  clothing: "clothing",
  brands: "brands",
  keywords: "keywords",
  contentCategory: "content_category",
  qualityEstimate: "quality_estimate",
  sensitivity: "sensitivity",
  photographerNotes: "photographer_notes",
  editorialUseOnly: "editorial_use_only",
  commercialUseEligible: "commercial_use_eligible",
  modelReleaseStatus: "model_release_status",
  propertyReleaseStatus: "property_release_status",
  embargoUntil: "embargo_until",
  sensitiveOrMinor: "sensitive_or_minor",
};

const ALL_EDITABLE = Object.keys(COLUMN_FOR);

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = Array.isArray(a) ? a : [];
    const right = Array.isArray(b) ? b : [];
    return left.length === right.length && left.every((entry, index) => entry === right[index]);
  }
  // Undefined, null, and "" all mean "nothing here" once a form has round-
  // tripped through a browser, so they must not read as a change.
  const normalise = (value: unknown) =>
    value === null || value === undefined || value === "" ? null : value;
  return normalise(a) === normalise(b);
}

export type SaveOutcome =
  | { readonly ok: true; readonly metadata: PhotographMetadata }
  | { readonly ok: false; readonly reason: "stale"; readonly metadata: PhotographMetadata }
  | { readonly ok: false; readonly reason: "missing" };

/**
 * Save a photographer's edits.
 *
 * `expectedVersion` is what the screen was rendered from. If the row has moved
 * on, nothing is written and the current record comes back so the interface can
 * show what changed underneath rather than silently discarding one of the two
 * edits.
 *
 * `shoot` is passed so that "did this change?" is judged against what the
 * person actually saw, inherited values included. Saving a form without
 * touching an inherited venue must not freeze that venue as an override --
 * otherwise correcting the brief would stop reaching frames nobody had edited.
 */
export async function saveMetadata(input: {
  organizationId: Id;
  actorId: Id;
  assetId: Id;
  values: MetadataInput;
  expectedVersion: number;
  shoot: Shoot | null;
  confirm?: boolean;
  client?: SupabaseClient;
}): Promise<SaveOutcome> {
  const { organizationId, actorId, assetId, values, expectedVersion, shoot, confirm } = input;
  const supabase = input.client ?? (await createClient());

  const current = await getMetadata(organizationId, assetId, supabase);
  if (!current) return { ok: false, reason: "missing" };
  if (current.version !== expectedVersion) return { ok: false, reason: "stale", metadata: current };

  const resolved = resolveMetadata(current, shoot);
  const submitted = values as unknown as Record<string, unknown>;

  // Which fields the person actually changed relative to what they were shown.
  const changed = ALL_EDITABLE.filter(
    (field) => !sameValue(submitted[field], resolved.fields[field]?.value),
  );

  const overrides = new Set(current.manualOverrides);
  for (const field of changed) overrides.add(field);

  const patch: Record<string, unknown> = { version: current.version + 1 };
  for (const field of ALL_EDITABLE) {
    const value = submitted[field];

    /*
     * An inherited value the form simply handed back stays UNSTORED.
     *
     * The panel renders the shoot's answer into the control, so it round-trips
     * on every save. Writing it into the column would look harmless and would
     * quietly end inheritance for that field: the column is no longer empty, so
     * the next read stops consulting the shoot, and correcting the brief would
     * never reach this frame again. Which is precisely the failure resolving on
     * read was chosen to avoid.
     *
     * So a field that did not change, and whose value on screen came from the
     * shoot, is written as null. It keeps inheriting, and it keeps showing the
     * same thing.
     */
    if (
      !changed.includes(field) &&
      resolved.fields[field]?.provenance === "inherited" &&
      !overrides.has(field)
    ) {
      patch[COLUMN_FOR[field]] = null;
      continue;
    }

    patch[COLUMN_FOR[field]] = value === undefined || value === "" ? null : value;
  }
  // Arrays are not nullable in the schema; an empty selection is an empty array.
  for (const field of EDITORIAL_LIST_FIELDS) patch[COLUMN_FOR[field]] = values[field] ?? [];
  patch.sensitivity = values.sensitivity;
  patch.editorial_use_only = values.editorialUseOnly;
  // sensitive_or_minor inherits from the shoot, so it obeys the same rule as
  // the text fields above: unchanged and inherited means unstored. It is a
  // NOT NULL boolean, so "unstored" is false rather than null -- the shoot is
  // what supplies the true on read.
  patch.sensitive_or_minor =
    !changed.includes("sensitiveOrMinor") &&
    resolved.fields.sensitiveOrMinor?.provenance === "inherited" &&
    !overrides.has("sensitiveOrMinor")
      ? false
      : values.sensitiveOrMinor;
  patch.manual_overrides = [...overrides];

  const hasManual = overrides.size > 0;
  patch.metadata_source = nextMetadataSource({
    hasGenerated: Boolean(current.generatedAt),
    hasManual,
  });

  /*
   * What the save leaves the record in.
   *
   * Confirming is explicit, and it is also implicit in one narrow case: editing
   * a record that was ALREADY confirmed. The photographer is typing the value
   * themselves at that point, so the assertion is theirs and the stamp moves to
   * them. What the gate exists to stop is a machine's words leaving unread, and
   * a hand-typed value on an already-confirmed frame is not that.
   *
   * Everything else with a generation behind it drops to needs_review, which is
   * the honest answer: values exist, and nobody has yet said they are right.
   */
  const wasConfirmed = Boolean(current.confirmedAt);
  const nowConfirmed = confirm === true || wasConfirmed;

  if (nowConfirmed) {
    patch.generation_status = "confirmed" satisfies MetadataGenerationStatus;
    patch.confirmed_at = new Date().toISOString();
    patch.confirmed_by = actorId;
    patch.failure_code = null;
    patch.failure_detail = null;
  } else {
    patch.confirmed_at = null;
    patch.confirmed_by = null;
    if (current.generationStatus === "queued" || current.generationStatus === "processing") {
      // A job is in flight. Leave the status alone: the run will land on top of
      // these values without touching the fields just edited, because they are
      // manual overrides now.
      delete patch.generation_status;
    } else if (current.generatedAt) {
      patch.generation_status = "needs_review" satisfies MetadataGenerationStatus;
      patch.failure_code = null;
      patch.failure_detail = null;
    } else {
      patch.generation_status = "not_generated" satisfies MetadataGenerationStatus;
      patch.failure_code = null;
      patch.failure_detail = null;
    }
  }

  const { data, error } = await supabase
    .from("asset_metadata")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("asset_id", assetId)
    // The version is part of the WHERE, not just the read above: two saves that
    // both passed the check a moment ago cannot both match here.
    .eq("version", expectedVersion)
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`Could not save the metadata: ${error.message}`);
  if (!data) {
    const latest = await getMetadata(organizationId, assetId, supabase);
    return latest
      ? { ok: false, reason: "stale", metadata: latest }
      : { ok: false, reason: "missing" };
  }

  const saved = toMetadata(data as Row);

  // Confirmation is what puts these words on the asset a dispatch sends.
  if (nowConfirmed) await publish(supabase, organizationId, actorId, saved);

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "asset",
    entityId: assetId,
    action: nowConfirmed && !wasConfirmed ? "asset.metadata_confirmed" : "asset.metadata_saved",
    data: {
      summary:
        nowConfirmed && !wasConfirmed
          ? "Photograph metadata confirmed"
          : `Photograph metadata edited${changed.length > 0 ? ` (${changed.length} ${changed.length === 1 ? "field" : "fields"})` : ""}`,
      changed_fields: changed,
      confirmed: nowConfirmed,
    },
  });

  return { ok: true, metadata: saved };
}

/**
 * Push the confirmed words onto the asset row.
 *
 * Kept separate and best-effort: the confirmation itself has already been
 * recorded by the time this runs, and a failure to copy a caption must not
 * un-confirm a record somebody put their name to. It is reported instead, and
 * the next save carries it across.
 */
async function publish(
  supabase: SupabaseClient,
  organizationId: Id,
  actorId: Id,
  metadata: PhotographMetadata,
): Promise<void> {
  try {
    await publishConfirmedMetadata({
      organizationId,
      actorId,
      assetId: metadata.assetId,
      client: supabase,
      editorial: {
        headline: metadata.editorial.headline,
        caption: metadata.editorial.editorialCaption,
        subjects: metadata.editorial.subjects,
        keywords: metadata.editorial.keywords,
      },
    });
  } catch (error) {
    console.warn(
      `Confirmed ${metadata.assetId} but could not copy the caption onto the asset: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
}

/**
 * Confirm without editing.
 *
 * Separate from `saveMetadata` because the interface offers it separately: a
 * photographer who has read the panel and agrees with it should not have to
 * re-submit every field to say so, and a confirmation that carried a form
 * payload could confirm something other than what was on screen.
 */
export async function confirmMetadata(input: {
  organizationId: Id;
  actorId: Id;
  assetId: Id;
  expectedVersion: number;
  client?: SupabaseClient;
}): Promise<SaveOutcome> {
  const { organizationId, actorId, assetId, expectedVersion } = input;
  const supabase = input.client ?? (await createClient());

  const { data, error } = await supabase
    .from("asset_metadata")
    .update({
      generation_status: "confirmed" satisfies MetadataGenerationStatus,
      confirmed_at: new Date().toISOString(),
      confirmed_by: actorId,
      failure_code: null,
      failure_detail: null,
      version: expectedVersion + 1,
    })
    .eq("organization_id", organizationId)
    .eq("asset_id", assetId)
    .eq("version", expectedVersion)
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`Could not confirm the metadata: ${error.message}`);

  if (!data) {
    const latest = await getMetadata(organizationId, assetId, supabase);
    return latest
      ? { ok: false, reason: "stale", metadata: latest }
      : { ok: false, reason: "missing" };
  }

  const confirmed = toMetadata(data as Row);
  await publish(supabase, organizationId, actorId, confirmed);

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "asset",
    entityId: assetId,
    action: "asset.metadata_confirmed",
    data: { summary: "Photograph metadata confirmed" },
  });

  return { ok: true, metadata: confirmed };
}

// ---------------------------------------------------------------------------
// Generation writes
// ---------------------------------------------------------------------------

/** Mark a record as waiting, so the panel says so before the worker starts. */
export async function markGenerationQueued(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  assetId: Id;
}): Promise<void> {
  await input.supabase
    .from("asset_metadata")
    .update({
      generation_status: "queued" satisfies MetadataGenerationStatus,
      generation_requested_at: new Date().toISOString(),
      failure_code: null,
      failure_detail: null,
    })
    .eq("organization_id", input.organizationId)
    .eq("asset_id", input.assetId)
    // A confirmed record is not moved back into a queue by the act of asking
    // for a second opinion. The run still happens; its output lands in
    // generated_values and the status stays where the photographer left it.
    .neq("generation_status", "confirmed");
}

export async function markGenerationProcessing(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  assetId: Id;
}): Promise<void> {
  await input.supabase
    .from("asset_metadata")
    .update({ generation_status: "processing" satisfies MetadataGenerationStatus })
    .eq("organization_id", input.organizationId)
    .eq("asset_id", input.assetId)
    .neq("generation_status", "confirmed");
}

export async function markGenerationFailed(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  assetId: Id;
  code: string;
  detail: string;
}): Promise<void> {
  await input.supabase
    .from("asset_metadata")
    .update({
      generation_status: "failed" satisfies MetadataGenerationStatus,
      failure_code: input.code.slice(0, 64),
      failure_detail: input.detail.slice(0, 500),
    })
    .eq("organization_id", input.organizationId)
    .eq("asset_id", input.assetId)
    .neq("generation_status", "confirmed");
}

export interface AppliedGeneration {
  readonly written: readonly string[];
  readonly skipped: readonly { readonly field: string; readonly reason: string }[];
  readonly status: MetadataGenerationStatus;
}

/**
 * Write what a run produced, as far as it is allowed to.
 *
 * The proposal is recorded in full regardless -- `generated_values` is the
 * audit trail for "the machine said X" and does not depend on whether X was
 * accepted. The live columns take only what the merge permits, and the
 * database trigger refuses the rest independently.
 */
export async function applyGeneratedMetadata(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  assetId: Id;
  generated: GeneratedMetadata;
  model: string;
  modelVersion?: string;
}): Promise<AppliedGeneration> {
  const { supabase, organizationId, assetId, generated, model, modelVersion } = input;

  const current = await getMetadata(organizationId, assetId, supabase);
  if (!current) throw new Error("That photograph has no metadata record.");

  const { patch, skipped } = mergeGeneratedMetadata(current, {
    headline: generated.headline,
    editorialCaption: generated.editorialCaption,
    altText: generated.altText,
    eventName: generated.eventName,
    venue: generated.venue,
    city: generated.city,
    region: generated.region,
    country: generated.country,
    scene: generated.scene,
    objects: generated.objects,
    clothing: generated.clothing,
    brands: generated.brands,
    keywords: generated.keywords,
    contentCategory: generated.contentCategory,
    qualityEstimate: generated.qualityEstimate,
    sensitivity: generated.sensitivity,
  });

  const generatedAt = new Date().toISOString();

  const update: Record<string, unknown> = {
    generated_at: generatedAt,
    generation_attempts: current.generationAttempts + 1,
    ai_model: model,
    ai_model_version: modelVersion ?? null,
    overall_confidence: generated.confidence,
    field_confidence: generated.fieldConfidence,
    generated_values: {
      ...generated,
      basis: generated.basis,
      recorded_at: generatedAt,
    },
    failure_code: null,
    failure_detail: null,
    version: current.version + 1,
  };

  for (const [field, value] of Object.entries(patch)) {
    update[COLUMN_FOR[field]] = value;
  }

  // A confirmed record keeps its status and its stamp. Everything else lands in
  // needs_review, because values now exist that nobody has accepted.
  const status: MetadataGenerationStatus = current.confirmedAt ? "confirmed" : "needs_review";
  update.generation_status = status;
  update.metadata_source = nextMetadataSource({
    hasGenerated: true,
    hasManual: current.manualOverrides.length > 0,
  });

  const { error } = await supabase
    .from("asset_metadata")
    .update(update)
    .eq("organization_id", organizationId)
    .eq("asset_id", assetId);

  if (error) throw new Error(`Could not record the generated metadata: ${error.message}`);

  return { written: Object.keys(patch), skipped, status };
}
