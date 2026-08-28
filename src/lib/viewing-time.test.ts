import { describe, expect, it } from "vitest";
import {
  IDLE_MS,
  MAX_TICK_MS,
  countableTickMs,
  isActivelyViewing,
  isMeaningfullyVisible,
} from "./viewing-time";

/**
 * The conditions under which a delivery page counts as being read.
 *
 * Each of these corresponds to a way the naive implementation -- start a timer
 * on mount, stop it on unmount -- would have reported attention that nobody
 * paid.
 */
const viewing = {
  documentVisible: true,
  windowFocused: true,
  msSinceActivity: 1_000,
};

describe("what counts as looking at a photograph", () => {
  it("counts a visible, focused, recently used page", () => {
    expect(isActivelyViewing(viewing)).toBe(true);
  });

  it("does not count a background tab", () => {
    // A tab left open behind others for a weekend would otherwise report the
    // weekend.
    expect(isActivelyViewing({ ...viewing, documentVisible: false })).toBe(false);
  });

  it("does not count a visible window that does not have focus", () => {
    // On screen and nobody reading it: a second monitor, or a window behind the
    // one being worked in.
    expect(isActivelyViewing({ ...viewing, windowFocused: false })).toBe(false);
  });

  it("does not count a page nobody has touched", () => {
    expect(isActivelyViewing({ ...viewing, msSinceActivity: IDLE_MS })).toBe(false);
    expect(isActivelyViewing({ ...viewing, msSinceActivity: IDLE_MS + 1 })).toBe(false);
    // ...and does count right up to the threshold.
    expect(isActivelyViewing({ ...viewing, msSinceActivity: IDLE_MS - 1 })).toBe(true);
  });

  it("needs every condition, not a majority of them", () => {
    expect(
      isActivelyViewing({
        documentVisible: false,
        windowFocused: false,
        msSinceActivity: 500_000,
      }),
    ).toBe(false);
  });
});

describe("how much of an interval may be counted", () => {
  it("counts a normal tick in full", () => {
    expect(countableTickMs(1_000)).toBe(1_000);
  });

  it("clamps a long gap to one tick", () => {
    // A throttled timer in a backgrounded tab firing after four minutes must
    // not bank four minutes.
    expect(countableTickMs(240_000)).toBe(MAX_TICK_MS);
  });

  it("refuses a negative or nonsensical interval", () => {
    // A clock moved backwards, or a value that arrived as NaN.
    expect(countableTickMs(-5_000)).toBe(0);
    expect(countableTickMs(Number.NaN)).toBe(0);
    expect(countableTickMs(Number.POSITIVE_INFINITY)).toBe(0);
    expect(countableTickMs(0)).toBe(0);
  });
});

describe("whether a photograph is on screen", () => {
  it("does not count a frame because one pixel of it appeared", () => {
    expect(isMeaningfullyVisible(0)).toBe(false);
    expect(isMeaningfullyVisible(0.01)).toBe(false);
    expect(isMeaningfullyVisible(0.49)).toBe(false);
  });

  it("counts a frame that is half on screen or more", () => {
    expect(isMeaningfullyVisible(0.5)).toBe(true);
    expect(isMeaningfullyVisible(1)).toBe(true);
  });
});
