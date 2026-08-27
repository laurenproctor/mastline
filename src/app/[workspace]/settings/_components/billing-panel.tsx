"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/components/primitives";
import { type CheckoutState, startCheckoutAction } from "@/app/[workspace]/billing/actions";
import type { BillingPeriod, PlanId } from "@/lib/pricing";
import { workspaceRoutes } from "@/lib/workspace-routes";

const INITIAL: CheckoutState = {};

export interface PlanOption {
  readonly id: PlanId;
  readonly name: string;
  readonly annualPrice: string;
  readonly monthlyPrice: string;
  readonly storage: string;
  readonly seats: string;
  readonly isCurrent: boolean;
}

/**
 * Choosing a plan.
 *
 * A downgrade, or any change that would strand storage or people, comes back
 * with what it would cost before it is confirmed. Nothing here changes the
 * workspace: the plan follows from a completed payment, and the database
 * refuses to let it be set any other way.
 */
export function BillingPanel({
  workspaceSlug,
  summary,
  tone,
  detail,
  needsCard,
  plans,
  billingAvailable,
  savingsClaim,
  portalAvailable,
}: {
  workspaceSlug: string;
  summary: string;
  tone: "info" | "warn" | "danger";
  detail: string;
  needsCard: boolean;
  plans: readonly PlanOption[];
  billingAvailable: boolean;
  savingsClaim: string;
  portalAvailable: boolean;
}) {
  const [state, formAction, pending] = useActionState(startCheckoutAction.bind(null, workspaceSlug), INITIAL);
  const [period, setPeriod] = useState<BillingPeriod>("annual");
  const [chosen, setChosen] = useState<PlanId | null>(null);

  const toneClass = tone === "danger" ? "danger" : tone === "warn" ? "warn" : "";

  return (
    <div className="panel-body">
      <div className={`billing-status ${toneClass}`}>
        <strong>{summary}</strong>
        <p>{detail}</p>
      </div>

      {!billingAvailable && (
        <p className="section-note">
          Payments are not connected yet, so nothing can be charged. The plans below are shown for
          reference.
        </p>
      )}

      {portalAvailable && (
        <p className="section-note">
          <a className="text-link" href={workspaceRoutes(workspaceSlug).billingPortal()}>
            Manage card and invoices
          </a>
        </p>
      )}

      {needsCard && (
        <>
          <div className="spacer" />
          <div className="billing-period" role="group" aria-label="Billing period">
            {(["annual", "monthly"] as const).map((value) => (
              <button
                aria-pressed={period === value}
                className={`button small${period === value ? " acid" : ""}`}
                key={value}
                onClick={() => setPeriod(value)}
                type="button"
              >
                {value === "annual" ? `Annual · ${savingsClaim}` : "Monthly"}
              </button>
            ))}
          </div>

          <ul className="plan-options">
            {plans.map((plan) => (
              <li className={plan.isCurrent ? "plan-option current" : "plan-option"} key={plan.id}>
                <div>
                  <strong>{plan.name}</strong>
                  {plan.isCurrent && <Badge tone="neutral">Current</Badge>}
                  <small>
                    {plan.storage} · {plan.seats}
                  </small>
                </div>
                <div className="plan-option-price">
                  <strong>{period === "annual" ? plan.annualPrice : plan.monthlyPrice}</strong>
                  <small>per month</small>
                </div>
                <form action={formAction}>
                  <input name="plan" type="hidden" value={plan.id} />
                  <input name="billingPeriod" type="hidden" value={period} />
                  {state.needsConfirmation && chosen === plan.id && (
                    <input name="confirmed" type="hidden" value="yes" />
                  )}
                  <button
                    className={`button small${plan.isCurrent ? "" : " blue"}`}
                    disabled={pending || !billingAvailable}
                    onClick={() => setChosen(plan.id)}
                    type="submit"
                  >
                    {state.needsConfirmation && chosen === plan.id
                      ? "Yes, change plan"
                      : plan.isCurrent
                        ? "Keep this plan"
                        : "Choose"}
                  </button>
                </form>
              </li>
            ))}
          </ul>

          {state.needsConfirmation && (
            <div className="billing-warning" role="alert">
              <strong>Before changing plan</strong>
              {(state.warnings ?? []).map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
              {(state.warnings ?? []).length === 0 && (
                <p>A downgrade takes effect at the end of the period already paid for.</p>
              )}
              <p className="section-note">Press the same button again to confirm.</p>
            </div>
          )}

          {state.error && (
            <p className="auth-error" role="alert">
              {state.error}
            </p>
          )}

          <p className="section-note">
            Adding a card during a trial does not end it. The trial runs its full course and the
            first charge lands when it does.
          </p>
        </>
      )}
    </div>
  );
}
