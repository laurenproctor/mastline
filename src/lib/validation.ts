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
  OPPORTUNITY_KINDS,
  OPPORTUNITY_SIGNALS,
  type OpportunityKind,
  type OpportunitySignal,
} from "./domain";
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

/**
 * Metadata the whole shoot shares, entered once on the creation page.
 *
 * These are the facts that are the same for every frame of one job -- who took
 * it, who owns it, and any limit that applies to the lot -- so they are typed
 * once and inherited, exactly as registerImport() already inherits the location
 * from the brief. A per-photograph value overrides its shoot-level counterpart;
 * neither is required to create a draft.
 */
export interface ShootAssetDefaultsInput {
  creditLine?: string;
  copyrightNotice?: string;
  usageRestrictions?: string;
  keywords: string[];
}

export function parseShootAssetDefaults(form: FormData): ShootAssetDefaultsInput {
  return {
    creditLine: optionalText(form, "defaultCreditLine"),
    copyrightNotice: optionalText(form, "defaultCopyrightNotice"),
    usageRestrictions: optionalText(form, "defaultUsageRestrictions"),
    keywords: parseList(optionalText(form, "defaultKeywords")),
  };
}

/** A preview the browser produced and staged next to its original. */
export interface StagedPreviewInput {
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  stagingKey: string;
}

/**
 * One photograph the browser has already put in the staging area, waiting for a
 * shoot to belong to.
 */
export interface StagedPhotographInput {
  filename: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  capturedAt?: string;
  width?: number;
  height?: number;
  stagingKey: string;
  preview?: StagedPreviewInput;
  metadata: AssetMetadataInput;
}

export type StagedPhotographsResult =
  | { readonly ok: true; readonly value: StagedPhotographInput[] }
  | { readonly ok: false; readonly error: string };

/**
 * How many frames one Create shoot may carry.
 *
 * A card dump is bigger than this, which is why the shoot workspace keeps its
 * own import queue: that one registers each file as it lands and survives a
 * closed laptop. This limit is on a single Server Action, where every
 * registration shares one request, and it exists so a request cannot be made
 * arbitrarily long by a value the browser supplied.
 */
export const MAX_STAGED_PHOTOGRAPHS = 200;

function stagedString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

function stagedNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stagedList(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

function parseStagedPreview(value: unknown): StagedPreviewInput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;

  const sha256 = stagedString(source, "sha256");
  const bytes = stagedNumber(source, "bytes");
  const width = stagedNumber(source, "width");
  const height = stagedNumber(source, "height");
  const stagingKey = stagedString(source, "stagingKey");

  // A malformed preview is dropped rather than refused. It is a thumbnail; the
  // original it belongs to is what must not be lost.
  if (!isSha256(sha256) || !bytes || bytes <= 0 || !width || !height || !stagingKey) {
    return undefined;
  }
  return { sha256, bytes, width, height, stagingKey };
}

/**
 * The photographs a Create shoot submission is carrying.
 *
 * These arrive as JSON in a hidden input, which is to say they arrive from the
 * browser and are worth exactly as much as anything else a browser sends. Every
 * field is re-checked here, and the staging key is checked again server-side
 * against the caller's organization by registerImport() -- this parser cannot
 * do that, because it does not know which organization the caller is in.
 *
 * A photograph is refused rather than repaired: bytes whose digest does not
 * parse are bytes nobody can prove the provenance of later, and the whole point
 * of the import path is that the digest is a fact.
 */
export function parseStagedPhotographs(form: FormData): StagedPhotographsResult {
  const raw = text(form, "photographs");
  if (!raw) return { ok: true, value: [] };

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The photographs could not be read. Add them again." };
  }

  if (!Array.isArray(decoded)) {
    return { ok: false, error: "The photographs could not be read. Add them again." };
  }
  if (decoded.length > MAX_STAGED_PHOTOGRAPHS) {
    return {
      ok: false,
      error: `Create the shoot with up to ${MAX_STAGED_PHOTOGRAPHS} photographs, then import the rest from the shoot.`,
    };
  }

  const photographs: StagedPhotographInput[] = [];

  for (const entry of decoded) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: "One of the photographs could not be read. Add it again." };
    }
    const source = entry as Record<string, unknown>;

    const filename = stagedString(source, "filename");
    const sha256 = stagedString(source, "sha256");
    const bytes = stagedNumber(source, "bytes");
    const mimeType = stagedString(source, "mimeType") || "application/octet-stream";
    const stagingKey = stagedString(source, "stagingKey");

    if (!filename) return { ok: false, error: "A photograph arrived without a filename." };
    if (!isSha256(sha256)) {
      return { ok: false, error: `The digest for ${filename} could not be read. Add it again.` };
    }
    if (!bytes || bytes <= 0) {
      return { ok: false, error: `${filename} arrived without a size. Add it again.` };
    }
    if (!stagingKey) {
      return { ok: false, error: `${filename} was never uploaded. Add it again.` };
    }

    const capturedAt = parseTimestamp(stagedString(source, "capturedAt") || undefined);
    const metadata = (source.metadata ?? {}) as Record<string, unknown>;

    const caption = stagedString(metadata, "caption");
    if (caption.length > MAX_CAPTION) {
      return {
        ok: false,
        error: `Keep the caption on ${filename} under ${MAX_CAPTION} characters.`,
      };
    }
    const headline = stagedString(metadata, "headline");
    if (headline.length > MAX_TITLE) {
      return {
        ok: false,
        error: `Keep the headline on ${filename} under ${MAX_TITLE} characters.`,
      };
    }

    photographs.push({
      filename,
      sha256,
      bytes,
      mimeType,
      // An unreadable capture time is dropped, not refused: it is read off the
      // file rather than typed, and the frame is still worth importing.
      capturedAt: capturedAt ?? undefined,
      width: stagedNumber(source, "width"),
      height: stagedNumber(source, "height"),
      stagingKey,
      preview: parseStagedPreview(source.preview),
      metadata: {
        headline: headline || undefined,
        caption: caption || undefined,
        subjects: stagedList(metadata, "subjects"),
        locationName: stagedString(metadata, "locationName") || undefined,
        keywords: stagedList(metadata, "keywords"),
        creditLine: stagedString(metadata, "creditLine") || undefined,
        copyrightNotice: stagedString(metadata, "copyrightNotice") || undefined,
        usageRestrictions: stagedString(metadata, "usageRestrictions") || undefined,
      },
    });
  }

  return { ok: true, value: photographs };
}

