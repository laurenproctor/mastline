import type { SupabaseClient } from "@supabase/supabase-js";
import type { Asset, DispatchPackage, Id, Shoot, ShootStatus, Submission } from "../domain";
import { type Money, formatMoney, money, sum, zero } from "../money";
import { type PaymentWithAllocations, listPayments } from "./money";
import { listPackages } from "./packages";
import { listShoots } from "./shoots";
import { createClient } from "../supabase/server";
import { listSubmissions } from "./submissions";
import { signedUrlsFor } from "./imports";
import { reviewSelection } from "../metadata-rules";
import type { WorkspaceRoutes } from "../workspace-routes";

/**
 * The daily action queue, and the dashboard built around it.
 *
 * Ranking is deterministic and factual. Every item names the recorded state
 * that put it where it is -- the reason travels with the item and is rendered,
 * because a ranking nobody can question is a ranking nobody can trust. Nothing
 * here scores intent, predicts a sale, or invents a deadline.
 */

export type WorkQueueCategory = "in-preparation" | "ready-to-send" | "awaiting-outcome" | "money";

export type WorkQueueFilter = WorkQueueCategory | "all";

export const WORK_QUEUE_FILTERS: readonly { key: WorkQueueFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in-preparation", label: "In preparation" },
  { key: "ready-to-send", label: "Ready to send" },
  { key: "awaiting-outcome", label: "Awaiting outcome" },
  { key: "money", label: "Money" },
];

export function isWorkQueueFilter(value: string | undefined): value is WorkQueueFilter {
  return WORK_QUEUE_FILTERS.some((filter) => filter.key === value);
}

/**
 * The ranking classes, in the order they outrank each other.
 *
 * 1. Recorded delivery or submission failure
 * 2. Overdue payment
 * 3. Passed explicit follow-up date
 * 4. Selected photographs blocked by required metadata
 * 5. Package ready for review or approval
 * 6. Submission without a recipient delivery link
 * 7. Submission awaiting an outcome
 * 8. Received payment with an unallocated balance
 * 9. Other unfinished work, by last activity
 *
 * Within a class, most recent activity first. The number is exposed so the
 * ordering can be asserted without parsing display strings.
 */
export type WorkQueuePriority = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface WorkQueueItem {
  readonly id: string;
  readonly kind: "Shoot" | "Dispatch" | "Submission" | "Money";
  readonly category: WorkQueueCategory;
  readonly priority: WorkQueuePriority;
  readonly title: string;
  readonly detail: string;
  readonly occurredAt: string;
  /** True only for a recorded failure, an overdue payment, or a passed
   *  explicit follow-up date. This is the only thing drawn in red. */
  readonly urgent: boolean;
  readonly actionLabel: string;
  /**
   * A complete, workspace-scoped destination.
   *
   * These used to be workspace-independent -- "/money", "/shoots/<id>" -- and
   * were rendered straight into an href, which left the middleware to guess the
   * workspace from the active-workspace cookie. The queue is the first screen
   * of the day and every row on it is a link, so that is the widest surface the
   * two-tab bug had.
   *
   * The alternative was to keep them relative and scope them where they are
   * drawn. It was rejected: a relative value here is indistinguishable from a
   * real path, so forgetting to scope one is silent, and a queue item is a
   * record that may be read somewhere other than the page that built it. A
   * destination that carries its own workspace cannot be rendered wrongly.
   */
  readonly href: string;
  readonly rankingBasis: string;
}

export interface WorkQueueCounts {
  readonly all: number;
  readonly inPreparation: number;
  readonly readyToSend: number;
  readonly awaitingOutcome: number;
  readonly money: number;
}

export interface WorkQueueMoneySummary {
  /** Net across payments in expected, invoiced, partial, or overdue status. */
  readonly expectedNet: Money;
  readonly expectedCount: number;
  /** Net recorded as received that no allocation yet attributes to work. */
  readonly unallocatedNet: Money;
  readonly unallocatedCount: number;
  /** Submissions in sent, delivered, or acknowledged with no outcome. */
  readonly awaitingOutcomeCount: number;
}

