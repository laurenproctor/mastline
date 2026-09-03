/**
 * The metadata a photograph carries, and the rules that decide who may set it.
 *
 * Everything in this module is pure. The database shape lives in the migration,
 * the reads and writes live in src/lib/data/asset-metadata.ts, and the three
 * decisions that actually matter live here so they can be tested without a
 * network or a Postgres:
 *
 *   1. INHERITANCE. What a frame takes from its shoot, and when it stops.
 *   2. THE MERGE. What a generation run may write over, and what it may not.
 *   3. PROVENANCE. Which of inherited, generated, entered, or confirmed a value
 *      is, so the interface can never present a machine's guess as a fact.
 *
 * The ordering principle throughout: a person's decision outranks a model's
 * proposal, which outranks a shoot default, which outranks nothing. Every rule
 * below is that sentence applied to one field.
 */

import type { Id, IsoTimestamp, Shoot } from "./domain";

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/**
 * Mirrors public.metadata_generation_status. Edit both together.
 *
 * `needs_review` is the state this whole feature exists to make visible: values
 * are present, they came from a machine, and nobody has accepted them yet.
 */
export const METADATA_GENERATION_STATUSES = [
  "not_generated",
  "queued",
  "processing",
  "needs_review",
  "confirmed",
  "failed",
] as const;
export type MetadataGenerationStatus = (typeof METADATA_GENERATION_STATUSES)[number];

