import { describe, expect, it } from "vitest";
import {
  type BillingState,
  PAST_DUE_GRACE_DAYS,
  billingSummary,
  canWrite,
  comparePlans,
  effectiveLimits,
  firstChargeAt,
  graceDaysRemaining,
  planChangeEffect,
} from "./billing";
import { PLAN_SEATS, PLAN_STORAGE_BYTES, TRIAL_STORAGE_BYTES } from "./pricing";

const NOW = new Date("2026-08-21T12:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const base: BillingState = { plan: "pro", status: "active", billingPeriod: "annual" };
const trialing = (endsIn: number, extra: Partial<BillingState> = {}): BillingState => ({
  ...base,
  status: "trialing",
  trialEndsAt: days(endsIn),
  ...extra,
});

describe("who can write", () => {
  it("lets an active workspace write", () => {
    expect(canWrite(base, NOW)).toBe(true);
  });

  it("lets a running trial write", () => {
    expect(canWrite(trialing(5), NOW)).toBe(true);
  });

  it("stops a lapsed trial", () => {
    expect(canWrite(trialing(-1), NOW)).toBe(false);
  });

  it("stops an expired or cancelled workspace", () => {
    expect(canWrite({ ...base, status: "expired" }, NOW)).toBe(false);
    expect(canWrite({ ...base, status: "cancelled" }, NOW)).toBe(false);
  });
});

describe("the past-due grace window", () => {
  const pastDue = (since: number): BillingState => ({
    ...base,
    status: "past_due",
    pastDueSince: days(since),
  });

  it("is fourteen days", () => {
    expect(PAST_DUE_GRACE_DAYS).toBe(14);
  });

  it("keeps working the day a payment fails", () => {
    expect(canWrite(pastDue(0), NOW)).toBe(true);
    expect(graceDaysRemaining(pastDue(0), NOW)).toBe(14);
  });

  it("keeps working on day thirteen", () => {
    expect(canWrite(pastDue(-13), NOW)).toBe(true);
    expect(graceDaysRemaining(pastDue(-13), NOW)).toBe(1);
  });

  it("stops once the window has run out", () => {
    expect(canWrite(pastDue(-15), NOW)).toBe(false);
    expect(graceDaysRemaining(pastDue(-15), NOW)).toBeLessThanOrEqual(0);
  });

  /**
   * Derived from the recorded date rather than a status flipped nightly, so
   * there is no job to fall behind and no drift to reconcile.
   */
  it("needs no scheduled job to become read-only", () => {
    const stale = pastDue(-100);
    expect(stale.status).toBe("past_due");
    expect(canWrite(stale, NOW)).toBe(false);
  });

  it("reports no grace for a workspace that is not past due", () => {
    expect(graceDaysRemaining(base, NOW)).toBeNull();
  });
});

describe("limits", () => {
  it("caps a trial with no card at the trial allowance", () => {
    const limits = effectiveLimits(trialing(10));
    expect(limits.storageBytes).toBe(TRIAL_STORAGE_BYTES);
    expect(limits.seats).toBe(1);
  });

  /**
   * Someone who has entered a card has committed. Holding them at 25 GB for
   * the rest of the month would be petty.
   */
  it("lifts the cap the moment a card is attached, without ending the trial", () => {
    const withCard = trialing(10, { paymentMethodAttachedAt: days(-1) });
    expect(effectiveLimits(withCard).storageBytes).toBe(PLAN_STORAGE_BYTES.pro);
    expect(canWrite(withCard, NOW)).toBe(true);
    expect(withCard.status).toBe("trialing");
  });

  it("uses the plan allowance once paying", () => {
    expect(effectiveLimits({ ...base, plan: "solo" }).storageBytes).toBe(PLAN_STORAGE_BYTES.solo);
    expect(effectiveLimits({ ...base, plan: "studio" }).seats).toBe(PLAN_SEATS.studio);
  });

  it("leaves Agency unconstrained", () => {
    expect(effectiveLimits({ ...base, plan: "agency" }).storageBytes).toBeNull();
  });
});

describe("when the first charge lands", () => {
  it("waits for the trial to finish", () => {
    const state = trialing(22, { paymentMethodAttachedAt: days(0) });
    expect(firstChargeAt(state, NOW)).toBe(state.trialEndsAt);
  });

  it("charges now once the trial is over", () => {
    expect(firstChargeAt(trialing(-1), NOW)).toBe(NOW.toISOString());
  });

  it("charges now for a workspace that is not on trial", () => {
    expect(firstChargeAt(base, NOW)).toBe(NOW.toISOString());
  });
});

describe("changing plan", () => {
  const noUsage = { storageBytes: 0, seats: 1 };

  it.each([
    ["solo", "pro", "upgrade"],
    ["pro", "studio", "upgrade"],
    ["studio", "pro", "downgrade"],
    ["pro", "pro", "same"],
  ] as const)("reads %s to %s as %s", (from, to, expected) => {
    expect(comparePlans(from, to)).toBe(expected);
  });

  it("applies an upgrade immediately", () => {
    const effect = planChangeEffect({ ...base, plan: "solo" }, "studio", noUsage);
    expect(effect.appliesAt).toBe("immediately");
    expect(effect.warnings).toHaveLength(0);
  });

  it("applies a downgrade at the end of the paid period", () => {
    const effect = planChangeEffect({ ...base, plan: "studio" }, "solo", noUsage);
    expect(effect.appliesAt).toBe("at_period_end");
    expect(effect.needsConfirmation).toBe(true);
  });

  it("warns rather than silently stranding stored work", () => {
    const effect = planChangeEffect({ ...base, plan: "studio" }, "solo", {
      storageBytes: 400 * 1024 ** 3,
      seats: 1,
    });
    expect(effect.warnings.join(" ")).toMatch(/Nothing already stored is removed/i);
    expect(effect.warnings.join(" ")).toMatch(/new imports will be refused/i);
  });

  it("warns rather than silently cutting people off", () => {
    const effect = planChangeEffect({ ...base, plan: "studio" }, "pro", {
      storageBytes: 0,
      seats: 4,
    });
    expect(effect.warnings.join(" ")).toMatch(/includes 1 person/i);
    expect(effect.warnings.join(" ")).toMatch(/lose access/i);
  });

  it("does not warn when everything fits", () => {
    const effect = planChangeEffect({ ...base, plan: "pro" }, "studio", {
      storageBytes: 100 * 1024 ** 3,
      seats: 1,
    });
    expect(effect.warnings).toHaveLength(0);
    expect(effect.needsConfirmation).toBe(false);
  });
});

describe("what the billing panel says", () => {
  it("tells a trialist a card will not be charged yet", () => {
    const summary = billingSummary(trialing(20), NOW);
    expect(summary.needsCard).toBe(true);
    expect(summary.detail).toMatch(/not be charged until the trial ends/i);
  });

  it("confirms when a card is on file, without implying an early charge", () => {
    const summary = billingSummary(trialing(20, { paymentMethodAttachedAt: days(-2) }), NOW);
    expect(summary.headline).toBe("Card on file");
    expect(summary.needsCard).toBe(false);
    expect(summary.detail).toMatch(/lands when it ends/i);
  });

  it("says the records are safe whenever the workspace is read-only", () => {
    for (const state of [
      trialing(-1),
      { ...base, status: "cancelled" as const },
      { ...base, status: "expired" as const },
      { ...base, status: "past_due" as const, pastDueSince: days(-20) },
    ]) {
      const summary = billingSummary(state, NOW);
      expect(summary.tone).toBe("danger");
      expect(summary.detail).toMatch(/still here|unchanged/i);
      expect(summary.detail).toMatch(/export/i);
    }
  });

  it("warns during the grace window rather than alarming", () => {
    const summary = billingSummary({ ...base, status: "past_due", pastDueSince: days(-2) }, NOW);
    expect(summary.tone).toBe("warn");
    expect(summary.detail).toMatch(/another 12 days/i);
  });

  it("says plainly when a subscription will not renew", () => {
    const summary = billingSummary({ ...base, cancelAtPeriodEnd: true }, NOW);
    expect(summary.headline).toMatch(/Ends at the period end/i);
    expect(summary.detail).toMatch(/will not renew/i);
  });

  it("never invents a trial duration in its copy", () => {
    for (const state of [base, trialing(20), trialing(-1)]) {
      expect(billingSummary(state, NOW).detail).not.toMatch(/\b(14|7|60|90) days\b/);
    }
  });
});
