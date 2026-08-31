/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import type { Asset, DispatchPackage, Shoot, Submission } from "../src/lib/domain";
import type { PaymentWithAllocations } from "../src/lib/data/money";
import {
  type WorkQueueFacts,
  buildMoneySummary,
  buildRecipientActivity,
  buildWorkPulse,
  buildWorkQueue,
  filterWorkQueue,
  isWorkQueueFilter,
  medianDispatchMinutes,
  workQueueCounts,
} from "../src/lib/data/work-queue-ranking";
import { money, zero } from "../src/lib/money";
import { workspaceRoutes } from "../src/lib/workspace-routes";

/**
 * The deterministic ranking, exercised without a database.
 *
 * Every fixture is the minimum record that produces the state under test, and
 * every assertion reads the item's priority class or its stated basis -- the
 * two things the screen renders -- rather than private internals.
 */

const ORG = "org-test";
const routes = workspaceRoutes("test-studio");
const NOW = new Date("2026-08-28T12:00:00Z");

const shoot = (overrides: Partial<Shoot> & { id: string }): Shoot => ({
  organizationId: ORG,
  title: `Shoot ${overrides.id}`,
  status: "preparing",
  priority: "standard",
  targetBuyerIds: [],
  sensitiveContent: false,
  hasSensitiveNote: false,
  createdAt: "2026-08-27T09:00:00Z",
  updatedAt: "2026-08-27T10:00:00Z",
  ...overrides,
});

const completeAsset = (id: string, shootId: string, overrides: Partial<Asset> = {}): Asset => ({
  id,
  organizationId: ORG,
  shootId,
  status: "active",
  canonicalFilename: `${id}.jpg`,
  capturedAt: "2026-08-27T09:30:00Z",
  caption: "A complete caption a person has stood behind.",
  captionOrigin: "human",
  creditLine: "Test / Mastline",
  copyrightNotice: "© 2026 Test",
  subjects: [],
  keywords: [],
  selected: true,
  versions: [],
  captionHistory: [],
  lifetimeEarnings: money(0),
  ...overrides,
});

const pkg = (
  overrides: Partial<DispatchPackage> & { id: string; shootId: string },
): DispatchPackage => ({
  organizationId: ORG,
  name: `Package ${overrides.id}`,
  status: "needs_review",
  assets: [],
  ...overrides,
});

const submission = (
  overrides: Partial<Submission> & { id: string; packageId: string },
): Submission => ({
  organizationId: ORG,
  status: "queued",
  reference: `REF-${overrides.id}`,
  manifest: [],
  ...overrides,
});

const payment = (
  overrides: Partial<PaymentWithAllocations> & { id: string },
): PaymentWithAllocations => ({
  organizationId: ORG,
  status: "expected",
  source: "invoice",
  gross: money(100_00),
  deductions: zero(),
  platformFee: zero(),
  tax: zero(),
  net: money(100_00),
  allocations: [],
  allocatedTotal: zero(),
  unallocated: zero(),
  ...overrides,
});

const facts = (overrides: Partial<WorkQueueFacts>): WorkQueueFacts => ({
  shoots: [],
  selectedAssetsByShoot: new Map(),
  packages: [],
  submissions: [],
  deliveryCountBySubmission: new Map(),
  payments: [],
  requests: [],
  now: NOW,
  ...overrides,
});

