import { describe, expect, it } from "vitest";
import {
  ARCHIVE_MATCH_THRESHOLD,
  ARCHIVE_WEIGHTS,
  type ArchiveCandidate,
  EMPTY_CONTEXT,
  EVALUATOR_VERSION,
  RIGHTS_FACT_LABELS,
  SHOOT_WEIGHTS,
  type SignalContext,
  type SignalEntity,
  archiveInputKey,
  compareMatches,
  evaluateArchive,
  evaluateShoot,
  isEligibleStatus,
  metadataIsComplete,
  normalizeTerm,
  rightsFacts,
  shootInputKey,
  significantTerms,
  specialtyOverlap,
  windowState,
} from "./news-radar-evaluation";

/**
 * The evaluator is a pure function of its input. These tests pin the rules
 * the documentation states: which facts score, how much, how ties break,
 * what is excluded, and what is said about rights -- and that nothing is
 * ever invented.
 */

const NOW = new Date("2026-08-29T12:00:00.000Z");

const story = {
  title: "Avery Hart returns to Hotel Chelsea for gallery opening",
  summary: "The actor is expected at the opening on Friday evening.",
  sourceName: "Evening Wire",
  sourceUrl: "https://example.test/avery",
  sourcePublishedAt: "2026-08-28T09:00:00.000Z",
};

const person = (value: string): SignalEntity => ({ kind: "person", value, provenance: "manual" });
const keyword = (value: string): SignalEntity => ({ kind: "keyword", value, provenance: "manual" });
const organization = (value: string): SignalEntity => ({
  kind: "organization",
  value,
  provenance: "manual",
});

const context: SignalContext = {
  ...EMPTY_CONTEXT,
  locationName: "Hotel Chelsea, New York",
  eventStartsAt: "2026-08-29T18:00:00.000Z",
};

function asset(overrides: Partial<ArchiveCandidate> & { assetId: string }): ArchiveCandidate {
  return {
    status: "active",
    canonicalFilename: `FILE_${overrides.assetId}`,
    subjects: [],
    keywords: [],
    ...overrides,
  };
}

const averyAtChelsea = asset({
  assetId: "a1",
  headline: "Avery Hart departs Hotel Chelsea",
  caption: "Avery Hart is seen leaving Hotel Chelsea in New York City.",
  subjects: ["Avery Hart"],
  keywords: ["Hotel Chelsea", "departure"],
  locationName: "Hotel Chelsea, New York",
  capturedAt: "2026-08-19T18:47:18.000Z",
  copyrightNotice: "© 2026 Marcus Hale",
  creditLine: "Marcus Hale / Mastline",
  usageRestrictions: "Editorial use only.",
});

const unrelated = asset({
  assetId: "z9",
  headline: "Regatta on the river",
  caption: "Rowers pass under the bridge at dawn.",
  subjects: ["Maya Chen"],
  keywords: ["rowing"],
  capturedAt: "2026-06-01T06:00:00.000Z",
});

describe("normalization and terms", () => {
  it("lower-cases, trims and collapses whitespace, as the database does", () => {
    expect(normalizeTerm("  Avery   Hart ")).toBe("avery hart");
  });

  it("keeps only significant words", () => {
    const terms = significantTerms("Avery Hart returns to the Hotel Chelsea after years");
    expect(terms.has("avery")).toBe(true);
    expect(terms.has("hotel")).toBe(true);
    expect(terms.has("the")).toBe(false);
    expect(terms.has("after")).toBe(false);
    expect(terms.has("years")).toBe(false);
  });
});

