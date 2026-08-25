import { describe, expect, it } from "vitest";
import {
  MAX_CAPTION,
  MAX_HEADLINE,
  MAX_KEYWORDS,
  SUGGESTION_SYSTEM_PROMPT,
  buildSuggestionPrompt,
  describeBasis,
  normaliseSuggestion,
  supportsEffort,
} from "./metadata-suggestions";

const BASIS = "Read from the image.";

describe("normaliseSuggestion", () => {
  it("keeps a well-formed suggestion", () => {
    const result = normaliseSuggestion(
      {
        headline: "Man leaves hotel through side entrance",
        caption: "A man in a dark coat walks out of a hotel side entrance at night.",
        keywords: ["hotel", "night", "coat"],
        basis: "Read from the image and the shoot brief.",
        confidence: 0.7,
      },
      BASIS,
    );

    expect(result).toEqual({
      headline: "Man leaves hotel through side entrance",
      caption: "A man in a dark coat walks out of a hotel side entrance at night.",
      keywords: ["hotel", "night", "coat"],
      basis: "Read from the image and the shoot brief.",
      confidence: 0.7,
    });
  });

  it("caps a headline and a caption rather than letting them reach a buyer", () => {
    const result = normaliseSuggestion(
      { headline: "h".repeat(400), caption: "c".repeat(3000), keywords: [], confidence: 0.5 },
      BASIS,
    );
    expect(result?.headline).toHaveLength(MAX_HEADLINE);
    expect(result?.caption).toHaveLength(MAX_CAPTION);
  });

  it("caps, lowercases, and de-duplicates keywords, keeping the strongest first", () => {
    const result = normaliseSuggestion(
      {
        caption: "Something visible.",
        keywords: ["Hotel", "hotel", "  NIGHT  ", ...Array.from({ length: 30 }, (_, i) => `k${i}`)],
        confidence: 0.5,
      },
      BASIS,
    );
    expect(result?.keywords).toHaveLength(MAX_KEYWORDS);
    expect(result?.keywords.slice(0, 3)).toEqual(["hotel", "night", "k0"]);
  });

  it("drops a keyword too long to be a search term", () => {
    const result = normaliseSuggestion(
      { caption: "Visible.", keywords: ["ok", "x".repeat(90)], confidence: 0.5 },
      BASIS,
    );
    expect(result?.keywords).toEqual(["ok"]);
  });

  it("clamps confidence into range instead of trusting it", () => {
    expect(normaliseSuggestion({ caption: "a", confidence: 5 }, BASIS)?.confidence).toBe(1);
    expect(normaliseSuggestion({ caption: "a", confidence: -2 }, BASIS)?.confidence).toBe(0);
    expect(normaliseSuggestion({ caption: "a", confidence: "high" }, BASIS)?.confidence).toBe(0.5);
  });

  it("falls back to the interface's own basis when the model gives none", () => {
    expect(normaliseSuggestion({ caption: "a", confidence: 0.5 }, BASIS)?.basis).toBe(BASIS);
  });

  it("returns null for a response with nothing usable in it, rather than a blank draft", () => {
    expect(normaliseSuggestion({ headline: "  ", caption: "", keywords: [] }, BASIS)).toBeNull();
    expect(normaliseSuggestion(null, BASIS)).toBeNull();
    expect(normaliseSuggestion("a string", BASIS)).toBeNull();
    expect(normaliseSuggestion(undefined, BASIS)).toBeNull();
  });

  it("ignores a keywords field that is not a list", () => {
    const result = normaliseSuggestion(
      { caption: "Visible.", keywords: "hotel, night", confidence: 0.5 },
      BASIS,
    );
    expect(result?.keywords).toEqual([]);
  });

  it("never carries a people field through, whatever the model returns", () => {
    const result = normaliseSuggestion(
      { caption: "Visible.", subjects: ["A Real Person"], keywords: [], confidence: 0.9 },
      BASIS,
    );
    expect(result).not.toHaveProperty("subjects");
    expect(JSON.stringify(result)).not.toContain("A Real Person");
  });
});

describe("the instruction given to the model", () => {
  it("forbids naming anyone", () => {
    expect(SUGGESTION_SYSTEM_PROMPT).toMatch(/never name/i);
  });

  it("tells it to say so rather than invent detail it cannot see", () => {
    expect(SUGGESTION_SYSTEM_PROMPT).toMatch(/rather than inventing detail/i);
  });
});

describe("buildSuggestionPrompt", () => {
  it("passes on the facts the photographer already recorded", () => {
    const prompt = buildSuggestionPrompt({
      shootTitle: "Hotel Chelsea departure",
      locationName: "40.7484, -73.9857",
      capturedAt: "2026-08-25T20:14:00Z",
    });
    expect(prompt).toContain("Hotel Chelsea departure");
    expect(prompt).toContain("40.7484, -73.9857");
    expect(prompt).toContain("2026-08-25T20:14:00Z");
    expect(prompt).toMatch(/do not name anyone/i);
  });

  it("says so when the frame came from a clip", () => {
    expect(buildSuggestionPrompt({ isVideo: true })).toMatch(/frame taken from a video clip/i);
    expect(buildSuggestionPrompt({ isVideo: false })).toMatch(/photograph/i);
  });

  it("does not pretend to context it does not have", () => {
    const prompt = buildSuggestionPrompt({});
    expect(prompt).toMatch(/has not recorded anything/i);
  });
});

describe("describeBasis", () => {
  it("always states that people are never suggested", () => {
    expect(describeBasis({})).toMatch(/People are never suggested/);
    expect(describeBasis({ isVideo: true })).toMatch(/frame of the clip/i);
  });
});

describe("supportsEffort", () => {
  // The default. Sending effort to it is a 400, not a wasted parameter.
  it("does not send effort to the model this deployment actually runs", () => {
    expect(supportsEffort("claude-haiku-4-5")).toBe(false);
    expect(supportsEffort("claude-haiku-4-5-20251001")).toBe(false);
  });

  it("sends effort to the models that accept it", () => {
    expect(supportsEffort("claude-opus-5")).toBe(true);
    expect(supportsEffort("claude-sonnet-5")).toBe(true);
    expect(supportsEffort("claude-sonnet-4-6")).toBe(true);
    expect(supportsEffort("claude-fable-5")).toBe(true);
  });

  // Sonnet 4.5 rejects effort exactly as Haiku does, which is the case an
  // "everything but haiku" rule would have got wrong.
  it("withholds effort from older models that reject it", () => {
    expect(supportsEffort("claude-sonnet-4-5")).toBe(false);
  });

  // A model released after this code was written is not a failed suggestion.
  it("falls back to the model's own default rather than guessing", () => {
    expect(supportsEffort("claude-something-7")).toBe(false);
    expect(supportsEffort("")).toBe(false);
  });
});
