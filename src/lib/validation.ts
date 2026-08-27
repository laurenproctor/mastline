/**
 * Input validation for Server Actions.
 *
 * Hand-rolled rather than schema-library-driven: the surface is small, the
 * rules are business rules worth reading in plain sight, and it keeps the
 * dependency list short. Every parser returns either a value or a field-keyed
 * set of messages, so a form can render errors next to the field that caused
 * them.
 */

import {
  COMMERCIAL_USE_STATES,
  CONTENT_CATEGORIES,
  type CommercialUseState,
  type ContentCategory,
  type MetadataInput,
  QUALITY_ESTIMATES,
  type QualityEstimate,
  RELEASE_STATES,
  type ReleaseState,
  SENSITIVITIES,
  type Sensitivity,
} from "./asset-metadata";
import {
  type OnboardingGoal,
  type Specialty,
  type WorkStyle,
  isOnboardingGoal,
  isSpecialty,
  isWorkStyle,
} from "./onboarding";
import { SLUG_MAX_LENGTH, slugProblem } from "./slug";

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

// ---------------------------------------------------------------------------
// Photograph metadata
// ---------------------------------------------------------------------------

const MAX_ALT_TEXT = 500;
const MAX_SHORT = 120;
const MAX_NOTES = 2000;
const MAX_LIST_ENTRIES = 24;

