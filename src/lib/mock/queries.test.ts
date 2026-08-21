import { describe, expect, it } from "vitest";
import { formatMoney } from "../money";
import { calculateSalesEngineSplit } from "../sales-engine";
import { LICENSES, PACKAGES, PAYMENTS, SUBMISSIONS } from "./fixtures";
import {
  allocatedTotal,
  getMedianSubmissionMinutes,
  getReviewablePackageForShoot,
  getArchiveRevenue,
  getAssetLifetimeEarnings,
  getMoneySummary,
  getRevenueBySource,
  getShootProgress,
  getWorkQueue,
  listReceivables,
  unallocatedRemainder,
} from "./queries";

describe("money summary derives from connected records", () => {
  it("nets received payments to $8,420", async () => {
    const summary = await getMoneySummary();
    expect(formatMoney(summary.netReceived)).toBe("$8,420");
  });

  it("totals outstanding receivables to $3,180", async () => {
    const summary = await getMoneySummary();
    expect(formatMoney(summary.outstanding)).toBe("$3,180");
  });

  it("counts the overdue invoices", async () => {
    const summary = await getMoneySummary();
    expect(summary.overdueCount).toBe(1);
  });

  it("reports unmatched statement value as the unallocated remainder only", async () => {
    const summary = await getMoneySummary();
    const expected = PAYMENTS.filter((payment) => payment.source === "statement").reduce(
      (total, payment) => total + unallocatedRemainder(payment).minor,
      0,
    );
    expect(summary.unmatchedStatementTotal.minor).toBe(expected);
  });

  it("never reports a negative average time to payment for settled invoices", async () => {
    const summary = await getMoneySummary();
    expect(summary.averageDaysToPayment).toBeGreaterThan(0);
  });
});

describe("revenue by source", () => {
  it("sums back to net received", async () => {
    const [sources, summary] = await Promise.all([getRevenueBySource(), getMoneySummary()]);
    const total = sources.reduce((sum, source) => sum + source.amount.minor, 0);
    expect(total).toBe(summary.netReceived.minor);
  });

  it("separates direct licenses and rights recovery from agency revenue", async () => {
    const labels = (await getRevenueBySource()).map((source) => source.label);
    expect(labels).toContain("Direct licenses");
    expect(labels).toContain("Rights recovery");
    expect(labels).toContain("Backgrid");
  });

  it("returns sources largest first", async () => {
    const amounts = (await getRevenueBySource()).map((source) => source.amount.minor);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });
});

describe("the Sales Engine share is only taken on Mastline-generated licenses", () => {
  it("charges the recorded platform fee on the direct license and nothing elsewhere", () => {
    const direct = LICENSES.find((license) => license.origin === "mastline_sales_engine");
    const external = LICENSES.find((license) => license.origin === "external");
    expect(direct).toBeDefined();
    expect(external).toBeDefined();
    expect(calculateSalesEngineSplit(external!.saleBase, external!.origin).platform.minor).toBe(0);
  });

  it("records a platform fee on the payment matching the computed 30% share", () => {
    const direct = LICENSES.find((license) => license.origin === "mastline_sales_engine")!;
    const split = calculateSalesEngineSplit(direct.saleBase, direct.origin);
    const payment = PAYMENTS.find((candidate) => candidate.source === "checkout")!;
    expect(payment.platformFee.minor).toBe(split.platform.minor);
    expect(payment.net.minor).toBe(split.photographer.minor);
  });

  it("takes no platform fee on any agency or statement payment", () => {
    for (const payment of PAYMENTS.filter((candidate) => candidate.source !== "checkout")) {
      expect(payment.platformFee.minor).toBe(0);
    }
  });
});

describe("allocations", () => {
  it("never allocates more than a payment's net", () => {
    for (const payment of PAYMENTS) {
      expect(allocatedTotal(payment).minor).toBeLessThanOrEqual(payment.net.minor);
    }
  });

  it("derives asset lifetime earnings from allocations", async () => {
    const earnings = await getAssetLifetimeEarnings("ast_nyfw_221");
    expect(earnings.minor).toBe(62_000);
  });

  it("returns zero for an asset that has never earned", async () => {
    const earnings = await getAssetLifetimeEarnings("ast_chelsea_470");
    expect(earnings.minor).toBe(0);
  });

  it("counts archive revenue from assets captured before the current period", async () => {
    const archive = await getArchiveRevenue();
    expect(archive.minor).toBeGreaterThan(0);
  });
});

