import { describe, expect, it } from "vitest";
import {
  type SelectableMatch,
  composeShootNotes,
  groupMatchesByShoot,
  ineligibleReason,
  isPlausibleTimezone,
  isRequestKey,
  parseShootConfirmation,
  reviewSelection,
  unconfirmedFacts,
} from "./news-radar-handoff";

/**
 * The pure handoff rules: what may be selected, how a selection is refused
 * (never trimmed), what a confirmation form is allowed to carry, and how
 * suggestions stay suggestions in the draft's notes.
 */

function match(
  overrides: Partial<SelectableMatch> & { assetId: string; rank: number },
): SelectableMatch {
  return {
    shootId: "shoot-1",
    shootTitle: "Gala arrivals",
    restricted: false,
    metadataComplete: true,
    rights: ["copyright_recorded", "credit_recorded", "no_restriction_recorded"],
    hasFile: true,
    ...overrides,
  };
}

const A = match({ assetId: "a", rank: 1 });
const B = match({ assetId: "b", rank: 2, metadataComplete: false });
const RESTRICTED = match({
  assetId: "r",
  rank: 3,
  restricted: true,
  rights: ["rights_incomplete"],
});
const OTHER_SHOOT = match({ assetId: "o", rank: 4, shootId: "shoot-2", shootTitle: "Court steps" });
const NO_SHOOT = match({ assetId: "n", rank: 5, shootId: undefined, shootTitle: undefined });
const NO_FILE = match({ assetId: "f", rank: 6, hasFile: false });
const RESTRICTION_NOTED = match({
  assetId: "u",
  rank: 7,
  rights: ["copyright_recorded", "credit_recorded", "restriction_recorded"],
});

describe("eligibility", () => {
  it("names why a match cannot be selected, in the order the database refuses", () => {
    expect(ineligibleReason(A)).toBeUndefined();
    expect(ineligibleReason(RESTRICTED)).toBe("restricted");
    expect(ineligibleReason(NO_SHOOT)).toBe("no_shoot");
    expect(ineligibleReason(NO_FILE)).toBe("no_file");
    // Incomplete metadata and a recorded restriction are said, not refused.
    expect(ineligibleReason(B)).toBeUndefined();
    expect(ineligibleReason(RESTRICTION_NOTED)).toBeUndefined();
  });
});

describe("grouping by shoot", () => {
  it("groups in rank order, best shoot first, frames on no shoot last", () => {
    const groups = groupMatchesByShoot([NO_SHOOT, OTHER_SHOOT, RESTRICTED, B, A]);
    expect(groups.map((group) => group.shootTitle)).toEqual([
      "Gala arrivals",
      "Court steps",
      "Not on a shoot",
    ]);
    expect(groups[0].matches.map((m) => m.assetId)).toEqual(["a", "b", "r"]);
    expect(groups[0].eligibleCount).toBe(2);
    expect(groups[2].shootId).toBeUndefined();
    expect(groups[2].eligibleCount).toBe(0);
  });

  it("is empty for no matches", () => {
    expect(groupMatchesByShoot([])).toEqual([]);
  });
});

describe("selection review", () => {
  const all = [A, B, RESTRICTED, OTHER_SHOOT, NO_SHOOT, NO_FILE, RESTRICTION_NOTED];

  it("refuses an empty selection", () => {
    expect(reviewSelection(all, []).refusal).toBe("empty");
  });

  it("passes a clean selection on one shoot, in rank order, and says what needs attention", () => {
    const review = reviewSelection(all, ["u", "b", "a"]);
    expect(review.refusal).toBeUndefined();
    expect(review.eligible).toEqual(["a", "b", "u"]);
    expect(review.incompleteMetadata).toEqual(["b"]);
    expect(review.rightsAttention).toEqual(["u"]);
    expect(review.shootIds).toEqual(["shoot-1"]);
  });

  it("refuses a restricted frame rather than dropping it", () => {
    const review = reviewSelection(all, ["a", "r"]);
    expect(review.refusal).toBe("restricted");
    expect(review.blocked).toEqual([{ assetId: "r", reason: "restricted" }]);
    // The eligible frame is still listed: nothing was removed for the person.
    expect(review.eligible).toEqual(["a"]);
  });

  it("refuses a selection across shoots", () => {
    expect(reviewSelection(all, ["a", "o"]).refusal).toBe("mixed_shoots");
  });

  it("refuses a frame on no shoot and a frame with no file", () => {
    expect(reviewSelection(all, ["a", "n"]).refusal).toBe("no_shoot");
    expect(reviewSelection(all, ["a", "f"]).refusal).toBe("no_file");
  });

  it("ignores ids that are not matches and duplicates", () => {
    const review = reviewSelection(all, ["a", "a", "not-a-match"]);
    expect(review.eligible).toEqual(["a"]);
    expect(review.refusal).toBeUndefined();
  });
});

const BRIEF = {
  knownLocation: "Federal Courthouse",
  eventStartsAt: "2026-09-02T14:00:00.000Z",
  eventEndsAt: undefined,
  knownPeople: ["Avery Hart", "Jordan Lee"],
  suggestedAngle: "Arrival and departure at the courthouse steps",
  suggestedShots: ["Wide of the steps", "Tight on Avery Hart"],
};

