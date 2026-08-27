import { describe, expect, it } from "vitest";
import { isRecordId, parseOnboarding, slugifyWorkspace } from "./validation";

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
