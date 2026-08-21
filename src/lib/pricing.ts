/**
 * Mastline subscription pricing.
 *
 * This module is the single source of truth for plan prices, limits, and the
 * savings claim. Nothing else in the codebase may hard-code a plan price.
 *
 * Prices are approved product facts (`docs/DECISIONS.md`). Changing them is a
 * business decision, not an implementation detail.
 *
 * Trial terms as of 2026-08-21: 14 days, no payment method required to start.
 * End-of-trial conversion mechanics and eligibility are still UNRESOLVED.
 * The marketing copy has not yet been authorized to state the duration, so
 * "Start free" stands alone here and the guard tests still forbid trial
 * language in plan copy. Changing that is a founder decision, not a cleanup.
 */

import { type Money, formatMoney, fromMajor } from "./money";

export type BillingPeriod = "annual" | "monthly";
export type PlanId = "solo" | "pro" | "studio" | "agency";

export interface Plan {
  readonly id: PlanId;
  readonly name: string;
  readonly audience: string;
  readonly description: string;
  /** Monthly-equivalent price when billed annually. Null for custom pricing. */
  readonly annualMonthlyMajor: number | null;
  /** Price when billed month to month. Null for custom pricing. */
  readonly monthlyMajor: number | null;
  readonly popular: boolean;
  readonly ctaLabel: string;
  readonly features: readonly string[];
}

export const PLANS: readonly Plan[] = [
  {
    id: "solo",
    name: "Solo",
    audience: "Independent",
    description: "The essential business system for working photographers.",
    annualMonthlyMajor: 49,
    monthlyMajor: 59,
    popular: false,
    ctaLabel: "Start free",
    features: [
      "1 photographer workspace",
      "Shoots, assets & submissions",
      "Contacts, invoices & payments",
      "Revenue reporting",
      "250 GB archive storage",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    audience: "Archive owners",
    description: "For photographers who want their archive working every day.",
    annualMonthlyMajor: 99,
    monthlyMajor: 119,
    popular: true,
    ctaLabel: "Start free",
    features: [
      "Everything in Solo",
      "Live news monitoring",
      "Archive-to-story matching",
      "Rights & usage monitoring",
      "Advanced revenue analytics",
      "1 TB archive storage",
    ],
  },
  {
    id: "studio",
    name: "Studio",
    audience: "Teams",
    description: "Dispatch, review and revenue control for small teams.",
    annualMonthlyMajor: 279,
    monthlyMajor: 339,
    popular: false,
    ctaLabel: "Start free",
    features: [
      "Everything in Pro",
      "Up to 5 team members",
      "Dispatch & review queues",
      "Roles and approvals",
      "Team revenue allocation",
      "5 TB shared archive",
    ],
  },
  {
    id: "agency",
    name: "Agency",
    audience: "At scale",
    description: "A tailored operating layer for larger organizations.",
    annualMonthlyMajor: null,
    monthlyMajor: null,
    popular: false,
    ctaLabel: "Talk to us",
    features: [
      "Custom team structure",
      "High-volume archive migration",
      "API access & integrations",
      "Custom permissions",
      "Priority support",
      "Flexible storage",
    ],
  },
] as const;

export const DEFAULT_BILLING_PERIOD: BillingPeriod = "annual";

export function isCustomPriced(plan: Plan): boolean {
  return plan.annualMonthlyMajor === null || plan.monthlyMajor === null;
}

/** The headline monthly figure for a plan under a billing period. */
export function monthlyPrice(plan: Plan, period: BillingPeriod): Money | null {
  const major = period === "annual" ? plan.annualMonthlyMajor : plan.monthlyMajor;
  return major === null ? null : fromMajor(major);
}

/** What the customer is actually charged per year when billed annually. */
export function annualTotal(plan: Plan): Money | null {
  return plan.annualMonthlyMajor === null ? null : fromMajor(plan.annualMonthlyMajor * 12);
}

/** What twelve separate monthly charges would cost. */
export function twelveMonthlyPaymentsTotal(plan: Plan): Money | null {
  return plan.monthlyMajor === null ? null : fromMajor(plan.monthlyMajor * 12);
}

/** Fractional saving from annual billing, e.g. 0.177 for Studio. */
export function annualSavingsRate(plan: Plan): number | null {
  const annual = annualTotal(plan);
  const monthly = twelveMonthlyPaymentsTotal(plan);
  if (annual === null || monthly === null || monthly.minor === 0) return null;
  return (monthly.minor - annual.minor) / monthly.minor;
}

/** The best saving available across all self-serve plans. */
export function maxAnnualSavingsRate(): number {
  const rates = PLANS.map(annualSavingsRate).filter((rate): rate is number => rate !== null);
  return Math.max(...rates);
}

/**
 * The savings claim shown beside the Annual toggle.
 *
 * Rounded UP to the nearest whole percent from the true maximum, and asserted
 * by test to never overstate by more than a rounding step. At the approved
 * prices the true maximum is 17.7%, so this renders "Save up to 18%".
 */
export function annualSavingsClaim(): string {
  return `Save up to ${Math.round(maxAnnualSavingsRate() * 100)}%`;
}

/** Display string for a plan's headline price, or "Custom". */
export function formatPlanPrice(plan: Plan, period: BillingPeriod): string {
  const price = monthlyPrice(plan, period);
  return price === null ? "Custom" : formatMoney(price);
}

export function billingCadenceLabel(period: BillingPeriod): string {
  return period === "annual" ? "billed annually" : "billed monthly";
}

export function findPlan(id: PlanId): Plan {
  const plan = PLANS.find((candidate) => candidate.id === id);
  if (!plan) throw new RangeError(`Unknown plan: ${id}`);
  return plan;
}
