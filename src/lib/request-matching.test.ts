import { describe, expect, it } from "vitest";
import {
  DATE_WINDOW_HOURS,
  MATCH_WEIGHTS,
  type MatchableAsset,
  type MatchableRequest,
  SUGGESTION_FLOOR,
  clearanceOf,
  rankMatches,
  scoreMatch,
} from "./request-matching";

const request: MatchableRequest = {
  id: "r1",
  title: "Departure from last night",
  subjectOrEvent: "Departure",
  subjectNames: ["Julian Cross"],
  topics: ["departure"],
  locationName: "Soho, London",
  eventAt: "2026-08-20T23:00:00.000Z",
  requestedFormats: ["JPEG"],
};

const asset = (over: Partial<MatchableAsset> = {}): MatchableAsset => ({
  id: "a1",
  assetKind: "image",
  capturedAt: "2026-08-20T23:20:00.000Z",
  subjects: ["Julian Cross"],
  keywords: ["departure", "night"],
  locationName: "Soho, London",
  status: "active",
  ...over,
});

describe("scoring a frame against a request", () => {
  it("scores the obvious match near the top", () => {
    const match = scoreMatch(request, asset());
    expect(match.confidence).toBeGreaterThan(0.9);
    expect(match.signals.subjects).toEqual(["Julian Cross"]);
    expect(match.signals.locationMatched).toBe(true);
  });

  it("explains itself from the same signals that produced the score", () => {
    const match = scoreMatch(request, asset());
    expect(match.basis).toContain("Julian Cross");
    expect(match.basis).toContain("Soho, London");
    // Says what matched, not that it is good.
    expect(match.basis).not.toMatch(/best|excellent|perfect|strong/i);
  });

  it("drops a frame outside the capture window to nothing on time", () => {
    const far = scoreMatch(request, asset({ capturedAt: "2026-08-10T23:00:00.000Z" }));
    const near = scoreMatch(request, asset());
    expect(far.confidence).toBeLessThan(near.confidence);
    expect(far.signals.hoursFromEvent).toBe(DATE_WINDOW_HOURS);
  });

  /*
   * A request with no stated event time cannot be scored on time. Counting that
   * as a miss would push every frame down for a fact the desk never gave, so
   * the weight is redistributed across the signals that do exist.
   */
  it("redistributes weight rather than penalising an unstated fact", () => {
    const timeless = { ...request, eventAt: undefined };
    const match = scoreMatch(timeless, asset());
    expect(match.signals.hoursFromEvent).toBeUndefined();
    // Subject, location, keywords and kind all match, so with time removed this
    // is a full score rather than one docked for a missing field.
    expect(match.confidence).toBe(1);
  });

  it("matches places generously in one direction and not at all in others", () => {
    expect(scoreMatch(request, asset({ locationName: "Soho" })).signals.locationMatched).toBe(true);
    expect(scoreMatch(request, asset({ locationName: "London" })).signals.locationMatched).toBe(
      true,
    );
    expect(scoreMatch(request, asset({ locationName: "Cannes" })).signals.locationMatched).toBe(
      false,
    );
    expect(scoreMatch(request, asset({ locationName: undefined })).signals.locationMatched).toBe(
      false,
    );
  });

  it("reads a request for video as a request for video", () => {
    const video = { ...request, requestedFormats: ["Video"] };
    expect(scoreMatch(video, asset({ assetKind: "video" })).signals.kindMatched).toBe(true);
    expect(scoreMatch(video, asset({ assetKind: "image" })).signals.kindMatched).toBe(false);
    expect(scoreMatch(request, asset({ assetKind: "video" })).signals.kindMatched).toBe(false);
  });

  it("scores prior buyer behaviour only when the caller looked it up", () => {
    // Not supplied: not scored, weight redistributed.
    expect(scoreMatch(request, asset()).signals.priorBuyerLicence).toBe(false);
    // Supplied and false: a real miss, which costs.
    const looked = scoreMatch({ ...request, eventAt: undefined }, asset(), {
      priorBuyerLicence: false,
    });
    const unlooked = scoreMatch({ ...request, eventAt: undefined }, asset());
    expect(looked.confidence).toBeLessThan(unlooked.confidence);
    // Supplied and true: full marks again.
    expect(
      scoreMatch({ ...request, eventAt: undefined }, asset(), { priorBuyerLicence: true })
        .confidence,
    ).toBe(1);
  });

  it("weights add to one, so a full match is a full score", () => {
    const total = Object.values(MATCH_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

/*
 * The claim that matters most, and it is structural rather than behavioural.
 *
 * The matcher's input type has no image, no bytes, no embedding and no face
 * data. `subjects` is a list of strings an operator typed. Matching on it says
 * two labels agree; it cannot say who is in a picture, because nothing in
 * scope has ever seen the picture.
 */
describe("what the matcher cannot do", () => {
  it("matches labels, not faces", () => {
    const mislabelled = asset({ subjects: ["Someone Else Entirely"] });
    const match = scoreMatch(request, mislabelled);
    // No subject credit: the labels disagree. The matcher has no other way to
    // form a view, and that is the point.
    expect(match.signals.subjects).toEqual([]);
    expect(match.basis).not.toContain("Julian Cross");
  });

  it("treats a subject as context, so a frame still ranks on everything else", () => {
    const unlabelled = asset({ subjects: [] });
    const match = scoreMatch(request, unlabelled);
    expect(match.signals.subjects).toEqual([]);
    // Location, keywords, kind and time still count.
    expect(match.confidence).toBeGreaterThan(SUGGESTION_FLOOR);
  });
});

describe("clearance, which is not relevance", () => {
  it("never says clear on the basis of absent information", () => {
    const { clearance } = clearanceOf(request, asset());
    expect(clearance).toBe("unknown");
  });

  it("calls a restricted frame restricted, and keeps its relevance", () => {
    const restricted = asset({ status: "restricted" });
    const match = scoreMatch(request, restricted);
    expect(match.clearance).toBe("restricted");
    // Still the right picture. Hiding it would leave somebody wondering why
    // the obvious frame never came up.
    expect(match.confidence).toBeGreaterThan(0.9);
  });

  it("carries a usage restriction through as the note", () => {
    const match = scoreMatch(request, asset({ usageRestrictions: "Editorial use only." }));
    expect(match.clearance).toBe("restricted");
    expect(match.clearanceNote).toBe("Editorial use only.");
  });

  it("refuses to answer when the request itself raises embargo or exclusivity", () => {
    const embargoed = { ...request, embargoUntil: "2026-09-01T00:00:00.000Z" };
    expect(clearanceOf(embargoed, asset()).clearance).toBe("unknown");
    const exclusive = { ...request, exclusivity: "First use, 48h" };
    expect(clearanceOf(exclusive, asset()).note).toMatch(/exclusivity or an embargo/i);
  });
});

describe("ranking", () => {
  it("drops noise, orders by confidence, and breaks ties predictably", () => {
    const ranked = rankMatches(request, [
      asset({
        id: "b",
        subjects: [],
        keywords: [],
        locationName: "Cannes",
        capturedAt: "2020-01-01T00:00:00.000Z",
        assetKind: "video",
      }),
      asset({ id: "c" }),
      asset({ id: "a" }),
    ]);
    expect(ranked.map((m) => m.assetId)).toEqual(["a", "c"]);
    expect(ranked.every((m) => m.confidence >= SUGGESTION_FLOOR)).toBe(true);
  });

  it("caps what a person is asked to look at", () => {
    const many = Array.from({ length: 60 }, (_, i) => asset({ id: `a${i}` }));
    expect(rankMatches(request, many, 20)).toHaveLength(20);
  });

  it("is stable: the same inputs give the same order", () => {
    const many = Array.from({ length: 30 }, (_, i) => asset({ id: `a${i}` }));
    expect(rankMatches(request, many).map((m) => m.assetId)).toEqual(
      rankMatches(request, many).map((m) => m.assetId),
    );
  });
});
