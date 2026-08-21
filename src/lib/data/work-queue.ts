import "server-only";

import type { Id } from "../domain";
import type { Money } from "../money";
import { listAssets } from "./assets";
import { getMoneySummary, listPayments } from "./money";
import { listPackages } from "./packages";
import { listShoots } from "./shoots";
import { listSubmissions } from "./submissions";
import { reviewSelection } from "../metadata-rules";

/**
 * The daily action queue.
 *
 * Priority combines workflow blockage, commercial impact, and age. The reason
 * travels with the item and is rendered, because a ranking nobody can question
 * is a ranking nobody can trust.
 */

export interface WorkQueueItem {
  readonly id: string;
  readonly kind: "Shoot" | "Dispatch" | "Submission" | "Money";
  readonly title: string;
  readonly detail: string;
  readonly occurredAt: string;
  readonly urgent: boolean;
  readonly actionLabel: string;
  readonly href: string;
  readonly rankingBasis: string;
}

export interface WorkPulse {
  readonly netReceived: Money;
  readonly outstanding: Money;
  readonly unmatched: Money;
  readonly overdueCount: number;
  readonly medianDispatchMinutes: number;
}

export async function getWorkQueue(organizationId: Id): Promise<readonly WorkQueueItem[]> {
  const [shoots, submissions, payments] = await Promise.all([
    listShoots(organizationId),
    listSubmissions(organizationId),
    listPayments(organizationId),
  ]);

  const items: WorkQueueItem[] = [];

  // Shoots whose selection is not yet dispatchable.
  for (const shoot of shoots) {
    if (["completed", "archived", "cancelled"].includes(shoot.status)) continue;

    const assets = await listAssets(organizationId, { shootId: shoot.id });
    const selected = assets.filter((asset) => asset.selected);
    if (selected.length === 0) continue;

    const report = reviewSelection(selected);
    if (report.blocked === 0) continue;

    items.push({
      id: `wq_captions_${shoot.id}`,
      kind: "Shoot",
      title: `Finish metadata on ${shoot.title}`,
      detail: `${report.ready} of ${report.total} frames ready`,
      occurredAt: shoot.updatedAt,
      urgent: shoot.priority === "urgent",
      actionLabel: "Continue",
      href: `/shoots/${shoot.id}`,
      rankingBasis: "Blocks dispatch on a shoot that already has selects",
    });
  }

  // Packages waiting on a decision.
  for (const shoot of shoots) {
    const packages = await listPackages(organizationId, { shootId: shoot.id });
    for (const pkg of packages) {
      if (!["needs_review", "ready", "draft"].includes(pkg.status)) continue;
      items.push({
        id: `wq_dispatch_${pkg.id}`,
        kind: "Dispatch",
        title: `Review ${pkg.name}`,
        detail: `${pkg.assets.length} assets awaiting approval`,
        occurredAt: shoot.updatedAt,
        urgent: false,
        actionLabel: "Review",
        href: `/dispatch/${shoot.id}?package=${pkg.id}`,
        rankingBasis: "A prepared package earns nothing until it is sent",
      });
    }
  }

  // A failed delivery is the single most urgent thing on the board, and it
  // produces exactly one item however many attempts have been made.
  for (const submission of submissions) {
    if (submission.status !== "failed") continue;
    items.push({
      id: `wq_failed_${submission.id}`,
      kind: "Submission",
      title: `Delivery failed: ${submission.reference}`,
      detail: "The buyer's system rejected or never received this package",
      occurredAt: submission.sentAt ?? "",
      urgent: true,
      actionLabel: "Retry",
      href: `/submissions/${submission.id}`,
      rankingBasis: "An approved package has not reached the buyer",
    });
  }

  // Submissions with no recorded outcome.
  for (const submission of submissions) {
    if (!["sent", "delivered", "acknowledged"].includes(submission.status)) continue;
    const overdue =
      submission.followUpAt !== undefined && new Date(submission.followUpAt) < new Date();
    items.push({
      id: `wq_followup_${submission.id}`,
      kind: "Submission",
      title: `No outcome recorded for ${submission.reference}`,
      detail: overdue ? "Follow-up date has passed" : "Awaiting a sale or no-sale",
      occurredAt: submission.sentAt ?? "",
      urgent: overdue,
      actionLabel: "Record",
      href: `/submissions/${submission.id}`,
      rankingBasis: overdue
        ? "The agreed follow-up date has passed"
        : "An unresolved submission is invisible revenue",
    });
  }

  // Money that has arrived but is not attributed, and anything overdue.
  for (const payment of payments) {
    if (payment.status === "overdue") {
      items.push({
        id: `wq_overdue_${payment.id}`,
        kind: "Money",
        title: `Overdue: ${payment.reference ?? payment.source}`,
        detail: `${payment.net.minor / 100} outstanding`,
        occurredAt: payment.dueAt ?? "",
        urgent: true,
        actionLabel: "Chase",
        href: "/money",
        rankingBasis: "Payment is past its due date",
      });
    } else if (payment.unallocated.minor > 0 && payment.source === "statement") {
      items.push({
        id: `wq_unmatched_${payment.id}`,
        kind: "Money",
        title: `Attribute ${payment.reference ?? "a statement line"}`,
        detail: `${payment.unallocated.minor / 100} not yet matched to work`,
        occurredAt: payment.receivedAt ?? "",
        urgent: false,
        actionLabel: "Match",
        href: "/money",
        rankingBasis: "Unattributed revenue cannot be traced to an asset or shoot",
      });
    }
  }

  return items.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "");
  });
}

/** Median minutes from the start of a shoot to its first dispatch. */
export async function getMedianDispatchMinutes(organizationId: Id): Promise<number> {
  const [submissions, shoots] = await Promise.all([
    listSubmissions(organizationId),
    listShoots(organizationId),
  ]);
  const shootById = new Map(shoots.map((shoot) => [shoot.id, shoot]));
  const packages = await listPackages(organizationId);
  const packageById = new Map(packages.map((pkg) => [pkg.id, pkg]));

  const durations: number[] = [];
  for (const submission of submissions) {
    if (!submission.sentAt) continue;
    const pkg = packageById.get(submission.packageId);
    const shoot = pkg ? shootById.get(pkg.shootId) : undefined;
    if (!shoot?.startsAt) continue;
    const minutes =
      (new Date(submission.sentAt).getTime() - new Date(shoot.startsAt).getTime()) / 60_000;
    if (minutes > 0) durations.push(minutes);
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

export async function getWorkPulse(organizationId: Id): Promise<WorkPulse> {
  const [summary, medianDispatchMinutes] = await Promise.all([
    getMoneySummary(organizationId),
    getMedianDispatchMinutes(organizationId),
  ]);

  return {
    netReceived: summary.netReceived,
    outstanding: summary.outstanding,
    unmatched: summary.unallocatedStatementTotal,
    overdueCount: summary.overdueCount,
    medianDispatchMinutes,
  };
}
