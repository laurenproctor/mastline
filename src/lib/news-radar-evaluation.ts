import type { AssetStatus, IsoTimestamp } from "./domain";
import { formatDateTime } from "./format";

/**
 * The News Radar evaluator: pure, versioned, deterministic.
 *
 * Two questions are asked of every story, and this module answers both from
 * rows alone:
 *
 *   archive  Which photographs the workspace already owns look relevant to
 *            this story, and exactly why?
 *   shoot    Do the recorded facts support a new shoot, and what does the
 *            photographer still have to confirm?
 *
 * No model, no vector, no feed, no clock read inside the scorer. Everything is
 * a function of its input, the weights are named constants, ties are broken
 * by stable keys, and the whole input can be reduced to a canonical string
 * whose hash says whether a rerun has anything new to compute. Change a
 * weight or a rule and bump EVALUATOR_VERSION: a stored result is only
 * comparable to another under the same version.
 *
 * Nothing here is a fact the evaluator made up. A person's whereabouts, an
 * event time, access, a confirmed appearance, buyer demand, a price -- none
 * of these are ever inferred. When the recorded context is not enough, the
 * answer is `needs_context` and a list of exactly what to confirm.
 *
 * Deliberately free of server imports so it can be unit-tested and shared
 * with client components.
 */

export const EVALUATOR_VERSION = "news-radar/1";

export const EVALUATION_STATES = [
  "not_evaluated",
  "evaluating",
  "ready",
  "needs_context",
  "failed",
] as const;
export type EvaluationState = (typeof EVALUATION_STATES)[number];

/** Where a piece of context came from. */
export const CONTEXT_PROVENANCES = ["manual", "source", "system"] as const;
export type ContextProvenance = (typeof CONTEXT_PROVENANCES)[number];

export const ENTITY_KINDS = ["person", "organization", "topic", "keyword"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const EVALUATION_FAILURE_CODES = [
  "denied",
  "not_found",
  "invalid_result",
  "asset_not_in_workspace",
  "write_failed",
  "archive_read_failed",
  "context_read_failed",
  "evaluator_error",
] as const;
export type EvaluationFailureCode = (typeof EVALUATION_FAILURE_CODES)[number];

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The story's source facts, as both paths read them from the canonical signal. */
export interface EvaluationStory {
  readonly title: string;
  readonly summary?: string;
  readonly sourceName?: string;
  readonly sourceUrl?: string;
  readonly sourcePublishedAt?: IsoTimestamp;
}

export interface SignalEntity {
  readonly kind: EntityKind;
  readonly value: string;
  readonly provenance: ContextProvenance;
  readonly basis?: string;
  readonly confidence?: number;
}

export interface SignalContext {
  readonly locationName?: string;
  readonly locationProvenance: ContextProvenance;
  readonly locationBasis?: string;
  readonly locationConfidence?: number;
  readonly eventStartsAt?: IsoTimestamp;
  readonly eventEndsAt?: IsoTimestamp;
  readonly eventTimeProvenance: ContextProvenance;
  readonly eventTimeBasis?: string;
  readonly eventTimeConfidence?: number;
  readonly windowNote?: string;
}

/** A context row that was never written. The story is still whole. */
export const EMPTY_CONTEXT: SignalContext = {
  locationProvenance: "manual",
  eventTimeProvenance: "manual",
};

/**
 * One owned photograph as the archive scorer sees it. Only fields that exist
 * on `public.assets` today; nothing here is enriched or guessed.
 */
export interface ArchiveCandidate {
  readonly assetId: string;
  readonly status: AssetStatus;
  readonly canonicalFilename: string;
  readonly headline?: string;
  readonly caption?: string;
  readonly subjects: readonly string[];
  readonly keywords: readonly string[];
  readonly locationName?: string;
  readonly capturedAt?: IsoTimestamp;
  readonly copyrightNotice?: string;
  readonly creditLine?: string;
  readonly usageRestrictions?: string;
}

export interface ArchiveEvaluationInput {
  readonly story: EvaluationStory;
  readonly context: SignalContext;
  readonly entities: readonly SignalEntity[];
  readonly candidates: readonly ArchiveCandidate[];
}

export interface WorkspacePreferences {
  /** From onboarding. Absent when the photographer never said. */
  readonly baseCity?: string;
  /** From onboarding. Empty when none were chosen. */
  readonly specialties: readonly string[];
  readonly timeZone: string;
}

export interface ShootEvaluationInput {
  readonly story: EvaluationStory;
  readonly context: SignalContext;
  readonly entities: readonly SignalEntity[];
  /** The shoot path's own useful window, as recorded on the path. */
  readonly windowClosesAt?: IsoTimestamp;
  readonly workspace: WorkspacePreferences;
  /**
   * The clock, passed in. It shapes the window state and the timing lines
   * and is deliberately NOT part of the input hash: a rerun with nothing else
   * changed has nothing new to compute, and the interface re-derives the
   * live window from the stored timestamps.
   */
  readonly now: Date;
}

// ---------------------------------------------------------------------------
// Normalization and terms
// ---------------------------------------------------------------------------

/**
 * Lower case, trimmed, inner whitespace collapsed -- exactly the three steps
 * `private.news_radar_normalize` applies in the database, so an entity is
 * the same entity on both sides.
 */
export function normalizeTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Words that carry no editorial meaning on their own. Short and deliberately
 * boring: the term overlap is the weakest signal here and is capped, so the
 * list only has to stop the obvious noise from scoring.
 */
const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "also",
  "amid",
  "among",
  "another",
  "around",
  "back",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "could",
  "does",
  "down",
  "during",
  "each",
  "even",
  "ever",
  "every",
  "first",
  "from",
  "have",
  "here",
  "into",
  "just",
  "last",
  "later",
  "like",
  "made",
  "make",
  "more",
  "most",
  "much",
  "near",
  "next",
  "only",
  "other",
  "over",
  "photo",
  "photos",
  "picture",
  "pictures",
  "said",
  "says",
  "seen",
  "several",
  "should",
  "since",
  "some",
  "still",
  "such",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "today",
  "under",
  "until",
  "very",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "will",
  "with",
  "would",
  "year",
  "years",
]);