describe("deterministic ranking", () => {
  it("puts a recorded failure first, whatever else exists", () => {
    const queue = buildWorkQueue(
      facts({
        shoots: [shoot({ id: "s1" })],
        selectedAssetsByShoot: new Map([
          ["s1", [completeAsset("a1", "s1", { caption: undefined })]],
        ]),
        packages: [pkg({ id: "p1", shootId: "s1" })],
        submissions: [
          submission({
            id: "sub-failed",
            packageId: "p1",
            status: "failed",
            sentAt: "2026-08-20T10:00:00Z",
          }),
          submission({
            id: "sub-late",
            packageId: "p1",
            status: "delivered",
            sentAt: "2026-08-21T10:00:00Z",
            followUpAt: "2026-08-25T10:00:00Z",
          }),
        ],
        payments: [
          payment({ id: "pay-overdue", status: "overdue", dueAt: "2026-08-16T00:00:00Z" }),
        ],
      }),
      routes,
    );

    expect(queue[0].id).toBe("wq_failed_sub-failed");
    expect(queue[0].priority).toBe(1);
    expect(queue[0].urgent).toBe(true);
    expect(queue[0].rankingBasis).toBe("A recorded delivery failure");
  });

  it("ranks an overdue payment above ordinary unfinished work", () => {
    const queue = buildWorkQueue(
      facts({
        shoots: [shoot({ id: "s1" })],
        selectedAssetsByShoot: new Map([
          ["s1", [completeAsset("a1", "s1", { caption: undefined })]],
        ]),
        payments: [
          payment({ id: "pay-overdue", status: "overdue", dueAt: "2026-08-16T00:00:00Z" }),
        ],
      }),
      routes,
    );

    expect(queue.map((item) => item.priority)).toEqual([2, 4]);
    expect(queue[0].id).toBe("wq_overdue_pay-overdue");
    expect(queue[0].urgent).toBe(true);
    expect(queue[0].rankingBasis).toBe("Payment is past its recorded due date");
  });

  it("promotes a submission whose explicit follow-up date has passed", () => {
    const queue = buildWorkQueue(
      facts({
        submissions: [
          submission({
            id: "sub-late",
            packageId: "p1",
            status: "delivered",
            sentAt: "2026-08-21T10:00:00Z",
            followUpAt: "2026-08-25T10:00:00Z",
          }),
          submission({
            id: "sub-waiting",
            packageId: "p1",
            status: "sent",
            sentAt: "2026-08-27T10:00:00Z",
            followUpAt: "2026-09-05T10:00:00Z",
          }),
        ],
      }),
      routes,
    );

    expect(queue[0].id).toBe("wq_outcome_sub-late");
    expect(queue[0].priority).toBe(3);
    expect(queue[0].urgent).toBe(true);
    expect(queue[0].rankingBasis).toBe("The explicit follow-up date has passed");

    expect(queue[1].id).toBe("wq_outcome_sub-waiting");
    expect(queue[1].priority).toBe(7);
    expect(queue[1].urgent).toBe(false);
  });

  it("finds metadata blockers with the shared metadata rules", () => {
    const blocked = completeAsset("a-blocked", "s1", { caption: undefined });
    const readyOnly = buildWorkQueue(
      facts({
        shoots: [shoot({ id: "s1" })],
        selectedAssetsByShoot: new Map([["s1", [completeAsset("a-ready", "s1")]]]),
      }),
      routes,
    );
    expect(readyOnly.find((item) => item.id.startsWith("wq_captions"))).toBeUndefined();

    const withBlocker = buildWorkQueue(
      facts({
        shoots: [shoot({ id: "s1" })],
        selectedAssetsByShoot: new Map([["s1", [completeAsset("a-ready", "s1"), blocked]]]),
      }),
      routes,
    );
    const item = withBlocker.find((entry) => entry.id === "wq_captions_s1");
    expect(item).toBeDefined();
    expect(item?.priority).toBe(4);
    expect(item?.category).toBe("in-preparation");
    expect(item?.detail).toBe("1 of 2 selected photos missing required metadata");
  });

  it("treats an unreviewed drafted caption as a blocker, exactly as dispatch does", () => {
    const drafted = completeAsset("a-drafted", "s1", {
      captionOrigin: "model",
      captionDraftedAt: "2026-08-27T09:31:00Z",
      captionReviewedAt: undefined,
      captionAwaitsReview: true,
    });
    const queue = buildWorkQueue(
      facts({
        shoots: [shoot({ id: "s1" })],
        selectedAssetsByShoot: new Map([["s1", [drafted]]]),
      }),
      routes,
    );
    expect(queue.find((item) => item.id === "wq_captions_s1")).toBeDefined();
  });

  it("detects a recorded submission with no recipient delivery link", () => {
    const base = facts({
      submissions: [submission({ id: "sub-q", packageId: "p1", status: "queued" })],
    });

    const without = buildWorkQueue(base, routes);
    const item = without.find((entry) => entry.id === "wq_nolink_sub-q");
    expect(item).toBeDefined();
    expect(item?.priority).toBe(6);
    expect(item?.category).toBe("ready-to-send");
    expect(item?.actionLabel).toBe("Create link");
    expect(item?.rankingBasis).toBe("A recorded submission with no recipient delivery link");

    const withLink = buildWorkQueue(
      { ...base, deliveryCountBySubmission: new Map([["sub-q", 1]]) },
      routes,
    );
    expect(withLink.find((entry) => entry.id === "wq_nolink_sub-q")).toBeUndefined();
  });

  it("detects received money with an unallocated balance, and only that", () => {
    const queue = buildWorkQueue(
      facts({
        payments: [
          payment({
            id: "pay-part",
            status: "received",
            receivedAt: "2026-08-26T00:00:00Z",
            unallocated: money(50_00),
          }),
          payment({
            id: "pay-done",
            status: "received",
            receivedAt: "2026-08-26T00:00:00Z",
            unallocated: zero(),
          }),
          // Not yet received: nothing to allocate, whatever its balance shows.
          payment({ id: "pay-expected", status: "expected", unallocated: money(10_00) }),
        ],
      }),
      routes,
    );

    expect(queue.map((item) => item.id)).toEqual(["wq_unallocated_pay-part"]);
    expect(queue[0].priority).toBe(8);
    expect(queue[0].category).toBe("money");
  });

  it("ranks package review above a missing link, and both above quiet waiting", () => {
    const queue = buildWorkQueue(
      facts({
        shoots: [shoot({ id: "s1" })],
        selectedAssetsByShoot: new Map([["s1", [completeAsset("a1", "s1")]]]),
        packages: [pkg({ id: "p-review", shootId: "s1", status: "needs_review" })],
        submissions: [
          submission({ id: "sub-q", packageId: "p-other", status: "queued" }),
          submission({
            id: "sub-wait",
            packageId: "p-other",
            status: "sent",
            sentAt: "2026-08-27T10:00:00Z",
          }),
        ],
      }),
      routes,
    );

    expect(queue.map((item) => item.id)).toEqual([
      "wq_dispatch_p-review",
      "wq_nolink_sub-q",
      "wq_outcome_sub-wait",
    ]);
  });

  it("orders equal priorities by most recent activity, then id", () => {
    const queue = buildWorkQueue(
      facts({
        submissions: [
          submission({
            id: "sub-old",
            packageId: "p1",
            status: "sent",
            sentAt: "2026-08-20T10:00:00Z",
          }),
          submission({
            id: "sub-new",
            packageId: "p1",
            status: "sent",
            sentAt: "2026-08-27T10:00:00Z",
          }),
        ],
      }),
      routes,
    );
    expect(queue.map((item) => item.id)).toEqual(["wq_outcome_sub-new", "wq_outcome_sub-old"]);
  });

  it("gives every item a workspace-scoped destination and a stated basis", () => {
    const queue = buildWorkQueue(
      facts({
        shoots: [shoot({ id: "s1" }), shoot({ id: "s2", status: "ingesting" })],
        selectedAssetsByShoot: new Map([
          ["s1", [completeAsset("a1", "s1", { caption: undefined })]],
        ]),
        packages: [
          pkg({ id: "p1", shootId: "s1", status: "needs_review" }),
          pkg({ id: "p2", shootId: "s1", status: "draft" }),
        ],
        submissions: [
          submission({
            id: "sub-f",
            packageId: "p1",
            status: "failed",
            sentAt: "2026-08-20T10:00:00Z",
          }),
          submission({ id: "sub-q", packageId: "p1", status: "queued" }),
        ],
        payments: [
          payment({ id: "pay-o", status: "overdue", dueAt: "2026-08-16T00:00:00Z" }),
          payment({ id: "pay-u", status: "received", unallocated: money(5_00) }),
        ],
      }),
      routes,
    );

    expect(queue.length).toBeGreaterThanOrEqual(7);
    for (const item of queue) {
      expect(item.href.startsWith("/test-studio/"), item.id).toBe(true);
      expect(item.rankingBasis.length, item.id).toBeGreaterThan(0);
    }
    // Nothing in the queue speculates: no scores, no predictions, no views.
    const rendered = JSON.stringify(queue).toLowerCase();
    for (const forbidden of ["viewed", "probability", "intent", "predicted", "estimated"]) {
      expect(rendered).not.toContain(forbidden);
    }
  });

  it("counts by category without changing the queue", () => {
    const queue = buildWorkQueue(
      facts({
        shoots: [shoot({ id: "s1" })],
        selectedAssetsByShoot: new Map([
          ["s1", [completeAsset("a1", "s1", { caption: undefined })]],
        ]),
        submissions: [
          submission({ id: "sub-q", packageId: "p1", status: "queued" }),
          submission({
            id: "sub-w",
            packageId: "p1",
            status: "sent",
            sentAt: "2026-08-27T10:00:00Z",
          }),
        ],
        payments: [payment({ id: "pay-o", status: "overdue", dueAt: "2026-08-16T00:00:00Z" })],
      }),
      routes,
    );

    const counts = workQueueCounts(queue);
    expect(counts.all).toBe(queue.length);
    expect(counts.inPreparation + counts.readyToSend + counts.awaitingOutcome + counts.money).toBe(
      counts.all,
    );
    expect(counts.inPreparation).toBe(1);
    expect(counts.readyToSend).toBe(1);
    expect(counts.awaitingOutcome).toBe(1);
    expect(counts.money).toBe(1);
  });

  it("is the same queue however many times it is built", () => {
    const input = facts({
      shoots: [shoot({ id: "s2", status: "ingesting" }), shoot({ id: "s1" })],
      selectedAssetsByShoot: new Map([["s1", [completeAsset("a1", "s1", { caption: undefined })]]]),
      packages: [
        pkg({ id: "p1", shootId: "s1", status: "needs_review" }),
        pkg({ id: "p2", shootId: "s1", status: "draft" }),
      ],
      submissions: [
        submission({
          id: "sub-a",
          packageId: "p1",
          status: "sent",
          sentAt: "2026-08-27T10:00:00Z",
        }),
        submission({
          id: "sub-b",
          packageId: "p1",
          status: "sent",
          sentAt: "2026-08-27T10:00:00Z",
        }),
        submission({ id: "sub-q", packageId: "p1", status: "queued" }),
      ],
      payments: [payment({ id: "pay-u", status: "received", unallocated: money(5_00) })],
    });
    const first = buildWorkQueue(input, routes).map((item) => item.id);
    const again = buildWorkQueue(
      {
        ...input,
        submissions: [...input.submissions].reverse(),
        shoots: [...input.shoots].reverse(),
      },
      routes,
    ).map((item) => item.id);
    expect(again).toEqual(first);
    // Equal time, equal class: the id decides, and it decides the same way.
    expect(first.indexOf("wq_outcome_sub-a")).toBeLessThan(first.indexOf("wq_outcome_sub-b"));
    // The classes never run backwards.
    const priorities = buildWorkQueue(input, routes).map((item) => item.priority);
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
  });

  it("keeps urgency for the three facts that earn it, and nothing else", () => {
    const queue = buildWorkQueue(
      facts({
        shoots: [shoot({ id: "s1", priority: "urgent" })],
        selectedAssetsByShoot: new Map([
          ["s1", [completeAsset("a1", "s1", { caption: undefined })]],
        ]),
        packages: [pkg({ id: "p1", shootId: "s1", status: "needs_review" })],
        submissions: [submission({ id: "sub-q", packageId: "p1", status: "queued" })],
        payments: [payment({ id: "pay-u", status: "received", unallocated: money(5_00) })],
      }),
      routes,
    );
    expect(queue.length).toBeGreaterThan(0);
    for (const item of queue) expect(item.urgent, item.id).toBe(false);
  });
});

