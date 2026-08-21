import { describe, expect, it } from "vitest";
import { formatConfidence, formatElapsed, humanizeStatus } from "./format";

const NOW = new Date("2026-08-20T18:00:00.000Z");

describe("formatElapsed", () => {
  it.each([
    ["2026-08-20T17:18:00.000Z", "42 min"],
    ["2026-08-20T16:00:00.000Z", "2 hr"],
    ["2026-08-19T18:00:00.000Z", "Yesterday"],
    ["2026-08-17T18:00:00.000Z", "3 days"],
    ["2026-08-20T17:59:50.000Z", "Just now"],
  ])("renders %s as %s", (iso, expected) => {
    expect(formatElapsed(iso, NOW)).toBe(expected);
  });

  it("falls back to a date beyond a week", () => {
    expect(formatElapsed("2026-08-01T18:00:00.000Z", NOW)).toBe("Aug 1");
  });
});

describe("humanizeStatus", () => {
  it.each([
    ["needs_review", "Needs review"],
    ["no_sale", "No sale"],
    ["written_off", "Written off"],
    ["no_linked_license_found", "No linked license found"],
  ])("renders %s as %s", (status, expected) => {
    expect(humanizeStatus(status)).toBe(expected);
  });
});

describe("formatConfidence", () => {
  it("renders a whole percentage", () => {
    expect(formatConfidence(0.94)).toBe("94%");
    expect(formatConfidence(0.815)).toBe("82%");
  });
});
