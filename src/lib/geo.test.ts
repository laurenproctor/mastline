import { describe, expect, it } from "vitest";
import { COORDINATE_PLACES, formatCoordinates, toDatetimeLocalValue } from "./geo";

describe("toDatetimeLocalValue", () => {
  it("writes the local wall clock, not UTC", () => {
    // Built from local parts so the assertion holds in any timezone the test
    // runs in. UTC formatting would shift this by the offset.
    const moment = new Date(2026, 7, 25, 16, 43, 12);
    expect(toDatetimeLocalValue(moment)).toBe("2026-08-25T16:43");
  });

  it("pads every part to the width the control expects", () => {
    expect(toDatetimeLocalValue(new Date(2026, 0, 2, 3, 4))).toBe("2026-01-02T03:04");
  });

  it("drops seconds, which the control does not take", () => {
    expect(toDatetimeLocalValue(new Date(2026, 5, 1, 9, 30, 59))).toBe("2026-06-01T09:30");
  });

  it("returns an empty value for a date that cannot be read", () => {
    expect(toDatetimeLocalValue(new Date("not a date"))).toBe("");
  });
});

describe("formatCoordinates", () => {
  it("rounds to the agreed precision rather than storing whatever the device reported", () => {
    expect(formatCoordinates(40.74844231, -73.98566119)).toBe("40.7484, -73.9857");
  });

  it("keeps trailing zeroes so the precision is visible", () => {
    expect(formatCoordinates(51.5, -0.1)).toBe(`51.5000, -0.1000`);
    expect(COORDINATE_PLACES).toBe(4);
  });

  it("refuses a fix outside the possible range instead of writing nonsense", () => {
    expect(formatCoordinates(91, 0)).toBe("");
    expect(formatCoordinates(0, 181)).toBe("");
  });

  it("refuses a missing or non-finite reading", () => {
    expect(formatCoordinates(Number.NaN, 0)).toBe("");
    expect(formatCoordinates(0, Number.POSITIVE_INFINITY)).toBe("");
  });
});
