/**
 * Deciding whether a frame might answer a request.
 *
 * Deterministic, inspectable, and stated in one place. Every number below is a
 * constant somebody chose, not a weight learned from anything, and the basis a
 * suggestion carries is generated from the same signals that produced its
 * score -- so "why is this here" and "why is it ranked there" have the same
 * answer.
 *
 * ---------------------------------------------------------------------------
 * What this reads, and what it refuses to
 *
 * It reads text a person recorded: the subjects and keywords on the asset, its
 * location, its capture time, its kind. It never opens an image and it never
 * derives who is in one. `subjects` is context an operator typed; matching on
 * it says "somebody labelled this frame Julian Cross and the desk asked about
 * Julian Cross", which is a statement about two labels and not about a face.
 *
 * There is no model here. The repository has an approved abstraction for one
 * and this deliberately does not use it: ranking cannot be shown to improve on
 * the data available, and a confidence learned from nothing is decoration with
 * a number on it.
 *
 * ---------------------------------------------------------------------------
 * Relevance is not clearance
 *
 * `score` answers "is this the right picture". `clearance` answers "may it be
 * sent". They are computed separately, returned separately, and a restricted
 * frame keeps its full relevance score -- because it IS the right picture, and
 * hiding it would leave somebody wondering why the obvious frame never came up.
 * What must never happen is a restricted frame presented as sendable.
 */

export interface MatchableAsset {
  readonly id: string;
  readonly assetKind: string;
  readonly capturedAt?: string;
  readonly subjects: readonly string[];
  readonly keywords: readonly string[];
  readonly locationName?: string;
  readonly headline?: string;
  readonly status: string;
  readonly usageRestrictions?: string;
}

export interface MatchableRequest {
  readonly id: string;
  readonly title: string;
  readonly subjectOrEvent?: string;
  readonly subjectNames: readonly string[];
  readonly topics: readonly string[];
  readonly locationName?: string;
  readonly eventAt?: string;
  readonly requestedFormats: readonly string[];
  readonly exclusivity?: string;
  readonly embargoUntil?: string;
}

/**
 * The weights, in one place, adding to 1.
 *
 * Ordered by how much each one actually tells you. A named subject shared
 * between a request and a frame is the strongest thing available; a keyword
 * overlap is weaker because keyword vocabularies are loose; prior buyer
 * behaviour is real signal but says more about the buyer than the frame.
 */
export const MATCH_WEIGHTS = {
  subject: 0.34,
  dateProximity: 0.22,
  location: 0.18,
  keyword: 0.14,
  kind: 0.07,
  priorBuyer: 0.05,
} as const;

/** Frames outside this window of a stated event are not that event. */
export const DATE_WINDOW_HOURS = 36;

export type Clearance = "clear" | "restricted" | "unknown";

export interface MatchSignals {
  readonly subjects: readonly string[];
  readonly keywords: readonly string[];
  readonly locationMatched: boolean;
  readonly hoursFromEvent?: number;
  readonly kindMatched: boolean;
  readonly priorBuyerLicence: boolean;
}

export interface Match {
  readonly assetId: string;
  readonly confidence: number;
  readonly basis: string;
  readonly signals: MatchSignals;
  readonly clearance: Clearance;
  readonly clearanceNote?: string;
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function overlap(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right.map(normalise).filter(Boolean));
  const seen = new Set<string>();
  const shared: string[] = [];
  for (const value of left) {
    const key = normalise(value);
    if (key && rightSet.has(key) && !seen.has(key)) {
      seen.add(key);
      shared.push(value);
    }
  }
  return shared;
}

/**
 * Whether two place names refer to the same place, as far as text can say.
 *
 * "Soho, London" and "Soho" match; "London" and "Soho, London" match. This is
 * deliberately generous in one direction and blind in every other -- there is
 * no gazetteer here, and a coordinate would be a better signal if the import
 * path captured one.
 */