export interface RecipientActivityItem {
  readonly id: string;
  /** The recipient the link was made for, or a neutral fallback. */
  readonly recipient: string;
  /** What the record shows they did, e.g. "opened Hotel Chelsea - Package 01". */
  readonly description: string;
  readonly kind: "opened" | "accepted" | "downloaded" | "refused";
  readonly occurredAt: string;
  readonly submissionId: string;
  readonly href: string;
}

export interface ActiveShootSummary {
  readonly id: string;
  readonly title: string;
  readonly status: ShootStatus;
  readonly totalAssets: number;
  readonly selectedCount: number;
  /** Required-metadata completion across the selection, 0-100. */
  readonly metadataPercent: number;
  readonly blockedCount: number;
  /** The latest package's state, as words. Null when none exists. */
  readonly packageLabel: string | null;
  /** Recipient-link state, only when a submission exists. */
  readonly linkLabel: string | null;
  readonly lastActivityAt: string;
  readonly actionLabel: string;
  readonly actionHref: string;
  /** Short-lived signed preview URLs, up to four. Empty when no derivative
   *  exists or signing failed; the card falls back to its text summary. */
  readonly previewUrls: readonly string[];
}

export interface WorkQueueDashboard {
  readonly nextUp: WorkQueueItem | null;
  /** The full ranked queue. `nextUp` is its first item, not a separate idea. */
  readonly queue: readonly WorkQueueItem[];
  readonly counts: WorkQueueCounts;
  readonly activeShoots: readonly ActiveShootSummary[];
  readonly recipientActivity: readonly RecipientActivityItem[];
  readonly money: WorkQueueMoneySummary;
}

/** Shoot statuses with work still ahead of dispatch. */
const OPEN_SHOOT_STATUSES: readonly ShootStatus[] = [
  "draft",
  "scheduled",
  "active",
  "ingesting",
  "preparing",
  "ready",
];

const AWAITING_OUTCOME_STATUSES = ["sent", "delivered", "acknowledged"] as const;

/**
 * Everything the queue is built from, already fetched. Plain collections so
 * the ranking below is a pure function a test can feed directly.
 */
export interface WorkQueueFacts {
  readonly shoots: readonly Shoot[];
  readonly selectedAssetsByShoot: ReadonlyMap<string, readonly Asset[]>;
  readonly packages: readonly DispatchPackage[];
  readonly submissions: readonly Submission[];
  /** How many delivery links each submission carries. Never the links. */
  readonly deliveryCountBySubmission: ReadonlyMap<string, number>;
  readonly payments: readonly PaymentWithAllocations[];
  readonly now: Date;
}

/**
 * Build and rank the queue. Pure: no clock, no database.
 *
 * Sorting is priority class first, then most recent activity, then id, so two
 * builds over the same facts agree to the row.
 */
