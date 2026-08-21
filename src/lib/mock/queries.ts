/**
 * The data-access seam.
 *
 * Screens call these functions and never touch fixtures directly. Every one is
 * async and organization-scoped, matching the shape a Supabase query will have,
 * so replacing this module in Phase 2 does not change a single component.
 *
 * Derived figures are computed here from the connected records rather than
 * restated as display strings, which is what makes the screens agree with one
 * another.
 */

import type {
  ActivityEvent,
  Asset,
  Buyer,
  DispatchPackage,
  Id,
  License,
  Member,
  Opportunity,
  Organization,
  Payment,
  RightsMatch,
  Shoot,
  Submission,
} from "../domain";
import { type Money, money, subtract, sum, zero } from "../money";
import {
  ACTIVITY_EVENTS,
  ASSETS,
  BUYERS,
  CHELSEA_IMPORTED_FILE_COUNT,
  CURRENT_USER_ID,
  DEMO_NOW,
  EXPENSES,
  LICENSES,
  MEMBERS,
  OPPORTUNITIES,
  ORGANIZATION,
  PACKAGES,
  PAYMENTS,
  RIGHTS_MATCHES,
  SHOOTS,
  SUBMISSIONS,
} from "./fixtures";

const usd = (minor: number) => money(minor, "USD");

export async function getOrganization(): Promise<Organization> {
  return ORGANIZATION;
}

export async function getMembers(): Promise<readonly Member[]> {
  return MEMBERS;
}

export async function getCurrentMember(): Promise<Member> {
  const member = MEMBERS.find((candidate) => candidate.userId === CURRENT_USER_ID);
  if (!member) throw new Error("The current user has no membership in this workspace.");
  return member;
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: "Owner · all workspace control",
  editor: "Editor · shoots, assets, captions, dispatch preparation",
  dispatcher: "Dispatcher · package delivery and status",
  finance: "Finance · revenue, payments, statements, exports",
  rights_reviewer: "Rights reviewer · evidence, license checks, case routing",
  viewer: "Viewer · read-only, no sensitive access",
};

export interface MemberWithRole extends Member {
  readonly roleDescription: string;
}

export async function listMembersWithRoles(): Promise<readonly MemberWithRole[]> {
  return MEMBERS.map((member) => ({
    ...member,
    roleDescription: ROLE_DESCRIPTIONS[member.role] ?? member.role,
  }));
}

export async function listBuyers(): Promise<readonly Buyer[]> {
  return BUYERS;
}

export async function getBuyer(id: Id | undefined): Promise<Buyer | null> {
  return BUYERS.find((buyer) => buyer.id === id) ?? null;
}

export async function listShoots(): Promise<readonly Shoot[]> {
  return [...SHOOTS].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getShoot(id: Id): Promise<Shoot | null> {
  return SHOOTS.find((shoot) => shoot.id === id) ?? null;
}

export async function listAssets(filter: { shootId?: Id } = {}): Promise<readonly Asset[]> {
  return ASSETS.filter((asset) => !filter.shootId || asset.shootId === filter.shootId);
}

export async function getAsset(id: Id): Promise<Asset | null> {
  return ASSETS.find((asset) => asset.id === id) ?? null;
}

export async function listPackages(
  filter: { shootId?: Id } = {},
): Promise<readonly DispatchPackage[]> {
  return PACKAGES.filter((pkg) => !filter.shootId || pkg.shootId === filter.shootId);
}

export async function getPackage(id: Id): Promise<DispatchPackage | null> {
  return PACKAGES.find((pkg) => pkg.id === id) ?? null;
}

const SETTLED_PACKAGE_STATUSES = new Set(["delivered", "recalled"]);

/**
 * The package a dispatch review screen should open for a shoot.
 *
 * Prefers one that still needs work; a shoot may have already dispatched an
 * earlier package to a different buyer.
 */
export async function getReviewablePackageForShoot(shootId: Id): Promise<DispatchPackage | null> {
  const forShoot = PACKAGES.filter((pkg) => pkg.shootId === shootId);
  return forShoot.find((pkg) => !SETTLED_PACKAGE_STATUSES.has(pkg.status)) ?? forShoot[0] ?? null;
}

export async function listSubmissions(): Promise<readonly Submission[]> {
  return [...SUBMISSIONS].sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
}

export async function getSubmission(id: Id): Promise<Submission | null> {
  return SUBMISSIONS.find((submission) => submission.id === id) ?? null;
}

export async function listLicenses(): Promise<readonly License[]> {
  return LICENSES;
}

export async function listPayments(): Promise<readonly Payment[]> {
  return PAYMENTS;
}

export async function listRightsMatches(): Promise<readonly RightsMatch[]> {
  return [...RIGHTS_MATCHES].sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt));
}

export async function listOpportunities(): Promise<readonly Opportunity[]> {
  return OPPORTUNITIES;
}

export async function listActivity(
  filter: { entityId?: Id } = {},
): Promise<readonly ActivityEvent[]> {
  return ACTIVITY_EVENTS.filter((event) => !filter.entityId || event.entityId === filter.entityId);
}