describe("archive: determinism", () => {
  it("identical inputs produce identical scores and ordering", () => {
    const entities = [person("Avery Hart"), keyword("departure")];
    const candidates = [
      unrelated,
      averyAtChelsea,
      asset({ assetId: "b2", subjects: ["Avery Hart"] }),
    ];
    const first = evaluateArchive({ story, context, entities, candidates });
    const second = evaluateArchive({ story, context, entities, candidates });
    expect(second).toEqual(first);

    // Row order from the database is not an input.
    const shuffled = evaluateArchive({
      story,
      context,
      entities,
      candidates: [...candidates].reverse(),
    });
    expect(shuffled.matches).toEqual(first.matches);
  });

  it("breaks equal scores by newest capture, then filename, then id", () => {
    const older = asset({
      assetId: "id-b",
      subjects: ["Avery Hart"],
      capturedAt: "2026-01-01T00:00:00Z",
      canonicalFilename: "B",
    });
    const newer = asset({
      assetId: "id-a",
      subjects: ["Avery Hart"],
      capturedAt: "2026-02-01T00:00:00Z",
      canonicalFilename: "A",
    });
    const undated1 = asset({ assetId: "id-d", subjects: ["Avery Hart"], canonicalFilename: "Z" });
    const undated2 = asset({ assetId: "id-c", subjects: ["Avery Hart"], canonicalFilename: "Z" });
    const result = evaluateArchive({
      // No publication date, so capture time earns nothing and the four tie.
      story: { title: story.title },
      context: EMPTY_CONTEXT,
      entities: [person("Avery Hart")],
      candidates: [undated1, older, undated2, newer],
    });
    expect(result.matches.map((m) => m.score)).toEqual([40, 40, 40, 40]);
    expect(result.matches.map((m) => m.assetId)).toEqual(["id-a", "id-b", "id-c", "id-d"]);
    expect(result.matches.map((m) => m.rank)).toEqual([1, 2, 3, 4]);

    expect(compareMatches(newer as never, older as never)).toBeLessThan(0);
  });

  it("changes the input key when context changes, and not when row order does", () => {
    const base = {
      story,
      context: EMPTY_CONTEXT,
      entities: [],
      candidates: [averyAtChelsea, unrelated],
    };
    const same = { ...base, candidates: [unrelated, averyAtChelsea] };
    expect(archiveInputKey(same)).toBe(archiveInputKey(base));
    expect(archiveInputKey({ ...base, entities: [person("Avery Hart")] })).not.toBe(
      archiveInputKey(base),
    );
    expect(archiveInputKey({ ...base, context })).not.toBe(archiveInputKey(base));
    expect(archiveInputKey({ ...base, candidates: [averyAtChelsea] })).not.toBe(
      archiveInputKey(base),
    );
    expect(archiveInputKey(base)).toContain(EVALUATOR_VERSION);
  });
});