export function buildWorkQueue(
  facts: WorkQueueFacts,
  routes: WorkspaceRoutes,
): readonly WorkQueueItem[] {
  const { shoots, selectedAssetsByShoot, packages, submissions, payments, now } = facts;
  const items: WorkQueueItem[] = [];

  const packagesByShoot = new Map<string, DispatchPackage[]>();
  for (const pkg of packages) {
    packagesByShoot.set(pkg.shootId, [...(packagesByShoot.get(pkg.shootId) ?? []), pkg]);
  }

  // 1. A recorded failure outranks everything: an approved package that never
  //    reached the buyer earns nothing and gets staler by the hour.
  for (const submission of submissions) {
    if (submission.status !== "failed") continue;
    items.push({
      id: `wq_failed_${submission.id}`,
      kind: "Submission",
      category: "ready-to-send",
      priority: 1,
      title: `Delivery failed — ${submission.reference}`,
      detail: "The buyer's system rejected or never received this package",
      occurredAt: submission.sentAt ?? "",
      urgent: true,
      actionLabel: "Retry",
      href: routes.submission(submission.id),
      rankingBasis: "A recorded delivery failure",
    });
  }

  // 2. Overdue payments.
  for (const payment of payments) {
    if (payment.status !== "overdue") continue;
    items.push({
      id: `wq_overdue_${payment.id}`,
      kind: "Money",
      category: "money",
      priority: 2,
      title: `Overdue — ${payment.reference ?? payment.source}`,
      detail: `${formatMoney(payment.net)} past its due date`,
      occurredAt: payment.dueAt ?? "",
      urgent: true,
      actionLabel: "Chase",
      href: routes.money(),
      rankingBasis: "Payment is past its recorded due date",
    });
  }

  // 3 and 7. Submissions with no outcome. A passed follow-up date is the
  //    urgent form of the same fact, so it is the same item promoted.
  for (const submission of submissions) {
    if (!AWAITING_OUTCOME_STATUSES.includes(submission.status as "sent")) continue;
    const followUpPassed =
      submission.followUpAt !== undefined && new Date(submission.followUpAt) < now;
    items.push({
      id: `wq_outcome_${submission.id}`,
      kind: "Submission",
      category: "awaiting-outcome",
      priority: followUpPassed ? 3 : 7,
      title: `Record outcome — ${submission.reference}`,
      detail: followUpPassed
        ? "The agreed follow-up date has passed"
        : "No sale or no-sale recorded yet",
      occurredAt: (followUpPassed ? submission.followUpAt : submission.sentAt) ?? "",
      urgent: followUpPassed,
      actionLabel: "Review",
      href: routes.submission(submission.id),
      rankingBasis: followUpPassed
        ? "The explicit follow-up date has passed"
        : "A submission with no recorded outcome",
    });
  }

  for (const shoot of shoots) {
    if (!OPEN_SHOOT_STATUSES.includes(shoot.status)) continue;
    const selected = selectedAssetsByShoot.get(shoot.id) ?? [];

    // 4. Selected photographs the required-metadata rules refuse to dispatch.
    if (selected.length > 0) {
      const report = reviewSelection(selected);
      if (report.blocked > 0) {
        items.push({
          id: `wq_captions_${shoot.id}`,
          kind: "Shoot",
          category: "in-preparation",
          priority: 4,
          title: `Finish metadata — ${shoot.title}`,
          detail: `${report.blocked} of ${report.total} selected photos missing required metadata`,
          occurredAt: shoot.updatedAt,
          urgent: false,
          actionLabel: "Continue",
          href: routes.shoot(shoot.id),
          rankingBasis: "Selected photos are blocked from dispatch by required metadata",
        });
      }
    } else if (["active", "ingesting", "preparing", "ready"].includes(shoot.status)) {
      // 9. Imported work nobody has selected from yet.
      items.push({
        id: `wq_select_${shoot.id}`,
        kind: "Shoot",
        category: "in-preparation",
        priority: 9,
        title: `Select photos — ${shoot.title}`,
        detail: "No photos selected yet",
        occurredAt: shoot.updatedAt,
        urgent: false,
        actionLabel: "Continue",
        href: routes.shoot(shoot.id),
        rankingBasis: "An open shoot with nothing selected for dispatch",
      });
    }

    for (const pkg of packagesByShoot.get(shoot.id) ?? []) {
      if (["needs_review", "ready"].includes(pkg.status)) {
        // 5. A prepared package waiting on review or approval.
        items.push({
          id: `wq_dispatch_${pkg.id}`,
          kind: "Dispatch",
          category: "ready-to-send",
          priority: 5,
          title: `Review package — ${pkg.name}`,
          detail: `${pkg.assets.length} photos awaiting approval`,
          occurredAt: shoot.updatedAt,
          urgent: false,
          actionLabel: "Review",
          href: routes.dispatch({ shootId: shoot.id, packageId: pkg.id }),
          rankingBasis: "A prepared package awaiting review and approval",
        });
      } else if (pkg.status === "draft") {
        // 9. A package someone started and left.
        items.push({
          id: `wq_draft_${pkg.id}`,
          kind: "Dispatch",
          category: "in-preparation",
          priority: 9,
          title: `Finish package — ${pkg.name}`,
          detail: `${pkg.assets.length} photos in a draft package`,
          occurredAt: shoot.updatedAt,
          urgent: false,
          actionLabel: "Continue",
          href: routes.dispatch({ shootId: shoot.id, packageId: pkg.id }),
          rankingBasis: "A draft package left unfinished",
        });
      }
    }
  }

  // 6. An approved submission that no recipient can open yet. Approval creates
  //    the submission `queued`; a link for a recipient is the next recorded
  //    step, and until one exists nothing has been offered to anyone.
  for (const submission of submissions) {
    if (submission.status !== "queued") continue;
    if ((facts.deliveryCountBySubmission.get(submission.id) ?? 0) > 0) continue;
    items.push({
      id: `wq_nolink_${submission.id}`,
      kind: "Submission",
      category: "ready-to-send",
      priority: 6,
      title: `Create a recipient link — ${submission.reference}`,
      detail: "Approved, but no recipient link exists yet",
      occurredAt: submission.sentAt ?? "",
      urgent: false,
      actionLabel: "Create link",
      href: routes.submission(submission.id),
      rankingBasis: "A recorded submission with no recipient delivery link",
    });
  }

  // 8. Money that arrived but is not yet attributed to the work that earned it.
  for (const payment of payments) {
    if (payment.status !== "received" || payment.unallocated.minor <= 0) continue;
    items.push({
      id: `wq_unallocated_${payment.id}`,
      kind: "Money",
      category: "money",
      priority: 8,
      title: `Allocate — ${payment.reference ?? payment.source}`,
      detail: `${formatMoney(payment.unallocated)} received but not attributed to work`,
      occurredAt: payment.receivedAt ?? "",
      urgent: false,
      actionLabel: "Allocate",
      href: routes.money(),
      rankingBasis: "A received payment with an unallocated balance",
    });
  }

  return items.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const byTime = (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "");
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });
}

