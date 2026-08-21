"use client";

import { useState } from "react";
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
import { formatMoney } from "@/lib/money";

export function PricingTable() {
  const [billing, setBilling] = useState<BillingPeriod>(DEFAULT_BILLING_PERIOD);

  return (
    <>
      <div className="billing-row">
        <div aria-label="Billing period" className="billing-toggle" role="group">
          <button
            aria-pressed={billing === "annual"}
            className={billing === "annual" ? "active" : ""}
            onClick={() => setBilling("annual")}
            type="button"
          >
            Annual <span>{annualSavingsClaim()}</span>
          </button>
          <button
            aria-pressed={billing === "monthly"}
            className={billing === "monthly" ? "active" : ""}
            onClick={() => setBilling("monthly")}
            type="button"
          >
            Monthly
          </button>
        </div>
      </div>

      <div className="pricing-grid pricing-grid-four">
        {PLANS.map((plan) => {
          const custom = isCustomPriced(plan);
          const yearly = annualTotal(plan);
          return (
            <article
              className={`price-card price-card-detailed${plan.popular ? " featured" : ""}`}
              key={plan.id}
            >
              {plan.popular && <span className="popular-label">Most popular</span>}
              <div className="plan-audience">{plan.audience}</div>
              <h2>{plan.name}</h2>
              <p className="plan-description">{plan.description}</p>

              <div className="plan-price">
                {custom ? (
                  <>
                    <strong>Custom</strong>
                    <small>
                      built around
                      <br />
                      your operation
                    </small>
                  </>
                ) : (
                  <>
                    <sup aria-hidden="true">$</sup>
                    <strong>{formatPlanPrice(plan, billing).replace("$", "")}</strong>
                    <small>
                      per month
                      <br />
                      {billingCadenceLabel(billing)}
                    </small>
                  </>
                )}
              </div>

              {!custom && billing === "annual" && yearly && (
                <p className="plan-annual-total">{formatMoney(yearly)} billed once a year</p>
              )}

              <button className={`button plan-cta${custom ? "" : " blue"}`} type="button">
                {plan.ctaLabel}
              </button>
              {!custom && <p className="plan-trial-note">{trialTermsLabel()}</p>}

              <div className="plan-divider" />
              <div className="plan-includes">What&apos;s included</div>
              <ul className="check-list">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </>
  );
}