describe("archive: what scores, and how much", () => {
  it("credits an exact person on the subjects as documented", () => {
    const result = evaluateArchive({
      story: { title: "Nothing in common here" },
      context: EMPTY_CONTEXT,
      entities: [person("avery  hart")],
      candidates: [asset({ assetId: "a", subjects: ["Avery Hart"] })],
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].breakdown.people).toBe(ARCHIVE_WEIGHTS.personMatch);
    expect(result.matches[0].score).toBe(ARCHIVE_WEIGHTS.personMatch);
    expect(result.matches[0].reasons[0]).toMatch(/matches a subject.*avery {2}hart/i);
  });

  it("credits keywords and location exactly as documented", () => {
    const result = evaluateArchive({
      story: { title: "Unrelated words" },
      context: { ...EMPTY_CONTEXT, locationName: "Hotel Chelsea, New York" },
      entities: [keyword("Departure"), keyword("hotel chelsea")],
      candidates: [
        asset({
          assetId: "a",
          keywords: ["departure", "Hotel Chelsea"],
          locationName: "hotel chelsea,  new york",
        }),
      ],
    });
    const [match] = result.matches;
    expect(match.breakdown.keywords).toBe(2 * ARCHIVE_WEIGHTS.keywordMatch);
    expect(match.breakdown.location).toBe(ARCHIVE_WEIGHTS.locationExact);
    expect(match.breakdown.people).toBe(0);
    expect(match.score).toBe(2 * ARCHIVE_WEIGHTS.keywordMatch + ARCHIVE_WEIGHTS.locationExact);
  });

  it("gives a shared location word the partial credit only", () => {
    const result = evaluateArchive({
      story: { title: "Unrelated words" },
      context: { ...EMPTY_CONTEXT, locationName: "Chelsea Piers" },
      entities: [keyword("departure")],
      candidates: [
        asset({ assetId: "a", keywords: ["departure"], locationName: "Chelsea Market" }),
      ],
    });
    expect(result.matches[0].breakdown.location).toBe(ARCHIVE_WEIGHTS.locationPartial);
  });

  it("caps each component and the total", () => {
    const names = ["A B", "C D", "E F", "G H"];
    const result = evaluateArchive({
      story,
      context,
      entities: [...names.map(person), organization("Hotel Chelsea"), keyword("departure")],
      candidates: [
        asset({
          ...averyAtChelsea,
          subjects: names,
          keywords: ["departure", "hotel chelsea"],
          capturedAt: "2026-08-29T10:00:00.000Z",
        }),
      ],
    });
    const [match] = result.matches;
    expect(match.breakdown.people).toBe(ARCHIVE_WEIGHTS.personCap);
    expect(match.score).toBeLessThanOrEqual(100);
  });

  it("credits capture time against the event, and against publication when no event is recorded", () => {
    const candidates = [
      asset({ assetId: "a", subjects: ["Avery Hart"], capturedAt: "2026-08-27T00:00:00Z" }),
    ];
    const withEvent = evaluateArchive({
      story,
      context,
      entities: [person("Avery Hart")],
      candidates,
    });
    expect(withEvent.matches[0].breakdown.time).toBe(ARCHIVE_WEIGHTS.timeWithin7Days);
    expect(withEvent.matches[0].reasons.join(" ")).toMatch(/recorded event time/);

    const noEvent = evaluateArchive({
      story,
      context: EMPTY_CONTEXT,
      entities: [person("Avery Hart")],
      candidates,
    });
    expect(noEvent.matches[0].breakdown.time).toBe(ARCHIVE_WEIGHTS.timeWithin7Days);
    expect(noEvent.matches[0].reasons.join(" ")).toMatch(/publication/);

    const noReference = evaluateArchive({
      story: { title: story.title },
      context: EMPTY_CONTEXT,
      entities: [person("Avery Hart")],
      candidates,
    });
    expect(noReference.matches[0].breakdown.time).toBe(0);
  });

  it("readiness points never make a match on their own", () => {
    const complete = asset({
      assetId: "a",
      headline: "Something",
      caption: "Else entirely",
      subjects: ["Nobody"],
      keywords: ["unrelated"],
      copyrightNotice: "©",
      creditLine: "X",
    });
    const result = evaluateArchive({
      story,
      context,
      entities: [person("Avery Hart")],
      candidates: [complete],
    });
    expect(result.matches).toHaveLength(0);
    expect(result.excluded.zeroOverlap).toBe(1);
  });
});

describe("archive: exclusions", () => {
  it("never returns a zero-overlap asset", () => {
    const result = evaluateArchive({
      story,
      context,
      entities: [person("Avery Hart")],
      candidates: [unrelated, averyAtChelsea],
    });
    expect(result.matches.map((m) => m.assetId)).toEqual(["a1"]);
    expect(result.excluded.zeroOverlap).toBe(1);
  });

  it("drops overlap below the threshold, and says so", () => {
    const thin = asset({ assetId: "t", headline: "A gallery, an opening, nothing more" });
    const result = evaluateArchive({
      story,
      context: EMPTY_CONTEXT,
      entities: [],
      candidates: [thin],
    });
    // Two shared words is 6 points: real overlap, too thin to show.
    expect(2 * ARCHIVE_WEIGHTS.termMatch).toBeLessThan(ARCHIVE_MATCH_THRESHOLD);
    expect(result.matches).toHaveLength(0);
    expect(result.excluded.belowThreshold).toBe(1);
  });

  it("excludes tombstoned and ingesting records whatever they contain", () => {
    const result = evaluateArchive({
      story,
      context,
      entities: [person("Avery Hart")],
      candidates: [
        { ...averyAtChelsea, assetId: "gone", status: "tombstoned" },
        { ...averyAtChelsea, assetId: "half", status: "ingesting" },
        { ...averyAtChelsea, assetId: "kept", status: "archived" },
        { ...averyAtChelsea, assetId: "flagged", status: "restricted" },
      ],
    });
    expect(result.matches.map((m) => m.assetId).sort()).toEqual(["flagged", "kept"]);
    expect(result.excluded.tombstoned).toBe(1);
    expect(result.excluded.ingesting).toBe(1);
    expect(isEligibleStatus("tombstoned")).toBe(false);
    expect(isEligibleStatus("ingesting")).toBe(false);
    expect(isEligibleStatus("restricted")).toBe(true);
  });
});

