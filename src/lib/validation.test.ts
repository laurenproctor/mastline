import { describe, expect, it } from "vitest";
import { slugifyWorkspace } from "./validation";

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