// ---------------------------------------------------------------------------
// Derived commercial figures
// ---------------------------------------------------------------------------

const RECEIVED_STATUSES = new Set(["received"]);
const OUTSTANDING_STATUSES = new Set(["expected", "invoiced", "partial", "overdue"]);

export function allocatedTotal(payment: Payment): Money {
  return sum(
    payment.allocations.map((allocation) => allocation.allocated),
    payment.net.currency,
  );
}

/** A statement line is unmatched to the extent it has not been allocated. */
export function unallocatedRemainder(payment: Payment): Money {
  const remainder = subtract(payment.net, allocatedTotal(payment));
  return remainder.minor > 0 ? remainder : zero(payment.net.currency);
}

export interface MoneySummary {
  readonly netReceived: Money;
  readonly outstanding: Money;
  readonly unmatchedStatementTotal: Money;
  readonly averageDaysToPayment: number;
  readonly overdueCount: number;
}

export async function getMoneySummary(): Promise<MoneySummary> {
  const received = PAYMENTS.filter((payment) => RECEIVED_STATUSES.has(payment.status));
  const outstanding = PAYMENTS.filter((payment) => OUTSTANDING_STATUSES.has(payment.status));
  const unmatched = PAYMENTS.filter(
    (payment) => payment.source === "statement" && unallocatedRemainder(payment).minor > 0,
  );

  const settled = received.filter((payment) => payment.expectedAt && payment.receivedAt);
  const averageDaysToPayment =
    settled.length === 0
      ? 0
      : Math.round(
          settled.reduce((total, payment) => {
            const expected = new Date(payment.expectedAt as string).getTime();
            const receivedAt = new Date(payment.receivedAt as string).getTime();
            return total + (receivedAt - expected) / 86_400_000;
          }, 0) / settled.length,
        );

  return {
    netReceived: sum(
      received.map((payment) => payment.net),
      "USD",
    ),
    outstanding: sum(
      outstanding.map((payment) => payment.net),
      "USD",
    ),
    unmatchedStatementTotal: sum(unmatched.map(unallocatedRemainder), "USD"),
    averageDaysToPayment,
    overdueCount: PAYMENTS.filter((payment) => payment.status === "overdue").length,
  };
}

export interface RevenueSource {
  readonly label: string;
  readonly amount: Money;
}

/** Received revenue grouped by where it came from, largest first. */
export async function getRevenueBySource(): Promise<readonly RevenueSource[]> {
  const totals = new Map<string, number>();
  for (const payment of PAYMENTS) {
    if (!RECEIVED_STATUSES.has(payment.status)) continue;
    const label =
      payment.source === "recovery"
        ? "Rights recovery"
        : payment.source === "checkout"
          ? "Direct licenses"
          : (BUYERS.find((buyer) => buyer.id === payment.buyerId)?.name ?? "Other");
    totals.set(label, (totals.get(label) ?? 0) + payment.net.minor);
  }
  return [...totals.entries()]
    .map(([label, minor]) => ({ label, amount: usd(minor) }))
    .sort((a, b) => b.amount.minor - a.amount.minor);
}

export interface Receivable {
  readonly payment: Payment;
  readonly buyerName: string;
  readonly daysOverdue: number;
}