export const METADATA_JOB_STATUSES = [
  "queued",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type MetadataJobStatus = (typeof METADATA_JOB_STATUSES)[number];

export const CONTENT_CATEGORIES = [
  "candid",
  "red_carpet",
  "event",
  "sport",
  "performance",
  "portrait",
  "street",
  "news",
  "travel",
  "arrival_departure",
  "other",
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const QUALITY_ESTIMATES = ["unusable", "low", "acceptable", "good", "excellent"] as const;
export type QualityEstimate = (typeof QUALITY_ESTIMATES)[number];

/**
 * How much editorial care a frame needs before it leaves.
 *
 * Ordered, and the order is load-bearing: a generation run may raise this and
 * may never lower it. A model that has decided a frame is fine is not a reason
 * to discard a person who decided it was not.
 */
export const SENSITIVITIES = ["none", "review", "sensitive"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const COMMERCIAL_USE_STATES = [
  "unknown",
  "not_eligible",
  "eligible_with_release",
  "eligible",
] as const;
export type CommercialUseState = (typeof COMMERCIAL_USE_STATES)[number];

export const RELEASE_STATES = ["unknown", "not_required", "not_obtained", "obtained"] as const;
export type ReleaseState = (typeof RELEASE_STATES)[number];

export const METADATA_SOURCES = ["inherited", "ai_generated", "manual", "mixed"] as const;
export type MetadataSource = (typeof METADATA_SOURCES)[number];

/** Where a single rendered value came from. Drives the label next to a field. */
export type FieldProvenance =
  "inherited" | "generated" | "entered" | "confirmed" | "file" | "empty";

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** Facts read from the file itself. Never written by a model. */
export interface TechnicalMetadata {
  readonly originalFilename?: string;
  readonly mimeType?: string;
  readonly fileBytes?: number;
  readonly width?: number;
  readonly height?: number;
  readonly orientation?: number;
  readonly capturedAt?: IsoTimestamp;
  readonly cameraMake?: string;
  readonly cameraModel?: string;
  readonly lens?: string;
  readonly focalLengthMm?: number;
  readonly apertureF?: number;
  readonly shutterSpeed?: string;
  readonly shutterSpeedSeconds?: number;
  readonly iso?: number;
  readonly gpsLatitude?: number;
  readonly gpsLongitude?: number;
  readonly gpsAltitudeM?: number;
  readonly colorProfile?: string;
  readonly checksumSha256?: string;
  readonly extractedAt?: IsoTimestamp;
  readonly source?: "exif" | "file" | "none";
  readonly raw: Readonly<Record<string, unknown>>;
}

/** What a desk reads. Proposed by a model or typed, always reviewable. */
export interface EditorialMetadata {
  readonly headline?: string;
  readonly editorialCaption?: string;
  readonly altText?: string;
  readonly subjects: readonly string[];
  readonly eventName?: string;
  readonly venue?: string;
  readonly city?: string;
  readonly region?: string;
  readonly country?: string;
  readonly scene?: string;
  readonly objects: readonly string[];
  readonly clothing: readonly string[];
  readonly brands: readonly string[];
  readonly keywords: readonly string[];
  readonly contentCategory?: ContentCategory;
  readonly qualityEstimate?: QualityEstimate;
  readonly sensitivity: Sensitivity;
  readonly photographerNotes?: string;
}

/** Photographer-entered facts. A model may never write any of these. */
export interface RightsMetadata {
  readonly editorialUseOnly: boolean;
  readonly commercialUseEligible: CommercialUseState;
  readonly modelReleaseStatus: ReleaseState;
  readonly propertyReleaseStatus: ReleaseState;
  readonly embargoUntil?: IsoTimestamp;
  readonly sensitiveOrMinor: boolean;
}

export interface PhotographMetadata {
  readonly assetId: Id;
  readonly organizationId: Id;
  readonly generationStatus: MetadataGenerationStatus;
  readonly generationAttempts: number;
  readonly generationRequestedAt?: IsoTimestamp;
  readonly generatedAt?: IsoTimestamp;
  readonly failureCode?: string;
  readonly failureDetail?: string;
  readonly aiModel?: string;
  readonly aiModelVersion?: string;
  readonly overallConfidence?: number;
  readonly fieldConfidence: Readonly<Record<string, number>>;
  /** What the model proposed, whatever happened to the live values after. */
  readonly generatedValues: Readonly<Record<string, unknown>>;
  readonly technical: TechnicalMetadata;
  readonly editorial: EditorialMetadata;
  readonly rights: RightsMetadata;
  readonly confirmedAt?: IsoTimestamp;
  readonly confirmedBy?: Id;
  readonly manualOverrides: readonly string[];
  readonly metadataSource: MetadataSource;
  readonly version: number;
  readonly updatedAt: IsoTimestamp;
}

/**
 * What a save submits.
 *
 * Every field is present on every save, including the ones the person did not
 * touch. That is deliberate: the save compares what came back against what the
 * screen showed, and a partial payload would make "left alone" and "cleared"
 * indistinguishable -- which is exactly the difference the override list is
 * built on.
 */
export interface MetadataInput {
  readonly headline?: string;
  readonly editorialCaption?: string;
  readonly altText?: string;
  readonly subjects: readonly string[];
  readonly eventName?: string;
  readonly venue?: string;
  readonly city?: string;
  readonly region?: string;
  readonly country?: string;
  readonly scene?: string;
  readonly objects: readonly string[];
  readonly clothing: readonly string[];
  readonly brands: readonly string[];
  readonly keywords: readonly string[];
  readonly contentCategory?: ContentCategory;
  readonly qualityEstimate?: QualityEstimate;
  readonly sensitivity: Sensitivity;
  readonly photographerNotes?: string;
  readonly editorialUseOnly: boolean;
  readonly commercialUseEligible: CommercialUseState;
  readonly modelReleaseStatus: ReleaseState;
  readonly propertyReleaseStatus: ReleaseState;
  readonly embargoUntil?: string;
  readonly sensitiveOrMinor: boolean;
}

// ---------------------------------------------------------------------------
// Field groups
// ---------------------------------------------------------------------------

/**
 * The editorial fields, in the order the panel shows them.
 *
 * One list, consumed by the form, the merge, the provenance labels, and the
 * tests. A field added here and nowhere else is a field the model can propose
 * and nobody can see, which is exactly the drift this list prevents.
 */
export const EDITORIAL_TEXT_FIELDS = [
  "headline",
  "editorialCaption",
  "altText",
  "eventName",
  "venue",
  "city",
  "region",
  "country",
  "scene",
  "photographerNotes",
] as const;
export type EditorialTextField = (typeof EDITORIAL_TEXT_FIELDS)[number];

export const EDITORIAL_LIST_FIELDS = [
  "subjects",
  "objects",
  "clothing",
  "brands",
  "keywords",
] as const;
export type EditorialListField = (typeof EDITORIAL_LIST_FIELDS)[number];

export const EDITORIAL_CHOICE_FIELDS = [
  "contentCategory",
  "qualityEstimate",
  "sensitivity",
] as const;

export const RIGHTS_FIELDS = [
  "editorialUseOnly",
  "commercialUseEligible",
  "modelReleaseStatus",
  "propertyReleaseStatus",
  "embargoUntil",
  "sensitiveOrMinor",
] as const;
export type RightsField = (typeof RIGHTS_FIELDS)[number];

/**
 * What a generation run is allowed to write.
 *
 * Two absences are deliberate and neither is an oversight.
 *
 * `subjects` is missing because naming who is in a frame is a factual claim
 * with consequences under publicity and privacy law, and a wrong name attached
 * to a licensed photograph is the worst failure this product could produce. The
 * model is told who the photographer says is there and may write a caption
 * around it; it may not decide the list. The person holding the camera does.
 *
 * `photographerNotes` is missing because it is the photographer's own margin.
 * A machine writing in it would make it useless as the one field nothing else
 * touches.
 */
export const AI_WRITABLE_FIELDS = [
  "headline",
  "editorialCaption",
  "altText",
  "eventName",
  "venue",
  "city",
  "region",
  "country",
  "scene",
  "objects",
  "clothing",
  "brands",
  "keywords",
  "contentCategory",
  "qualityEstimate",
  "sensitivity",
] as const;
export type AiWritableField = (typeof AI_WRITABLE_FIELDS)[number];

const AI_WRITABLE = new Set<string>(AI_WRITABLE_FIELDS);

/** Human labels, used by the panel and by the messages that name a field. */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  headline: "Headline",
  editorialCaption: "Editorial caption",
  altText: "Alt text",
  subjects: "People in frame",
  eventName: "Event or context",
  venue: "Venue",
  city: "City",
  region: "State or region",
  country: "Country",
  scene: "Scene or activity",
  objects: "Visible objects",
  clothing: "Clothing and accessories",
  brands: "Visible brands",
  keywords: "Keywords",
  contentCategory: "Category",
  qualityEstimate: "Estimated quality",
  sensitivity: "Editorial sensitivity",
  photographerNotes: "Your notes",
  editorialUseOnly: "Editorial use only",
  commercialUseEligible: "Commercial use",
  modelReleaseStatus: "Model release",
  propertyReleaseStatus: "Property release",
  embargoUntil: "Hold until",
  sensitiveOrMinor: "Sensitive or minor in frame",
};

// ---------------------------------------------------------------------------
// Inheritance
// ---------------------------------------------------------------------------

/**
 * What a photograph takes from its shoot when it has nothing of its own.
 *
 * Resolved at read time rather than copied at import, and that is the whole
 * design. A copy would freeze the shoot's answer into every frame, so
 * correcting the venue on the brief would leave four hundred photographs still
 * carrying the old one -- and re-copying to fix that would walk over edits
 * somebody had already made. Resolving on read gives both halves of the rule
 * the product asks for: a shoot correction reaches every frame that has not
 * been touched, and reaches none that has.
 *
 * A field stops inheriting the moment a person writes to it, INCLUDING when
 * they deliberately clear it. That is what `manualOverrides` records, and it is
 * why clearing a field is not the same as never having filled one in.
 */
export const INHERITED_FROM_SHOOT = {
  eventName: (shoot: Shoot) => shoot.title,
  venue: (shoot: Shoot) => shoot.locationName,
  embargoUntil: (shoot: Shoot) => shoot.embargoUntil,
  sensitiveOrMinor: (shoot: Shoot) => shoot.sensitiveContent || undefined,
} as const;

export type InheritedField = keyof typeof INHERITED_FROM_SHOOT;

const isBlank = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim().length === 0) ||
  (Array.isArray(value) && value.length === 0) ||
  value === false;

/** One field, as the interface should show it. */
export interface ResolvedField {
  readonly value: unknown;
  readonly provenance: FieldProvenance;
  /** Present only for a generated value. */
  readonly confidence?: number;
}

export interface ResolvedMetadata {
  readonly fields: Readonly<Record<string, ResolvedField>>;
  /** Fields carrying a generated value nobody has accepted yet. */
  readonly needsReview: readonly string[];
}

/**
 * Every field with its effective value and where that value came from.
 *
 * The provenance ladder, highest first:
 *
 *   confirmed  a person put their name to the whole record
 *   entered    a person typed or cleared this field
 *   generated  the model proposed it and it stands unedited
 *   inherited  nothing here; the shoot answered
 *   empty      nothing anywhere
 *
 * `file` is reserved for the technical block, which is resolved separately
 * because it never inherits and never comes from a model.
 */
export function resolveMetadata(
  metadata: PhotographMetadata | null,
  shoot: Shoot | null,
): ResolvedMetadata {
  const fields: Record<string, ResolvedField> = {};
  const needsReview: string[] = [];

  const overrides = new Set(metadata?.manualOverrides ?? []);
  const confirmed = Boolean(metadata?.confirmedAt);
  const generated = (metadata?.generatedValues ?? {}) as Record<string, unknown>;

  const own: Record<string, unknown> = metadata
    ? {
        ...metadata.editorial,
        ...metadata.rights,
      }
    : {};

  const names = [
    ...EDITORIAL_TEXT_FIELDS,
    ...EDITORIAL_LIST_FIELDS,
    ...EDITORIAL_CHOICE_FIELDS,
    ...RIGHTS_FIELDS,
  ];

  for (const name of names) {
    const stored = own[name];
    const inheritable = (
      INHERITED_FROM_SHOOT as Record<string, ((s: Shoot) => unknown) | undefined>
    )[name];

    // A person's edit wins outright, whether they wrote a value or emptied one.
    if (overrides.has(name)) {
      fields[name] = {
        value: stored,
        provenance: confirmed ? "confirmed" : "entered",
      };
      continue;
    }

    if (!isBlank(stored)) {
      // `sensitivity` defaults to "none" in the column, so a stored default is
      // not evidence that anything wrote it. Everything else that is non-blank
      // and not overridden came from a generation run.
      const cameFromModel = name in generated && !confirmed;
      fields[name] = {
        value: stored,
        provenance: confirmed ? "confirmed" : cameFromModel ? "generated" : "entered",
        confidence: cameFromModel ? metadata?.fieldConfidence[name] : undefined,
      };
      if (cameFromModel) needsReview.push(name);
      continue;
    }

    if (inheritable && shoot) {
      const inheritedValue = inheritable(shoot);
      if (!isBlank(inheritedValue)) {
        fields[name] = { value: inheritedValue, provenance: "inherited" };
        continue;
      }
    }

    fields[name] = { value: stored, provenance: "empty" };
  }

  return { fields, needsReview };
}

// ---------------------------------------------------------------------------
// The merge
// ---------------------------------------------------------------------------

export interface GeneratedEditorial {
  readonly headline?: string;
  readonly editorialCaption?: string;
  readonly altText?: string;
  readonly eventName?: string;
  readonly venue?: string;
  readonly city?: string;
  readonly region?: string;
  readonly country?: string;
  readonly scene?: string;
  readonly objects?: readonly string[];
  readonly clothing?: readonly string[];
  readonly brands?: readonly string[];
  readonly keywords?: readonly string[];
  readonly contentCategory?: ContentCategory;
  readonly qualityEstimate?: QualityEstimate;
  readonly sensitivity?: Sensitivity;
}

export interface MergeOutcome {
  /** Only the fields that may actually be written. */
  readonly patch: Readonly<Record<string, unknown>>;
  /** Fields the model proposed that were refused, and why. */
  readonly skipped: readonly { readonly field: string; readonly reason: string }[];
}

const sensitivityRank = (value: Sensitivity | undefined): number =>
  value ? SENSITIVITIES.indexOf(value) : 0;

/**
 * What a generation run is permitted to write over an existing record.
 *
 * Three refusals, in order of severity:
 *
 *   1. A CONFIRMED record takes nothing. The proposal is still recorded in
 *      generatedValues so a photographer can see what a later model thought,
 *      but not one live value moves. This is repeated as a database trigger,
 *      because the worker runs with the service role and bypasses RLS.
 *   2. A MANUALLY EDITED field takes nothing, confirmed or not. Somebody typed
 *      that; a regeneration is not a reason to discard it.
 *   3. SENSITIVITY only ever rises. A model may raise a concern; it may not
 *      clear one that a person or an earlier run raised.
 *
 * Everything else -- an inherited default, an unconfirmed value from a previous
 * run, an empty field -- is replaced. That is what "Regenerate" means, and the
 * interface warns about exactly that before it runs.
 */
export function mergeGeneratedMetadata(
  current: PhotographMetadata | null,
  generated: GeneratedEditorial,
): MergeOutcome {
  const patch: Record<string, unknown> = {};
  const skipped: { field: string; reason: string }[] = [];

  const proposed = Object.entries(generated).filter(([, value]) => !isBlank(value));

  if (current?.confirmedAt) {
    for (const [field] of proposed) {
      skipped.push({ field, reason: "confirmed" });
    }
    return { patch, skipped };
  }

  const overrides = new Set(current?.manualOverrides ?? []);

  for (const [field, value] of proposed) {
    if (!AI_WRITABLE.has(field)) {
      skipped.push({ field, reason: "not_generatable" });
      continue;
    }
    if (overrides.has(field)) {
      skipped.push({ field, reason: "edited_by_hand" });
      continue;
    }
    if (field === "sensitivity") {
      const currentValue = current?.editorial.sensitivity ?? "none";
      if (sensitivityRank(value as Sensitivity) <= sensitivityRank(currentValue)) {
        skipped.push({ field, reason: "would_lower_sensitivity" });
        continue;
      }
    }
    patch[field] = value;
  }

  return { patch, skipped };
}

/**
 * The source label for the record as a whole, after a write.
 *
 * `mixed` is the common case once anybody edits a generated frame, and saying
 * so is more useful than picking whichever half is larger.
 */
export function nextMetadataSource(input: {
  hasGenerated: boolean;
  hasManual: boolean;
}): MetadataSource {
  if (input.hasGenerated && input.hasManual) return "mixed";
  if (input.hasGenerated) return "ai_generated";
  if (input.hasManual) return "manual";
  return "inherited";
}

// ---------------------------------------------------------------------------
// Review state
// ---------------------------------------------------------------------------

export interface MetadataStatusView {
  readonly status: MetadataGenerationStatus;
  readonly label: string;
  readonly tone: "neutral" | "good" | "warn" | "danger" | "blue";
  readonly detail: string;
  /** True while a job is in flight, so the interface can keep polling. */
  readonly inFlight: boolean;
}

export function describeStatus(metadata: PhotographMetadata | null): MetadataStatusView {
  const status = metadata?.generationStatus ?? "not_generated";

  switch (status) {
    case "queued":
      return {
        status,
        label: "Queued",
        tone: "blue",
        detail: "Waiting to be read. You can keep working; this finishes on its own.",
        inFlight: true,
      };
    case "processing":
      return {
        status,
        label: "Reading the frame",
        tone: "blue",
        detail: "Mastline is describing what is visible. This does not block anything.",
        inFlight: true,
      };
    case "needs_review":
      return {
        status,
        label: "Needs review",
        tone: "warn",
        detail:
          "AI-generated — review required. Nothing here reaches a buyer until you confirm it.",
        inFlight: false,
      };
    case "confirmed":
      return {
        status,
        label: "Confirmed",
        tone: "good",
        detail: "You confirmed this describes the photograph. It may be used in dispatches.",
        inFlight: false,
      };
    case "failed":
      return {
        status,
        label: "Failed",
        tone: "danger",
        detail:
          metadata?.failureDetail ?? "The frame could not be read. Retry, or caption it by hand.",
        inFlight: false,
      };
    default:
      return {
        status: "not_generated",
        label: "Not generated",
        tone: "neutral",
        detail: "Nothing has been suggested for this frame yet.",
        inFlight: false,
      };
  }
}

/**
 * Why a photograph may not go out yet, from the metadata record alone.
 *
 * This is the server-side half of the dispatch gate and the interface's list of
 * what still needs attention. Both read this function, which is what keeps the
 * badge on the contact sheet and the reason a dispatch is refused from ever
 * disagreeing.
 *
 * A frame with no metadata record at all is NOT blocked here. Captioning by
 * hand has always been a complete workflow, and the baseline rules in
 * metadata-rules.ts already require a caption, a credit, a copyright and a
 * capture time. What this adds is narrower and specific: a machine's words may
 * not leave the building unread.
 */
export function blockingMetadataReasons(metadata: PhotographMetadata | null): readonly string[] {
  if (!metadata) return [];
  const reasons: string[] = [];

  if (metadata.generationStatus === "queued" || metadata.generationStatus === "processing") {
    reasons.push("metadata is still being generated");
  }

  if (metadata.generationStatus === "needs_review") {
    reasons.push("AI-generated metadata has not been confirmed");
  }

  if (metadata.editorial.sensitivity === "sensitive" && !metadata.confirmedAt) {
    reasons.push("flagged as sensitive and not confirmed");
  }

  if (metadata.rights.embargoUntil && new Date(metadata.rights.embargoUntil) > new Date()) {
    reasons.push(`held until ${metadata.rights.embargoUntil}`);
  }

  return reasons;
}

export function isDispatchReady(metadata: PhotographMetadata | null): boolean {
  return blockingMetadataReasons(metadata).length === 0;
}

/**
 * A photograph that may not be confirmed in bulk.
 *
 * Confirming is a legal act -- it is what lets a caption and a rights position
 * travel to a buyer -- so the bulk path takes only frames where nothing
 * rights-bearing has been asserted. Anything flagged sensitive, anything with a
 * release or a commercial position recorded, and anything held under an embargo
 * has to be read on its own screen.
 *
 * This is the gate the product requires around bulk confirmation, and it is a
 * rule rather than a hidden control: the server applies it to every id in a
 * bulk request regardless of what the interface offered.
 */
export function requiresIndividualConfirmation(metadata: PhotographMetadata): boolean {
  return (
    metadata.editorial.sensitivity !== "none" ||
    metadata.rights.sensitiveOrMinor ||
    Boolean(metadata.rights.embargoUntil) ||
    metadata.rights.commercialUseEligible !== "unknown" ||
    metadata.rights.modelReleaseStatus !== "unknown" ||
    metadata.rights.propertyReleaseStatus !== "unknown"
  );
}

/**
 * The technical block, as label/value rows.
 *
 * Formatted here rather than in the component so the same rows can be rendered
 * on the shoot screen, on the photograph's own record, and asserted in a test
 * without three ideas of how to write an aperture. Nothing unknown is listed:
 * a row that says "—" for every frame from a phone is noise.
 */
export function technicalRows(
  technical: TechnicalMetadata | null,
  /**
   * How to render an instant, from the caller that knows the workspace's
   * timezone. Left as a parameter rather than imported so this module stays
   * free of formatting policy -- and so a test can assert the rows without
   * asserting somebody's clock.
   */
  formatTimestamp: (iso: string) => string = (iso) => iso,
): readonly { readonly label: string; readonly value: string }[] {
  if (!technical) return [];

  const rows: { label: string; value: string }[] = [];
  const push = (label: string, value: string | number | undefined, suffix = "") => {
    if (value === undefined || value === null || value === "") return;
    rows.push({ label, value: `${value}${suffix}` });
  };

  push("Original filename", technical.originalFilename);
  push("Type", technical.mimeType);
  if (technical.fileBytes) {
    rows.push({
      label: "Size",
      value: `${(technical.fileBytes / 1_048_576).toFixed(1)} MB`,
    });
  }
  if (technical.width && technical.height) {
    rows.push({ label: "Dimensions", value: `${technical.width} × ${technical.height}` });
  }
  push("Orientation", technical.orientation);
  if (technical.capturedAt) {
    const rendered = formatTimestamp(technical.capturedAt);
    rows.push({
      label: "Captured",
      value:
        technical.raw?.captured_at_zone === "not recorded"
          ? `${rendered} (the camera recorded no timezone)`
          : rendered,
    });
  }
  push(
    "Camera",
    [technical.cameraMake, technical.cameraModel].filter(Boolean).join(" ") || undefined,
  );
  push("Lens", technical.lens);
  push("Focal length", technical.focalLengthMm, " mm");
  push("Aperture", technical.apertureF ? `f/${technical.apertureF}` : undefined);
  push("Shutter", technical.shutterSpeed);
  push("ISO", technical.iso);
  if (technical.gpsLatitude !== undefined && technical.gpsLongitude !== undefined) {
    rows.push({
      label: "Coordinates",
      value: `${technical.gpsLatitude}, ${technical.gpsLongitude}${
        technical.gpsAltitudeM !== undefined ? ` · ${technical.gpsAltitudeM} m` : ""
      }`,
    });
  }
  push("Colour profile", technical.colorProfile);
  if (technical.checksumSha256) {
    rows.push({ label: "SHA-256", value: `${technical.checksumSha256.slice(0, 16)}…` });
  }
  rows.push({
    label: "Source",
    value:
      technical.source === "exif"
        ? "Read from the file's own EXIF"
        : technical.source === "file"
          ? "From the file itself; no EXIF tags were present"
          : "Nothing could be read",
  });

  return rows;
}

/** Progress across a shoot, for the "7 of 24 reviewed" line. */
export interface ReviewProgress {
  readonly total: number;
  readonly confirmed: number;
  readonly needsReview: number;
  readonly failed: number;
  readonly inFlight: number;
  readonly notGenerated: number;
  readonly percent: number;
}

export function reviewProgress(records: readonly (PhotographMetadata | null)[]): ReviewProgress {
  const total = records.length;
  let confirmed = 0;
  let needsReview = 0;
  let failed = 0;
  let inFlight = 0;
  let notGenerated = 0;

  for (const record of records) {
    switch (record?.generationStatus ?? "not_generated") {
      case "confirmed":
        confirmed += 1;
        break;
      case "needs_review":
        needsReview += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "queued":
      case "processing":
        inFlight += 1;
        break;
      default:
        notGenerated += 1;
    }
  }

  return {
    total,
    confirmed,
    needsReview,
    failed,
    inFlight,
    notGenerated,
    percent: total === 0 ? 0 : Math.round((confirmed / total) * 100),
  };
}