describe("archive: honest states", () => {
  it("says the archive is empty rather than reporting no matches", () => {
    const result = evaluateArchive({
      story,
      context,
      entities: [person("Avery Hart")],
      candidates: [],
    });
    expect(result.outcome).toBe("ready");
    expect(result.candidatesConsidered).toBe(0);
    expect(result.explanation).toMatch(/no eligible photographs/);
  });

  it("needs context when a headline-only story matches nothing", () => {
    const result = evaluateArchive({
      story: { title: "Quiet day" },
      context: EMPTY_CONTEXT,
      entities: [],
      candidates: [unrelated],
    });
    expect(result.outcome).toBe("needs_context");
    expect(result.missingContext).toEqual([
      "People on the story",
      "Topics or keywords",
      "Location",
    ]);
  });

  it("is ready with zero matches when context exists and nothing overlaps", () => {
    const result = evaluateArchive({
      story: { title: "Quiet day" },
      context: EMPTY_CONTEXT,
      entities: [person("Nobody Known")],
      candidates: [unrelated],
    });
    expect(result.outcome).toBe("ready");
    expect(result.matches).toHaveLength(0);
  });
});

describe("rights and metadata facts", () => {
  it("describes recorded rights precisely and never says cleared", () => {
    const full = rightsFacts({
      copyrightNotice: "©",
      creditLine: "X",
      usageRestrictions: "Editorial only",
    });
    expect(full).toEqual(["copyright_recorded", "credit_recorded", "restriction_recorded"]);

    const bare = rightsFacts({});
    expect(bare).toEqual(["no_restriction_recorded", "rights_incomplete"]);

    const half = rightsFacts({ creditLine: "X" });
    expect(half).toEqual(["credit_recorded", "no_restriction_recorded", "rights_incomplete"]);

    for (const label of Object.values(RIGHTS_FACT_LABELS)) {
      expect(label.toLowerCase()).not.toMatch(/clear|ready to use|approved/);
    }
  });

  it("reports metadata completeness from the four editorial fields", () => {
    expect(metadataIsComplete(averyAtChelsea)).toBe(true);
    expect(metadataIsComplete({ ...averyAtChelsea, keywords: [] })).toBe(false);
  });
});