describe("the ?queue= filter contract", () => {
  it("accepts exactly the five documented values", () => {
    for (const value of ["all", "in-preparation", "ready-to-send", "awaiting-outcome", "money"]) {
      expect(isWorkQueueFilter(value), value).toBe(true);
    }
    for (const value of [undefined, "", "All", "money ", "in_preparation", "everything"]) {
      expect(isWorkQueueFilter(value), String(value)).toBe(false);
    }
  });

  it("shows a category in the queue's own order, and the count is the proof", () => {
    const queue = buildWorkQueue(
      facts({
        shoots: [shoot({ id: "s1" })],
        selectedAssetsByShoot: new Map([
          ["s1", [completeAsset("a1", "s1", { caption: undefined })]],
        ]),
        submissions: [
          submission({ id: "sub-q", packageId: "p1", status: "queued" }),
          submission({
            id: "sub-w",
            packageId: "p1",
            status: "sent",
            sentAt: "2026-08-27T10:00:00Z",
          }),
        ],
        payments: [
          payment({ id: "pay-o", status: "overdue", dueAt: "2026-08-16T00:00:00Z" }),
          payment({ id: "pay-u", status: "received", unallocated: money(5_00) }),
        ],
      }),
      routes,
    );
    const counts = workQueueCounts(queue);

    expect(filterWorkQueue(queue, "all")).toBe(queue);
    expect(filterWorkQueue(queue, "money").map((item) => item.id)).toEqual([
      "wq_overdue_pay-o",
      "wq_unallocated_pay-u",
    ]);
    expect(filterWorkQueue(queue, "money")).toHaveLength(counts.money);
    expect(filterWorkQueue(queue, "in-preparation")).toHaveLength(counts.inPreparation);
    expect(filterWorkQueue(queue, "ready-to-send")).toHaveLength(counts.readyToSend);
    expect(filterWorkQueue(queue, "awaiting-outcome")).toHaveLength(counts.awaitingOutcome);
    for (const item of filterWorkQueue(queue, "ready-to-send")) {
      expect(item.category).toBe("ready-to-send");
    }
  });
});

