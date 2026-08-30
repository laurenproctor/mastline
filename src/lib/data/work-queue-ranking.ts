import type { Asset, DispatchPackage, Shoot, ShootStatus, Submission } from "../domain";
import { type Money, formatMoney, sum, zero } from "../money";
import { OUTSTANDING, type PaymentWithAllocations, RECEIVED } from "./money";
import { reviewSelection } from "../metadata-rules";
import type { WorkspaceRoutes } from "../workspace-routes";

/**
 * The daily action queue: what it is made of and how it is ordered.
 *
 * Ranking is deterministic and factual. Every item names the recorded state
 * that put it where it is -- the reason travels with the item and is rendered,
 * because a ranking nobody can question is a ranking nobody can trust. Nothing
 * here scores intent, predicts a sale, or invents a deadline.
 *
 * Everything in this module is pure: plain collections in, plain values out,
 * no clock and no database, so a test feeds it directly. The loaders live in
 * `work-queue.ts`, which re-exports this API.
 */

export type WorkQueueCategory = "in-preparation" | "ready-to-send" | "awaiting-outcome" | "money";

export type WorkQueueFilter = WorkQueueCategory | "all";

/** The `?queue=` values the screen accepts, in display order. */
export const WORK_QUEUE_FILTERS: readonly { key: WorkQueueFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in-preparation", label: "In preparation" },
  { key: "ready-to-send", label: "Ready to send" },
  { key: "awaiting-outcome", label: "Awaiting outcome" },
  { key: "money", label: "Money" },
];

/** An unknown value in the query is somebody's typo, not an error page. */
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
 * Within a class, most recent activity first, then id. The number is exposed
 * so the ordering can be asserted without parsing display strings.
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
  /**
   * True only for a recorded failure, an overdue payment, or a passed explicit
   * follow-up date. This is the only thing a screen may draw in red.
   */
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

/**
 * The four figures the screen's header shows today. The same definitions as
 * `getMoneySummary` and `getMedianDispatchMinutes`, computed from records the
 * dashboard has already loaded rather than fetched a second time.
 */
export interface WorkPulse {
  readonly netReceived: Money;
  readonly outstanding: Money;
  readonly unmatched: Money;
  readonly overdueCount: number;
  readonly medianDispatchMinutes: number;
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
  /**
   * Short-lived signed preview URLs, at most `previewsPerShoot`. Empty unless
   * the dashboard was asked for previews, when no derivative exists, or when
   * signing failed; a card falls back to its text summary.
   */
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
  readonly pulse: WorkPulse;
}

/** Shoot statuses with work still ahead of dispatch. */
export const OPEN_SHOOT_STATUSES: readonly ShootStatus[] = [
  "draft",
  "scheduled",
  "active",
  "ingesting",
  "preparing",
  "ready",
];

const AWAITING_OUTCOME_STATUSES: readonly Submission["status"][] = [
  "sent",
  "delivered",
  "acknowledged",
];

/**
 * What the ranking reads from a shoot. A `Shoot` satisfies it, so tests can
 * hand in full records; the loader fetches only these columns.
 */
export type WorkQueueShoot = Pick<
  Shoot,
  "id" | "title" | "status" | "priority" | "startsAt" | "locationName" | "updatedAt"
>;

/**
 * Everything the queue is built from, already fetched. Plain collections so
 * the ranking below is a pure function a test can feed directly.
 */
export interface WorkQueueFacts {
  readonly shoots: readonly WorkQueueShoot[];
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
    if (!AWAITING_OUTCOME_STATUSES.includes(submission.status)) continue;
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

/**
 * The rows a `?queue=` value shows. "all" is the whole queue; a category shows
 * everything in it and nothing else, in the queue's own order, so the visible
 * list is the proof of the count beside the filter.
 */
export function filterWorkQueue(
  queue: readonly WorkQueueItem[],
  filter: WorkQueueFilter,
): readonly WorkQueueItem[] {
  if (filter === "all") return queue;
  return queue.filter((item) => item.category === filter);
}

/** The strip at the foot of the queue: three sums, no forecasts. */
export function buildMoneySummary(
  payments: readonly PaymentWithAllocations[],
  submissions: readonly Submission[],
): WorkQueueMoneySummary {
  const awaiting = payments.filter((payment) => OUTSTANDING.includes(payment.status));
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
      AWAITING_OUTCOME_STATUSES.includes(submission.status),
    ).length,
  };
}

/**
 * Median minutes from the start of a shoot to its first dispatch. Pure; the
 * definition `getMedianDispatchMinutes` has always used.
 */
export function medianDispatchMinutes(
  submissions: readonly Submission[],
  shoots: readonly Pick<Shoot, "id" | "startsAt">[],
  packages: readonly Pick<DispatchPackage, "id" | "shootId">[],
): number {
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

/**
 * The header figures, from records already in hand. Each definition is the
 * one `getMoneySummary` uses for the Money screen, so the two screens can
 * never disagree about what was received or what is outstanding.
 */
export function buildWorkPulse(
  facts: Pick<WorkQueueFacts, "payments" | "submissions" | "shoots" | "packages">,
): WorkPulse {
  const { payments } = facts;
  const received = payments.filter((payment) => RECEIVED.includes(payment.status));
  const outstanding = payments.filter((payment) => OUTSTANDING.includes(payment.status));
  const unmatched = payments.filter(
    (payment) => payment.source === "statement" && payment.unallocated.minor > 0,
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
    unmatched: sum(
      unmatched.map((payment) => payment.unallocated),
      "USD",
    ),
    overdueCount: payments.filter((payment) => payment.status === "overdue").length,
    medianDispatchMinutes: medianDispatchMinutes(facts.submissions, facts.shoots, facts.packages),
  };
}

export interface DeliveryRef {
  readonly id: string;
  readonly submissionId: string;
  readonly recipientLabel?: string;
}

export interface AccessEventRow {
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