export async function listReceivables(): Promise<readonly Receivable[]> {
  return PAYMENTS.filter((payment) => OUTSTANDING_STATUSES.has(payment.status))
    .map((payment) => {
      const dueAt = payment.dueAt ? new Date(payment.dueAt).getTime() : null;
      const daysOverdue =
        dueAt === null ? 0 : Math.max(0, Math.floor((DEMO_NOW.getTime() - dueAt) / 86_400_000));
      return {
        payment,
        buyerName: BUYERS.find((buyer) => buyer.id === payment.buyerId)?.name ?? "Unknown buyer",
        daysOverdue,
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/** Lifetime earnings for an asset, derived from allocations rather than stored. */
export async function getAssetLifetimeEarnings(assetId: Id): Promise<Money> {
  const allocations = PAYMENTS.flatMap((payment) => payment.allocations).filter(
    (allocation) => allocation.assetId === assetId,
  );
  return sum(
    allocations.map((allocation) => allocation.allocated),
    "USD",
  );
}

export interface ShootProgress {
  readonly shoot: Shoot;
  readonly importedFileCount: number;
  readonly selectedCount: number;
  readonly captionedCount: number;
  readonly captionCompletionPercent: number;
  readonly warningCount: number;
  readonly packageStatus: DispatchPackage["status"] | null;
}

export async function getShootProgress(shootId: Id): Promise<ShootProgress | null> {
  const shoot = SHOOTS.find((candidate) => candidate.id === shootId);
  if (!shoot) return null;
  const assets = ASSETS.filter((asset) => asset.shootId === shootId);
  const selected = assets.filter((asset) => asset.selected);
  const captioned = selected.filter((asset) => Boolean(asset.caption));
  const pkg = PACKAGES.find((candidate) => candidate.shootId === shootId) ?? null;
  return {
    shoot,
    importedFileCount: shootId === "sht_chelsea" ? CHELSEA_IMPORTED_FILE_COUNT : assets.length,
    selectedCount: selected.length,
    captionedCount: captioned.length,
    captionCompletionPercent:
      selected.length === 0 ? 0 : Math.round((captioned.length / selected.length) * 100),
    warningCount: selected.length - captioned.length,
    packageStatus: pkg?.status ?? null,
  };
}

export interface WorkQueueItem {
  readonly id: string;
  readonly kind: "Shoot" | "Delivery" | "Money" | "Rights";
  readonly title: string;
  readonly detail: string;
  readonly occurredAt: string;
  readonly urgent: boolean;
  readonly actionLabel: string;
  readonly href: string;
  /** Why this item is ranked where it is. Surfaced in the UI, never hidden. */
  readonly rankingBasis: string;
}

/**
 * The daily action queue.
 *
 * Priority combines workflow blockage, commercial impact, and age. The reason
 * travels with the item so the ranking can be explained rather than trusted.
 */
export async function getWorkQueue(): Promise<readonly WorkQueueItem[]> {
  const progress = await getShootProgress("sht_chelsea");
  const summary = await getMoneySummary();
  const newMatches = RIGHTS_MATCHES.filter((match) => match.status === "new");

  const items: WorkQueueItem[] = [];

  if (progress && progress.warningCount > 0) {
    items.push({
      id: "wq_captions",
      kind: "Shoot",
      title: `Finish captions for ${progress.shoot.title}`,
      detail: `${progress.captionedCount} of ${progress.selectedCount} complete`,
      occurredAt: progress.shoot.updatedAt,
      urgent: false,
      actionLabel: "Continue",
      href: `/shoots/${progress.shoot.id}`,
      rankingBasis: "Blocks dispatch on a high-priority shoot",
    });
  }

  items.push({
    id: "wq_delivery",
    kind: "Delivery",
    title: "Retry failed Backgrid delivery",
    detail: "6 files need retry",
    occurredAt: "2026-08-20T17:00:00.000Z",
    urgent: true,
    actionLabel: "Review",
    href: "/submissions/sub_bg_0820_441",
    rankingBasis: "Failed delivery blocks a submission already approved for send",
  });

  if (summary.unmatchedStatementTotal.minor > 0) {
    items.push({
      id: "wq_reconcile",
      kind: "Money",
      title: "Match unreconciled August statement sales",
      detail: `${summary.unmatchedStatementTotal.minor / 100} dollars unmatched`,
      occurredAt: "2026-08-20T16:00:00.000Z",
      urgent: false,
      actionLabel: "Reconcile",
      href: "/money",
      rankingBasis: "Unmatched revenue cannot be attributed to an asset or shoot",
    });
  }

  for (const match of newMatches) {
    items.push({
      id: `wq_rights_${match.id}`,
      kind: "Rights",
      title: `Decide whether ${match.publisherName} is licensed`,
      detail: `Observed ${match.matchMethod.toLowerCase()}`,
      occurredAt: match.lastObservedAt,
      urgent: false,
      actionLabel: "Review",
      href: "/rights",
      rankingBasis: "No linked license found; needs a human determination",
    });
  }

  return items.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return b.occurredAt.localeCompare(a.occurredAt);
  });
}

/** Median minutes from capture to first dispatch across completed submissions. */
export async function getMedianSubmissionMinutes(): Promise<number> {
  const durations: number[] = [];
  for (const submission of SUBMISSIONS) {
    if (!submission.sentAt) continue;
    const pkg = PACKAGES.find((candidate) => candidate.id === submission.packageId);
    const shoot = pkg ? SHOOTS.find((candidate) => candidate.id === pkg.shootId) : undefined;
    if (!shoot?.startsAt) continue;
    durations.push(
      (new Date(submission.sentAt).getTime() - new Date(shoot.startsAt).getTime()) / 60_000,
    );
  }
  if (durations.length === 0) return 0;
  durations.sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  return Math.round(
    durations.length % 2 === 0
      ? (durations[middle - 1] + durations[middle]) / 2
      : durations[middle],
  );
}

/** Revenue attributable to assets shot before the current month. */
export async function getArchiveRevenue(): Promise<Money> {
  const archiveAssetIds = new Set(
    ASSETS.filter((asset) => (asset.capturedAt ?? "") < "2026-08-15T00:00:00.000Z").map(
      (asset) => asset.id,
    ),
  );
  const allocations = PAYMENTS.filter((payment) => RECEIVED_STATUSES.has(payment.status))
    .flatMap((payment) => payment.allocations)
    .filter((allocation) => allocation.assetId && archiveAssetIds.has(allocation.assetId));
  return sum(
    allocations.map((allocation) => allocation.allocated),
    "USD",
  );
}

export async function getTotalExpenses(shootId?: Id): Promise<Money> {
  return sum(
    EXPENSES.filter((expense) => !shootId || expense.shootId === shootId).map(
      (expense) => expense.amount,
    ),
    "USD",
  );
}
