/**
 * Input validation for Server Actions.
 *
 * Hand-rolled rather than schema-library-driven: the surface is small, the
 * rules are business rules worth reading in plain sight, and it keeps the
 * dependency list short. Every parser returns either a value or a field-keyed
 * set of messages, so a form can render errors next to the field that caused
 * them.
 */

export type FieldErrors<T> = Partial<Record<keyof T | "_form", string>>;

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: FieldErrors<T> };

function text(form: FormData, key: string): string {
  const raw = form.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function optionalText(form: FormData, key: string): string | undefined {
  const value = text(form, key);
  return value === "" ? undefined : value;
}

/** Parse a datetime-local value into an ISO instant, or undefined. */
export function parseTimestamp(value: string | undefined): string | undefined | null {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const SHOOT_PRIORITIES = ["watch", "standard", "high", "urgent"] as const;
export type ShootPriorityInput = (typeof SHOOT_PRIORITIES)[number];

export interface ShootBriefInput {
  title: string;
  storyAngle?: string;
  startsAt?: string;
  endsAt?: string;
  priority: ShootPriorityInput;
  locationName?: string;
  assignmentLabel?: string;
  targetBuyerIds: string[];
  exclusivity?: string;
  embargoUntil?: string;
  sensitiveContent: boolean;
  notes?: string;
  sourceNote?: string;
  confidentialLocation?: string;
}

const MAX_TITLE = 200;

/**
 * A shoot brief.
 *
 * Only the title is required: a brief-first shoot must be creatable before any
 * file exists, and often before the time and place are known.
 */
export function parseShootBrief(form: FormData): ParseResult<ShootBriefInput> {
  const errors: FieldErrors<ShootBriefInput> = {};

  const title = text(form, "title");
  if (!title) errors.title = "Give the shoot a subject or event.";
  else if (title.length > MAX_TITLE) errors.title = `Keep this under ${MAX_TITLE} characters.`;

  const priorityRaw = text(form, "priority") || "standard";
  const priority = SHOOT_PRIORITIES.includes(priorityRaw as ShootPriorityInput)
    ? (priorityRaw as ShootPriorityInput)
    : null;
  if (!priority) errors.priority = "Choose a priority.";

  const startsAt = parseTimestamp(optionalText(form, "startsAt"));
  if (startsAt === null) errors.startsAt = "That date and time could not be read.";

  const endsAt = parseTimestamp(optionalText(form, "endsAt"));
  if (endsAt === null) errors.endsAt = "That date and time could not be read.";

  if (startsAt && endsAt && endsAt < startsAt) {
    errors.endsAt = "The end must be after the start.";
  }

  const embargoUntil = parseTimestamp(optionalText(form, "embargoUntil"));
  if (embargoUntil === null) errors.embargoUntil = "That embargo date could not be read.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const targetBuyerIds = form
    .getAll("targetBuyerIds")
    .map((value) => String(value))
    .filter((value) => value !== "");

  return {
    ok: true,
    value: {
      title,
      storyAngle: optionalText(form, "storyAngle"),
      startsAt: startsAt ?? undefined,
      endsAt: endsAt ?? undefined,
      priority: priority as ShootPriorityInput,
      locationName: optionalText(form, "locationName"),
      assignmentLabel: optionalText(form, "assignmentLabel"),
      targetBuyerIds,
      exclusivity: optionalText(form, "exclusivity"),
      embargoUntil: embargoUntil ?? undefined,
      sensitiveContent: form.get("sensitiveContent") === "on",
      notes: optionalText(form, "notes"),
      sourceNote: optionalText(form, "sourceNote"),
      confidentialLocation: optionalText(form, "confidentialLocation"),
    },
  };
}

export interface AssetMetadataInput {
  headline?: string;
  caption?: string;
  subjects: string[];
  locationName?: string;
  keywords: string[];
  creditLine?: string;
  copyrightNotice?: string;
  usageRestrictions?: string;
}

/** Split a comma-separated field into trimmed, de-duplicated entries. */
export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

const MAX_CAPTION = 2000;

export function parseAssetMetadata(form: FormData): ParseResult<AssetMetadataInput> {
  const errors: FieldErrors<AssetMetadataInput> = {};

  const caption = optionalText(form, "caption");
  if (caption && caption.length > MAX_CAPTION) {
    errors.caption = `Keep the caption under ${MAX_CAPTION} characters.`;
  }

  const headline = optionalText(form, "headline");
  if (headline && headline.length > MAX_TITLE) {
    errors.headline = `Keep the headline under ${MAX_TITLE} characters.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      headline,
      caption,
      subjects: parseList(optionalText(form, "subjects")),
      locationName: optionalText(form, "locationName"),
      keywords: parseList(optionalText(form, "keywords")),
      creditLine: optionalText(form, "creditLine"),
      copyrightNotice: optionalText(form, "copyrightNotice"),
      usageRestrictions: optionalText(form, "usageRestrictions"),
    },
  };
}

/** A SHA-256 hex digest, lowercased. */
export function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

/**
 * Object keys are built by the server, never accepted from a client, but this
 * guards the shape anyway: the first segment must be the organization id
 * because the storage policies key on it.
 */
export function objectKeyBelongsTo(objectKey: string, organizationId: string): boolean {
  return objectKey.startsWith(`${organizationId}/`);
}

/** Strip characters that make a filename unsafe as a storage key segment. */
export function safeFilenameSegment(filename: string): string {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+/, "")
    .slice(0, 120);
  return cleaned || "file";
}
