import { describe, expect, it } from "vitest";
import { OPPORTUNITY_KINDS } from "./domain";
import {
  KIND_FOR_MODE,
  MODE_FOR_KIND,
  NEWS_MODES,
  parseNewsMode,
  usefulWindow,
} from "./news-radar";

/**
 * The mode is URL state. The parser faces the query string, which is browser
 * input, so it may select between the two known views and nothing else.
 */
describe("parseNewsMode", () => {
  it("reads the two addressable modes", () => {
    expect(parseNewsMode("archive")).toBe("archive");
    expect(parseNewsMode("shoot")).toBe("shoot");
  });

  it("answers archive for anything else", () => {
    expect(parseNewsMode(undefined)).toBe("archive");
    expect(parseNewsMode("")).toBe("archive");
    expect(parseNewsMode("SHOOT")).toBe("archive");
    expect(parseNewsMode("archive_match")).toBe("archive");
    expect(parseNewsMode("../../etc")).toBe("archive");
    // Next can hand an array for a repeated parameter. Not a mode.
    expect(parseNewsMode(["shoot", "archive"])).toBe("archive");
  });

  it("round-trips every kind through its mode", () => {
    for (const kind of OPPORTUNITY_KINDS) {
      expect(KIND_FOR_MODE[MODE_FOR_KIND[kind]]).toBe(kind);
    }
    for (const mode of NEWS_MODES) {
      expect(MODE_FOR_KIND[KIND_FOR_MODE[mode]]).toBe(mode);
    }
  });
});

describe("usefulWindow", () => {
  const now = new Date("2026-08-20T18:00:00.000Z");

  it("reports no window when none was set", () => {
    expect(usefulWindow(undefined, now)).toEqual({
      text: "No window set",
      urgent: false,
      closed: false,
    });
  });

  it("reports a closed window as closed, not as an error", () => {
    const window = usefulWindow("2026-08-20T17:59:00.000Z", now);
    expect(window.closed).toBe(true);
    expect(window.urgent).toBe(false);
  });

  it("marks the final hours urgent", () => {
    expect(usefulWindow("2026-08-20T18:40:00.000Z", now)).toMatchObject({
      text: "40 min left",
      urgent: true,
    });
    expect(usefulWindow("2026-08-20T20:30:00.000Z", now)).toMatchObject({
      text: "2 hr 30 min left",
      urgent: true,
    });
  });

  it("stays calm about a window days away", () => {
    expect(usefulWindow("2026-08-23T18:00:00.000Z", now)).toMatchObject({
      text: "3 days left",
      urgent: false,
      closed: false,
    });
  });
});
