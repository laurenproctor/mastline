/** @vitest-environment node */
import { afterAll, describe, expect, it } from "vitest";
import { listAssets } from "@/lib/data/assets";
import { ORG_A, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * The export stops carrying file digests once a workspace gets real.
 *
 * listAssets looks up versions and lifetime earnings with `.in("asset_id",
 * ids)`, and PostgREST puts that list in the URL -- about 37 bytes per id.
 * Kong answers 414 past roughly 8KB, which lands at about 215 assets. Measured
 * on the local stack: 210 ids is 7,839 bytes and answers 200; 220 ids is 8,209
 * and answers 414.
 *
 * On its own that is a bug you can see. What made it dangerous is that both
 * call sites destructured `{ data }` and never read `error`, so the refusal
 * became an empty array: every asset silently reported having no versions and
 * no earnings. The workspace export -- which the README promises carries "every
 * asset record with its file hashes and object keys" -- shipped without a
 * single digest, and nothing failed anywhere.
 *
 * A photographer with 215 frames is a small workspace, so this is the size at
 * which the portability promise quietly stopped being true.
 *
 * The threshold is the whole point of this test, which is why it builds a
 * workspace past it rather than trusting a unit test about batching.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const SHOOT = "d0000000-0000-0000-0000-00000000ab01";
/* Comfortably past the measured 414 boundary. */
const COUNT = 240;

describeIf("reading a workspace larger than one URL", () => {
  afterAll(async () => {
    await purgeShoot(SHOOT);
  });

  it("returns every asset's versions past the point the URL stops fitting", async () => {
    const service = serviceClient();
    const { data: owner } = await service
      .from("memberships")
      .select("user_id")
      .eq("organization_id", ORG_A)
      .eq("role", "owner")
      .limit(1)
      .single();
    const actor = owner!.user_id;

    await service
      .from("shoots")
      .upsert(
        { id: SHOOT, organization_id: ORG_A, title: "Scale probe", created_by: actor },
        { onConflict: "id" },
      );

    const assets = Array.from({ length: COUNT }, (_, i) => ({
      id: `d1000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      organization_id: ORG_A,
      shoot_id: SHOOT,
      status: "active",
      canonical_filename: `SCALE_${String(i).padStart(4, "0")}.jpg`,
      created_by: actor,
    }));
    const versions = assets.map((asset, i) => ({
      id: `d2000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      organization_id: ORG_A,
      asset_id: asset.id,
      version_kind: "original",
      storage_bucket: "originals",
      object_key: `${ORG_A}/${SHOOT}/SCALE_${String(i).padStart(4, "0")}.arw`,
      // A stable 64-character digest. Nothing fetches these bytes.
      sha256: String(i).padStart(2, "0").repeat(32).slice(0, 64),
      bytes: 1_000_000 + i,
      mime_type: "image/jpeg",
      created_by: actor,
    }));

    // Inserted in chunks for the same reason the fix exists: a single insert of
    // 240 rows is a large request too.
    for (let start = 0; start < COUNT; start += 60) {
      const a = await service.from("assets").upsert(assets.slice(start, start + 60), {
        onConflict: "id",
      });
      expect(a.error?.message ?? null).toBeNull();
      const v = await service.from("asset_versions").upsert(versions.slice(start, start + 60), {
        onConflict: "id",
      });
      expect(v.error?.message ?? null).toBeNull();
    }

    const read = await listAssets(ORG_A, { shootId: SHOOT }, service);

    expect(read).toHaveLength(COUNT);
    // The assertion that would have caught it: before the fix every one of
    // these came back with an empty versions array and no error anywhere.
    const withoutVersions = read.filter((asset) => asset.versions.length === 0);
    expect(withoutVersions.map((asset) => asset.canonicalFilename)).toEqual([]);

    for (const asset of read) {
      expect(asset.versions[0]?.sha256, asset.canonicalFilename).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("raises rather than reporting an empty result when a lookup fails", async () => {
    // The half that did the damage. A refused request must not read as "this
    // asset has no versions"; the unit tests around selectByIds cover the
    // mechanism, and this records why it matters here.
    const { selectByIds } = await import("@/lib/in-batches");
    await expect(
      selectByIds(["a"], "asset versions", async () => ({
        data: null,
        error: { message: "URI too large" },
      })),
    ).rejects.toThrow(/Could not load asset versions/);
  });
});