describe("the header pulse, from records already loaded", () => {
  it("uses the Money screen's definitions of received, outstanding, and unmatched", () => {
    const pulse = buildWorkPulse({
      payments: [
        payment({ id: "p1", status: "received", net: money(300_00), unallocated: zero() }),
        payment({
          id: "p2",
          status: "received",
          source: "statement",
          net: money(200_00),
          unallocated: money(50_00),
        }),
        // Received with a balance, but not from a statement: not "unmatched".
        payment({
          id: "p3",
          status: "received",
          source: "invoice",
          net: money(10_00),
          unallocated: money(10_00),
        }),
        payment({ id: "p4", status: "expected", net: money(100_00) }),
        payment({ id: "p5", status: "overdue", net: money(85_00) }),
        payment({ id: "p6", status: "reported", net: money(999_00) }),
      ],
      submissions: [],
      shoots: [],
      packages: [],
    });
    expect(pulse.netReceived.minor).toBe(510_00);
    expect(pulse.outstanding.minor).toBe(185_00);
    expect(pulse.unmatched.minor).toBe(50_00);
    expect(pulse.overdueCount).toBe(1);
    expect(pulse.medianDispatchMinutes).toBe(0);
  });

  it("takes the median from shoot start to first dispatch, over positive durations only", () => {
    const shoots = [
      { id: "s1", startsAt: "2026-08-27T09:00:00Z" },
      { id: "s2", startsAt: "2026-08-27T09:00:00Z" },
      { id: "s3", startsAt: undefined },
    ];
    const packages = [
      pkg({ id: "p1", shootId: "s1" }),
      pkg({ id: "p2", shootId: "s2" }),
      pkg({ id: "p3", shootId: "s3" }),
    ];
    const submissions = [
      submission({ id: "a", packageId: "p1", status: "sent", sentAt: "2026-08-27T09:30:00Z" }),
      submission({ id: "b", packageId: "p2", status: "sent", sentAt: "2026-08-27T10:30:00Z" }),
      // Sent before the shoot started: a data quirk, not a negative duration.
      submission({ id: "c", packageId: "p1", status: "sent", sentAt: "2026-08-27T08:00:00Z" }),
      // No start on the shoot, and never sent: both ignored.
      submission({ id: "d", packageId: "p3", status: "sent", sentAt: "2026-08-27T12:00:00Z" }),
      submission({ id: "e", packageId: "p1", status: "queued" }),
    ];
    expect(medianDispatchMinutes(submissions, shoots, packages)).toBe(60);
    expect(medianDispatchMinutes([], shoots, packages)).toBe(0);
  });
});

