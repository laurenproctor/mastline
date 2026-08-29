import {
  type ContextProvenance,
  type EntityKind,
  type SignalContext,
  type SignalEntity,
  normalizeTerm,
} from "./news-radar-evaluation";
import { parseTimestamp } from "./validation";

/**
 * Structured context for a story: what the editor collects, how it is
 * checked, and what the system may suggest from the story's own words.
 *
 * Feature-local on purpose. The shared validation module is being reshaped
 * by concurrent work, and everything here is specific to News Radar.
 *
 * Three registers, kept apart wherever they are shown:
 *
 *   source   facts recorded on the canonical signal (headline, source, date)
 *   manual   context a person typed into the editor below
 *   system   a suggestion drawn from the story's text by a fixed rule, which
 *            becomes a recorded fact only when a person accepts it -- and
 *            then keeps the basis and confidence that were shown
 *
 * No model reads the story. The suggestion rules are a handful of regular
 * expressions over capitalised phrases; they are here so the "suggest ->
 * explain -> confirm" shape exists from the start, not because they are
 * clever.
 */

export const CONTEXT_LIST_MAX = 20;
export const CONTEXT_VALUE_MAX = 200;
export const CONTEXT_NOTE_MAX = 500;

export interface ContextInput {
  readonly people: readonly string[];
  readonly organizations: readonly string[];
  readonly topics: readonly string[];
  readonly keywords: readonly string[];
  readonly locationName?: string;
  readonly eventStartsAt?: string;
  readonly eventEndsAt?: string;
  readonly windowNote?: string;
}

export type ContextFieldErrors = Partial<Record<keyof ContextInput | "_form", string>>;

export type ContextParseResult =
  | { readonly ok: true; readonly value: ContextInput }
  | { readonly ok: false; readonly errors: ContextFieldErrors };

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A list typed as one line per entry or comma-separated, deduplicated on the
 * normalized value, keeping the first spelling seen.
 */
export function parseContextList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/[\n,]/)) {
    const entry = raw.trim().replace(/\s+/g, " ");
    if (!entry) continue;
    const normalized = normalizeTerm(entry);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(entry);
  }
  return out;
}

function checkList(values: readonly string[], label: string): string | undefined {
  if (values.length > CONTEXT_LIST_MAX) return `Keep ${label} to ${CONTEXT_LIST_MAX} entries.`;
  if (values.some((value) => value.length > CONTEXT_VALUE_MAX)) {
    return `Keep each entry under ${CONTEXT_VALUE_MAX} characters.`;
  }
  return undefined;
}

