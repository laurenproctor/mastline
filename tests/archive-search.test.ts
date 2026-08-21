/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { searchArchive } from "../src/lib/data/archive";
import {
  ORG_A,
  ORG_B,
  clientFor,
  hasLocalSupabase,
  purgeShoot,
  serviceClient,
} from "./helpers/supabase";

/**
 * Archive search happens in the database.
 *
 * The previous version fetched every asset and filtered in JavaScript, so these
 * check the two things that broke: that a search only returns what matches, and
 * that a page is a page rather than the whole workspace.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const shoots: string[] = [];

afterAll(async () => {
  for (const shootId of shoots) await purgeShoot(shootId);
});

describeIf("searching", () => {
  it("finds an asset by a word in its caption", async () => {
    const owner = await clientFor("owner");
    const page = await searchArchive(ORG_A, { query: "Hotel Chelsea" }, owner);
    expect(page.total).toBeGreaterThan(0);
    expect(page.results.some((r) => r.canonicalFilename.startsWith("MH_0819"))).toBe(true);
  });

  it("finds an asset by a named subject", async () => {
    const owner = await clientFor("owner");
    const page = await searchArchive(ORG_A, { query: "Avery Hart" }, owner);
    expect(page.total).toBeGreaterThan(0);
  });

  it("finds an asset by its filename", async () => {
    const owner = await clientFor("owner");
    const page = await searchArchive(ORG_A, { query: "MH_0818_0221" }, owner);
    expect(page.results.map((r) => r.canonicalFilename)).toContain("MH_0818_0221");
  });

  it("returns nothing for a word that appears nowhere", async () => {
    const owner = await clientFor("owner");
    const page = await searchArchive(ORG_A, { query: "zeppelin" }, owner);
    expect(page.total).toBe(0);
    expect(page.results).toHaveLength(0);
  });

  it("returns everything when there is no query", async () => {
    const owner = await clientFor("owner");
    const page = await searchArchive(ORG_A, {}, owner);
    expect(page.total).toBeGreaterThanOrEqual(3);
  });

  it("carries commercial state, not just pixels", async () => {
    const owner = await clientFor("owner");
    const page = await searchArchive(ORG_A, { query: "Avery Hart" }, owner);
    const earning = page.results.find((r) => r.lifetimeEarnings.minor > 0);
    expect(earning).toBeDefined();
    expect(earning!.lifetimeEarnings.minor).toBe(44_800);
  });
});

describeIf("filtering", () => {
  it("separates assets that have earned from those that have not", async () => {
    const owner = await clientFor("owner");
    const [all, unsold, earning] = await Promise.all([
      searchArchive(ORG_A, { filter: "all" }, owner),
      searchArchive(ORG_A, { filter: "unsold" }, owner),
      searchArchive(ORG_A, { filter: "earning" }, owner),
    ]);

    expect(unsold.total + earning.total).toBe(all.total);
    for (const result of unsold.results) expect(result.lifetimeEarnings.minor).toBe(0);
    for (const result of earning.results) expect(result.lifetimeEarnings.minor).toBeGreaterThan(0);
  });

  it("combines a search with a filter", async () => {
    const owner = await clientFor("owner");
    const page = await searchArchive(ORG_A, { query: "Avery Hart", filter: "earning" }, owner);
    expect(page.total).toBe(1);
  });
});

describeIf("pagination", () => {
  it("returns a page rather than the whole workspace", async () => {
    const service = serviceClient();
    const owner = await clientFor("owner");

    const { data: shoot } = await service
      .from("shoots")
      .insert({
        organization_id: ORG_A,
        title: `Paging ${Date.now()}`,
        status: "preparing",
        created_by: OWNER,
      })
      .select("id")
      .single();
    shoots.push(shoot!.id as string);

    const rows = Array.from({ length: 12 }, (_, index) => ({
      organization_id: ORG_A,
      shoot_id: shoot!.id,
      status: "active" as const,
      canonical_filename: `PAGE_${String(index).padStart(3, "0")}`,
      captured_at: new Date(Date.now() - index * 60_000).toISOString(),
      caption: "A paging fixture frame.",
      created_by: OWNER,
    }));
    await service.from("assets").insert(rows);

    const first = await searchArchive(
      ORG_A,
      { query: "paging fixture", pageSize: 5, page: 1 },
      owner,
    );
    expect(first.results).toHaveLength(5);
    expect(first.total).toBe(12);
    expect(first.totalPages).toBe(3);

    const third = await searchArchive(
      ORG_A,
      { query: "paging fixture", pageSize: 5, page: 3 },
      owner,
    );
    expect(third.results).toHaveLength(2);
    expect(third.total).toBe(12);

    // No overlap between pages.
    const firstIds = new Set(first.results.map((r) => r.assetId));
    for (const result of third.results) expect(firstIds.has(result.assetId)).toBe(false);
  });

  it("caps the page size so a caller cannot ask for everything", async () => {
    const owner = await clientFor("owner");
    const page = await searchArchive(ORG_A, { pageSize: 10_000 }, owner);
    expect(page.pageSize).toBeLessThanOrEqual(100);
  });

  it("returns an empty page past the end rather than failing", async () => {
    const owner = await clientFor("owner");
    const page = await searchArchive(ORG_A, { page: 999 }, owner);
    expect(page.results).toHaveLength(0);
  });
});

describeIf("isolation", () => {
  /**
   * The function is security invoker, so a search can never become a way to
   * read another workspace.
   */
  it("returns nothing when searching another workspace", async () => {
    const owner = await clientFor("owner");
    const page = await searchArchive(ORG_B, { query: "Northline" }, owner);
    expect(page.total).toBe(0);
  });

  it("does not surface another workspace's assets in an unfiltered search", async () => {
    const owner = await clientFor("owner");
    const page = await searchArchive(ORG_A, { pageSize: 100 }, owner);
    expect(page.results.some((r) => r.canonicalFilename.startsWith("NL_"))).toBe(false);
  });

  it("hides a tombstoned asset", async () => {
    const service = serviceClient();
    const owner = await clientFor("owner");

    const { data: shoot } = await service
      .from("shoots")
      .insert({
        organization_id: ORG_A,
        title: `Tombstone search ${Date.now()}`,
        status: "preparing",
        created_by: OWNER,
      })
      .select("id")
      .single();
    shoots.push(shoot!.id as string);

    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_A,
        shoot_id: shoot!.id,
        status: "active",
        canonical_filename: `TOMBSEARCH_${Date.now()}`,
        caption: "A distinctive quokka reference.",
        created_by: OWNER,
      })
      .select("id")
      .single();

    const before = await searchArchive(ORG_A, { query: "quokka" }, owner);
    expect(before.total).toBe(1);

    await service
      .from("assets")
      .update({ status: "tombstoned", tombstone_reason: "test" })
      .eq("id", asset!.id);

    const after = await searchArchive(ORG_A, { query: "quokka" }, owner);
    expect(after.total).toBe(0);
  });
});