export interface ManualStoryInput {
  title: string;
  kind: OpportunityKind;
  sourceName?: string;
  sourceUrl?: string;
  sourcePublishedAt?: string;
  summary?: string;
  signal: OpportunitySignal;
  windowClosesAt?: string;
  suggestionBasis?: string;
  /** 0 to 1. The form field takes a whole percentage. */
  confidence?: number;
}

const MAX_SOURCE_NAME = 120;
const MAX_SUMMARY = 2000;
export const MAX_SUGGESTION_BASIS = 500;
const MAX_SOURCE_URL = 2048;

/**
 * A story's web address, or a reason it cannot be one.
 *
 * Only http(s) is a story source. Anything else -- javascript:, data:, a bare
 * word -- is refused rather than repaired, because this value is rendered back
 * as a link for the whole workspace to click.
 */
function parseSourceUrl(value: string | undefined): string | undefined | null {
  if (!value) return undefined;
  if (value.length > MAX_SOURCE_URL) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.href;
}

export function isOpportunityKind(value: string): value is OpportunityKind {
  return (OPPORTUNITY_KINDS as readonly string[]).includes(value);
}

export function isOpportunitySignal(value: string): value is OpportunitySignal {
  return (OPPORTUNITY_SIGNALS as readonly string[]).includes(value);
}

/**
 * A manually entered News Radar story.
 *
 * Only the headline and the opportunity kind are required: this creates a
 * private workspace record, and a photographer typing between jobs should not
 * be blocked on facts they do not have yet. Everything else is optional and
 * checked only for shape.
 *
 * One rule crosses fields, and the database repeats it as a check constraint:
 * a confidence may not arrive without a stated basis. A bare percentage is a
 * claim with nothing behind it, and this product does not record those.
 */
export function parseManualStory(form: FormData): ParseResult<ManualStoryInput> {
  const errors: FieldErrors<ManualStoryInput> = {};

  const title = text(form, "title");
  if (!title) errors.title = "Give the story a headline.";
  else if (title.length > MAX_TITLE) errors.title = `Keep this under ${MAX_TITLE} characters.`;

  const kindRaw = text(form, "kind");
  const kind = isOpportunityKind(kindRaw) ? kindRaw : null;
  if (!kind) errors.kind = "Choose whether this is an archive match or a shoot opportunity.";

  const signalRaw = text(form, "signal") || "watch";
  const signal = isOpportunitySignal(signalRaw) ? signalRaw : null;
  if (!signal) errors.signal = "Choose a signal.";

  const sourceName = optionalText(form, "sourceName");
  if (sourceName && sourceName.length > MAX_SOURCE_NAME) {
    errors.sourceName = `Keep the source name under ${MAX_SOURCE_NAME} characters.`;
  }

  const sourceUrl = parseSourceUrl(optionalText(form, "sourceUrl"));
  if (sourceUrl === null) {
    errors.sourceUrl = "That does not read as a web address. Use a full http(s) link.";
  }

  const sourcePublishedAt = parseTimestamp(optionalText(form, "sourcePublishedAt"));
  if (sourcePublishedAt === null) {
    errors.sourcePublishedAt = "That date and time could not be read.";
  }

  const windowClosesAt = parseTimestamp(optionalText(form, "windowClosesAt"));
  if (windowClosesAt === null) {
    errors.windowClosesAt = "That date and time could not be read.";
  }

  const summary = optionalText(form, "summary");
  if (summary && summary.length > MAX_SUMMARY) {
    errors.summary = `Keep the summary under ${MAX_SUMMARY} characters.`;
  }

  const suggestionBasis = optionalText(form, "suggestionBasis");
  if (suggestionBasis && suggestionBasis.length > MAX_SUGGESTION_BASIS) {
    errors.suggestionBasis = `Keep this under ${MAX_SUGGESTION_BASIS} characters.`;
  }

  // The form takes a whole percentage; the record keeps 0 to 1.
  const confidenceRaw = optionalText(form, "confidence");
  let confidence: number | undefined;
  if (confidenceRaw !== undefined) {
    const parsed = Number(confidenceRaw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      errors.confidence = "Confidence is a percentage between 0 and 100.";
    } else {
      confidence = Math.round(parsed) / 100;
    }
  }
  if (confidence !== undefined && !suggestionBasis && !errors.suggestionBasis) {
    errors.suggestionBasis =
      "A confidence needs a stated basis. Say what the number is a confidence in.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      title,
      kind: kind as OpportunityKind,
      sourceName,
      sourceUrl: sourceUrl ?? undefined,
      sourcePublishedAt: sourcePublishedAt ?? undefined,
      summary,
      signal: signal as OpportunitySignal,
      windowClosesAt: windowClosesAt ?? undefined,
      suggestionBasis,
      confidence,
    },
  };
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
      errors.workspaceSlug = `Use lowercase letters, numbers and hyphens, up to ${SLUG_MAX_LENGTH} characters.`;
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