export function workQueueCounts(queue: readonly WorkQueueItem[]): WorkQueueCounts {
  const of = (category: WorkQueueCategory) =>
    queue.filter((item) => item.category === category).length;
  return {
    all: queue.length,
    inPreparation: of("in-preparation"),
    readyToSend: of("ready-to-send"),
    awaitingOutcome: of("awaiting-outcome"),
    money: of("money"),
  };
}

/** The strip at the foot of the queue: three sums, no forecasts. */
export function buildMoneySummary(
  payments: readonly PaymentWithAllocations[],
  submissions: readonly Submission[],
): WorkQueueMoneySummary {
  const awaiting = payments.filter((payment) =>
    ["expected", "invoiced", "partial", "overdue"].includes(payment.status),
  );
  const unallocated = payments.filter(
    (payment) => payment.status === "received" && payment.unallocated.minor > 0,
  );
  return {
    expectedNet: awaiting.length
      ? sum(
          awaiting.map((payment) => payment.net),
          "USD",
        )
      : zero("USD"),
    expectedCount: awaiting.length,
    unallocatedNet: unallocated.length
      ? sum(
          unallocated.map((payment) => payment.unallocated),
          "USD",
        )
      : zero("USD"),
    unallocatedCount: unallocated.length,
    awaitingOutcomeCount: submissions.filter((submission) =>
      AWAITING_OUTCOME_STATUSES.includes(submission.status as "sent"),
    ).length,
  };
}

interface DeliveryRef {
  readonly id: string;
  readonly submissionId: string;
  readonly recipientLabel?: string;
}

interface AccessEventRow {
  readonly id: string;
  readonly deliveryId: string;
  readonly kind: RecipientActivityItem["kind"];
  readonly occurredAt: string;
}

/**
 * Turn recorded access events into readable rows. Pure and deterministic.
 *
 * Downloads on one delivery collapse into a single counted row -- a desk
 * pulling eight files is one act, not eight rows -- stamped with the latest
 * download's time. Opens, acceptances, and refusals stay individual, because
 * each is separately meaningful evidence. There is no per-photo "viewed"
 * event in the record, so nothing here claims one.
 */