export function parseContextForm(form: FormData): ContextParseResult {
  const errors: ContextFieldErrors = {};

  const people = parseContextList(text(form, "people"));
  const organizations = parseContextList(text(form, "organizations"));
  const topics = parseContextList(text(form, "topics"));
  const keywords = parseContextList(text(form, "keywords"));

  const peopleError = checkList(people, "people");
  if (peopleError) errors.people = peopleError;
  const organizationsError = checkList(organizations, "organizations");
  if (organizationsError) errors.organizations = organizationsError;
  const topicsError = checkList(topics, "topics");
  if (topicsError) errors.topics = topicsError;
  const keywordsError = checkList(keywords, "keywords");
  if (keywordsError) errors.keywords = keywordsError;

  const locationName = text(form, "locationName").replace(/\s+/g, " ") || undefined;
  if (locationName && locationName.length > CONTEXT_VALUE_MAX) {
    errors.locationName = `Keep the location under ${CONTEXT_VALUE_MAX} characters.`;
  }

  const eventStartsAt = parseTimestamp(text(form, "eventStartsAt") || undefined);
  if (eventStartsAt === null) errors.eventStartsAt = "That is not a date and time.";
  const eventEndsAt = parseTimestamp(text(form, "eventEndsAt") || undefined);
  if (eventEndsAt === null) errors.eventEndsAt = "That is not a date and time.";
  if (
    eventStartsAt &&
    eventEndsAt &&
    new Date(eventEndsAt).getTime() < new Date(eventStartsAt).getTime()
  ) {
    errors.eventEndsAt = "The event cannot end before it starts.";
  }

  const windowNote = text(form, "windowNote") || undefined;
  if (windowNote && windowNote.length > CONTEXT_NOTE_MAX) {
    errors.windowNote = `Keep the window note under ${CONTEXT_NOTE_MAX} characters.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      people,
      organizations,
      topics,
      keywords,
      locationName,
      eventStartsAt: eventStartsAt ?? undefined,
      eventEndsAt: eventEndsAt ?? undefined,
      windowNote,
    },
  };
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export type SuggestionKind = "person" | "organization" | "location" | "keyword";

export interface ContextSuggestion {
  readonly kind: SuggestionKind;
  readonly value: string;
  /** Why this was suggested, in words. Stored with the fact if accepted. */
  readonly basis: string;
  /** 0 to 1. Stored with the fact if accepted. */
  readonly confidence: number;
}

/** Whole-phrase endings that name an organization or venue rather than a person. */
const ORGANIZATION_ENDINGS = new Set([
  "airport",
  "arena",
  "awards",
  "bank",
  "cathedral",
  "centre",
  "center",
  "church",
  "club",
  "college",
  "corporation",
  "council",
  "court",
  "department",
  "fc",
  "festival",
  "foundation",
  "gallery",
  "group",
  "hall",
  "hospital",
  "hotel",
  "inc",
  "institute",
  "limited",
  "llc",
  "ltd",
  "museum",
  "palace",
  "police",
  "school",
  "stadium",
  "studios",
  "theatre",
  "theater",
  "united",
  "university",
]);

/** Whole-phrase endings that name a place. */
const PLACE_ENDINGS = new Set([
  "avenue",
  "beach",
  "bridge",
  "city",
  "island",
  "park",
  "road",
  "square",
  "street",
]);

/** Words that begin a place phrase: "in Paris", "outside the Old Bailey". */
const PLACE_PREPOSITIONS = new Set(["in", "at", "outside", "near", "inside", "from"]);

/** Capitalised words that are never a name by themselves. */
const SENTENCE_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

interface Token {
  readonly text: string;
  readonly capitalised: boolean;
  /** Ends a sentence or clause, so the next word may be capitalised for that reason alone. */
  readonly boundaryAfter: boolean;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    const boundaryAfter = /[.!?:;,—–-]$/.test(raw);
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, "");
    if (!word) continue;
    tokens.push({
      text: word,
      capitalised: /^\p{Lu}/u.test(word) && !SENTENCE_WORDS.has(word.toLowerCase()),
      boundaryAfter,
    });
  }
  return tokens;
}

/**
 * Whether a text is written in Title Case, where capitals say nothing.
 *
 * Two tells, either of which is enough: a function word capitalised in the
 * middle of the text ("On", "The"), or nearly every word capitalised. A
 * headline that is merely full of names -- "Avery Hart departs Hotel
 * Chelsea in New York" -- has neither.
 */
function isTitleCase(tokens: readonly Token[]): boolean {
  if (tokens.length < 4) return false;
  const functionWordCapitalised = tokens.some(
    (token, index) =>
      index > 0 && /^\p{Lu}/u.test(token.text) && SENTENCE_WORDS.has(token.text.toLowerCase()),
  );
  if (functionWordCapitalised) return true;
  const capitalised = tokens.filter((token) => /^\p{Lu}/u.test(token.text)).length;
  return capitalised / tokens.length >= 0.9;
}

function classify(phrase: readonly string[], afterPreposition: boolean): SuggestionKind {
  const last = phrase[phrase.length - 1].toLowerCase();
  const first = phrase[0].toLowerCase();
  if (PLACE_ENDINGS.has(last)) return "location";
  if (ORGANIZATION_ENDINGS.has(last) || ORGANIZATION_ENDINGS.has(first)) {
    return afterPreposition ? "location" : "organization";
  }
  if (afterPreposition) return "location";
  return "person";
}

function collect(
  where: "headline" | "summary",
  input: string,
  found: Map<string, ContextSuggestion>,
): void {
  const tokens = tokenize(input);
  if (isTitleCase(tokens)) return;

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    // The first word of a sentence is capitalised for grammar, not identity,
    // unless it continues into a second capitalised word.
    const sentenceStart = index === 0 || tokens[index - 1].boundaryAfter;
    if (!token.capitalised) {
      index += 1;
      continue;
    }

    const phrase: string[] = [token.text];
    let end = index;
    while (end + 1 < tokens.length && tokens[end + 1].capitalised && !tokens[end].boundaryAfter) {
      end += 1;
      phrase.push(tokens[end].text);
    }

    const previous = index > 0 ? tokens[index - 1].text.toLowerCase() : "";
    const afterPreposition = PLACE_PREPOSITIONS.has(previous);

    if (phrase.length >= 2 || (afterPreposition && !sentenceStart)) {
      if (!(phrase.length === 1 && sentenceStart)) {
        const kind = classify(phrase, afterPreposition);
        const value = phrase.join(" ");
        const key = `${kind}:${normalizeTerm(value)}`;
        if (!found.has(key)) {
          found.set(key, {
            kind,
            value,
            basis: afterPreposition
              ? `Follows “${previous}” in the ${where}`
              : `Capitalised phrase in the ${where}`,
            confidence: afterPreposition ? 0.5 : phrase.length >= 3 ? 0.45 : 0.4,
          });
        }
      }
    }
    index = end + 1;
  }
}

/**
 * What the story's own words suggest, minus anything already recorded.
 *
 * Deterministic: the same headline and summary always yield the same list in
 * the same order. Every suggestion carries the rule that produced it and a
 * fixed confidence, and nothing here is recorded until a person accepts it.
 */
export function suggestContext(
  story: { readonly title: string; readonly summary?: string },
  recorded: { readonly entities: readonly SignalEntity[]; readonly context: SignalContext },
): readonly ContextSuggestion[] {
  const found = new Map<string, ContextSuggestion>();
  collect("headline", story.title, found);
  if (story.summary) collect("summary", story.summary, found);

  const already = new Set<string>();
  for (const entity of recorded.entities) {
    already.add(normalizeTerm(entity.value));
  }
  if (recorded.context.locationName) already.add(normalizeTerm(recorded.context.locationName));

  return [...found.values()].filter((suggestion) => !already.has(normalizeTerm(suggestion.value)));
}

/** The entity kind a suggestion kind records as; a location goes to the context row instead. */
export function entityKindForSuggestion(kind: SuggestionKind): EntityKind | undefined {
  return kind === "location" ? undefined : kind;
}

export function isSuggestionKind(value: string): value is SuggestionKind {
  return (
    value === "person" || value === "organization" || value === "location" || value === "keyword"
  );
}

/**
 * A suggestion coming back from the browser is re-derived from the story
 * rather than trusted: the form names a kind and a value, and the server
 * accepts it only if the same rule would suggest it now. The basis and
 * confidence that get stored are the rule's, never the browser's.
 */
export function findSuggestion(
  suggestions: readonly ContextSuggestion[],
  kind: string,
  value: string,
): ContextSuggestion | undefined {
  if (!isSuggestionKind(kind)) return undefined;
  const normalized = normalizeTerm(value);
  return suggestions.find(
    (suggestion) => suggestion.kind === kind && normalizeTerm(suggestion.value) === normalized,
  );
}

export const PROVENANCE_LABELS: Record<ContextProvenance, string> = {
  manual: "Entered by a person",
  source: "Recorded from the source",
  system: "Suggested, then accepted",
};

export const ENTITY_KIND_LABELS: Record<EntityKind, string> = {
  person: "Person",
  organization: "Organization",
  topic: "Topic",
  keyword: "Keyword",
};

export const SUGGESTION_KIND_LABELS: Record<SuggestionKind, string> = {
  person: "person",
  organization: "organization",
  location: "location",
  keyword: "keyword",
};
