/**
 * Suggested caption metadata, and the rules that keep a suggestion a suggestion.
 *
 * A vision model can read a frame and propose a headline, a caption, and
 * keywords far faster than anyone can type them at a kerbside. It cannot know
 * who is in the picture, and it must never be allowed to imply that it does.
 *
 * So this module is deliberately conservative:
 *
 *   - Nothing here writes to an asset. A suggestion is returned to the browser,
 *     shown as a suggestion, edited if the operator wants, and saved only by
 *     the existing save action -- `suggest -> explain -> confirm`.
 *   - People are never suggested. Naming a face is a factual claim with legal
 *     consequences under publicity and privacy law, and a wrong name attached
 *     to a licensed frame is the worst failure this product could produce.
 *     The People field is left for the photographer, who was there.
 *   - Every field is capped and trimmed here rather than trusted from the
 *     model, so a long or malformed response cannot reach a form or a buyer.
 *
 * The pure parts live here so they can be tested without a network.
 */

export const MAX_HEADLINE = 120;
export const MAX_CAPTION = 700;
export const MAX_KEYWORDS = 12;
export const MAX_KEYWORD_LENGTH = 40;

export interface MetadataSuggestion {
  readonly headline: string;
  readonly caption: string;
  readonly keywords: readonly string[];
  /** Why this was proposed, shown next to the fields. Never hidden. */
  readonly basis: string;
  /** 0 to 1, as reported by the model and clamped here. */
  readonly confidence: number;
}

/** Facts the operator already recorded, given to the model as context. */
export interface SuggestionContext {
  readonly shootTitle?: string;
  readonly storyAngle?: string;
  readonly locationName?: string;
  readonly capturedAt?: string;
  readonly isVideo?: boolean;
}

const collapse = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/u, " ").replace(/\s+/gu, " ").trim() : "";

/**
 * Clean whatever the model returned into something safe to put in a form.
 *
 * Exported and pure: a suggestion that arrives malformed should be visibly
 * empty, never partially applied and never thrown.
 */
export function normaliseSuggestion(
  raw: unknown,
  fallbackBasis: string,
): MetadataSuggestion | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const headline = collapse(record.headline).slice(0, MAX_HEADLINE);
  const caption = collapse(record.caption).slice(0, MAX_CAPTION);

  const keywords = (Array.isArray(record.keywords) ? record.keywords : [])
    .map((keyword) => collapse(keyword).toLowerCase())
    .filter((keyword) => keyword.length > 0 && keyword.length <= MAX_KEYWORD_LENGTH)
    // Order is preserved, which puts the model's strongest keyword first.
    .filter((keyword, index, all) => all.indexOf(keyword) === index)
    .slice(0, MAX_KEYWORDS);

  if (!headline && !caption && keywords.length === 0) return null;

  const rawConfidence = typeof record.confidence === "number" ? record.confidence : 0.5;
  const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0.5;

  return {
    headline,
    caption,
    keywords,
    basis: collapse(record.basis) || fallbackBasis,
    confidence,
  };
}

/**
 * The instruction the model is given.
 *
 * Written as a briefing for a picture desk sub-editor rather than a generic
 * captioning prompt, because the output has to survive being read by one.
 */
export const SUGGESTION_SYSTEM_PROMPT = [
  "You are helping a working news photographer draft caption metadata for a frame",
  "they just shot. Your output is a draft the photographer will read and correct;",
  "it is never published as-is.",
  "",
  "Rules, in order of importance:",
  "1. Never name, guess at, or describe the identity of any person in the frame.",
  "   Refer to people by what is visible: 'a man in a dark coat', 'two people'.",
  "   The photographer records who it is; you do not.",
  "2. Describe only what is visible. Do not infer the event, the relationship",
  "   between people, the reason for anything, or anyone's emotional state beyond",
  "   plainly visible expression.",
  "3. Use the facts the photographer already recorded (shoot, location, time)",
  "   where they help. Do not contradict them and do not invent new ones.",
  "4. Write in the flat, factual register of a wire caption: present tense, no",
  "   adjectives that editorialise, no speculation.",
  "5. If the frame is too dark, blurred, or ambiguous to describe, say so in the",
  "   caption and return a low confidence rather than inventing detail.",
  "",
  "Keywords are lowercase search terms a picture desk would use: setting,",
  "clothing, objects, weather, activity. No names of people.",
].join("\n");

/** The per-frame message, assembled from what the operator already recorded. */
export function buildSuggestionPrompt(context: SuggestionContext): string {
  const known: string[] = [];
  if (context.shootTitle) known.push(`Shoot: ${context.shootTitle}`);
  if (context.storyAngle) known.push(`Story angle: ${context.storyAngle}`);
  if (context.locationName)
    known.push(`Location recorded by the photographer: ${context.locationName}`);
  if (context.capturedAt) known.push(`Captured at: ${context.capturedAt}`);

  return [
    context.isVideo
      ? "This is a frame taken from a video clip. Describe the clip on the basis of this frame, and say in the caption that it is a still from video."
      : "This is a photograph from the shoot below.",
    known.length > 0
      ? `\nWhat the photographer has already recorded:\n${known.join("\n")}`
      : "\nThe photographer has not recorded anything about this frame yet.",
    "\nDraft a headline, a caption, and keywords. Do not name anyone.",
  ].join("\n");
}

/** How a suggestion is explained in the interface. */
export function describeBasis(context: SuggestionContext): string {
  const parts = [context.isVideo ? "Read from a frame of the clip" : "Read from the image"];
  if (context.shootTitle) parts.push(`with the shoot brief`);
  if (context.locationName) parts.push(`and the recorded location`);
  return `${parts.join(" ")}. People are never suggested.`;
}