describe("money summary", () => {
  it("separates awaited money from received-but-unallocated money", () => {
    const summary = buildMoneySummary(
      [
        payment({ id: "p1", status: "expected", net: money(100_00) }),
        payment({ id: "p2", status: "overdue", net: money(85_00) }),
        payment({
          id: "p3",
          status: "received",
          net: money(60_00),
          unallocated: money(60_00),
        }),
        payment({ id: "p4", status: "received", net: money(40_00), unallocated: zero() }),
      ],
      [
        submission({ id: "s1", packageId: "p", status: "delivered" }),
        submission({ id: "s2", packageId: "p", status: "sold" }),
      ],
    );

    expect(summary.expectedNet.minor).toBe(185_00);
    expect(summary.expectedCount).toBe(2);
    expect(summary.unallocatedNet.minor).toBe(60_00);
    expect(summary.unallocatedCount).toBe(1);
    expect(summary.awaitingOutcomeCount).toBe(1);
  });
});

describe("recipient activity", () => {
  const deliveries = [
    { id: "d1", submissionId: "sub1", recipientLabel: "Page Six" },
    { id: "d2", submissionId: "sub1", recipientLabel: undefined },
  ];
  const submissions = [
    submission({ id: "sub1", packageId: "pkg1", recipientLabel: "NY picture desk" }),
  ];
  const packages = [pkg({ id: "pkg1", shootId: "s1", name: "Gigi Hadid in SoHo" })];

  it("renders opens, acceptances, and grouped downloads from recorded events only", () => {
    const rows = buildRecipientActivity(
      [
        { id: "e5", deliveryId: "d1", kind: "downloaded", occurredAt: "2026-08-28T11:00:00Z" },
        { id: "e4", deliveryId: "d1", kind: "downloaded", occurredAt: "2026-08-28T10:59:00Z" },
        { id: "e3", deliveryId: "d1", kind: "accepted", occurredAt: "2026-08-28T10:30:00Z" },
        { id: "e2", deliveryId: "d1", kind: "opened", occurredAt: "2026-08-28T10:00:00Z" },
        { id: "e1", deliveryId: "d2", kind: "refused", occurredAt: "2026-08-27T09:00:00Z" },
      ],
      deliveries,
      submissions,
      packages,
      routes,
    );

    expect(rows.map((row) => `${row.recipient} ${row.description}`)).toEqual([
      "Page Six downloaded 2 authorized files",
      "Page Six accepted the terms",
      "Page Six opened Gigi Hadid in SoHo",
      // No label on the link, so the submission's own snapshot names the desk.
      "NY picture desk was refused access",
    ]);
    // The grouped downloads carry the latest download's time.
    expect(rows[0].occurredAt).toBe("2026-08-28T11:00:00Z");
    // Every row leads to the submission, never to a token.
    for (const row of rows) {
      expect(row.href).toBe("/test-studio/submissions/sub1");
    }
    expect(JSON.stringify(rows)).not.toContain("token");
  });

  it("never claims a per-photo view", () => {
    const rows = buildRecipientActivity(
      [{ id: "e1", deliveryId: "d1", kind: "opened", occurredAt: "2026-08-28T10:00:00Z" }],
      deliveries,
      submissions,
      packages,
      routes,
    );
    expect(JSON.stringify(rows).toLowerCase()).not.toContain("view");
  });

  it("falls back to a neutral recipient when nothing names one", () => {
    const rows = buildRecipientActivity(
      [{ id: "e1", deliveryId: "d2", kind: "opened", occurredAt: "2026-08-28T10:00:00Z" }],
      deliveries,
      [submission({ id: "sub1", packageId: "pkg1" })],
      packages,
      routes,
    );
    expect(rows[0].recipient).toBe("A recipient");
  });
});