describe("receivables", () => {
  it("orders the most overdue first", async () => {
    const receivables = await listReceivables();
    const days = receivables.map((receivable) => receivable.daysOverdue);
    expect([...days].sort((a, b) => b - a)).toEqual(days);
  });

  it("flags the Mega invoice as overdue and the Backgrid invoice as not", async () => {
    const receivables = await listReceivables();
    const mega = receivables.find((receivable) => receivable.buyerName === "The Mega Agency");
    const backgrid = receivables.find((receivable) => receivable.buyerName === "Backgrid");
    expect(mega?.daysOverdue).toBeGreaterThan(0);
    expect(backgrid?.daysOverdue).toBe(0);
  });
});

describe("shoot progress", () => {
  it("derives caption completeness from the selected assets", async () => {
    const progress = await getShootProgress("sht_chelsea");
    expect(progress?.selectedCount).toBe(18);
    expect(progress?.captionedCount).toBe(11);
    expect(progress?.captionCompletionPercent).toBe(61);
    expect(progress?.warningCount).toBe(7);
  });

  it("returns null for an unknown shoot", async () => {
    expect(await getShootProgress("sht_missing")).toBeNull();
  });
});

describe("work queue", () => {
  it("puts the urgent item first", async () => {
    const queue = await getWorkQueue();
    expect(queue[0]?.urgent).toBe(true);
  });

  it("explains why every item is ranked", async () => {
    for (const item of await getWorkQueue()) {
      expect(item.rankingBasis.length).toBeGreaterThan(10);
    }
  });

  it("links every item to a real destination", async () => {
    for (const item of await getWorkQueue()) {
      expect(item.href).toMatch(/^\//);
    }
  });
});

describe("the record graph stays internally consistent", () => {
  it("only creates a submission from a package that was approved", () => {
    for (const submission of SUBMISSIONS) {
      const pkg = PACKAGES.find((candidate) => candidate.id === submission.packageId);
      expect(pkg, `submission ${submission.reference} has no package`).toBeDefined();
      if (submission.sentAt) {
        expect(pkg!.approvedAt, `${pkg!.name} was never approved`).toBeDefined();
        expect(pkg!.approvedBy).toBeDefined();
      }
    }
  });

  it("never sends a submission before its package was approved", () => {
    for (const submission of SUBMISSIONS) {
      if (!submission.sentAt) continue;
      const pkg = PACKAGES.find((candidate) => candidate.id === submission.packageId)!;
      expect(new Date(submission.sentAt).getTime()).toBeGreaterThanOrEqual(
        new Date(pkg.approvedAt!).getTime(),
      );
    }
  });

  it("ships only asset versions the package actually contained", () => {
    for (const submission of SUBMISSIONS) {
      const pkg = PACKAGES.find((candidate) => candidate.id === submission.packageId)!;
      const packaged = new Set(pkg.assets.map((entry) => entry.assetVersionId));
      for (const entry of submission.manifest) {
        expect(packaged.has(entry.assetVersionId)).toBe(true);
      }
    }
  });

  it("delivers before it acknowledges", () => {
    for (const submission of SUBMISSIONS) {
      if (!submission.sentAt || !submission.deliveredAt) continue;
      expect(new Date(submission.deliveredAt).getTime()).toBeGreaterThanOrEqual(
        new Date(submission.sentAt).getTime(),
      );
    }
  });

  it("opens the package that still needs work, not one already delivered", async () => {
    const pkg = await getReviewablePackageForShoot("sht_chelsea");
    expect(pkg?.status).toBe("needs_review");
  });
});

describe("median submission time", () => {
  it("reports a plausible capture-to-dispatch figure", async () => {
    const minutes = await getMedianSubmissionMinutes();
    expect(minutes).toBeGreaterThan(0);
    // A dispatch measured in days means the metric or the data is wrong.
    expect(minutes).toBeLessThan(24 * 60);
  });

  it("is the median of the recorded dispatches", async () => {
    expect(await getMedianSubmissionMinutes()).toBe(19);
  });
});