export function buildRecipientActivity(
  events: readonly AccessEventRow[],
  deliveries: readonly DeliveryRef[],
  submissions: readonly Submission[],
  packages: readonly DispatchPackage[],
  routes: WorkspaceRoutes,
  limit = 8,
): readonly RecipientActivityItem[] {
  const deliveryById = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
  const submissionById = new Map(submissions.map((submission) => [submission.id, submission]));
  const packageById = new Map(packages.map((pkg) => [pkg.id, pkg]));

  const rows: RecipientActivityItem[] = [];
  const downloadsByDelivery = new Map<string, { count: number; latest: string }>();

  for (const event of events) {
    const delivery = deliveryById.get(event.deliveryId);
    if (!delivery) continue;
    const submission = submissionById.get(delivery.submissionId);
    if (!submission) continue;

    if (event.kind === "downloaded") {
      const group = downloadsByDelivery.get(delivery.id);
      downloadsByDelivery.set(delivery.id, {
        count: (group?.count ?? 0) + 1,
        // Events arrive newest first; the first one seen is the latest.
        latest: group?.latest ?? event.occurredAt,
      });
      continue;
    }

    const recipient = delivery.recipientLabel ?? submission.recipientLabel ?? "A recipient";
    const packageName = packageById.get(submission.packageId)?.name ?? submission.reference;
    const description =
      event.kind === "opened"
        ? `opened ${packageName}`
        : event.kind === "accepted"
          ? "accepted the terms"
          : "was refused access";

    rows.push({
      id: event.id,
      recipient,
      description,
      kind: event.kind,
      occurredAt: event.occurredAt,
      submissionId: submission.id,
      href: routes.submission(submission.id),
    });
  }

  for (const [deliveryId, group] of downloadsByDelivery) {
    const delivery = deliveryById.get(deliveryId);
    const submission = delivery ? submissionById.get(delivery.submissionId) : undefined;
    if (!delivery || !submission) continue;
    rows.push({
      id: `dl_${deliveryId}`,
      recipient: delivery.recipientLabel ?? submission.recipientLabel ?? "A recipient",
      description: `downloaded ${group.count} authorized ${group.count === 1 ? "file" : "files"}`,
      kind: "downloaded",
      occurredAt: group.latest,
      submissionId: submission.id,
      href: routes.submission(submission.id),
    });
  }

  return rows
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/**
 * Everything the queue is built from, in a fixed number of queries.
 *
 * The page an operator opens every morning must not get slower as the
 * workspace grows, so nothing here loops a query over records. The asset
 * query is deliberately narrow: completeness only needs the fields the
 * metadata rules read -- not versions, not earnings -- so it does not go
 * through listAssets. The delivery query carries no token: the queue needs to
 * know a link exists and who it names, never the credential itself.
 */
async function fetchWorkQueueFacts(
  organizationId: Id,
  supabase: SupabaseClient,
): Promise<WorkQueueFacts & { deliveries: readonly DeliveryRef[] }> {
  const [shoots, submissions, payments, packages, assetRows, deliveryRows] = await Promise.all([
    listShoots(organizationId, supabase),
    listSubmissions(organizationId, supabase),
    listPayments(organizationId, supabase),
    listPackages(organizationId, {}, supabase),
    supabase
      .from("assets")
      .select(
        "id, shoot_id, selected, caption, caption_awaits_review, caption_reviewed_at, caption_origin, caption_drafted_at, headline, credit_line, copyright_notice, captured_at, location_name, subjects, usage_restrictions, keywords, status",
      )
      .eq("organization_id", organizationId)
      .eq("selected", true)
      .neq("status", "tombstoned"),
    supabase
      .from("submission_deliveries")
      .select("id, submission_id, recipient_label")
      .eq("organization_id", organizationId),
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
      captionOrigin: row.caption_origin === "model" ? "model" : "human",
      captionDraftedAt: (row.caption_drafted_at as string | null) ?? undefined,
      captionReviewedAt: (row.caption_reviewed_at as string | null) ?? undefined,
      captionAwaitsReview: (row.caption_awaits_review as boolean | null) ?? false,
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

  const deliveries: DeliveryRef[] = (deliveryRows.data ?? []).map((row) => ({
    id: row.id as string,
    submissionId: row.submission_id as string,
    recipientLabel: (row.recipient_label as string | null) ?? undefined,
  }));

  const deliveryCountBySubmission = new Map<string, number>();
  for (const delivery of deliveries) {
    deliveryCountBySubmission.set(
      delivery.submissionId,
      (deliveryCountBySubmission.get(delivery.submissionId) ?? 0) + 1,
    );
  }

  return {
    shoots,
    selectedAssetsByShoot: selectedByShoot,
    packages,
    submissions,
    deliveryCountBySubmission,
    payments,
    deliveries,
    now: new Date(),
  };
}

/**
 * The ranked queue on its own. Kept for callers and tests that only need the
 * list; the page reads `getWorkQueueDashboard`, which shares the same fetch
 * and the same ranking.
 */
export async function getWorkQueue(
  organizationId: Id,
  /**
   * The route builder for the workspace being read, from `workspaceRoutes()`.
   * A builder rather than a slug: two strings in a row is how an organization
   * id and an address get swapped by accident.
   */
  routes: WorkspaceRoutes,
  client?: SupabaseClient,
): Promise<readonly WorkQueueItem[]> {
  const supabase = client ?? (await createClient());
  const facts = await fetchWorkQueueFacts(organizationId, supabase);
  return buildWorkQueue(facts, routes);
}

/** How many recorded access events to read for the activity panel. */
const ACTIVITY_EVENT_WINDOW = 40;

/** How many preview derivatives to consider across the active-shoot cards. */
const PREVIEW_CANDIDATES = 48;

const PREVIEWS_PER_SHOOT = 4;

/**
 * Everything the Work Queue screen renders, in one fixed-cost load.
 *
 * On top of the queue facts this adds three queries -- recorded access
 * events, the active shoots' asset ids, and their preview derivatives -- so
 * the round-trip count stays flat however much work the workspace holds.
 * Preview URLs are signed server-side for ten minutes; no original is ever
 * loaded for this screen, and no delivery token leaves the data layer.
 */
export async function getWorkQueueDashboard(
  organizationId: Id,
  routes: WorkspaceRoutes,
  client?: SupabaseClient,
): Promise<WorkQueueDashboard> {
  const supabase = client ?? (await createClient());
  const facts = await fetchWorkQueueFacts(organizationId, supabase);
  const queue = buildWorkQueue(facts, routes);

  const activeShootRecords = facts.shoots
    .filter((shoot) => OPEN_SHOOT_STATUSES.includes(shoot.status))
    .slice(0, 2);
  const activeShootIds = activeShootRecords.map((shoot) => shoot.id);

  const [eventRows, shootAssetRows, versionRows] = await Promise.all([
    supabase
      .from("delivery_access_events")
      .select("id, delivery_id, kind, occurred_at")
      .eq("organization_id", organizationId)
      .order("occurred_at", { ascending: false })
      .limit(ACTIVITY_EVENT_WINDOW),
    activeShootIds.length > 0
      ? supabase
          .from("assets")
          .select("id, shoot_id, selected")
          .eq("organization_id", organizationId)
          .neq("status", "tombstoned")
          .in("shoot_id", activeShootIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    activeShootIds.length > 0
      ? supabase
          .from("asset_versions")
          .select(
            "asset_id, version_kind, object_key, storage_bucket, assets!inner(shoot_id, selected)",
          )
          .eq("organization_id", organizationId)
          .in("version_kind", ["preview", "thumbnail"])
          .eq("storage_bucket", "derivatives")
          .in("assets.shoot_id", activeShootIds)
          .order("created_at", { ascending: true })
          .limit(PREVIEW_CANDIDATES)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const events: AccessEventRow[] = (eventRows.data ?? []).map((row) => ({
    id: row.id as string,
    deliveryId: row.delivery_id as string,
    kind: row.kind as AccessEventRow["kind"],
    occurredAt: row.occurred_at as string,
  }));

  const recipientActivity = buildRecipientActivity(
    events,
    facts.deliveries,
    facts.submissions,
    facts.packages,
    routes,
  );

  // Asset totals per active shoot, from ids alone.
  const totalsByShoot = new Map<string, { total: number; selected: number }>();
  for (const row of shootAssetRows.data ?? []) {
    const shootId = row.shoot_id as string;
    const entry = totalsByShoot.get(shootId) ?? { total: 0, selected: 0 };
    entry.total += 1;
    if (row.selected) entry.selected += 1;
    totalsByShoot.set(shootId, entry);
  }

  // Up to four preview keys per shoot, selected frames first.
  const previewsByShoot = new Map<string, string[]>();
  const versionRecords = (versionRows.data ?? []).map((row) => {
    const rel = row.assets as unknown as { shoot_id: string; selected: boolean } | null;
    return {
      objectKey: row.object_key as string,
      shootId: rel?.shoot_id ?? "",
      selected: Boolean(rel?.selected),
    };
  });
  for (const pass of [true, false]) {
    for (const version of versionRecords) {
      if (version.selected !== pass || !version.shootId) continue;
      const bucket = previewsByShoot.get(version.shootId) ?? [];
      if (bucket.length >= PREVIEWS_PER_SHOOT || bucket.includes(version.objectKey)) continue;
      bucket.push(version.objectKey);
      previewsByShoot.set(version.shootId, bucket);
    }
  }

  const allKeys = [...previewsByShoot.values()].flat();
  const signed = await signedUrlsFor(supabase, "derivatives", allKeys, 600);

  const submissionsByPackage = new Map<string, Submission[]>();
  for (const submission of facts.submissions) {
    submissionsByPackage.set(submission.packageId, [
      ...(submissionsByPackage.get(submission.packageId) ?? []),
      submission,
    ]);
  }
  const packagesByShoot = new Map<string, DispatchPackage[]>();
  for (const pkg of facts.packages) {
    packagesByShoot.set(pkg.shootId, [...(packagesByShoot.get(pkg.shootId) ?? []), pkg]);
  }

  const activeShoots: ActiveShootSummary[] = activeShootRecords.map((shoot) => {
    const totals = totalsByShoot.get(shoot.id) ?? { total: 0, selected: 0 };
    const selection = reviewSelection(facts.selectedAssetsByShoot.get(shoot.id) ?? []);
    const shootPackages = packagesByShoot.get(shoot.id) ?? [];
    // listPackages orders newest first, so the first is the latest.
    const latestPackage = shootPackages[0];
    const shootSubmissions = shootPackages.flatMap((pkg) => submissionsByPackage.get(pkg.id) ?? []);
    const unlinkedSubmission = shootSubmissions.find(
      (submission) =>
        submission.status === "queued" &&
        (facts.deliveryCountBySubmission.get(submission.id) ?? 0) === 0,
    );
    const linkedCount = shootSubmissions.reduce(
      (count, submission) => count + (facts.deliveryCountBySubmission.get(submission.id) ?? 0),
      0,
    );

    const action = unlinkedSubmission
      ? { label: "Create recipient link", href: routes.submission(unlinkedSubmission.id) }
      : selection.total > 0 && selection.blocked > 0
        ? { label: "Complete metadata", href: routes.shoot(shoot.id) }
        : latestPackage && ["needs_review", "ready"].includes(latestPackage.status)
          ? {
              label: "Review package",
              href: routes.dispatch({ shootId: shoot.id, packageId: latestPackage.id }),
            }
          : { label: "Open shoot", href: routes.shoot(shoot.id) };

    return {
      id: shoot.id,
      title: shoot.title,
      status: shoot.status,
      totalAssets: totals.total,
      selectedCount: totals.selected,
      metadataPercent: selection.completionPercent,
      blockedCount: selection.blocked,
      packageLabel: latestPackage
        ? latestPackage.status === "needs_review"
          ? "Needs review"
          : latestPackage.status.charAt(0).toUpperCase() + latestPackage.status.slice(1)
        : null,
      linkLabel:
        shootSubmissions.length === 0
          ? null
          : unlinkedSubmission
            ? "No recipient link"
            : linkedCount > 0
              ? "Recipient link created"
              : null,
      lastActivityAt: shoot.updatedAt,
      actionLabel: action.label,
      actionHref: action.href,
      previewUrls: (previewsByShoot.get(shoot.id) ?? [])
        .map((key) => signed.get(key))
        .filter((url): url is string => Boolean(url)),
    };
  });

  return {
    nextUp: queue[0] ?? null,
    queue,
    counts: workQueueCounts(queue),
    activeShoots,
    recipientActivity,
    money: buildMoneySummary(facts.payments, facts.submissions),
  };
}
