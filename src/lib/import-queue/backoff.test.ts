import { describe, expect, it } from "vitest";
import { backoffDelay, isDue, nextAttemptAt } from "./backoff";

/**
 * Retry timing, which is the difference between a queue that recovers and one
 * that makes an outage worse.
 */
describe("backing off", () => {
  it("grows with each attempt", () => {
    // The random is pinned so the growth, not the jitter, is what is asserted.
    const at = (attempt: number) => backoffDelay(attempt, { random: () => 1 });
    expect(at(1)).toBe(1_000);
    expect(at(2)).toBe(2_000);
    expect(at(3)).toBe(4_000);
    expect(at(4)).toBe(8_000);
  });

  it("never waits longer than the ceiling", () => {
    // A photographer coming back to the car should not find the next attempt
    // scheduled for an hour's time.
    for (const attempt of [8, 12, 40, 1000]) {
      expect(backoffDelay(attempt, { random: () => 1 })).toBeLessThanOrEqual(60_000);
    }
  });

  it("spreads a batch that all failed at the same moment", () => {
    // A hundred files failing together must not retry together.
    const delays = new Set(
      Array.from({ length: 100 }, (_, index) => backoffDelay(3, { random: () => index / 100 })),
    );
    expect(delays.size).toBeGreaterThan(50);
  });

  it("keeps a floor, so a retry is a wait rather than a hammer", () => {
    expect(backoffDelay(3, { random: () => 0 })).toBe(1_000);
    expect(backoffDelay(1, { random: () => 0 })).toBe(250);
  });

  it("schedules against a clock", () => {
    const now = new Date("2026-08-29T09:00:00.000Z");
    expect(nextAttemptAt(1, now, { random: () => 1 })).toBe("2026-08-29T09:00:01.000Z");
  });

  it("treats an unscheduled item as due", () => {
    const now = new Date("2026-08-29T09:00:00.000Z");
    expect(isDue(undefined, now)).toBe(true);
    expect(isDue("2026-08-29T08:59:59.000Z", now)).toBe(true);
    expect(isDue("2026-08-29T09:00:30.000Z", now)).toBe(false);
    // A value that cannot be read must not strand a file forever.
    expect(isDue("not a date", now)).toBe(true);
  });
});