/** A choice field, checked against its vocabulary rather than trusted. */
function choice<T extends string>(
  form: FormData,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = text(form, key);
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * The photograph metadata panel.
 *
 * Longer than the other parsers here because the panel is longer, and every
 * bound below is a bound the database also carries: the column checks refuse
 * the same thing, and this exists to turn that refusal into a sentence next to
 * the field rather than a failed action.
 *
 * The three enum groups are filtered against their vocabularies rather than
 * accepted, because a select's value is only a hint about what a browser sent.
 * An unrecognised choice falls back to the safe end of its scale -- unknown for
 * a release, none for sensitivity -- never to the permissive end.
 */
export function parseMetadataForm(form: FormData): ParseResult<MetadataInput> {
  const errors: FieldErrors<MetadataInput> = {};

  const headline = optionalText(form, "headline");
  if (headline && headline.length > MAX_TITLE) {
    errors.headline = `Keep the headline under ${MAX_TITLE} characters.`;
  }

  const editorialCaption = optionalText(form, "editorialCaption");
  if (editorialCaption && editorialCaption.length > MAX_CAPTION) {
    errors.editorialCaption = `Keep the caption under ${MAX_CAPTION} characters.`;
  }

  const altText = optionalText(form, "altText");
  if (altText && altText.length > MAX_ALT_TEXT) {
    errors.altText = `Keep alt text under ${MAX_ALT_TEXT} characters.`;
  }

  const photographerNotes = optionalText(form, "photographerNotes");
  if (photographerNotes && photographerNotes.length > MAX_NOTES) {
    errors.photographerNotes = `Keep notes under ${MAX_NOTES} characters.`;
  }

  for (const field of ["eventName", "venue", "city", "region", "country", "scene"] as const) {
    const value = optionalText(form, field);
    if (value && value.length > MAX_SHORT) {
      errors[field] = `Keep this under ${MAX_SHORT} characters.`;
    }
  }

  const embargoUntil = parseTimestamp(optionalText(form, "embargoUntil"));
  if (embargoUntil === null) errors.embargoUntil = "That date could not be read.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const list = (key: string) => parseList(optionalText(form, key)).slice(0, MAX_LIST_ENTRIES);

  return {
    ok: true,
    value: {
      headline,
      editorialCaption,
      altText,
      subjects: list("subjects"),
      eventName: optionalText(form, "eventName"),
      venue: optionalText(form, "venue"),
      city: optionalText(form, "city"),
      region: optionalText(form, "region"),
      country: optionalText(form, "country"),
      scene: optionalText(form, "scene"),
      objects: list("objects"),
      clothing: list("clothing"),
      brands: list("brands"),
      keywords: list("keywords"),
      contentCategory: choice<ContentCategory>(form, "contentCategory", CONTENT_CATEGORIES),
      qualityEstimate: choice<QualityEstimate>(form, "qualityEstimate", QUALITY_ESTIMATES),
      sensitivity: choice<Sensitivity>(form, "sensitivity", SENSITIVITIES) ?? "none",
      photographerNotes,
      // An unchecked box sends nothing. For editorial-use-only that means the
      // absence of a tick reads as "not editorial only", which is the value the
      // photographer sees on screen -- so the control is rendered checked by
      // default and this simply reflects it.
      editorialUseOnly: form.get("editorialUseOnly") === "on",
      commercialUseEligible:
        choice<CommercialUseState>(form, "commercialUseEligible", COMMERCIAL_USE_STATES) ??
        "unknown",
      modelReleaseStatus:
        choice<ReleaseState>(form, "modelReleaseStatus", RELEASE_STATES) ?? "unknown",
      propertyReleaseStatus:
        choice<ReleaseState>(form, "propertyReleaseStatus", RELEASE_STATES) ?? "unknown",
      embargoUntil: embargoUntil ?? undefined,
      sensitiveOrMinor: form.get("sensitiveOrMinor") === "on",
    },
  };
}

/**
 * The version the screen was rendered from.
 *
 * A save without one is refused rather than treated as "whatever is current",
 * because "whatever is current" is precisely the overwrite this guards against.
 */
export function parseExpectedVersion(form: FormData): number | null {
  const raw = Number(text(form, "expectedVersion"));
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

/**
 * A record id.
 *
 * Every id in the system is a UUID, so a malformed one means "no such record"
 * rather than "something went wrong". Checking before querying turns a URL
 * somebody edited by hand into a 404 instead of a database error and an error
 * page.
 */
export function isRecordId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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

/**
 * A URL-safe slug from a workspace name.
 *
 * Workspace slugs are unique across every workspace in the system, so a
 * collision is expected rather than exceptional; the caller retries with a
 * suffix instead of failing in front of someone on their first screen.
 */
export function slugifyWorkspace(name: string): string {
  const base = name
    .normalize("NFKD")
    // NFKD splits an accented letter into a base plus a combining mark. Without
    // stripping the marks they become separators, and "Ünïcödé" turns into
    // "u-ni-co-de".
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base || "workspace";
}

export interface OnboardingInput {
  name: string;
  /** The workspace's address: mastline.co/<workspaceSlug>. */
  workspaceSlug: string;
  timezone: string;
  workStyle: WorkStyle;
  baseCity: string;
  specialties: Specialty[];
  goals: OnboardingGoal[];
  salesEngineEnabled: boolean;
}

const MAX_WORKSPACE_NAME = 120;
const MAX_CITY = 120;

/**
 * The answers the onboarding flow collects.
 *
 * Every list is filtered against the canonical vocabulary rather than trusted:
 * the values arrive from hidden inputs, and a hidden input is only a hint about
 * what a browser sent. The database repeats these same sets as check
 * constraints, so an unknown key would be refused there too -- this parser
 * exists to turn that refusal into a sentence somebody can act on.
 */
export function parseOnboarding(form: FormData): ParseResult<OnboardingInput> {
  const errors: FieldErrors<OnboardingInput> = {};

  const name = text(form, "name");
  if (!name) errors.name = "Give the workspace a name.";
  else if (name.length > MAX_WORKSPACE_NAME) {
    errors.name = `Keep the name under ${MAX_WORKSPACE_NAME} characters.`;
  }

  const baseCity = text(form, "baseCity");
  if (!baseCity) errors.baseCity = "Say where you are mostly based.";
  else if (baseCity.length > MAX_CITY) {
    errors.baseCity = `Keep this under ${MAX_CITY} characters.`;
  }

  /*
   * The address is chosen, not derived, so it is validated like anything else
   * somebody typed. The same two rules run in the database -- a check
   * constraint for the shape, a trigger for the reserved words -- and this copy
   * exists so the answer arrives while they are still on the step rather than
   * after they press the button.
   *
   * Whether it is already taken is not decided here. That can change between
   * this moment and the insert, so the database is what answers it.
   */
  const workspaceSlug = text(form, "workspaceSlug").toLowerCase();
  if (!workspaceSlug) errors.workspaceSlug = "Choose a workspace address.";
  else {
    const problem = slugProblem(workspaceSlug);
    if (problem === "invalid") {
      errors.workspaceSlug =
        `Use lowercase letters, numbers and hyphens, up to ${SLUG_MAX_LENGTH} characters.`;
    } else if (problem === "reserved") {
      errors.workspaceSlug = "That address is reserved. Choose another.";
    }
  }

  const workStyleRaw = text(form, "workStyle");
  if (!isWorkStyle(workStyleRaw)) errors.workStyle = "Choose how you work.";

  const specialties = parseList(optionalText(form, "specialties")).filter(isSpecialty);
  if (specialties.length === 0) errors.specialties = "Choose at least one kind of work.";

  const goals = parseList(optionalText(form, "goals")).filter(isOnboardingGoal);
  if (goals.length === 0) errors.goals = "Choose at least one priority.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      workspaceSlug,
      timezone: text(form, "timezone") || "America/New_York",
      workStyle: workStyleRaw as WorkStyle,
      baseCity,
      specialties,
      goals,
      // An unchecked checkbox sends nothing at all, so absence is a decline.
      // This is the safe direction for a flag that governs the 70/30 split.
      salesEngineEnabled: form.get("salesEngine") === "on",
    },
  };
}
