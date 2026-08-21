/**
 * Subscription lifecycle.
 *
 * Everything here is a pure function over recorded facts, so the rules can be
 * read and tested without a payment provider in the room. The provider only
 * ever tells us what happened; what that *means* is decided here.
 *
 * Settled terms (`docs/DECISIONS.md` item 1):
 *   * A card attached mid-trial does not end the trial. The first charge lands
 *     when the 30 days are up, so choosing to pay early never costs anyone.
 *   * A failed renewal keeps the workspace working for 14 days, then it goes
 *     read-only. Never locked: reading and exporting always work.
 */

import {
  type PlanId,
  TRIAL_PLAN,
  TRIAL_STORAGE_BYTES,
  PLAN_SEATS,
  PLAN_STORAGE_BYTES,
} from "./pricing";
import type { BillingPeriod } from "./pricing";
import type { SubscriptionStatus } from "./subscription";

/** How long a workspace keeps working after a renewal fails. */
export const PAST_DUE_GRACE_DAYS = 14;

export interface BillingState {
  readonly plan: PlanId;
  readonly status: SubscriptionStatus;
  readonly billingPeriod: BillingPeriod;
  readonly trialEndsAt?: string;
  /** Set when a card is on file. A trial with a card still runs its course. */
  readonly paymentMethodAttachedAt?: string;
  /** When the renewal first failed. Drives the grace window. */
  readonly pastDueSince?: string;
  readonly currentPeriodEnd?: string;
  readonly cancelAtPeriodEnd?: boolean;
}

function daysBetween(from: string, to: Date): number {
  return (to.getTime() - new Date(from).getTime()) / 86_400_000;
}

/** Days left in the past-due grace window. Negative once it has run out. */
export function graceDaysRemaining(state: BillingState, now: Date): number | null {
  if (state.status !== "past_due" || !state.pastDueSince) return null;
  return Math.ceil(PAST_DUE_GRACE_DAYS - daysBetween(state.pastDueSince, now));
}

/**
 * Can this workspace be written to?
 *
 * Derived from the recorded dates rather than a status a scheduled job has to
 * flip. Nothing to run nightly, and nothing that can silently fall behind.
 */
export function canWrite(state: BillingState, now: Date): boolean {
  switch (state.status) {
    case "active":
      return true;
    case "trialing":
      return !state.trialEndsAt || new Date(state.trialEndsAt) > now;
    case "past_due": {
      const remaining = graceDaysRemaining(state, now);
      return remaining === null || remaining > 0;
    }
    case "expired":
    case "cancelled":
      return false;
  }
}

/** Reading and exporting never stop, whatever the billing state. */
export function canRead(): boolean {
  return true;
}

/** Effective limits, which a trial caps regardless of the plan it runs on. */
export function effectiveLimits(state: BillingState): {
  storageBytes: number | null;
  seats: number | null;
} {
  // A card on file lifts the trial cap immediately: they have committed, so
  // holding them at 25 GB for the rest of the month would be petty.
  const cappedByTrial = state.status === "trialing" && !state.paymentMethodAttachedAt;

  return {
    storageBytes: cappedByTrial ? TRIAL_STORAGE_BYTES : PLAN_STORAGE_BYTES[state.plan],
    seats: cappedByTrial ? PLAN_SEATS[TRIAL_PLAN] : PLAN_SEATS[state.plan],
  };
}

export type PlanChange = "upgrade" | "downgrade" | "same" | "period_change";

const LADDER: readonly PlanId[] = ["solo", "pro", "studio", "agency"];

export function comparePlans(from: PlanId, to: PlanId): PlanChange {
  if (from === to) return "same";
  return LADDER.indexOf(to) > LADDER.indexOf(from) ? "upgrade" : "downgrade";
}

export interface PlanChangeEffect {
  readonly change: PlanChange;
  /** When the new plan starts applying. */
  readonly appliesAt: "immediately" | "at_period_end";
  /** True when the change can strand data or people already in the workspace. */
  readonly needsConfirmation: boolean;
  readonly warnings: readonly string[];
}

/**
 * What choosing a different plan actually does.
 *
 * Upgrades apply immediately, because someone who has just paid more should get
 * what they paid for now. Downgrades apply at the end of the period they have
 * already paid for, and only then reduce the allowances -- which is why a
 * downgrade that would strand storage or people warns first rather than
 * silently locking imports later.
 */