function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

describe("shoot confirmation", () => {
  it("carries only confirmed fields, and only offered people and suggestions", () => {
    const parsed = parseShootConfirmation(
      form({
        title: "  Hart hearing  ",
        confirmLocation: "on",
        locationName: "Federal Courthouse",
        confirmTime: "on",
        startsAt: "2026-09-02T14:00:00.000Z",
        confirmTimezone: "on",
        timezone: "America/New_York",
        priority: "high",
        people: ["Avery Hart", "Someone Invented"],
        copiedSuggestions: ["shot:Wide of the steps", "angle:Invented angle"],
        ownNotes: "Bring the long lens.",
      }),
      BRIEF,
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        title: "Hart hearing",
        locationName: "Federal Courthouse",
        startsAt: "2026-09-02T14:00:00.000Z",
        endsAt: undefined,
        timezone: "America/New_York",
        priority: "high",
        people: ["Avery Hart"],
        copiedSuggestions: ["shot:Wide of the steps"],
        ownNotes: "Bring the long lens.",
      },
    });
  });

  it("does not copy an unconfirmed location or time even when a value is present", () => {
    const parsed = parseShootConfirmation(
      form({
        title: "Hearing",
        locationName: "Federal Courthouse",
        startsAt: "2026-09-02T14:00:00.000Z",
        timezone: "UTC",
      }),
      BRIEF,
    );
    expect(parsed.ok && parsed.value.locationName).toBeUndefined();
    expect(parsed.ok && parsed.value.startsAt).toBeUndefined();
    expect(parsed.ok && parsed.value.timezone).toBeUndefined();
  });

  it("refuses a confirmation with nothing behind it, and reports every problem at once", () => {
    const parsed = parseShootConfirmation(
      form({
        title: "",
        confirmLocation: "on",
        locationName: "",
        confirmTime: "on",
        startsAt: "",
        timezone: "Nowhere/Land",
        priority: "asap",
      }),
      BRIEF,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.errors).sort()).toEqual([
      "locationName",
      "priority",
      "startsAt",
      "timezone",
      "title",
    ]);
  });

  it("refuses an end before the start and an unreadable time", () => {
    const parsed = parseShootConfirmation(
      form({
        title: "Hearing",
        confirmTime: "on",
        startsAt: "2026-09-02T14:00",
        endsAt: "2026-09-02T13:00",
      }),
      BRIEF,
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.endsAt).toMatch(/after the start/);
    const unreadable = parseShootConfirmation(
      form({ title: "Hearing", startsAt: "yesterday" }),
      BRIEF,
    );
    expect(unreadable.ok).toBe(false);
  });

  it("knows a plausible time zone from garbage", () => {
    expect(isPlausibleTimezone("Europe/London")).toBe(true);
    expect(isPlausibleTimezone("UTC")).toBe(true);
    expect(isPlausibleTimezone("Nowhere/Land")).toBe(false);
    expect(isPlausibleTimezone("'; drop table shoots; --")).toBe(false);
  });
});

describe("notes and unconfirmed facts", () => {
  const confirmed = {
    title: "Hearing",
    priority: "standard" as const,
    people: ["Avery Hart"],
    copiedSuggestions: ["angle:Arrival and departure", "shot:Wide of the steps"],
    ownNotes: "Bring the long lens.",
  };

  it("labels every carried suggestion as a suggestion and every person as confirmed", () => {
    const notes = composeShootNotes(confirmed, "Hart hearing set for Tuesday") ?? "";
    expect(notes).toContain("From News Radar story: Hart hearing set for Tuesday");
    expect(notes).toContain("People expected (confirmed by the photographer): Avery Hart");
    expect(notes).toContain(
      "Suggested angle (News Radar suggestion, not confirmed): Arrival and departure",
    );
    expect(notes).toContain(
      "Suggested shots (News Radar suggestions, not confirmed):\n- Wide of the steps",
    );
    expect(notes).toContain("Bring the long lens.");
    // Never phrased as a fact.
    expect(notes).not.toMatch(/confirmed to appear|access granted|credential/i);
  });

  it("lists what remains unconfirmed, distinguishing recorded from not recorded", () => {
    expect(unconfirmedFacts(confirmed, BRIEF)).toEqual([
      "Location (recorded, not confirmed)",
      "Event time (recorded, not confirmed)",
      "Time zone (not confirmed)",
    ]);
    expect(
      unconfirmedFacts(
        { ...confirmed, people: [] },
        { ...BRIEF, knownLocation: undefined, knownPeople: [] },
      ),
    ).toEqual([
      "Location (not recorded)",
      "Event time (recorded, not confirmed)",
      "Time zone (not confirmed)",
      "People expected (none recorded)",
    ]);
  });
});

describe("request keys", () => {
  it("accepts a browser token and refuses anything else", () => {
    expect(isRequestKey(crypto.randomUUID())).toBe(true);
    expect(isRequestKey("short")).toBe(false);
    expect(isRequestKey("has spaces in it")).toBe(false);
  });
});
