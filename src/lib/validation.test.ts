import { describe, expect, it } from "vitest";
import {
  MAX_STAGED_PHOTOGRAPHS,
  isRecordId,
  parseOnboarding,
  parseShootAssetDefaults,
  parseStagedPhotographs,
  slugifyWorkspace,
} from "./validation";

describe("slugifyWorkspace", () => {
  it.each([
    ["Marcus Hale Studio", "marcus-hale-studio"],
    ["  Spaced  Out  ", "spaced-out"],
    ["Ünïcödé Stüdio", "unicode-studio"],
    ["Studio & Co.", "studio-co"],
    ["...leading and trailing...", "leading-and-trailing"],
    ["ALL CAPS", "all-caps"],
  ])("turns %j into %j", (input, expected) => {
    expect(slugifyWorkspace(input)).toBe(expected);
  });

  it("falls back rather than producing an empty slug", () => {
    expect(slugifyWorkspace("!!!")).toBe("workspace");
    expect(slugifyWorkspace("")).toBe("workspace");
  });

  it("caps the length and never ends on a separator", () => {
    const slug = slugifyWorkspace("a".repeat(60));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("matches the slug pattern the schema enforces", () => {
    const pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    for (const name of ["Marcus Hale Studio", "Studio & Co.", "  Spaced  ", "!!!", "Ünïcödé"]) {
      expect(slugifyWorkspace(name)).toMatch(pattern);
    }
  });
});

describe("isRecordId", () => {
  it("accepts a real id", () => {
    expect(isRecordId("a0000000-0000-0000-0000-0000000000d1")).toBe(true);
  });

  it("accepts either case", () => {
    expect(isRecordId("A0000000-0000-0000-0000-0000000000D1")).toBe(true);
  });

  it.each([
    ["a hand-edited URL", "not-a-uuid"],
    ["an empty string", ""],
    ["a number", "12345"],
    ["a truncated id", "a0000000-0000-0000-0000"],
    ["something SQL-shaped", "'; drop table assets; --"],
  ])("rejects %s", (_label, value) => {
    expect(isRecordId(value)).toBe(false);
  });
});

/**
 * The address arrives from a form, so it is checked here as well as on the
 * step. A disabled Continue button is a courtesy; this is the control.
 */
describe("parseOnboarding: the workspace address", () => {
  function form(overrides: Record<string, string> = {}): FormData {
    const data = new FormData();
    const fields: Record<string, string> = {
      name: "Hale Studio",
      workspaceSlug: "hale-studio",
      timezone: "America/New_York",
      workStyle: "independent",
      baseCity: "New York, NY",
      specialties: "celebrity",
      goals: "organize",
      ...overrides,
    };
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  }

  it("accepts a well-formed address", () => {
    const parsed = parseOnboarding(form());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.workspaceSlug).toBe("hale-studio");
  });

  it("lowercases what it is given", () => {
    const parsed = parseOnboarding(form({ workspaceSlug: "Hale-Studio" }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.workspaceSlug).toBe("hale-studio");
  });

  it("refuses a reserved address even when the step let it through", () => {
    const parsed = parseOnboarding(form({ workspaceSlug: "pricing" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.workspaceSlug).toMatch(/reserved/i);
  });

  it("refuses a malformed address", () => {
    for (const slug of ["not kebab", "trailing-", "-leading", "under_score", "a".repeat(41)]) {
      const parsed = parseOnboarding(form({ workspaceSlug: slug }));
      expect(parsed.ok, `${slug} should be refused`).toBe(false);
    }
  });

  it("refuses a missing address rather than inventing one", () => {
    const parsed = parseOnboarding(form({ workspaceSlug: "" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.workspaceSlug).toMatch(/choose/i);
  });
});

/**
 * The photographs a Create shoot carries.
 *
 * These arrive as JSON in a hidden input, which is to say they arrive from a
 * browser. The parser's job is to be unimpressed by that: a digest that is not
 * a digest is refused rather than stored, because the digest is the whole basis
 * for claiming later that an original is the file the photographer had.
 */
const DIGEST = "a".repeat(64);

const staged = (over: Record<string, unknown> = {}) => ({
  filename: "MH_0001.jpg",
  sha256: DIGEST,
  bytes: 4_200_000,
  mimeType: "image/jpeg",
  capturedAt: "2026-08-27T10:00:00.000Z",
  width: 6000,
  height: 4000,
  stagingKey: "org-id/_staging/token",
  ...over,
});

function payload(photographs: unknown): FormData {
  const data = new FormData();
  data.set("photographs", JSON.stringify(photographs));
  return data;
}

describe("parseStagedPhotographs", () => {
  it("reads an empty submission as no photographs, not as an error", () => {
    const parsed = parseStagedPhotographs(new FormData());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual([]);
  });

  it("keeps the facts the server needs to register an original", () => {
    const parsed = parseStagedPhotographs(payload([staged()]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value[0]).toMatchObject({
      filename: "MH_0001.jpg",
      sha256: DIGEST,
      bytes: 4_200_000,
      mimeType: "image/jpeg",
      width: 6000,
      height: 4000,
      stagingKey: "org-id/_staging/token",
    });
    expect(parsed.value[0].capturedAt).toBe("2026-08-27T10:00:00.000Z");
  });

  it("refuses anything whose digest is not one", () => {
    for (const sha256 of ["", "not-a-digest", "A".repeat(64), "a".repeat(63)]) {
      const parsed = parseStagedPhotographs(payload([staged({ sha256 })]));
      expect(parsed.ok, `${sha256} should be refused`).toBe(false);
    }
  });

  it("refuses a photograph with no bytes, no name, or nowhere to read it from", () => {
    expect(parseStagedPhotographs(payload([staged({ bytes: 0 })])).ok).toBe(false);
    expect(parseStagedPhotographs(payload([staged({ filename: "" })])).ok).toBe(false);
    expect(parseStagedPhotographs(payload([staged({ stagingKey: "" })])).ok).toBe(false);
  });

  it("refuses a payload that is not a list of objects", () => {
    const data = new FormData();
    data.set("photographs", "{ not json");
    expect(parseStagedPhotographs(data).ok).toBe(false);
    expect(parseStagedPhotographs(payload({ filename: "x" })).ok).toBe(false);
    expect(parseStagedPhotographs(payload(["MH_0001.jpg"])).ok).toBe(false);
  });

  it("caps how many one request may carry", () => {
    const many = Array.from({ length: MAX_STAGED_PHOTOGRAPHS + 1 }, (_, index) =>
      staged({ filename: `MH_${index}.jpg` }),
    );
    const parsed = parseStagedPhotographs(payload(many));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/up to 200/);
  });

  it("drops an unreadable capture time rather than refusing the frame", () => {
    const parsed = parseStagedPhotographs(payload([staged({ capturedAt: "not a date" })]));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value[0].capturedAt).toBeUndefined();
  });

  it("cleans per-photograph metadata rather than trusting it", () => {
    const parsed = parseStagedPhotographs(
      payload([
        staged({
          metadata: {
            headline: "  On the steps  ",
            caption: " A complete caption. ",
            subjects: ["  Marcus  ", "", "Marcus", 7],
            keywords: ["street", " street ", "night"],
          },
        }),
      ]),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value[0].metadata).toMatchObject({
      headline: "On the steps",
      caption: "A complete caption.",
      subjects: ["Marcus"],
      keywords: ["street", "night"],
    });
  });

  it("refuses a caption or headline past the length the database takes", () => {
    expect(
      parseStagedPhotographs(payload([staged({ metadata: { caption: "x".repeat(2001) } })])).ok,
    ).toBe(false);
    expect(
      parseStagedPhotographs(payload([staged({ metadata: { headline: "x".repeat(201) } })])).ok,
    ).toBe(false);
  });

  it("keeps a well-formed preview and drops a broken one", () => {
    const good = parseStagedPhotographs(
      payload([
        staged({
          preview: {
            sha256: "b".repeat(64),
            bytes: 90_000,
            width: 1400,
            height: 933,
            stagingKey: "org-id/_staging/token-preview",
          },
        }),
      ]),
    );
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value[0].preview?.stagingKey).toBe("org-id/_staging/token-preview");

    // A thumbnail is not worth refusing an original over.
    const broken = parseStagedPhotographs(
      payload([staged({ preview: { sha256: "nope", bytes: 1, width: 1, height: 1 } })]),
    );
    expect(broken.ok).toBe(true);
    if (broken.ok) expect(broken.value[0].preview).toBeUndefined();
  });
});

describe("parseShootAssetDefaults", () => {
  it("reads the metadata every photograph in the shoot inherits", () => {
    const data = new FormData();
    data.set("defaultCreditLine", "  Marcus Hale / Mastline ");
    data.set("defaultCopyrightNotice", "© 2026 Marcus Hale");
    data.set("defaultUsageRestrictions", "Editorial use only");
    data.set("defaultKeywords", "street, night, street");

    expect(parseShootAssetDefaults(data)).toEqual({
      creditLine: "Marcus Hale / Mastline",
      copyrightNotice: "© 2026 Marcus Hale",
      usageRestrictions: "Editorial use only",
      keywords: ["street", "night"],
    });
  });

  it("leaves what nobody filled in empty rather than inventing it", () => {
    expect(parseShootAssetDefaults(new FormData())).toEqual({
      creditLine: undefined,
      copyrightNotice: undefined,
      usageRestrictions: undefined,
      keywords: [],
    });
  });
});
