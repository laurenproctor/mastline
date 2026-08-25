/**
 * Workspace subscription state.
 *
 * A workspace is either trialing, paying, or lapsed. What that means for the
 * person using it is decided here, once, so the interface and the database
 * enforcement agree.
 *
 * The settled terms (`docs/DECISIONS.md` #1): 30 days, no card, a storage cap
 * during the trial, and a read-only workspace with export still available when
 * it ends. Read-only rather than locked, because a commercial record is never
 * held hostage -- see the exportability principle in CLAUDE.md.
 */

import {
  PLAN_STORAGE_BYTES,
  PLAN_SEATS,
  TRIAL_DAYS,
  TRIAL_PLAN,
  TRIAL_STORAGE_BYTES,
  type PlanId,
} from "./pricing";

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "expired",
  "cancelled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface Subscription {
  readonly plan: PlanId;
  readonly status: SubscriptionStatus;
  readonly trialEndsAt?: string;
}

/** How many whole days remain. Negative once the trial has ended. */
export function trialDaysRemaining(trialEndsAt: string | undefined, now: Date): number | null {
  if (!trialEndsAt) return null;
  const end = new Date(trialEndsAt).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - now.getTime()) / 86_400_000);
}

export function trialEndDateFrom(start: Date): string {
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + TRIAL_DAYS);
  return end.toISOString();
}

/**
 * Can this workspace be written to?
 *
 * `past_due` still writes: a card that failed on Tuesday should not stop a
 * photographer working a story on Wednesday. Chasing payment is a conversation,
 * not a reason to break the product mid-shoot.
 */
export function isWritable(subscription: Subscription, now: Date): boolean {
  switch (subscription.status) {
    case "active":
    case "past_due":
      return true;
    case "trialing": {
      const remaining = trialDaysRemaining(subscription.trialEndsAt, now);
      return remaining === null || remaining > 0;
    }
    case "expired":
    case "cancelled":
      return false;
  }
}

/**
 * Reading and exporting never stop.
 *
 * A lapsed workspace can still be read and taken away in full. Only creating,
 * changing, and sending stop.
 */
export function isReadable(): boolean {
  return true;
}

/** Storage this workspace may use, in bytes. Null means negotiated. */
export function storageLimitBytes(subscription: Subscription): number | null {
  if (subscription.status === "trialing") return TRIAL_STORAGE_BYTES;
  return PLAN_STORAGE_BYTES[subscription.plan];
}

/** People this workspace may have. Null means negotiated. */
export function seatLimit(subscription: Subscription): number | null {
  if (subscription.status === "trialing") return PLAN_SEATS[TRIAL_PLAN];
  return PLAN_SEATS[subscription.plan];
}

export interface StorageState {
  readonly usedBytes: number;
  readonly limitBytes: number | null;
  readonly percentUsed: number;
  readonly isOverLimit: boolean;
  /** True from 80% onwards, so a warning arrives before a wall does. */
  readonly isNearLimit: boolean;
  readonly remainingBytes: number | null;
}

export function storageState(subscription: Subscription, usedBytes: number): StorageState {
  const limitBytes = storageLimitBytes(subscription);

  if (limitBytes === null) {
    return {
      usedBytes,
      limitBytes: null,
      percentUsed: 0,
      isOverLimit: false,
      isNearLimit: false,
      remainingBytes: null,
    };
  }

  const percentUsed = limitBytes === 0 ? 100 : Math.round((usedBytes / limitBytes) * 100);
  return {
    usedBytes,
    limitBytes,
    percentUsed,
    isOverLimit: usedBytes >= limitBytes,
    isNearLimit: percentUsed >= 80,
    remainingBytes: Math.max(0, limitBytes - usedBytes),
  };
}

/** Bytes as a human figure, using the binary units a filesystem reports. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export interface WorkspaceNotice {
  readonly tone: "info" | "warn" | "danger";
  readonly headline: string;
  readonly detail: string;
  readonly action?: { readonly label: string; readonly href: string };
}

/**
 * What the workspace should be told, if anything.
 *
 * At most one notice, chosen by severity, because a banner for every condition
 * teaches people to ignore banners.
 */
export function workspaceNotice(
  subscription: Subscription,
  storage: StorageState,
  now: Date,
): WorkspaceNotice | null {
  if (!isWritable(subscription, now)) {
    return {
      tone: "danger",
      headline:
        subscription.status === "trialing" ? "The trial has ended" : "This workspace is read-only",
      detail:
        "Everything is still here and all of it stays exportable. Importing, dispatching, and recording are paused until a plan is chosen.",
      action: { label: "See plans", href: "/pricing" },
    };
  }

  if (storage.isOverLimit) {
    return {
      tone: "danger",
      headline: "Storage is full",
      detail: `${formatBytes(storage.usedBytes)} of ${formatBytes(storage.limitBytes ?? 0)} used. New imports are paused until space is freed or the plan moves up. Nothing already stored is affected.`,
      action: { label: "See plans", href: "/pricing" },
    };
  }

  const remaining = trialDaysRemaining(subscription.trialEndsAt, now);
  if (subscription.status === "trialing" && remaining !== null && remaining <= 7) {
    return {
      tone: "warn",
      headline: remaining === 1 ? "The trial ends tomorrow" : `The trial ends in ${remaining} days`,
      detail:
        "When it ends the workspace becomes read-only. Shoots, assets and records stay, and everything remains exportable.",
      action: { label: "See plans", href: "/pricing" },
    };
  }

  if (storage.isNearLimit) {
    return {
      tone: "warn",
      headline: `Storage is ${storage.percentUsed}% full`,
      detail: `${formatBytes(storage.remainingBytes ?? 0)} left of ${formatBytes(storage.limitBytes ?? 0)}.`,
      action: { label: "See plans", href: "/pricing" },
    };
  }

  return null;
}
