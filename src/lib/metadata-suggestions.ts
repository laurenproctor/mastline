/**
 * The contract with the model, and the rules that keep a suggestion a suggestion.
 *
 * A vision model can read a frame and propose a headline, a caption, alt text,
 * a scene, visible objects and brands far faster than anyone can type them at a
 * kerbside. It cannot know who is in the picture, where exactly it was taken,
 * what event it belongs to, or whether anyone signed a release -- and it must
 * never be allowed to imply that it does.
 *
 * So this module is deliberately conservative:
 *
 *   - Nothing here writes. It shapes the request and cleans the response; the
 *     data layer decides what may be stored, and a person decides what may be
 *     used. `suggest -> explain -> confirm`, with the confirm step now recorded
 *     against a name and a time rather than implied by a Save.
 *   - People are never proposed. Naming a face is a factual claim with legal
 *     consequences under publicity and privacy law, and a wrong name attached
 *     to a licensed frame is the worst failure this product could produce. The
 *     model is TOLD who the photographer says is present, so a caption can be
 *     written around it, and it may not add to that list or return one.
 *   - Rights, releases, and commercial eligibility are absent from the schema
 *     entirely. A field a model cannot see is a field it cannot get wrong.
 *   - Every value is capped and trimmed here rather than trusted, so a long or
 *     malformed response cannot reach a form, a database, or a buyer.
 *
 * The pure parts live here so they can be tested without a network.
 */

import {
  CONTENT_CATEGORIES,
  type ContentCategory,
  QUALITY_ESTIMATES,
  type QualityEstimate,
  SENSITIVITIES,
  type Sensitivity,
} from "./asset-metadata";

/**
 * Whether a model accepts `output_config.effort`.
 *
 * Haiku 4.5 -- the default -- rejects effort with a 400 rather than ignoring
 * it, so this is a correctness check and not a tuning one. That is why it is an
 * allow list: an unrecognised override sends no effort and gets the model's own
 * default, which is always a valid request. Guessing the other way would turn a
 * new model id into a failed generation.
 */
export function supportsEffort(model: string): boolean {
  return /^claude-(opus|fable|mythos)-/.test(model) || /^claude-sonnet-(5|4-6)/.test(model);
}

export const MAX_HEADLINE = 120;
export const MAX_CAPTION = 700;
export const MAX_ALT_TEXT = 300;
export const MAX_SHORT_TEXT = 120;
export const MAX_KEYWORDS = 12;
export const MAX_LIST_ITEMS = 10;
export const MAX_ITEM_LENGTH = 40;

/** The fields confidence is reported for. Small and fixed, so it stays honest. */
export const CONFIDENCE_FIELDS = ["editorialCaption", "city", "brands", "contentCategory"] as const;
export type ConfidenceField = (typeof CONFIDENCE_FIELDS)[number];

export interface GeneratedMetadata {
  readonly headline?: string;
  readonly editorialCaption?: string;
  readonly altText?: string;
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
  /** What the model says it could not settle. Shown, never hidden. */
  readonly uncertaintyNote?: string;
  /** Why this was proposed, shown next to the fields. Never hidden. */
  readonly basis: string;
  /** 0 to 1, as reported by the model and clamped here. */
  readonly confidence: number;
  readonly fieldConfidence: Readonly<Partial<Record<ConfidenceField, number>>>;
}

/** Facts the photographer already recorded, given to the model as context. */
export interface SuggestionContext {
  readonly shootTitle?: string;
  readonly storyAngle?: string;
  readonly locationName?: string;
  readonly capturedAt?: string;
  readonly knownSubjects?: readonly string[];
  readonly isVideo?: boolean;
}

const collapse = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";

const text = (value: unknown, max: number): string | undefined => {
  const cleaned = collapse(value).slice(0, max);
  return cleaned.length > 0 ? cleaned : undefined;
};

