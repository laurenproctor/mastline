import { describe, expect, it } from "vitest";
import { TRIAL_DAYS, TRIAL_STORAGE_BYTES } from "./pricing";
import {
  type Subscription,
  formatBytes,
  isWritable,
  seatLimit,
  storageLimitBytes,
  storageState,
  trialDaysRemaining,
  trialEndDateFrom,
  workspaceNotice,
} from "./subscription";

const NOW = new Date("2026-08-21T12:00:00.000Z");

const trialing = (endsAt: string): Subscription => ({
  plan: "pro",
  status: "trialing",
  trialEndsAt: endsAt,
});

describe("trial dates", () => {
  it("ends the approved number of days after it starts", () => {
    const end = trialEndDateFrom(new Date("2026-08-01T00:00:00.000Z"));
    expect(end).toBe("2026-08-31T00:00:00.000Z");
    expect(TRIAL_DAYS).toBe(30);
  });

  it("counts whole days remaining", () => {
    expect(trialDaysRemaining("2026-08-31T12:00:00.000Z", NOW)).toBe(10);
    expect(trialDaysRemaining("2026-08-22T12:00:00.000Z", NOW)).toBe(1);
  });

  it("goes negative once the trial has ended", () => {
    expect(trialDaysRemaining("2026-08-20T12:00:00.000Z", NOW)).toBe(-1);
  });

  it("returns null when there is no trial end", () => {
    expect(trialDaysRemaining(undefined, NOW)).toBeNull();
    expect(trialDaysRemaining("not a date", NOW)).toBeNull();
  });
});

describe("who can write", () => {
  it("lets an active workspace write", () => {
    expect(isWritable({ plan: "solo", status: "active" }, NOW)).toBe(true);
  });

  it("lets a trial write while it is running", () => {
    expect(isWritable(trialing("2026-08-31T12:00:00.000Z"), NOW)).toBe(true);
  });

  it("stops writes once the trial has ended", () => {
    expect(isWritable(trialing("2026-08-20T12:00:00.000Z"), NOW)).toBe(false);
  });

  it("stops writes on an expired or cancelled workspace", () => {
    expect(isWritable({ plan: "pro", status: "expired" }, NOW)).toBe(false);
    expect(isWritable({ plan: "pro", status: "cancelled" }, NOW)).toBe(false);
  });

  /**
   * A card that failed on Tuesday should not stop a photographer working a
   * story on Wednesday. Chasing payment is a conversation, not a reason to
   * break the product mid-shoot.
   */
  it("keeps a past-due workspace working", () => {
    expect(isWritable({ plan: "pro", status: "past_due" }, NOW)).toBe(true);
  });
});

describe("limits", () => {
  it("caps a trial well below the plan it runs on", () => {
    expect(storageLimitBytes(trialing("2026-08-31T12:00:00.000Z"))).toBe(TRIAL_STORAGE_BYTES);
  });

  it("uses the plan's allowance once paying", () => {
    expect(storageLimitBytes({ plan: "solo", status: "active" })).toBe(250 * 1024 ** 3);
    expect(storageLimitBytes({ plan: "studio", status: "active" })).toBe(5 * 1024 ** 4);
  });

  it("leaves Agency unconstrained", () => {
    expect(storageLimitBytes({ plan: "agency", status: "active" })).toBeNull();
    expect(seatLimit({ plan: "agency", status: "active" })).toBeNull();
  });

  it("gives a trial one seat, matching the plan it runs on", () => {
    expect(seatLimit(trialing("2026-08-31T12:00:00.000Z"))).toBe(1);
  });
});

describe("storage state", () => {
  const solo: Subscription = { plan: "solo", status: "active" };
  const limit = 250 * 1024 ** 3;

  it("reports usage as a percentage", () => {
    expect(storageState(solo, limit / 2).percentUsed).toBe(50);
  });

  it("warns from 80% so a warning arrives before a wall", () => {
    expect(storageState(solo, limit * 0.79).isNearLimit).toBe(false);
    expect(storageState(solo, limit * 0.8).isNearLimit).toBe(true);
    expect(storageState(solo, limit * 0.8).isOverLimit).toBe(false);
  });

  it("is over limit at exactly the limit", () => {
    expect(storageState(solo, limit).isOverLimit).toBe(true);
  });

  it("never reports negative headroom", () => {
    expect(storageState(solo, limit * 2).remainingBytes).toBe(0);
  });

  it("treats an unconstrained plan as never full", () => {
    const state = storageState({ plan: "agency", status: "active" }, 10 * 1024 ** 4);
    expect(state.isOverLimit).toBe(false);
    expect(state.limitBytes).toBeNull();
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1024, "1.0 KB"],
    [25 * 1024 ** 3, "25 GB"],
    [1024 ** 4, "1.0 TB"],
    [5 * 1024 ** 4, "5.0 TB"],
  ])("renders %i as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("what the workspace is told", () => {
  const solo: Subscription = { plan: "solo", status: "active" };
  const limit = 250 * 1024 ** 3;

  it("says nothing when there is nothing to say", () => {
    expect(workspaceNotice(solo, storageState(solo, 1024), NOW)).toBeNull();
  });

  it("leads with the lapse, and promises the records are still there", () => {
    const lapsed = trialing("2026-08-20T12:00:00.000Z");
    const notice = workspaceNotice(lapsed, storageState(lapsed, 0), NOW)!;
    expect(notice.tone).toBe("danger");
    expect(notice.headline).toMatch(/trial has ended/i);
    expect(notice.detail).toMatch(/still here/i);
    expect(notice.detail).toMatch(/export/i);
  });

  it("promises nothing already stored is affected when storage is full", () => {
    const notice = workspaceNotice(solo, storageState(solo, limit), NOW)!;
    expect(notice.tone).toBe("danger");
    expect(notice.detail).toMatch(/Nothing already stored is affected/i);
  });

  it("warns a week before the trial ends, not on the day", () => {
    const inSix = trialing("2026-08-27T12:00:00.000Z");
    expect(workspaceNotice(inSix, storageState(inSix, 0), NOW)?.tone).toBe("warn");

    const inTwenty = trialing("2026-09-10T12:00:00.000Z");
    expect(workspaceNotice(inTwenty, storageState(inTwenty, 0), NOW)).toBeNull();
  });

  it("reads naturally on the last day", () => {
    const tomorrow = trialing("2026-08-22T12:00:00.000Z");
    expect(workspaceNotice(tomorrow, storageState(tomorrow, 0), NOW)?.headline).toBe(
      "The trial ends tomorrow",
    );
  });

  it("shows only one notice, the most severe", () => {
    // Both lapsed AND over storage: the lapse is what matters.
    const lapsed = trialing("2026-08-20T12:00:00.000Z");
    const notice = workspaceNotice(lapsed, storageState(lapsed, TRIAL_STORAGE_BYTES * 2), NOW)!;
    expect(notice.headline).toMatch(/trial has ended/i);
  });

  it("always offers somewhere to go", () => {
    const cases: [Subscription, number][] = [
      [trialing("2026-08-20T12:00:00.000Z"), 0],
      [solo, limit],
      [trialing("2026-08-24T12:00:00.000Z"), 0],
      [solo, limit * 0.85],
    ];
    for (const [subscription, used] of cases) {
      const notice = workspaceNotice(subscription, storageState(subscription, used), NOW);
      expect(notice?.action?.href).toBe("/pricing");
    }
  });
});