const MIN_TERM_LENGTH = 4;

/** Significant words of a text: letters and digits, four characters or more, not stopwords. */
export function significantTerms(text: string | undefined): Set<string> {
  const terms = new Set<string>();
  if (!text) return terms;
  for (const token of normalizeTerm(text).split(/[^\p{L}\p{N}]+/u)) {
    if (token.length >= MIN_TERM_LENGTH && !STOPWORDS.has(token)) terms.add(token);
  }
  return terms;
}

/** Whether `phrase` appears whole, on word boundaries, inside `text`. */
function containsPhrase(text: string | undefined, phrase: string): boolean {
  if (!text || !phrase) return false;
  const haystack = ` ${normalizeTerm(text).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const needle = ` ${phrase.replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  return haystack.includes(needle);
}

function uniqueNormalized(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeTerm(value);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

function entityValues(entities: readonly SignalEntity[], kind: EntityKind): string[] {
  return uniqueNormalized(entities.filter((entity) => entity.kind === kind).map((e) => e.value));
}

/** The display spelling of a normalized value, as it was recorded. */
function displayValue(entities: readonly SignalEntity[], normalized: string): string {
  return entities.find((entity) => normalizeTerm(entity.value) === normalized)?.value ?? normalized;
}

// ---------------------------------------------------------------------------
// Archive scoring
// ---------------------------------------------------------------------------

/**
 * The weights, in points out of 100. Every component is named so the
 * breakdown stored beside a match can be read back against this table.
 *
 * The first five are OVERLAP components: at least one of them must be
 * non-zero for an asset to be a match at all. The last three describe the
 * asset's readiness and only ever add to an existing overlap.
 */
export const ARCHIVE_WEIGHTS = {
  /** An exact normalized person on the story equals a subject on the asset. */
  personMatch: 40,
  personCap: 60,
  /** An organization on the story equals an asset keyword, or is named whole in its text. */
  organizationMatch: 15,
  organizationCap: 30,
  /** A topic or keyword on the story equals an asset keyword. */
  keywordMatch: 10,
  keywordCap: 30,
  /** The story's location equals the asset's, or is named whole in its text. */
  locationExact: 20,
  /** The two locations share a significant word. */
  locationPartial: 10,
  /** Each significant word shared between the story's text and the asset's. */
  termMatch: 3,
  termCap: 15,
  /** Captured within N days of the event, or of publication when no event is recorded. */
  timeWithin7Days: 10,
  timeWithin90Days: 5,
  timeWithin365Days: 2,
  /** Headline, caption, subjects and keywords all recorded. */
  metadataComplete: 5,
  /** Copyright notice and credit line both recorded. */
  rightsRecorded: 5,
} as const;

/**
 * Below this the OVERLAP is too thin to show. Three shared words is not a
 * match, and complete metadata or recorded rights cannot make it one: the
 * threshold is applied to the overlap components alone.
 */
export const ARCHIVE_MATCH_THRESHOLD = 10;

/** How many ranked matches are kept per story. */
export const ARCHIVE_MAX_MATCHES = 50;

export interface ArchiveMatchBreakdown {
  readonly people: number;
  readonly organizations: number;
  readonly keywords: number;
  readonly location: number;
  readonly terms: number;
  readonly time: number;
  readonly metadata: number;
  readonly rights: number;
}

export interface ArchiveMatch {
  readonly assetId: string;
  readonly score: number;
  readonly rank: number;
  /** One sentence per reason, in the order the components are listed above. */
  readonly reasons: readonly string[];
  readonly breakdown: ArchiveMatchBreakdown;
}

export interface ArchiveExclusions {
  readonly tombstoned: number;
  readonly ingesting: number;
  readonly zeroOverlap: number;
  readonly belowThreshold: number;
  readonly beyondCap: number;
}

export interface ArchiveEvaluation {
  readonly outcome: "ready" | "needs_context";
  /** The top match's score, or 0. */
  readonly score: number;
  readonly explanation: string;
  readonly matches: readonly ArchiveMatch[];
  readonly candidatesConsidered: number;
  readonly excluded: ArchiveExclusions;
  /** What recording would sharpen the comparison. Empty when structured context exists. */
  readonly missingContext: readonly string[];
}

/**
 * Whether a status is eligible for matching at all.
 *
 * `tombstoned` is a removed record kept for history; `ingesting` is an import
 * that has not finished and may have no metadata yet. `restricted` is
 * eligible but is flagged wherever it is shown and never described as ready
 * to use; `archived` is owned work that has simply moved to the archive,
 * which is exactly what this evaluator exists to reactivate.
 */
export function isEligibleStatus(status: AssetStatus): boolean {
  return status === "active" || status === "restricted" || status === "archived";
}

export type RightsFact =
  | "copyright_recorded"
  | "credit_recorded"
  | "restriction_recorded"
  | "no_restriction_recorded"
  | "rights_incomplete";

/**
 * Precisely what the asset's rights columns say, and nothing more. In
 * particular: the absence of a recorded restriction is reported as exactly
 * that, never as "cleared".
 */
export function rightsFacts(asset: {
  readonly copyrightNotice?: string;
  readonly creditLine?: string;
  readonly usageRestrictions?: string;
}): readonly RightsFact[] {
  const facts: RightsFact[] = [];
  const copyright = Boolean(asset.copyrightNotice?.trim());
  const credit = Boolean(asset.creditLine?.trim());
  if (copyright) facts.push("copyright_recorded");
  if (credit) facts.push("credit_recorded");
  if (asset.usageRestrictions?.trim()) facts.push("restriction_recorded");
  else facts.push("no_restriction_recorded");
  if (!copyright || !credit) facts.push("rights_incomplete");
  return facts;
}

export const RIGHTS_FACT_LABELS: Record<RightsFact, string> = {
  copyright_recorded: "Copyright information recorded",
  credit_recorded: "Credit line recorded",
  restriction_recorded: "Usage restriction recorded",
  no_restriction_recorded: "No restriction recorded",
  rights_incomplete: "Rights information incomplete",
};

export function metadataIsComplete(asset: {
  readonly headline?: string;
  readonly caption?: string;
  readonly subjects: readonly string[];
  readonly keywords: readonly string[];
}): boolean {
  return Boolean(
    asset.headline?.trim() &&
    asset.caption?.trim() &&
    asset.subjects.length > 0 &&
    asset.keywords.length > 0,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: IsoTimestamp, b: IsoTimestamp): number | undefined {
  const x = new Date(a).getTime();
  const y = new Date(b).getTime();
  if (Number.isNaN(x) || Number.isNaN(y)) return undefined;
  return Math.abs(x - y) / DAY_MS;
}

function list(values: readonly string[]): string {
  return values.join(", ");
}

/** Score one candidate. Undefined when it shares nothing with the story. */
function scoreCandidate(
  candidate: ArchiveCandidate,
  story: EvaluationStory,
  context: SignalContext,
  entities: readonly SignalEntity[],
  storyTerms: ReadonlySet<string>,
):
  | { score: number; overlap: number; reasons: string[]; breakdown: ArchiveMatchBreakdown }
  | undefined {
  const W = ARCHIVE_WEIGHTS;
  const reasons: string[] = [];

  const assetSubjects = new Set(uniqueNormalized(candidate.subjects));
  const assetKeywords = new Set(uniqueNormalized(candidate.keywords));
  const assetText = `${candidate.headline ?? ""} ${candidate.caption ?? ""}`;

  // People: exact subject, or the whole name in the headline or caption.
  const people = entityValues(entities, "person");
  const peopleAsSubjects = people.filter((person) => assetSubjects.has(person));
  const peopleInText = people.filter(
    (person) => !assetSubjects.has(person) && containsPhrase(assetText, person),
  );
  const peoplePoints = Math.min(
    W.personCap,
    (peopleAsSubjects.length + peopleInText.length) * W.personMatch,
  );
  if (peopleAsSubjects.length > 0) {
    reasons.push(
      `Recorded ${peopleAsSubjects.length === 1 ? "person matches a subject" : "people match subjects"} on the photograph: ${list(peopleAsSubjects.map((p) => displayValue(entities, p)))}`,
    );
  }
  if (peopleInText.length > 0) {
    reasons.push(
      `Named in the headline or caption: ${list(peopleInText.map((p) => displayValue(entities, p)))}`,
    );
  }

  // Organizations: exact keyword, or the whole name in the text.
  const organizations = entityValues(entities, "organization");
  const organizationHits = organizations.filter(
    (org) => assetKeywords.has(org) || containsPhrase(assetText, org),
  );
  const organizationPoints = Math.min(
    W.organizationCap,
    organizationHits.length * W.organizationMatch,
  );
  if (organizationHits.length > 0) {
    reasons.push(
      `Organization on the story appears on the photograph: ${list(organizationHits.map((o) => displayValue(entities, o)))}`,
    );
  }

  // Topics and keywords: exact keyword overlap only.
  const storyKeywords = uniqueNormalized([
    ...entityValues(entities, "topic"),
    ...entityValues(entities, "keyword"),
  ]);
  const keywordHits = storyKeywords.filter((keyword) => assetKeywords.has(keyword));
  const keywordPoints = Math.min(W.keywordCap, keywordHits.length * W.keywordMatch);
  if (keywordHits.length > 0) {
    reasons.push(
      `Shared keyword${keywordHits.length === 1 ? "" : "s"}: ${list(keywordHits.map((k) => displayValue(entities, k)))}`,
    );
  }

  // Location: exact, named whole in the text, or one significant word shared.
  let locationPoints = 0;
  const storyLocation = context.locationName ? normalizeTerm(context.locationName) : "";
  if (storyLocation) {
    const assetLocation = candidate.locationName ? normalizeTerm(candidate.locationName) : "";
    if (assetLocation === storyLocation) {
      locationPoints = W.locationExact;
      reasons.push(`Same recorded location: ${context.locationName}`);
    } else if (
      containsPhrase(assetText, storyLocation) ||
      containsPhrase(assetLocation, storyLocation)
    ) {
      locationPoints = W.locationExact;
      reasons.push(`Location named on the photograph: ${context.locationName}`);
    } else {
      const shared = [...significantTerms(storyLocation)].filter((term) =>
        significantTerms(assetLocation).has(term),
      );
      if (shared.length > 0) {
        locationPoints = W.locationPartial;
        reasons.push(`Locations share a word: ${list(shared)}`);
      }
    }
  }

  // Headline and caption terms: the weakest signal, capped.
  const assetTerms = significantTerms(assetText);
  const sharedTerms = [...storyTerms].filter((term) => assetTerms.has(term)).sort();
  const termPoints = Math.min(W.termCap, sharedTerms.length * W.termMatch);
  if (sharedTerms.length > 0) {
    reasons.push(
      `Headline or caption shares ${sharedTerms.length} word${sharedTerms.length === 1 ? "" : "s"} with the story: ${list(sharedTerms.slice(0, 6))}${sharedTerms.length > 6 ? "…" : ""}`,
    );
  }

  const overlap = peoplePoints + organizationPoints + keywordPoints + locationPoints + termPoints;
  if (overlap === 0) return undefined;

  // Time: relevance to the event, or to publication when no event is recorded.
  let timePoints = 0;
  const reference = context.eventStartsAt ?? story.sourcePublishedAt;
  if (reference && candidate.capturedAt) {
    const days = daysBetween(reference, candidate.capturedAt);
    const against = context.eventStartsAt ? "the recorded event time" : "publication";
    if (days !== undefined) {
      if (days <= 7) {
        timePoints = W.timeWithin7Days;
        reasons.push(`Captured within a week of ${against}`);
      } else if (days <= 90) {
        timePoints = W.timeWithin90Days;
        reasons.push(`Captured within three months of ${against}`);
      } else if (days <= 365) {
        timePoints = W.timeWithin365Days;
        reasons.push(`Captured within a year of ${against}`);
      }
    }
  }

  const metadataPoints = metadataIsComplete(candidate) ? W.metadataComplete : 0;
  if (metadataPoints > 0) reasons.push("Headline, caption, people and keywords all recorded");

  const facts = rightsFacts(candidate);
  const rightsPoints =
    facts.includes("copyright_recorded") && facts.includes("credit_recorded")
      ? W.rightsRecorded
      : 0;
  if (rightsPoints > 0) reasons.push("Copyright information and credit line recorded");

  const breakdown: ArchiveMatchBreakdown = {
    people: peoplePoints,
    organizations: organizationPoints,
    keywords: keywordPoints,
    location: locationPoints,
    terms: termPoints,
    time: timePoints,
    metadata: metadataPoints,
    rights: rightsPoints,
  };
  const score = Math.min(100, overlap + timePoints + metadataPoints + rightsPoints);
  return { score, overlap, reasons, breakdown };
}

/**
 * Stable order: score, then newest capture, then filename, then id. Two
 * runs over the same rows produce the same list in the same order, and two
 * assets that tie on score are separated by facts about them rather than by
 * the order the database happened to return them in.
 */
export function compareMatches(
  a: { score: number; capturedAt?: string; canonicalFilename: string; assetId: string },
  b: { score: number; capturedAt?: string; canonicalFilename: string; assetId: string },
): number {
  if (a.score !== b.score) return b.score - a.score;
  const aTime = a.capturedAt ?? "";
  const bTime = b.capturedAt ?? "";
  if (aTime !== bTime) {
    if (!aTime) return 1;
    if (!bTime) return -1;
    return bTime.localeCompare(aTime);
  }
  if (a.canonicalFilename !== b.canonicalFilename) {
    return a.canonicalFilename.localeCompare(b.canonicalFilename);
  }
  return a.assetId.localeCompare(b.assetId);
}

/** What structured context the story is missing, for the archive comparison. */
function archiveMissingContext(
  context: SignalContext,
  entities: readonly SignalEntity[],
): string[] {
  const missing: string[] = [];
  if (entityValues(entities, "person").length === 0) missing.push("People on the story");
  if (
    entityValues(entities, "topic").length === 0 &&
    entityValues(entities, "keyword").length === 0
  ) {
    missing.push("Topics or keywords");
  }
  if (!context.locationName) missing.push("Location");
  return missing;
}

export function evaluateArchive(input: ArchiveEvaluationInput): ArchiveEvaluation {
  const { story, context, entities, candidates } = input;
  const storyTerms = significantTerms(`${story.title} ${story.summary ?? ""}`);
  const missingContext = archiveMissingContext(context, entities);
  const hasStructuredContext = missingContext.length < 3;

  let tombstoned = 0;
  let ingesting = 0;
  let zeroOverlap = 0;
  let belowThreshold = 0;
  const scored: (ArchiveMatch & { capturedAt?: string; canonicalFilename: string })[] = [];

  for (const candidate of candidates) {
    if (candidate.status === "tombstoned") {
      tombstoned += 1;
      continue;
    }
    if (candidate.status === "ingesting") {
      ingesting += 1;
      continue;
    }
    if (!isEligibleStatus(candidate.status)) continue;

    const result = scoreCandidate(candidate, story, context, entities, storyTerms);
    if (!result) {
      zeroOverlap += 1;
      continue;
    }
    if (result.overlap < ARCHIVE_MATCH_THRESHOLD) {
      belowThreshold += 1;
      continue;
    }
    scored.push({
      assetId: candidate.assetId,
      score: result.score,
      rank: 0,
      reasons: result.reasons,
      breakdown: result.breakdown,
      capturedAt: candidate.capturedAt,
      canonicalFilename: candidate.canonicalFilename,
    });
  }

  scored.sort(compareMatches);
  const beyondCap = Math.max(0, scored.length - ARCHIVE_MAX_MATCHES);
  const matches: ArchiveMatch[] = scored.slice(0, ARCHIVE_MAX_MATCHES).map((match, index) => ({
    assetId: match.assetId,
    score: match.score,
    rank: index + 1,
    reasons: match.reasons,
    breakdown: match.breakdown,
  }));

  const considered = candidates.length - tombstoned - ingesting;
  const excluded: ArchiveExclusions = {
    tombstoned,
    ingesting,
    zeroOverlap,
    belowThreshold,
    beyondCap,
  };

  if (considered === 0) {
    return {
      outcome: "ready",
      score: 0,
      explanation: "The archive holds no eligible photographs to compare against this story.",
      matches,
      candidatesConsidered: 0,
      excluded,
      missingContext,
    };
  }

  if (matches.length === 0 && !hasStructuredContext) {
    return {
      outcome: "needs_context",
      score: 0,
      explanation: `None of the ${considered} eligible photographs share a significant word with the headline, and the story carries no people, keywords or location to compare on.`,
      matches,
      candidatesConsidered: considered,
      excluded,
      missingContext,
    };
  }

  const top = matches[0]?.score ?? 0;
  const explanation =
    matches.length === 0
      ? `None of the ${considered} eligible photographs overlap with this story's recorded people, keywords, location or headline${belowThreshold > 0 ? ` (${belowThreshold} shared too little to show)` : ""}.`
      : `${matches.length} of ${considered} eligible photographs overlap with this story; the strongest scores ${top} of 100.${!hasStructuredContext ? " Matched on headline terms only: recording people, keywords or a location would sharpen this." : ""}${beyondCap > 0 ? ` ${beyondCap} weaker matches beyond the top ${ARCHIVE_MAX_MATCHES} are not kept.` : ""}`;

  return {
    outcome: "ready",
    score: top,
    explanation,
    matches,
    candidatesConsidered: considered,
    excluded,
    missingContext,
  };
}

// ---------------------------------------------------------------------------
// Shoot brief
// ---------------------------------------------------------------------------

/**
 * Readiness points out of 100. Facts first: where, when, who. Then what the
 * workspace said about itself, which only counts when it was actually said.
 */
export const SHOOT_WEIGHTS = {
  eventTimeRecorded: 25,
  eventUpcoming: 10,
  locationRecorded: 25,
  peopleRecorded: 15,
  sourceRecorded: 5,
  summaryRecorded: 5,
  withinBaseCity: 10,
  specialtyOverlap: 5,
} as const;

export type WindowState = "open" | "closing" | "closed" | "unknown";

export interface ShootBriefBreakdown {
  readonly eventTime: number;
  readonly upcoming: number;
  readonly location: number;
  readonly people: number;
  readonly source: number;
  readonly summary: number;
  readonly baseCity: number;
  readonly specialty: number;
}

export interface ShootBrief {
  readonly readiness: "ready" | "needs_context";
  readonly readinessScore: number;
  readonly whyNow: readonly string[];
  readonly knownPeople: readonly string[];
  readonly knownOrganizations: readonly string[];
  readonly knownLocation?: string;
  readonly eventStartsAt?: IsoTimestamp;
  readonly eventEndsAt?: IsoTimestamp;
  readonly windowState: WindowState;
  readonly windowClosesAt?: IsoTimestamp;
  readonly geographicRelevance: string;
  /** Undefined when the workspace recorded no specialties. */
  readonly specialtyRelevance?: string;
  /** Labelled a suggestion wherever it is shown. Undefined when nothing can be suggested. */
  readonly suggestedAngle?: string;
  /** Each one a suggestion, built only from recorded facts. */
  readonly suggestedShots: readonly string[];
  readonly missingConfirmations: readonly string[];
  readonly breakdown: ShootBriefBreakdown;
  readonly explanation: string;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The state of the useful window, derived from the clock and the recorded
 * timestamps. Exported so the interface can re-derive it live rather than
 * trusting the one stored at evaluation time.
 */
export function windowState(
  now: Date,
  closesAt: IsoTimestamp | undefined,
  eventStartsAt: IsoTimestamp | undefined,
  eventEndsAt: IsoTimestamp | undefined,
): WindowState {
  const t = now.getTime();
  const closes = closesAt ? new Date(closesAt).getTime() : undefined;
  const ends = eventEndsAt ? new Date(eventEndsAt).getTime() : undefined;
  const starts = eventStartsAt ? new Date(eventStartsAt).getTime() : undefined;
  if (closes !== undefined && closes <= t) return "closed";
  if (ends !== undefined && ends <= t) return "closed";
  // An event with a start and no end is treated as still under way for a day.
  if (ends === undefined && starts !== undefined && starts + 24 * HOUR_MS <= t) return "closed";
  const soonest = [closes, starts].filter((v): v is number => v !== undefined && v > t);
  if (soonest.some((v) => v - t <= 24 * HOUR_MS)) return "closing";
  if (closes !== undefined || starts !== undefined || ends !== undefined) return "open";
  return "unknown";
}

/**
 * Which recorded specialties a story's text touches. The vocabulary is a
 * fixed table, so the answer is the same on every run; it is deliberately
 * small and only ever adds a few points.
 */
export const SPECIALTY_TERMS: Record<string, readonly string[]> = {
  celebrity: [
    "celebrity",
    "star",
    "actor",
    "actress",
    "singer",
    "premiere",
    "red carpet",
    "awards",
    "gala",
    "arrival",
    "departure",
    "airport",
    "hotel",
  ],
  street_style: ["fashion", "fashion week", "street style", "runway", "designer", "model"],
  entertainment: [
    "premiere",
    "festival",
    "concert",
    "tour",
    "film",
    "movie",
    "series",
    "album",
    "show",
    "theatre",
    "theater",
    "red carpet",
  ],
  events: [
    "gala",
    "ceremony",
    "launch",
    "opening",
    "festival",
    "parade",
    "wedding",
    "funeral",
    "conference",
    "summit",
  ],
  news: [
    "court",
    "trial",
    "verdict",
    "sentencing",
    "protest",
    "march",
    "election",
    "police",
    "arrest",
    "hearing",
    "vote",
    "strike",
    "rally",
    "press conference",
    "inquest",
  ],
  portraits: ["portrait", "sitting", "interview"],
};

const SPECIALTY_LABELS: Record<string, string> = {
  celebrity: "Celebrity",
  street_style: "Street style",
  entertainment: "Entertainment",
  events: "Events",
  news: "News",
  portraits: "Portraits",
};

export function specialtyOverlap(text: string, specialties: readonly string[]): readonly string[] {
  return specialties.filter((specialty) =>
    (SPECIALTY_TERMS[specialty] ?? []).some((term) => containsPhrase(text, term)),
  );
}

function sharesWord(a: string, b: string): boolean {
  const left = significantTerms(a);
  return [...significantTerms(b)].some((term) => left.has(term));
}

export function evaluateShoot(input: ShootEvaluationInput): ShootBrief {
  const { story, context, entities, workspace, now } = input;
  const W = SHOOT_WEIGHTS;
  const zone = workspace.timeZone;
  const when = (iso: IsoTimestamp) => formatDateTime(iso, zone);

  const people = entities.filter((e) => e.kind === "person").map((e) => e.value);
  const organizations = entities.filter((e) => e.kind === "organization").map((e) => e.value);
  const location = context.locationName?.trim() || undefined;
  const starts = context.eventStartsAt;
  const ends = context.eventEndsAt;
  const state = windowState(now, input.windowClosesAt, starts, ends);
  const closesAt = input.windowClosesAt ?? ends;

  // Points ---------------------------------------------------------------
  const eventTime = starts ? W.eventTimeRecorded : 0;
  const upcoming = starts && new Date(starts).getTime() > now.getTime() ? W.eventUpcoming : 0;
  const locationPoints = location ? W.locationRecorded : 0;
  const peoplePoints = people.length > 0 ? W.peopleRecorded : 0;
  const sourcePoints = story.sourceUrl || story.sourceName ? W.sourceRecorded : 0;
  const summaryPoints = story.summary?.trim() ? W.summaryRecorded : 0;

  // Geography: only against a base city the workspace actually recorded.
  let geographicRelevance: string;
  let baseCityPoints = 0;
  const baseCity = workspace.baseCity?.trim();
  if (!location) {
    geographicRelevance = "No location recorded on the story, so distance is not assessed.";
  } else if (!baseCity) {
    geographicRelevance = `Location recorded (${location}); the workspace has no base city on record, so distance is not assessed.`;
  } else if (sharesWord(location, baseCity) || containsPhrase(location, normalizeTerm(baseCity))) {
    baseCityPoints = W.withinBaseCity;
    geographicRelevance = `Within your base city: ${location} matches ${baseCity}.`;
  } else {
    geographicRelevance = `Outside your base city (${baseCity}): ${location}. Confirm travel before committing.`;
  }

  // Specialties: reported only when the preference exists.
  let specialtyRelevance: string | undefined;
  let specialtyPoints = 0;
  if (workspace.specialties.length > 0) {
    const text = [
      story.title,
      story.summary ?? "",
      ...entities.filter((e) => e.kind === "topic" || e.kind === "keyword").map((e) => e.value),
    ].join(" ");
    const hits = specialtyOverlap(text, workspace.specialties);
    const labels = (keys: readonly string[]) =>
      keys.map((k) => SPECIALTY_LABELS[k] ?? k).join(", ");
    if (hits.length > 0) {
      specialtyPoints = W.specialtyOverlap;
      specialtyRelevance = `Touches your recorded specialties: ${labels(hits)}.`;
    } else {
      specialtyRelevance = `No overlap with your recorded specialties (${labels(workspace.specialties)}).`;
    }
  }

  const breakdown: ShootBriefBreakdown = {
    eventTime,
    upcoming,
    location: locationPoints,
    people: peoplePoints,
    source: sourcePoints,
    summary: summaryPoints,
    baseCity: baseCityPoints,
    specialty: specialtyPoints,
  };
  const readinessScore = Math.min(
    100,
    eventTime +
      upcoming +
      locationPoints +
      peoplePoints +
      sourcePoints +
      summaryPoints +
      baseCityPoints +
      specialtyPoints,
  );

  // Why now --------------------------------------------------------------
  const whyNow: string[] = [];
  if (story.sourcePublishedAt) {
    whyNow.push(
      `Published ${when(story.sourcePublishedAt)}${story.sourceName ? ` by ${story.sourceName}` : ""}`,
    );
  } else if (story.sourceName) {
    whyNow.push(`Reported by ${story.sourceName}; publication time not recorded`);
  }
  if (starts) {
    whyNow.push(
      new Date(starts).getTime() > now.getTime()
        ? `Event starts ${when(starts)}`
        : `Event started ${when(starts)}`,
    );
  }
  if (ends) whyNow.push(`Event ends ${when(ends)}`);
  if (input.windowClosesAt)
    whyNow.push(`This path's useful window closes ${when(input.windowClosesAt)}`);
  if (people.length > 0) {
    whyNow.push(
      `${people.length} ${people.length === 1 ? "person" : "people"} recorded: ${list(people)}`,
    );
  }
  if (context.windowNote) whyNow.push(`Window note: ${context.windowNote}`);
  if (whyNow.length === 0) {
    whyNow.push("No timing facts recorded, so nothing here establishes urgency yet.");
  }

  // Suggestions, from recorded facts only ---------------------------------
  let suggestedAngle: string | undefined;
  if (people.length > 0 && location) {
    suggestedAngle = `${list(people)} at ${location}`;
  } else if (people.length > 0) {
    suggestedAngle = `${list(people)} — location still to be confirmed`;
  } else if (location) {
    suggestedAngle = `The scene at ${location}`;
  }

  const suggestedShots: string[] = [];
  if (location) suggestedShots.push(`Establishing frame of ${location}`);
  for (const person of people.slice(0, 3)) {
    suggestedShots.push(`${person}: a clean single, tight and wide`);
  }
  if (starts) suggestedShots.push(`Arrivals before ${when(starts)}`);
  if (ends) suggestedShots.push(`Departures after ${when(ends)}`);
  for (const organization of organizations.slice(0, 2)) {
    suggestedShots.push(`Signage or branding of ${organization} in frame`);
  }

  // What a person still has to confirm --------------------------------------
  const missing: string[] = [];
  if (!starts) missing.push("Event time: none recorded");
  if (!location) missing.push("Location: none recorded");
  if (people.length === 0) missing.push("Who is expected: no people recorded");
  else missing.push("Appearance: a recorded name is not a confirmed appearance");
  missing.push("Access and credentials: Mastline records none; confirm before travelling");
  if (!story.sourceUrl && !story.sourceName) missing.push("Source: none recorded");
  if (state === "closed") {
    missing.push("The recorded window has closed: confirm whether a follow-up moment exists");
  } else if (starts && !ends && new Date(starts).getTime() <= now.getTime()) {
    missing.push("The event has started and no end is recorded: confirm it is still under way");
  }

  const readiness: ShootBrief["readiness"] = starts && location ? "ready" : "needs_context";
  const explanation =
    readiness === "ready"
      ? `Where and when are recorded; readiness ${readinessScore} of 100 with ${missing.length} confirmation${missing.length === 1 ? "" : "s"} outstanding.`
      : `Not enough to brief a shoot: ${[!starts ? "no event time" : "", !location ? "no location" : ""].filter(Boolean).join(" and ")} recorded. Readiness ${readinessScore} of 100.`;

  return {
    readiness,
    readinessScore,
    whyNow,
    knownPeople: people,
    knownOrganizations: organizations,
    knownLocation: location,
    eventStartsAt: starts,
    eventEndsAt: ends,
    windowState: state,
    windowClosesAt: closesAt,
    geographicRelevance,
    specialtyRelevance,
    suggestedAngle,
    suggestedShots,
    missingConfirmations: missing,
    breakdown,
    explanation,
  };
}

// ---------------------------------------------------------------------------
// Input keys
//
// The canonical string of everything an evaluation depends on. Hash it and
// two runs with the same hash have nothing new to compute. Keys are sorted
// and lists are ordered by stable fields so field order and row order never
// change the answer. The clock is excluded on purpose (see ShootEvaluationInput).
// ---------------------------------------------------------------------------

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

function sortedEntities(entities: readonly SignalEntity[]) {
  return [...entities]
    .map((entity) => ({ kind: entity.kind, value: normalizeTerm(entity.value) }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
}

function storyKey(story: EvaluationStory) {
  return {
    title: story.title,
    summary: story.summary,
    sourceName: story.sourceName,
    sourceUrl: story.sourceUrl,
    sourcePublishedAt: story.sourcePublishedAt,
  };
}

function contextKey(context: SignalContext) {
  return {
    locationName: context.locationName ? normalizeTerm(context.locationName) : undefined,
    eventStartsAt: context.eventStartsAt,
    eventEndsAt: context.eventEndsAt,
    windowNote: context.windowNote,
  };
}

export function archiveInputKey(input: ArchiveEvaluationInput): string {
  return canonical({
    version: EVALUATOR_VERSION,
    path: "archive_match",
    story: storyKey(input.story),
    context: contextKey(input.context),
    entities: sortedEntities(input.entities),
    candidates: [...input.candidates]
      .map((c) => ({
        assetId: c.assetId,
        status: c.status,
        canonicalFilename: c.canonicalFilename,
        headline: c.headline,
        caption: c.caption,
        subjects: uniqueNormalized(c.subjects).sort(),
        keywords: uniqueNormalized(c.keywords).sort(),
        locationName: c.locationName ? normalizeTerm(c.locationName) : undefined,
        capturedAt: c.capturedAt,
        copyrightNotice: c.copyrightNotice,
        creditLine: c.creditLine,
        usageRestrictions: c.usageRestrictions,
      }))
      .sort((a, b) => a.assetId.localeCompare(b.assetId)),
  });
}

export function shootInputKey(input: Omit<ShootEvaluationInput, "now">): string {
  return canonical({
    version: EVALUATOR_VERSION,
    path: "shoot_opportunity",
    story: storyKey(input.story),
    context: contextKey(input.context),
    entities: sortedEntities(input.entities),
    windowClosesAt: input.windowClosesAt,
    workspace: {
      baseCity: input.workspace.baseCity ? normalizeTerm(input.workspace.baseCity) : undefined,
      specialties: [...input.workspace.specialties].sort(),
      timeZone: input.workspace.timeZone,
    },
  });
}

// ---------------------------------------------------------------------------
// Labels shared by the interface
// ---------------------------------------------------------------------------

export const EVALUATION_STATE_LABELS: Record<EvaluationState, string> = {
  not_evaluated: "Not evaluated",
  evaluating: "Evaluating",
  ready: "Ready",
  needs_context: "Needs context",
  failed: "Failed",
};

export const FAILURE_LABELS: Record<EvaluationFailureCode, string> = {
  denied: "Your role may not run the evaluator.",
  not_found: "That opportunity is not in this workspace.",
  invalid_result: "The evaluator produced a result the database refused. Nothing was changed.",
  asset_not_in_workspace:
    "A matched photograph is no longer in this workspace. Nothing was changed.",
  write_failed: "The result could not be written. Nothing was changed.",
  archive_read_failed: "The archive could not be read. Nothing was changed.",
  context_read_failed: "The story's context could not be read. Nothing was changed.",
  evaluator_error: "The evaluator stopped before producing a result. Nothing was changed.",
};

export const WINDOW_STATE_LABELS: Record<WindowState, string> = {
  open: "Open",
  closing: "Closing within a day",
  closed: "Closed",
  unknown: "No timing recorded",
};