/**
 * A list of short terms, cleaned the same way everywhere.
 *
 * Order is preserved, which keeps the model's strongest term first. Casing is
 * flattened for keywords only; a brand or a garment reads badly lowercased and
 * a desk searches keywords, not clothing.
 */
function list(value: unknown, options: { lowercase?: boolean; max?: number } = {}): string[] {
  const { lowercase = false, max = MAX_LIST_ITEMS } = options;
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of value) {
    const cleaned = collapse(entry);
    const item = lowercase ? cleaned.toLowerCase() : cleaned;
    if (item.length === 0 || item.length > MAX_ITEM_LENGTH) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }

  return out;
}

const clamp01 = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  const candidate = collapse(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return (allowed as readonly string[]).includes(candidate) ? (candidate as T) : undefined;
}

/**
 * Clean whatever the model returned into something safe to store.
 *
 * Exported and pure: a response that arrives malformed should be visibly empty,
 * never partially applied and never thrown. Returning null is the signal that
 * there is nothing worth recording, which the caller turns into a failure the
 * photographer can retry rather than a record full of blanks.
 */
export function normaliseGeneration(raw: unknown, fallbackBasis: string): GeneratedMetadata | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const headline = text(record.headline, MAX_HEADLINE);
  const editorialCaption = text(record.caption, MAX_CAPTION);
  const altText = text(record.alt_text, MAX_ALT_TEXT);
  const keywords = list(record.keywords, { lowercase: true, max: MAX_KEYWORDS });
  const objects = list(record.objects);
  const clothing = list(record.clothing);
  const brands = list(record.brands);

  // Nothing describable came back. A record of empty strings would look like a
  // successful generation and read like a broken one.
  if (
    !headline &&
    !editorialCaption &&
    !altText &&
    keywords.length === 0 &&
    objects.length === 0 &&
    brands.length === 0
  ) {
    return null;
  }

  const rawFieldConfidence =
    record.field_confidence && typeof record.field_confidence === "object"
      ? (record.field_confidence as Record<string, unknown>)
      : {};

  const fieldConfidence: Partial<Record<ConfidenceField, number>> = {};
  const CONFIDENCE_KEYS: Record<ConfidenceField, string> = {
    editorialCaption: "caption",
    city: "location",
    brands: "brands",
    contentCategory: "category",
  };
  for (const field of CONFIDENCE_FIELDS) {
    const value = rawFieldConfidence[CONFIDENCE_KEYS[field]];
    if (typeof value === "number" && Number.isFinite(value)) {
      fieldConfidence[field] = clamp01(value, 0.5);
    }
  }

  return {
    headline,
    editorialCaption,
    altText,
    eventName: text(record.event, MAX_SHORT_TEXT),
    venue: text(record.venue, MAX_SHORT_TEXT),
    city: text(record.city, MAX_SHORT_TEXT),
    region: text(record.region, MAX_SHORT_TEXT),
    country: text(record.country, MAX_SHORT_TEXT),
    scene: text(record.scene, MAX_SHORT_TEXT),
    objects,
    clothing,
    brands,
    keywords,
    contentCategory: oneOf(record.category, CONTENT_CATEGORIES),
    qualityEstimate: oneOf(record.quality, QUALITY_ESTIMATES),
    // Absent means "nothing to flag", which is the safe reading of silence for
    // a field the model may raise and may never lower.
    sensitivity: oneOf(record.sensitivity, SENSITIVITIES) ?? "none",
    uncertaintyNote: text(record.uncertainty_note, 300),
    basis: text(record.basis, 300) ?? fallbackBasis,
    confidence: clamp01(record.confidence, 0.5),
    fieldConfidence,
  };
}

/**
 * The instruction the model is given.
 *
 * Written as a briefing for a picture desk sub-editor rather than a generic
 * captioning prompt, because the output has to survive being read by one.
 */
