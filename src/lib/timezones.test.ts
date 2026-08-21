import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  WORKSPACE_NAME_MAX,
  WORKSPACE_TIMEZONES,
  formatTimezone,
  isSupportedTimezone,
  parseWorkspaceName,
} from "./timezones";

describe("workspace timezones", () => {
  it("accepts every zone it offers", () => {
    for (const zone of WORKSPACE_TIMEZONES) {
      expect(isSupportedTimezone(zone), zone).toBe(true);
    }
  });

  it("offers a default it also accepts", () => {
    expect(isSupportedTimezone(DEFAULT_TIMEZONE)).toBe(true);
  });

  it("refuses anything not on the list", () => {
    // A form can post whatever it likes, including a real IANA zone that this
    // product has not chosen to support.
    expect(isSupportedTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isSupportedTimezone("America/Phoenix")).toBe(false);
    expect(isSupportedTimezone("")).toBe(false);
    expect(isSupportedTimezone("america/new_york")).toBe(false);
  });

  it("every zone is one Intl can actually format with", () => {
    // A zone the runtime rejects would throw at render time, on a screen rather
    // than in a test.
    for (const zone of WORKSPACE_TIMEZONES) {
      const format = () => new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date(0));
      expect(format, zone).not.toThrow();
    }
  });

  it("reads a zone without its underscores", () => {
    expect(formatTimezone("America/New_York")).toBe("America/New York");
    expect(formatTimezone("UTC")).toBe("UTC");
  });
});

describe("parseWorkspaceName", () => {
  it("keeps an ordinary name", () => {
    expect(parseWorkspaceName("Marcus Hale Studio")).toEqual({ name: "Marcus Hale Studio" });
  });

  it("trims and collapses whitespace", () => {
    expect(parseWorkspaceName("  Hale   Media  ")).toEqual({ name: "Hale Media" });
    expect(parseWorkspaceName("Hale\tMedia")).toEqual({ name: "Hale Media" });
  });

  it("refuses an empty name, including one that is only spaces", () => {
    expect(parseWorkspaceName("")).toEqual({ error: "A workspace needs a name." });
    expect(parseWorkspaceName("   ")).toEqual({ error: "A workspace needs a name." });
  });

  it("refuses a name longer than the column allows", () => {
    // The database check is 1..120. Failing here returns a sentence; failing
    // there returns a constraint violation.
    const tooLong = "a".repeat(WORKSPACE_NAME_MAX + 1);
    expect(parseWorkspaceName(tooLong)).toEqual({
      error: `A workspace name cannot be longer than ${WORKSPACE_NAME_MAX} characters.`,
    });
  });

  it("accepts a name of exactly the maximum length", () => {
    const exact = "a".repeat(WORKSPACE_NAME_MAX);
    expect(parseWorkspaceName(exact)).toEqual({ name: exact });
  });

  it("counts length after trimming, not before", () => {
    const padded = `  ${"a".repeat(WORKSPACE_NAME_MAX)}  `;
    expect(parseWorkspaceName(padded)).toEqual({ name: "a".repeat(WORKSPACE_NAME_MAX) });
  });

  it("keeps accents and punctuation rather than mangling them", () => {
    // Unlike the slug, the display name is not normalised.
    expect(parseWorkspaceName("Álvarez & Sons")).toEqual({ name: "Álvarez & Sons" });
  });
});
