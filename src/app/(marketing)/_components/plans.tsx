"use client";

import Link from "next/link";
import { useState } from "react";
import { formatMoney } from "@/lib/money";
import {
  type BillingPeriod,
  DEFAULT_BILLING_PERIOD,
  PLANS,
  annualSavingsClaim,
  annualTotal,
  billingCadenceLabel,
  formatPlanPrice,
  isCustomPriced,
  trialTermsLabel,
} from "@/lib/pricing";

/**
 * The plan grid, in the marketing site's design.
 *
 * Every number and every feature line comes from `src/lib/pricing.ts`, not from
 * the markup. The design artifact this was ported from hardcoded three figures
 * that disagreed with the approved ones -- a 22% saving where the real spread
 * is 16.8%-17.7%, and ten Studio seats where the plan sells five. Reading them
 * from the same module the application bills against means a price can only be
 * wrong in one place, and the tests that pin those facts catch it there.
 */

/** Cross-links the artifact puts in two of the descriptions. */
const DESCRIPTION_LINK: Partial<Record<string, { href: string; label: string }>> = {
  studio: { href: "/teams", label: "For teams →" },
  agency: { href: "/teams", label: "For agencies →" },
};

export function Plans({ eyebrow, heading }: { eyebrow: string; heading: string }) {
  const [billing, setBilling] = useState<BillingPeriod>(DEFAULT_BILLING_PERIOD);

  return (
    <>
      {/* The toggle sits in the section head, where the design puts it. */}
      <div className="head">
        <div>
          <span className="mk-eyebrow">{eyebrow}</span>
          <h2>{heading}</h2>
        </div>
        <div aria-label="Billing period" className="pr-toggle" role="group">
          <button
            aria-pressed={billing === "annual"}
            className={billing === "annual" ? "on" : ""}
            onClick={() => setBilling("annual")}
            type="button"
          >
            Annual <small>{annualSavingsClaim()}</small>
          </button>
          <button
            aria-pressed={billing === "monthly"}
            className={billing === "monthly" ? "on" : ""}
            onClick={() => setBilling("monthly")}
            type="button"
          >
            Monthly
          </button>
        </div>
      </div>

      <div className="plans">
        {PLANS.map((plan) => {
          const custom = isCustomPriced(plan);
          const yearly = annualTotal(plan);
          const extra = DESCRIPTION_LINK[plan.id];

          return (
            <div className={`plan${plan.popular ? " popular" : ""}`} key={plan.id}>
              {plan.popular && <span className="badge">Most popular</span>}
              <span className="mk-eyebrow">{plan.audience}</span>
              <h3>{plan.name}</h3>
              <p className="desc">
                {plan.description} {extra && <Link href={extra.href}>{extra.label}</Link>}
              </p>

              {custom ? (
                <div className="price custom">
                  <b>Custom</b>
                  <span>
                    built around
                    <br />
                    the operation
                  </span>
                </div>
              ) : (
                <div className="price">
                  <sup>$</sup>
                  <b>{formatPlanPrice(plan, billing).replace("$", "")}</b>
                  <span>
                    per month
                    <br />
                    <em>{billingCadenceLabel(billing)}</em>
                  </span>
                </div>
              )}

              {/* What a year actually costs is a material fact, not a detail. */}
              {!custom && billing === "annual" && yearly && (
                <p className="plan-annual-total">{formatMoney(yearly)} billed once a year</p>
              )}

              <Link
                className={`btn ${custom ? "ghost" : "primary"}`}
                href={custom ? "/company" : "/sign-up"}
              >
                {plan.ctaLabel}
              </Link>
              {!custom && <p className="plan-trial-note">{trialTermsLabel()}</p>}

              <span className="inc">What’s included</span>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}
