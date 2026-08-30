import { describe, expect, it } from "vitest";
import { EMPTY_CONTEXT } from "./news-radar-evaluation";
import {
  CONTEXT_LIST_MAX,
  findSuggestion,
  parseContextForm,
  parseContextList,
  suggestContext,
} from "./news-radar-context";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("parseContextList", () => {
  it("splits on commas and lines, trims, and deduplicates on the normalized value", () => {
    expect(parseContextList("Avery Hart, avery  hart\nMaya Chen,,")).toEqual([
      "Avery Hart",
      "Maya Chen",
    ]);
  });
});

describe("parseContextForm", () => {
  it("accepts an empty form: a headline-only story is still whole", () => {
    const result = parseContextForm(form({}));
    expect(result).toEqual({
      ok: true,
      value: { people: [], organizations: [], topics: [], keywords: [] },
    });
  });

  it("refuses an event that ends before it starts", () => {
    const result = parseContextForm(
      form({ eventStartsAt: "2026-08-30T10:00", eventEndsAt: "2026-08-30T09:00" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.eventEndsAt).toMatch(/cannot end before/);
  });

  it("bounds the lists", () => {
    const tooMany = Array.from({ length: CONTEXT_LIST_MAX + 1 }, (_, i) => `Person ${i}`).join(",");
    const result = parseContextForm(form({ people: tooMany }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.people).toMatch(/entries/);
  });

  it("returns typed values", () => {
    const result = parseContextForm(
      form({
        people: "Avery Hart",
        locationName: "  Hotel   Chelsea ",
        eventStartsAt: "2026-08-30T10:00:00Z",
        windowNote: "Doors at six.",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.people).toEqual(["Avery Hart"]);
      expect(result.value.locationName).toBe("Hotel Chelsea");
      expect(result.value.eventStartsAt).toBe("2026-08-30T10:00:00.000Z");
      expect(result.value.windowNote).toBe("Doors at six.");
    }
  });
});

describe("suggestContext", () => {
  const nothingRecorded = { entities: [], context: EMPTY_CONTEXT };

  it("suggests capitalised phrases with a stated basis and fixed confidence, deterministically", () => {
    const story = {
      title: "Avery Hart departs Hotel Chelsea in New York",
      summary: "She was photographed leaving with Maya Chen.",
    };
    const first = suggestContext(story, nothingRecorded);
    expect(first).toEqual([
      {
        kind: "person",
        value: "Avery Hart",
        basis: "Capitalised phrase in the headline",
        confidence: 0.4,
      },
      {
        kind: "organization",
        value: "Hotel Chelsea",
        basis: "Capitalised phrase in the headline",
        confidence: 0.4,
      },
      {
        kind: "location",
        value: "New York",
        basis: "Follows “in” in the headline",
        confidence: 0.5,
      },
      {
        kind: "person",
        value: "Maya Chen",
        basis: "Capitalised phrase in the summary",
        confidence: 0.4,
      },
    ]);
    expect(suggestContext(story, nothingRecorded)).toEqual(first);
  });

  it("says nothing about a Title Case headline, where capitals mean nothing", () => {
    expect(
      suggestContext({ title: "Gallery Opening On The South Bank Draws Crowds" }, nothingRecorded),
    ).toEqual([]);
  });

  it("does not repeat what is already recorded", () => {
    const story = { title: "Avery Hart departs Hotel Chelsea in New York" };
    const suggestions = suggestContext(story, {
      entities: [{ kind: "person", value: "avery hart", provenance: "manual" }],
      context: { ...EMPTY_CONTEXT, locationName: "New York" },
    });
    expect(suggestions.map((s) => s.value)).toEqual(["Hotel Chelsea"]);
  });

  it("only re-derives a suggestion the rule would make now", () => {
    const suggestions = suggestContext({ title: "Avery Hart departs" }, nothingRecorded);
    expect(findSuggestion(suggestions, "person", "AVERY HART")?.value).toBe("Avery Hart");
    expect(findSuggestion(suggestions, "person", "Somebody Else")).toBeUndefined();
    expect(findSuggestion(suggestions, "buyer", "Avery Hart")).toBeUndefined();
  });
});