export const GENERATION_SYSTEM_PROMPT = [
  "You are helping a working news photographer draft metadata for a frame they",
  "just shot. Your output is a draft the photographer will read, correct, and",
  "confirm. It is never published as-is and it is never treated as fact until a",
  "person confirms it.",
  "",
  "Rules, in order of importance:",
  "",
  "1. Never name, guess at, or otherwise identify any person in the frame, and",
  "   never work backwards from a face. Refer to people by what is visible:",
  "   'a man in a dark coat', 'two people'. If the photographer has told you who",
  "   is present you may write a caption around that, but you must not add to",
  "   the list, correct it, or claim to have recognised anyone yourself.",
  "",
  "2. Describe only what is visible, or what the photographer has already",
  "   recorded. Do not infer the event, the venue, the city, the relationship",
  "   between people, the reason for anything, or anyone's emotional state",
  "   beyond a plainly visible expression.",
  "",
  "3. Return null for any field you cannot settle, and an empty array for any",
  "   list you cannot fill. A null is a correct answer. A plausible guess is",
  "   not, and is worse than a blank because somebody may believe it.",
  "",
  "4. Only name a city, region, or country if the photographer recorded it or if",
  "   it is unambiguously readable in the frame -- a street sign, a registered",
  "   vehicle plate, a named building. Otherwise return null.",
  "",
  "5. Only list a brand or product you can actually read or unmistakably see.",
  "   A logo you are inferring from a shape is not a brand you have seen.",
  "",
  "6. Write in the flat, factual register of a wire caption: present tense, no",
  "   adjectives that editorialise, no speculation, nothing sensational.",
  "",
  "7. Raise sensitivity to 'review' if the frame may involve a child, a medical",
  "   or distressing situation, a private moment, or anything a desk should look",
  "   at before publishing; 'sensitive' if that is clearly the case. Never lower",
  "   it, and say why in uncertainty_note.",
  "",
  "8. If the frame is too dark, blurred, or ambiguous to describe, say so in the",
  "   caption, set quality accordingly, and return a low confidence rather than",
  "   inventing detail.",
  "",
  "Alt text is for a reader who cannot see the image: one sentence, literal,",
  "no names. Keywords are lowercase search terms a picture desk would use:",
  "setting, clothing, objects, weather, activity. No names of people anywhere.",
].join("\n");

/** The per-frame message, assembled from what the photographer already recorded. */
export function buildGenerationPrompt(context: SuggestionContext): string {
  const known: string[] = [];
  if (context.shootTitle) known.push(`Shoot: ${context.shootTitle}`);
  if (context.storyAngle) known.push(`Story angle: ${context.storyAngle}`);
  if (context.locationName)
    known.push(`Location recorded by the photographer: ${context.locationName}`);
  if (context.capturedAt) known.push(`Captured at: ${context.capturedAt}`);
  if (context.knownSubjects && context.knownSubjects.length > 0) {
    known.push(
      `People the photographer says are present: ${context.knownSubjects.join(", ")}. ` +
        "Use this to write the caption. Do not add anyone, and do not return a list of people.",
    );
  }

  return [
    context.isVideo
      ? "This is a frame taken from a video clip. Describe the clip on the basis of this frame, and say in the caption that it is a still from video."
      : "This is a photograph from the shoot below.",
    known.length > 0
      ? `\nWhat the photographer has already recorded:\n${known.join("\n")}`
      : "\nThe photographer has not recorded anything about this frame yet.",
    "\nDraft the metadata. Return null for anything you cannot settle from the frame or from the notes above.",
  ].join("\n");
}

/** How a generation is explained in the interface. */
export function describeBasis(context: SuggestionContext): string {
  const parts = [context.isVideo ? "Read from a frame of the clip" : "Read from the image"];
  if (context.shootTitle) parts.push("with the shoot brief");
  if (context.locationName) parts.push("and the recorded location");
  return `${parts.join(" ")}. People are never identified by Mastline.`;
}
