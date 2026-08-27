import { describe, expect, it } from "vitest";
import {
  GENERATION_SYSTEM_PROMPT,
  MAX_CAPTION,
  MAX_HEADLINE,
  MAX_ITEM_LENGTH,
  MAX_KEYWORDS,
  MAX_LIST_ITEMS,
  buildGenerationPrompt,
  describeBasis,
  normaliseGeneration,
  supportsEffort,
} from "./metadata-suggestions";

const BASIS = "Read from the image.";

/** A complete, well-behaved response, as the tool schema asks for it. */
const WELL_FORMED = {
  headline: "Man leaves hotel through side entrance",
  caption: "A man in a dark coat walks out of a hotel side entrance at night.",
  alt_text: "A man in a dark coat walking out of a lit doorway at night.",
  event: null,
  venue: null,
  city: "London",
  region: null,
  country: "United Kingdom",
  scene: "walking to a waiting car",
  objects: ["car", "umbrella"],
  clothing: ["dark coat"],
  brands: [],
  keywords: ["hotel", "night", "coat"],
  category: "candid",
  quality: "good",
  sensitivity: "none",
  uncertainty_note: null,
  basis: "Read from the image and the shoot brief.",
  confidence: 0.7,
  field_confidence: { caption: 0.8, location: 0.4, brands: 0.9, category: 0.6 },
};

describe("normaliseGeneration", () => {
  it("keeps a well-formed response", () => {
    const result = normaliseGeneration(WELL_FORMED, BASIS);

    expect(result).toMatchObject({
      headline: "Man leaves hotel through side entrance",
      editorialCaption: "A man in a dark coat walks out of a hotel side entrance at night.",
      city: "London",
      country: "United Kingdom",
      scene: "walking to a waiting car",
      objects: ["car", "umbrella"],
      clothing: ["dark coat"],
      brands: [],
      keywords: ["hotel", "night", "coat"],
      contentCategory: "candid",
      qualityEstimate: "good",
      sensitivity: "none",
      confidence: 0.7,
    });
    // The provider's key is `caption`; the product's field is editorialCaption.
    // A stray copy under the wire name would quietly become a second source.
    expect(result).not.toHaveProperty("caption");
  });

  it("carries per-field confidence under the names the panel uses", () => {
    const result = normaliseGeneration(WELL_FORMED, BASIS);
    expect(result?.fieldConfidence).toEqual({
      editorialCaption: 0.8,
      city: 0.4,
      brands: 0.9,
      contentCategory: 0.6,
    });
  });

  it("reads a null as nothing rather than as the string 'null'", () => {
    const result = normaliseGeneration(WELL_FORMED, BASIS);
    expect(result?.eventName).toBeUndefined();
    expect(result?.venue).toBeUndefined();
    expect(result?.region).toBeUndefined();
  });

  it("caps a headline and a caption rather than letting them reach a buyer", () => {
    const result = normaliseGeneration(
      { ...WELL_FORMED, headline: "h".repeat(400), caption: "c".repeat(3000) },
      BASIS,
    );
    expect(result?.headline).toHaveLength(MAX_HEADLINE);
    expect(result?.editorialCaption).toHaveLength(MAX_CAPTION);
  });

  it("caps, lowercases, and de-duplicates keywords, keeping the strongest first", () => {
    const result = normaliseGeneration(
      {
        ...WELL_FORMED,
        keywords: ["Hotel", "hotel", "  NIGHT  ", ...Array.from({ length: 30 }, (_, i) => `k${i}`)],
      },
      BASIS,
    );
    expect(result?.keywords).toHaveLength(MAX_KEYWORDS);
    expect(result?.keywords.slice(0, 3)).toEqual(["hotel", "night", "k0"]);
  });

  it("keeps the casing of a brand, which reads wrong lowercased", () => {
    const result = normaliseGeneration(
      { ...WELL_FORMED, brands: ["Balenciaga", "balenciaga"] },
      BASIS,
    );
    expect(result?.brands).toEqual(["Balenciaga"]);
  });

  it("drops an entry too long to be a search term", () => {
    const result = normaliseGeneration(
      { ...WELL_FORMED, keywords: ["hotel", "x".repeat(MAX_ITEM_LENGTH + 1)] },
      BASIS,
    );
    expect(result?.keywords).toEqual(["hotel"]);
  });

  it("caps a list the model overfilled", () => {
    const result = normaliseGeneration(
      { ...WELL_FORMED, objects: Array.from({ length: 40 }, (_, i) => `object ${i}`) },
      BASIS,
    );
    expect(result?.objects).toHaveLength(MAX_LIST_ITEMS);
  });
});

