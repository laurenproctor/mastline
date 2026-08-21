import type { SupabaseClient } from "@supabase/supabase-js";
import type { Asset, Id } from "../domain";
import { type Money, money } from "../money";
import { getMoneySummary, listPayments } from "./money";
import { listPackages } from "./packages";
import { listShoots } from "./shoots";
import { createClient } from "../supabase/server";
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

/**
 * Build the queue with a fixed number of queries.
 *
 * This used to loop over every shoot asking for its assets and packages, which
 * meant roughly 3 + 4N round trips on the page an operator opens every morning.
 * Everything is now fetched once and grouped in memory: five queries, whatever
 * the size of the workspace.
 *
 * The asset query is deliberately narrow. Completeness only needs the metadata
 * fields the rules read -- not versions, not earnings -- so it does not go
 * through listAssets.
 */
export async function getWorkQueue(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<readonly WorkQueueItem[]> {
  const supabase = client ?? (await createClient());

  const [shoots, submissions, payments, packages, assetRows] = await Promise.all([
    listShoots(organizationId, supabase),
    listSubmissions(organizationId, supabase),
    listPayments(organizationId, supabase),
    listPackages(organizationId, {}, supabase),
    supabase
      .from("assets")
      .select(
        "id, shoot_id, selected, caption, headline, credit_line, copyright_notice, captured_at, location_name, subjects, usage_restrictions, keywords, status",
      )
      .eq("organization_id", organizationId)
      .eq("selected", true)
      .neq("status", "tombstoned"),
  ]);

  const selectedByShoot = new Map<string, Asset[]>();
  for (const row of assetRows.data ?? []) {
    const shootId = row.shoot_id as string | null;
    if (!shootId) continue;
    // Only the fields the completeness rules read; the rest are placeholders.
    const asset: Asset = {
      id: row.id as string,
      organizationId,
      shootId,
      status: row.status as Asset["status"],
      canonicalFilename: "",
      capturedAt: (row.captured_at as string | null) ?? undefined,
      headline: (row.headline as string | null) ?? undefined,
      caption: (row.caption as string | null) ?? undefined,
      subjects: Array.isArray(row.subjects) ? (row.subjects as string[]) : [],
      locationName: (row.location_name as string | null) ?? undefined,
      keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
      creditLine: (row.credit_line as string | null) ?? undefined,
      copyrightNotice: (row.copyright_notice as string | null) ?? undefined,
      usageRestrictions: (row.usage_restrictions as string | null) ?? undefined,
      selected: Boolean(row.selected),
      versions: [],
      captionHistory: [],
      lifetimeEarnings: money(0),
    };
    selectedByShoot.set(shootId, [...(selectedByShoot.get(shootId) ?? []), asset]);
  }

  const packagesByShoot = new Map<string, typeof packages>();
  for (const pkg of packages) {
    packagesByShoot.set(pkg.shootId, [...(packagesByShoot.get(pkg.shootId) ?? []), pkg]);
  }

  const items: WorkQueueItem[] = [];

  for (const shoot of shoots) {
    if (["completed", "archived", "cancelled"].includes(shoot.status)) continue;

    const selected = selectedByShoot.get(shoot.id) ?? [];
    if (selected.length > 0) {
      const report = reviewSelection(selected);
      if (report.blocked > 0) {
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
    }

    for (const pkg of packagesByShoot.get(shoot.id) ?? []) {
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

  // A failed delivery is the most urgent thing on the board, and produces
  // exactly one item however many attempts have been made.
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
export async function getMedianDispatchMinutes(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<number> {
  const supabase = client ?? (await createClient());
  const [submissions, shoots, packages] = await Promise.all([
    listSubmissions(organizationId, supabase),
    listShoots(organizationId, supabase),
    listPackages(organizationId, {}, supabase),
  ]);
  const shootById = new Map(shoots.map((shoot) => [shoot.id, shoot]));
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

export async function getWorkPulse(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<WorkPulse> {
  const supabase = client ?? (await createClient());
  const [summary, medianDispatchMinutes] = await Promise.all([
    getMoneySummary(organizationId, supabase),
    getMedianDispatchMinutes(organizationId, supabase),
  ]);

  return {
    netReceived: summary.netReceived,
    outstanding: summary.outstanding,
    unmatched: summary.unallocatedStatementTotal,
    overdueCount: summary.overdueCount,
    medianDispatchMinutes,
  };
}