function placesAgree(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  const a = normalise(left);
  const b = normalise(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** Formats a desk asks for, reduced to the one thing an asset knows about itself. */
function wantsVideo(formats: readonly string[]): boolean {
  return formats.some((format) => /video|mp4|mov|clip/i.test(format));
}

/**
 * How close a frame is to a stated event, as a share of the window.
 *
 * Returns undefined when either side is unstated, which is different from far
 * away: a request with no event time cannot be scored on time, and the weight
 * is redistributed rather than counted as a miss.
 */
function dateCloseness(request: MatchableRequest, asset: MatchableAsset): number | undefined {
  if (!request.eventAt || !asset.capturedAt) return undefined;
  const event = Date.parse(request.eventAt);
  const captured = Date.parse(asset.capturedAt);
  if (Number.isNaN(event) || Number.isNaN(captured)) return undefined;

  const hours = Math.abs(captured - event) / 3_600_000;
  if (hours > DATE_WINDOW_HOURS) return 0;
  return 1 - hours / DATE_WINDOW_HOURS;
}

/**
 * Whether the frame may be sent, which the caller must render separately.
 *
 * `unknown` is the honest answer far more often than either of the others, and
 * it is a real value rather than a soft no: the workspace has to look. Nothing
 * here ever returns `clear` on the basis of absent information.
 */
export function clearanceOf(
  request: MatchableRequest,
  asset: MatchableAsset,
): { clearance: Clearance; note?: string } {
  if (asset.status === "restricted") {
    return { clearance: "restricted", note: "This frame is marked restricted in the archive." };
  }
  if (asset.usageRestrictions && asset.usageRestrictions.trim() !== "") {
    return { clearance: "restricted", note: asset.usageRestrictions.trim() };
  }
  // A desk asking for exclusivity, or holding an embargo, is a question about
  // terms nobody has answered here. Saying "clear" would be inventing an answer.
  if (request.exclusivity || request.embargoUntil) {
    return {
      clearance: "unknown",
      note: "The request asks about exclusivity or an embargo. Check the terms before sending.",
    };
  }
  return { clearance: "unknown", note: "Rights have not been checked for this frame." };
}

/**
 * Score one frame against one request.
 *
 * Weights for signals that cannot be evaluated are redistributed across the
 * ones that can, so a request with no stated event time is not scored as
 * though every frame missed its date. A frame that matches nothing scores 0
 * and the caller should not store it.
 */
export interface MatchContext {
  /**
   * Whether this buyer has licensed from this frame's shoot before.
   *
   * Supplied by the caller, because it is a fact about history that this module
   * cannot see. Left undefined it is not scored at all and its weight is
   * redistributed -- the same treatment as an unstated event time, and for the
   * same reason: a fact nobody looked up is not a fact that failed.
   */
  readonly priorBuyerLicence?: boolean;
}

export function scoreMatch(
  request: MatchableRequest,
  asset: MatchableAsset,
  context: MatchContext = {},
): Match {
  const subjects = overlap(request.subjectNames, asset.subjects);
  const requestTerms = [
    ...request.topics,
    ...normalise(request.title).split(" "),
    ...(request.subjectOrEvent ? normalise(request.subjectOrEvent).split(" ") : []),
  ].filter((term) => term.length > 2);
  const keywords = overlap(requestTerms, asset.keywords);

  const locationMatched = placesAgree(request.locationName, asset.locationName);
  const closeness = dateCloseness(request, asset);
  const kindMatched = wantsVideo(request.requestedFormats)
    ? asset.assetKind === "video"
    : asset.assetKind !== "video";
  const priorBuyerLicence = context.priorBuyerLicence ?? false;

  const parts: Array<[number, number]> = [
    [MATCH_WEIGHTS.subject, subjects.length > 0 ? 1 : 0],
    [MATCH_WEIGHTS.location, locationMatched ? 1 : 0],
    [MATCH_WEIGHTS.keyword, keywords.length > 0 ? Math.min(1, keywords.length / 2) : 0],
    [MATCH_WEIGHTS.kind, kindMatched ? 1 : 0],
  ];
  if (closeness !== undefined) parts.push([MATCH_WEIGHTS.dateProximity, closeness]);
  if (context.priorBuyerLicence !== undefined) {
    parts.push([MATCH_WEIGHTS.priorBuyer, priorBuyerLicence ? 1 : 0]);
  }

  const available = parts.reduce((total, [weight]) => total + weight, 0);
  const earned = parts.reduce((total, [weight, value]) => total + weight * value, 0);
  const confidence = available > 0 ? Math.min(1, Math.max(0, earned / available)) : 0;

  const { clearance, note } = clearanceOf(request, asset);

  return {
    assetId: asset.id,
    confidence: Number(confidence.toFixed(3)),
    basis: describeBasis(
      {
        subjects,
        keywords,
        locationMatched,
        hoursFromEvent: undefined,
        kindMatched,
        priorBuyerLicence,
      },
      closeness,
      request,
    ),
    signals: {
      subjects,
      keywords,
      locationMatched,
      hoursFromEvent:
        closeness === undefined ? undefined : Math.round((1 - closeness) * DATE_WINDOW_HOURS),
      kindMatched,
      priorBuyerLicence,
    },
    clearance,
    clearanceNote: note,
  };
}

/**
 * The sentence a person reads next to the frame.
 *
 * Built from the same signals that produced the score, so the explanation
 * cannot drift from the ranking. Says what matched, never why it is good.
 */
export function describeBasis(
  signals: MatchSignals,
  closeness: number | undefined,
  request: MatchableRequest,
): string {
  const reasons: string[] = [];
  if (signals.subjects.length > 0) {
    reasons.push(`subject recorded as ${signals.subjects.join(", ")}`);
  }
  if (closeness !== undefined && closeness > 0) {
    const hours = Math.round((1 - closeness) * DATE_WINDOW_HOURS);
    reasons.push(
      hours <= 1
        ? "captured within an hour of the event"
        : `captured within ${hours}h of the event`,
    );
  }
  if (signals.locationMatched && request.locationName) {
    reasons.push(`location matches ${request.locationName}`);
  }
  if (signals.keywords.length > 0) {
    reasons.push(`keywords ${signals.keywords.slice(0, 3).join(", ")}`);
  }
  if (signals.priorBuyerLicence) reasons.push("this buyer has licensed from this shoot before");

  if (reasons.length === 0) return "No recorded signal matched; ranked only on asset type.";
  return `Matched on ${reasons.join("; ")}.`;
}

/** The floor below which a frame is not worth putting in front of anybody. */
export const SUGGESTION_FLOOR = 0.25;

/** Rank, drop the noise, and cap what a person is asked to look at. */
export function rankMatches(
  request: MatchableRequest,
  assets: readonly MatchableAsset[],
  limit = 20,
  contextFor: (asset: MatchableAsset) => MatchContext = () => ({}),
): Match[] {
  return assets
    .map((asset) => scoreMatch(request, asset, contextFor(asset)))
    .filter((match) => match.confidence >= SUGGESTION_FLOOR)
    .sort((a, b) => b.confidence - a.confidence || a.assetId.localeCompare(b.assetId))
    .slice(0, limit);
}
