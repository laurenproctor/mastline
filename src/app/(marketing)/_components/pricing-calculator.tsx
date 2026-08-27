"use client";

import { useMemo, useState } from "react";
import { type Money, formatMoney, fromMajor, money, roundHalfUp } from "@/lib/money";
import { type PlanId, findPlan, isCustomPriced } from "@/lib/pricing";
import { SALES_ENGINE_PLATFORM_RATE, calculateSalesEngineSplit } from "@/lib/sales-engine";

/**
 * What a photographer actually keeps.
 *
 * The pricing page states the 70/30 four separate times -- the split band, the
 * two lanes, the agency comparison, and the plan table -- and the calculator
 * that sat here restated it a fifth, turning one license value into $700 and
 * $300. Nobody reaches this page unsure what 30% of a thousand dollars is.
 *
 * The question the page could not answer was the compound one: across a
 * month's work, some sold directly and some sold by Mastline, after the
 * subscription, how does this compare to handing everything to an agency? That
 * needs three inputs and it needs the subscription in the arithmetic, which is
 * the part a comparison usually leaves out.
 *
 * Three rules it holds itself to:
 *
 * 1. Every figure is computed by the modules that bill and split for real --
 *    `findPlan` for the subscription, `calculateSalesEngineSplit` for the
 *    share. No price or rate is typed into this file.
 * 2. The agency comparison is the band the page already prints, 40-60%, and it
 *    stays a band. Picking a single number would be inventing a fact.
 * 3. It is allowed to say Mastline costs more. At low volume with everything
 *    sold directly, the subscription is real money and the agency's cut is
 *    small; the result goes negative and says so. A calculator that can only
 *    produce good news is an advertisement, and this page's own argument is
 *    that the economics are transparent.
 */

/** The agency share the page already states. Kept as a band, never a number. */
const AGENCY_LOW = 0.4;
const AGENCY_HIGH = 0.6;

const REVENUE_MIN = 1000;
const REVENUE_MAX = 40000;
const REVENUE_STEP = 500;

const SELECTABLE: readonly PlanId[] = ["solo", "pro", "studio"];

/** Plans are billed annually here, the page's own default. */
const monthlySubscription = (id: PlanId): Money => {
  const plan = findPlan(id);
  // Never reached: SELECTABLE holds no custom-priced plan. The guard is here so
  // that adding one later fails loudly instead of rendering "$NaN".
  if (isCustomPriced(plan) || plan.annualMonthlyMajor === null) {
    throw new RangeError(`${plan.name} has no published monthly price.`);
  }
  return fromMajor(plan.annualMonthlyMajor);
};

const perYear = (amount: Money): Money => money(amount.minor * 12, amount.currency);

export function PricingCalculator() {
  const [revenue, setRevenue] = useState(6000);
  /** The share of the month's licensing Mastline itself created, 0-100. */
  const [enginePercent, setEnginePercent] = useState(40);
  const [plan, setPlan] = useState<PlanId>("pro");

  const result = useMemo(() => {
    const total = fromMajor(revenue);

    // Split the month between what Mastline sold and what the photographer
    // sold, in minor units, so the two halves add back to the month exactly.
    const engineMinor = roundHalfUp(total.minor * (enginePercent / 100));
    const engine = money(engineMinor, total.currency);
    const direct = money(total.minor - engineMinor, total.currency);

    const split = calculateSalesEngineSplit(engine, "mastline_sales_engine");
    const subscription = monthlySubscription(plan);

    const keptBeforeSubscription = direct.minor + split.photographer.minor;
    const kept = money(keptBeforeSubscription - subscription.minor, total.currency);

    // An agency takes its share of everything, including the work the
    // photographer brought in themselves. That is the comparison being drawn.
    const agencyBest = money(total.minor - roundHalfUp(total.minor * AGENCY_LOW), total.currency);
    const agencyWorst = money(total.minor - roundHalfUp(total.minor * AGENCY_HIGH), total.currency);

    return {
      total,
      platform: split.platform,
      subscription,
      kept,
      agencyBest,
      agencyWorst,
      betterBy: money(kept.minor - agencyBest.minor, total.currency),
      betterByAtWorst: money(kept.minor - agencyWorst.minor, total.currency),
    };
  }, [revenue, enginePercent, plan]);

  const behind = result.betterBy.minor < 0;

  return (
    <div className="calc pcalc">
      <div className="calc-l">
        <span className="mk-eyebrow">Run the numbers</span>
        <h2>
          What a month
          <br />
          actually leaves you.
        </h2>
        <p>
          The share applies only to licensing Mastline creates. Everything sold through the
          photographer’s own relationships stays whole, and the subscription is counted here rather
          than left out of the comparison.
        </p>

        <label className="calc-slider">
          <span className="mk-eyebrow">Licensing revenue a month</span>
          <div>
            <input
              aria-label="Licensing revenue a month"
              max={REVENUE_MAX}
              min={REVENUE_MIN}
              onChange={(event) => setRevenue(Number(event.target.value))}
              step={REVENUE_STEP}
              type="range"
              value={revenue}
            />
            <output>{formatMoney(result.total)}</output>
          </div>
        </label>

        <label className="calc-slider">
          <span className="mk-eyebrow">Of that, sold by Mastline</span>
          <div>
            <input
              aria-label="Share of revenue sold by Mastline"
              max={100}
              min={0}
              onChange={(event) => setEnginePercent(Number(event.target.value))}
              step={5}
              type="range"
              value={enginePercent}
            />
            <output>{enginePercent}%</output>
          </div>
        </label>

        <div aria-label="Plan" className="pcalc-plans" role="group">
          {SELECTABLE.map((id) => (
            <button
              aria-pressed={id === plan}
              className={id === plan ? "on" : ""}
              key={id}
              onClick={() => setPlan(id)}
              type="button"
            >
              {findPlan(id).name}
            </button>
          ))}
        </div>
      </div>

      <div aria-live="polite" className="calc-r">
        <div className="calc-row">
          <span>Licensing revenue</span>
          <b>{formatMoney(result.total)}</b>
        </div>
        <div className="calc-row">
          <span>
            <i className="dot us" />
            Mastline’s share{" "}
            <small>
              {Math.round(SALES_ENGINE_PLATFORM_RATE * 100)}% of that {enginePercent}%
            </small>
          </span>
          <b>−{formatMoney(result.platform)}</b>
        </div>
        <div className="calc-row">
          <span>
            <i className="dot us" />
            {findPlan(plan).name} <small>billed annually</small>
          </span>
          <b>−{formatMoney(result.subscription)}</b>
        </div>
        <div className="calc-row big">
          <span className="mk-eyebrow">
            <i className="dot you" />
            Kept, a month
          </span>
          <b>{formatMoney(result.kept)}</b>
        </div>
        <p className="pcalc-year">{formatMoney(perYear(result.kept))} across a year</p>

        <div className="pcalc-vs">
          <div className="calc-row">
            <span>
              With an agency <small>taking 40–60%</small>
            </span>
            <b>
              {formatMoney(result.agencyWorst)}–{formatMoney(result.agencyBest)}
            </b>
          </div>
          <p className={`pcalc-delta${behind ? " behind" : ""}`}>
            {behind ? (
              <>
                At this volume and mix the subscription costs more than an agency’s cut would. More
                volume, or more of it sold directly, turns that around.
              </>
            ) : (
              <>
                <b>
                  {formatMoney(result.betterBy)} to {formatMoney(result.betterByAtWorst)}
                </b>{" "}
                more a month, and the buyer history stays with the photographer.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