describe("normaliseGeneration on a malformed response", () => {
  it("returns null rather than a record of blanks when nothing describable came back", () => {
    expect(
      normaliseGeneration(
        {
          ...WELL_FORMED,
          headline: "",
          caption: "",
          alt_text: "",
          keywords: [],
          objects: [],
          brands: [],
        },
        BASIS,
      ),
    ).toBeNull();
  });

  it("returns null for a response that is not an object at all", () => {
    expect(normaliseGeneration(null, BASIS)).toBeNull();
    expect(normaliseGeneration("a caption", BASIS)).toBeNull();
    expect(normaliseGeneration([1, 2, 3], BASIS)).toBeNull();
    expect(normaliseGeneration(42, BASIS)).toBeNull();
  });

  it("ignores a list that arrived as a string", () => {
    const result = normaliseGeneration({ ...WELL_FORMED, keywords: "hotel, night" }, BASIS);
    expect(result?.keywords).toEqual([]);
  });

  it("ignores an enum value that is not in the vocabulary", () => {
    const result = normaliseGeneration(
      { ...WELL_FORMED, category: "paparazzi_chase", quality: "amazing" },
      BASIS,
    );
    expect(result?.contentCategory).toBeUndefined();
    expect(result?.qualityEstimate).toBeUndefined();
  });

  it("falls back to the safe end of the sensitivity scale, never the permissive one", () => {
    // A model that returns nonsense here must not be able to clear a concern.
    expect(normaliseGeneration({ ...WELL_FORMED, sensitivity: "fine" }, BASIS)?.sensitivity).toBe(
      "none",
    );
    expect(
      normaliseGeneration({ ...WELL_FORMED, sensitivity: "sensitive" }, BASIS)?.sensitivity,
    ).toBe("sensitive");
  });

  it("clamps a confidence outside 0 to 1 and repairs one that is not a number", () => {
    expect(normaliseGeneration({ ...WELL_FORMED, confidence: 7 }, BASIS)?.confidence).toBe(1);
    expect(normaliseGeneration({ ...WELL_FORMED, confidence: -3 }, BASIS)?.confidence).toBe(0);
    expect(normaliseGeneration({ ...WELL_FORMED, confidence: "high" }, BASIS)?.confidence).toBe(
      0.5,
    );
    expect(normaliseGeneration({ ...WELL_FORMED, confidence: NaN }, BASIS)?.confidence).toBe(0.5);
  });

  it("drops per-field confidence that is not a number rather than storing it", () => {
    const result = normaliseGeneration(
      { ...WELL_FORMED, field_confidence: { caption: "high", location: 0.2 } },
      BASIS,
    );
    expect(result?.fieldConfidence).toEqual({ city: 0.2 });
  });

  it("uses the caller's basis when the model gave none", () => {
    expect(normaliseGeneration({ ...WELL_FORMED, basis: "" }, BASIS)?.basis).toBe(BASIS);
  });

  it("collapses whitespace a model wrapped its answer in", () => {
    const result = normaliseGeneration(
      { ...WELL_FORMED, headline: "  Two   people\n  leave  " },
      BASIS,
    );
    expect(result?.headline).toBe("Two people leave");
  });
});

describe("the instruction the model is given", () => {
  it("forbids identifying anyone, in the first rule", () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/Never name, guess at, or otherwise identify/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/never work backwards from a face/);
  });

  it("says a null is a correct answer, so a blank is not treated as a failure", () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/A null is a correct answer/);
  });

  it("holds the model to what is readable before it may name a place or a brand", () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/Only name a city, region, or country/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/Only list a brand or product you can actually read/);
  });
});

describe("buildGenerationPrompt", () => {
  it("passes known subjects as context and forbids adding to them", () => {
    const prompt = buildGenerationPrompt({ knownSubjects: ["A. Photographer"] });
    expect(prompt).toContain("A. Photographer");
    expect(prompt).toContain("Do not add anyone, and do not return a list of people.");
  });

  it("says so when the photographer has recorded nothing", () => {
    expect(buildGenerationPrompt({})).toContain("has not recorded anything about this frame yet");
  });

  it("tells the model a clip is a clip, so the caption can say so", () => {
    expect(buildGenerationPrompt({ isVideo: true })).toContain("still from video");
  });

  it("carries the recorded facts without inventing any", () => {
    const prompt = buildGenerationPrompt({
      shootTitle: "Soho arrival",
      locationName: "Dean Street",
      capturedAt: "2026-08-19T17:47:03.000Z",
    });
    expect(prompt).toContain("Shoot: Soho arrival");
    expect(prompt).toContain("Dean Street");
    expect(prompt).toContain("2026-08-19T17:47:03.000Z");
  });
});

describe("describeBasis", () => {
  it("always says that people are not identified", () => {
    expect(describeBasis({})).toContain("People are never identified by Mastline.");
  });

  it("names what it read, so the sentence in the panel is specific", () => {
    expect(describeBasis({ isVideo: true, shootTitle: "x", locationName: "y" })).toBe(
      "Read from a frame of the clip with the shoot brief and the recorded location. People are never identified by Mastline.",
    );
  });
});

describe("supportsEffort", () => {
  it("sends no effort to the default model, which rejects it with a 400", () => {
    expect(supportsEffort("claude-haiku-4-5")).toBe(false);
  });

  it("sends effort to the models that take it", () => {
    expect(supportsEffort("claude-opus-5")).toBe(true);
    expect(supportsEffort("claude-sonnet-5")).toBe(true);
  });

  it("treats an unrecognised model as not supporting it, which is always a valid request", () => {
    expect(supportsEffort("some-future-model")).toBe(false);
  });
});