describe("shoot brief", () => {
  const workspace = {
    baseCity: "New York",
    specialties: ["celebrity", "news"],
    timeZone: "America/New_York",
  };

  it("needs context and lists exactly what to confirm when where or when is missing", () => {
    const brief = evaluateShoot({
      story: { title: "Something may happen" },
      context: EMPTY_CONTEXT,
      entities: [],
      workspace: { specialties: [], timeZone: "UTC" },
      now: NOW,
    });
    expect(brief.readiness).toBe("needs_context");
    expect(brief.missingConfirmations).toEqual([
      "Event time: none recorded",
      "Location: none recorded",
      "Who is expected: no people recorded",
      "Access and credentials: Mastline records none; confirm before travelling",
      "Source: none recorded",
    ]);
    // Nothing is invented for a story that records nothing.
    expect(brief.suggestedAngle).toBeUndefined();
    expect(brief.suggestedShots).toEqual([]);
    expect(brief.knownLocation).toBeUndefined();
    expect(brief.eventStartsAt).toBeUndefined();
    expect(brief.specialtyRelevance).toBeUndefined();
    expect(brief.readinessScore).toBe(0);
    expect(brief.windowState).toBe("unknown");
  });

  it("is ready with where and when recorded, and scores as documented", () => {
    const brief = evaluateShoot({
      story,
      context,
      entities: [person("Avery Hart"), organization("Hotel Chelsea")],
      windowClosesAt: "2026-08-30T00:00:00.000Z",
      workspace,
      now: NOW,
    });
    expect(brief.readiness).toBe("ready");
    expect(brief.breakdown).toEqual({
      eventTime: SHOOT_WEIGHTS.eventTimeRecorded,
      upcoming: SHOOT_WEIGHTS.eventUpcoming,
      location: SHOOT_WEIGHTS.locationRecorded,
      people: SHOOT_WEIGHTS.peopleRecorded,
      source: SHOOT_WEIGHTS.sourceRecorded,
      summary: SHOOT_WEIGHTS.summaryRecorded,
      baseCity: SHOOT_WEIGHTS.withinBaseCity,
      specialty: SHOOT_WEIGHTS.specialtyOverlap,
    });
    expect(brief.readinessScore).toBe(100);
    expect(brief.windowState).toBe("closing");
    expect(brief.knownPeople).toEqual(["Avery Hart"]);
    expect(brief.knownLocation).toBe("Hotel Chelsea, New York");
    expect(brief.geographicRelevance).toMatch(/Within your base city/);
    expect(brief.specialtyRelevance).toMatch(/Celebrity/);
    expect(brief.suggestedAngle).toBe("Avery Hart at Hotel Chelsea, New York");
    expect(brief.suggestedShots).toEqual([
      "Establishing frame of Hotel Chelsea, New York",
      "Avery Hart: a clean single, tight and wide",
      "Arrivals before Aug 29 · 2:00 PM",
      "Signage or branding of Hotel Chelsea in frame",
    ]);
    // A recorded name is still not a confirmed appearance.
    expect(brief.missingConfirmations).toContain(
      "Appearance: a recorded name is not a confirmed appearance",
    );
    expect(brief.whyNow[0]).toBe("Published Aug 28 · 5:00 AM by Evening Wire");
  });

  it("reports specialty relevance only when the workspace recorded specialties", () => {
    const withNone = evaluateShoot({
      story,
      context,
      entities: [],
      workspace: { specialties: [], timeZone: "UTC" },
      now: NOW,
    });
    expect(withNone.specialtyRelevance).toBeUndefined();
    expect(withNone.breakdown.specialty).toBe(0);

    const noOverlap = evaluateShoot({
      story: { title: "Council votes on bins" },
      context,
      entities: [],
      workspace: { specialties: ["portraits"], timeZone: "UTC" },
      now: NOW,
    });
    expect(noOverlap.specialtyRelevance).toMatch(/No overlap.*Portraits/);
    expect(specialtyOverlap("court hearing today", ["news", "portraits"])).toEqual(["news"]);
  });

  it("never claims a base city the workspace did not record", () => {
    const brief = evaluateShoot({
      story,
      context,
      entities: [],
      workspace: { specialties: [], timeZone: "UTC" },
      now: NOW,
    });
    expect(brief.geographicRelevance).toMatch(/no base city on record/);
    expect(brief.breakdown.baseCity).toBe(0);
  });

  it("derives the window from the clock and the recorded timestamps", () => {
    expect(windowState(NOW, undefined, undefined, undefined)).toBe("unknown");
    expect(windowState(NOW, "2026-08-28T00:00:00Z", undefined, undefined)).toBe("closed");
    expect(windowState(NOW, undefined, "2026-08-29T18:00:00Z", undefined)).toBe("closing");
    expect(windowState(NOW, undefined, "2026-09-10T18:00:00Z", undefined)).toBe("open");
    expect(windowState(NOW, undefined, undefined, "2026-08-29T06:00:00Z")).toBe("closed");
    // A started event with no end is treated as under way for a day.
    expect(windowState(NOW, undefined, "2026-08-29T06:00:00Z", undefined)).toBe("open");
    expect(windowState(NOW, undefined, "2026-08-27T06:00:00Z", undefined)).toBe("closed");
  });

  it("excludes the clock from the input key and includes the workspace preferences", () => {
    const base = { story, context, entities: [person("Avery Hart")], workspace };
    expect(shootInputKey(base)).toBe(shootInputKey(base));
    expect(shootInputKey({ ...base, workspace: { ...workspace, baseCity: "Paris" } })).not.toBe(
      shootInputKey(base),
    );
    expect(shootInputKey({ ...base, windowClosesAt: "2026-09-01T00:00:00Z" })).not.toBe(
      shootInputKey(base),
    );
    expect(shootInputKey(base)).not.toContain("now");
  });

  it("both paths read the same canonical facts", () => {
    const archiveKey = archiveInputKey({ story, context, entities: [], candidates: [] });
    const shootKey = shootInputKey({ story, context, entities: [], workspace });
    for (const fact of [
      story.title,
      story.sourceUrl,
      story.sourcePublishedAt,
      "hotel chelsea, new york",
    ]) {
      expect(archiveKey).toContain(fact);
      expect(shootKey).toContain(fact);
    }
  });
});
