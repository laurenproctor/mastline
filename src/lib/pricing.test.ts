import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";
import {
  DEFAULT_BILLING_PERIOD,
  PLANS,
  annualSavingsClaim,
  annualSavingsRate,
  annualTotal,
  findPlan,
  formatPlanPrice,
  isCustomPriced,
  maxAnnualSavingsRate,
  monthlyPrice,
  TRIAL_DAYS,
  TRIAL_REQUIRES_PAYMENT_METHOD,
  trialTermsLabel,
  twelveMonthlyPaymentsTotal,
} from "./pricing";

describe("approved plan prices", () => {
  it.each([
    ["solo", 49, 59],
    ["pro", 99, 119],
    ["studio", 279, 339],
  ] as const)("%s is $%i annual and $%i monthly", (id, annual, monthly) => {
    const plan = findPlan(id);
    expect(plan.annualMonthlyMajor).toBe(annual);
    expect(plan.monthlyMajor).toBe(monthly);
    expect(formatPlanPrice(plan, "annual")).toBe(`$${annual}`);
    expect(formatPlanPrice(plan, "monthly")).toBe(`$${monthly}`);
  });

  it("prices Agency as custom in both periods", () => {
    const agency = findPlan("agency");
    expect(isCustomPriced(agency)).toBe(true);
    expect(monthlyPrice(agency, "annual")).toBeNull();
    expect(monthlyPrice(agency, "monthly")).toBeNull();
    expect(formatPlanPrice(agency, "annual")).toBe("Custom");
  });

  it("offers exactly four plans in ascending order of price", () => {
    expect(PLANS.map((plan) => plan.id)).toEqual(["solo", "pro", "studio", "agency"]);
  });
});

describe("annual totals", () => {
  it.each([
    ["solo", 588],
    ["pro", 1188],
    ["studio", 3348],
  ] as const)("%s charges $%i per year", (id, total) => {
    const annual = annualTotal(findPlan(id));
    expect(annual?.minor).toBe(total * 100);
  });

  it("formats the annual totals the way the acceptance criteria state them", () => {
    const totals = (["solo", "pro", "studio"] as const).map((id) => {
      const total = annualTotal(findPlan(id));
      return total === null ? null : formatMoney(total);
    });
    expect(totals).toEqual(["$588", "$1,188", "$3,348"]);
  });

  it("has no annual total for Agency", () => {
    expect(annualTotal(findPlan("agency"))).toBeNull();
  });
});

describe("the savings claim", () => {
  it("computes each plan's true saving", () => {
    expect(annualSavingsRate(findPlan("solo"))).toBeCloseTo(0.1695, 4);
    expect(annualSavingsRate(findPlan("pro"))).toBeCloseTo(0.1681, 4);
    expect(annualSavingsRate(findPlan("studio"))).toBeCloseTo(0.177, 4);
  });

  it("tops out at 17.7%, driven by Studio", () => {
    expect(maxAnnualSavingsRate()).toBeCloseTo(0.177, 4);
  });

  it("renders 'Save up to 18%'", () => {
    expect(annualSavingsClaim()).toBe("Save up to 18%");
  });

  it("never overstates the saving by more than a rounding step", () => {
    const claimed = Number(annualSavingsClaim().match(/(\d+)%/)?.[1]) / 100;
    expect(claimed).toBeLessThanOrEqual(maxAnnualSavingsRate() + 0.005);
  });

  it("never claims a saving that no plan actually offers", () => {
    const claimed = Number(annualSavingsClaim().match(/(\d+)%/)?.[1]) / 100;
    const best = maxAnnualSavingsRate();
    expect(claimed - best).toBeLessThan(0.01);
  });

  it("keeps twelve monthly payments strictly more expensive than annual", () => {
    for (const plan of PLANS) {
      const annual = annualTotal(plan);
      const monthly = twelveMonthlyPaymentsTotal(plan);
      if (annual === null || monthly === null) continue;
      expect(monthly.minor).toBeGreaterThan(annual.minor);
    }
  });
});

describe("approved trial terms", () => {
  it("is 14 days and needs no payment method", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(TRIAL_REQUIRES_PAYMENT_METHOD).toBe(false);
  });

  it("states the approved duration and the card position", () => {
    expect(trialTermsLabel()).toBe("14 days free. No card required.");
  });

  it("states no duration other than the approved one", () => {
    const durations = trialTermsLabel().match(/\d+/g) ?? [];
    expect(durations).toEqual([String(TRIAL_DAYS)]);
  });

  it("claims nothing about what happens when the trial ends", () => {
    // Conversion mechanics are unresolved (docs/DECISIONS.md #1). Copy that
    // promises auto-renewal, cancellation, or continued access would be an
    // invented product fact.
    expect(trialTermsLabel()).not.toMatch(/cancel|renew|auto|then|after|expire|keep|charge/i);
  });
});

describe("presentation rules", () => {
  it("defaults to annual billing", () => {
    expect(DEFAULT_BILLING_PERIOD).toBe("annual");
  });

  it("marks exactly one plan most popular, and it is Pro", () => {
    const popular = PLANS.filter((plan) => plan.popular);
    expect(popular).toHaveLength(1);
    expect(popular[0]?.id).toBe("pro");
  });

  it("uses 'Start free' on the three self-serve plans and 'Talk to us' on Agency", () => {
    expect(PLANS.filter((plan) => plan.ctaLabel === "Start free").map((plan) => plan.id)).toEqual([
      "solo",
      "pro",
      "studio",
    ]);
    expect(findPlan("agency").ctaLabel).toBe("Talk to us");
  });

  it("keeps trial terms out of per-plan copy so there is one place to change them", () => {
    const copy = PLANS.flatMap((plan) => [
      plan.name,
      plan.description,
      plan.audience,
      plan.ctaLabel,
      ...plan.features,
    ]).join(" ");
    expect(copy).not.toMatch(/\b\d+[- ]?(day|week|month)s?\s+(free|trial)/i);
    expect(copy).not.toMatch(/\btrial\b/i);
  });

  it("states the storage limit on every self-serve plan", () => {
    expect(findPlan("solo").features.join(" ")).toMatch(/250 GB/);
    expect(findPlan("pro").features.join(" ")).toMatch(/1 TB/);
    expect(findPlan("studio").features.join(" ")).toMatch(/5 TB/);
  });

  it("does not use marketplace framing", () => {
    const copy = PLANS.flatMap((plan) => [plan.description, ...plan.features]).join(" ");
    expect(copy).not.toMatch(/marketplace|two[- ]sided|buyers? can browse/i);
  });

  it("rejects an unknown plan id", () => {
    // @ts-expect-error -- guarding the runtime path against a bad id
    expect(() => findPlan("enterprise")).toThrow(RangeError);
  });
});