export function planChangeEffect(
  state: BillingState,
  to: PlanId,
  usage: { storageBytes: number; seats: number },
): PlanChangeEffect {
  const change = comparePlans(state.plan, to);
  const warnings: string[] = [];

  const nextStorage = PLAN_STORAGE_BYTES[to];
  const nextSeats = PLAN_SEATS[to];

  if (nextStorage !== null && usage.storageBytes > nextStorage) {
    warnings.push(
      "You are storing more than that plan includes. Nothing already stored is removed, but new imports will be refused until you free space.",
    );
  }
  if (nextSeats !== null && usage.seats > nextSeats) {
    warnings.push(
      `That plan includes ${nextSeats} ${nextSeats === 1 ? "person" : "people"} and this workspace has ${usage.seats}. Remove people before the change takes effect, or they will lose access.`,
    );
  }

  return {
    change,
    appliesAt: change === "downgrade" ? "at_period_end" : "immediately",
    needsConfirmation: warnings.length > 0 || change === "downgrade",
    warnings,
  };
}

/**
 * When a subscription's first charge should land.
 *
 * Attaching a card during a trial does not bring the charge forward: the trial
 * runs its full course. Outside a trial, billing starts now.
 */
export function firstChargeAt(state: BillingState, now: Date): string {
  if (state.status === "trialing" && state.trialEndsAt && new Date(state.trialEndsAt) > now) {
    return state.trialEndsAt;
  }
  return now.toISOString();
}

export interface BillingSummary {
  readonly headline: string;
  readonly detail: string;
  readonly tone: "info" | "warn" | "danger";
  readonly needsCard: boolean;
}

/** What the billing panel should say about where this workspace stands. */
export function billingSummary(state: BillingState, now: Date): BillingSummary {
  const writable = canWrite(state, now);

  if (state.status === "trialing") {
    const endsAt = state.trialEndsAt;
    const days = endsAt ? Math.ceil(daysBetween(now.toISOString(), new Date(endsAt))) : null;

    if (state.paymentMethodAttachedAt) {
      return {
        headline: "Card on file",
        detail:
          days !== null && days > 0
            ? `Your trial runs for another ${days} ${days === 1 ? "day" : "days"}. The first charge lands when it ends.`
            : "The first charge lands when the trial ends.",
        tone: "info",
        needsCard: false,
      };
    }

    return {
      headline: writable ? "On trial" : "Trial ended",
      detail: writable
        ? `${days} ${days === 1 ? "day" : "days"} left. Add a card whenever you like; it will not be charged until the trial ends.`
        : "The workspace is read-only. Everything is still here and you can export all of it.",
      tone: writable ? "info" : "danger",
      needsCard: true,
    };
  }

  if (state.status === "past_due") {
    const remaining = graceDaysRemaining(state, now) ?? 0;
    return {
      headline: remaining > 0 ? "Payment failed" : "Payment overdue",
      detail:
        remaining > 0
          ? `We could not take the last payment. The workspace keeps working for another ${remaining} ${remaining === 1 ? "day" : "days"}. Update your card to avoid interruption.`
          : "The workspace is read-only until a payment goes through. Everything is still here and exportable.",
      tone: remaining > 0 ? "warn" : "danger",
      needsCard: true,
    };
  }

  if (state.status === "cancelled" || state.status === "expired") {
    return {
      headline: state.status === "cancelled" ? "Subscription cancelled" : "Subscription ended",
      detail:
        "The workspace is read-only. Your shoots, assets, and financial records are unchanged and you can export all of them.",
      tone: "danger",
      needsCard: true,
    };
  }

  return {
    headline: state.cancelAtPeriodEnd ? "Ends at the period end" : "Active",
    detail: state.cancelAtPeriodEnd
      ? "Your subscription will not renew. The workspace becomes read-only when the period ends."
      : state.currentPeriodEnd
        ? `Renews ${new Date(state.currentPeriodEnd).toISOString().slice(0, 10)}.`
        : "Your subscription is active.",
    tone: state.cancelAtPeriodEnd ? "warn" : "info",
    needsCard: false,
  };
}
