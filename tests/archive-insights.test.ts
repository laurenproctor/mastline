/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { archiveInsights, searchArchive } from "../src/lib/data/archive";
import { ORG_A, ORG_B, clientFor, hasLocalSupabase } from "./helpers/supabase";

/**
 * The insights rail is built from the same search the grid uses, so what it
 * counts and what a filter shows can never disagree. These check that claim
 * against the seeded workspace, and that the figures are the workspace's own.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

describeIf("the archive's figures", () => {
  it("agree with the filters they link to", async () => {
    const owner = await clientFor("owner");
    const [insights, all, earning, unsold] = await Promise.all([
      archiveInsights(ORG_A, owner),
      searchArchive(ORG_A, {}, owner),
      searchArchive(ORG_A, { filter: "earning" }, owner),
      searchArchive(ORG_A, { filter: "unsold" }, owner),
    ]);

    expect(insights.totalAssets).toBe(all.total);
    expect(insights.earningAssets).toBe(earning.total);
    expect(insights.unsoldAssets).toBe(unsold.total);
    // The seed records a payment against one Hotel Chelsea frame.
    expect(insights.earningAssets).toBeGreaterThan(0);
    expect(insights.earningAssets + insights.unsoldAssets).toBeLessThanOrEqual(
      insights.totalAssets,
    );
  });

  it("brackets the capture dates the workspace actually holds", async () => {
    const owner = await clientFor("owner");
    const [insights, all] = await Promise.all([
      archiveInsights(ORG_A, owner),
      searchArchive(ORG_A, { pageSize: 100 }, owner),
    ]);
    const captured = all.results
      .map((result) => result.capturedAt)
      .filter((value): value is string => Boolean(value))
      .sort();

    expect(insights.oldestCapturedAt).toBeDefined();
    expect(insights.latestCapturedAt).toBeDefined();
    expect(Date.parse(insights.oldestCapturedAt!)).toBe(Date.parse(captured[0]));
    expect(Date.parse(insights.latestCapturedAt!)).toBe(Date.parse(captured[captured.length - 1]));
  });

  it("are the workspace's own, not the other tenant's", async () => {
    const owner = await clientFor("owner");
    const [a, b] = await Promise.all([
      archiveInsights(ORG_A, owner),
      archiveInsights(ORG_B, owner),
    ]);
    expect(a.totalAssets).toBeGreaterThan(0);
    // Marcus is not a member of org B, so the policies show him nothing there.
    expect(b.totalAssets).toBe(0);
    expect(b.earningAssets).toBe(0);
    expect(b.oldestCapturedAt).toBeUndefined();
  });
});
