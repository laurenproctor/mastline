/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { ensureDraftPackage, setPackageSelection } from "@/lib/data/packages";
import { ORG_A, clientFor, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * The delivery flow's draft: a reachable, persistent draft package whose
 * selection is reconciled rather than accumulated, and which freezes solid at
 * approval. These are the Increment A guarantees: a double-click or retry
 * lands on one draft, sending the same selection twice is the same selection,
 * and nothing about a draft survives editing once the package is approved.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const BACKGRID = "a0000000-0000-0000-0000-0000000000b1";
const createdShoots: string[] = [];

async function digest(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A shoot with `count` fully described, active assets, each with an original. */
async function shootWithAssets(label: string, count: number) {
  const service = serviceClient();
  const { data: shoot, error } = await service
    .from("shoots")
    .insert({
      organization_id: ORG_A,
      title: `${label} ${Date.now()}`,
      status: "preparing",
      starts_at: new Date(Date.now() - 3_600_000).toISOString(),
      created_by: OWNER,
    })
    .select("id")
    .single();
  if (error) throw error;
  const shootId = shoot!.id as string;
  createdShoots.push(shootId);

  const assetIds: string[] = [];
  const versionIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_A,
        shoot_id: shootId,
        status: "active",
        canonical_filename: `MH_${label}_${String(index).padStart(4, "0")}`,
        captured_at: new Date(Date.now() - 3_600_000 + index * 1000).toISOString(),
        caption: "A complete caption describing the frame.",
        credit_line: "Marcus Hale / Mastline",
        copyright_notice: "© 2026 Marcus Hale",
        selected: false,
        created_by: OWNER,
      })
      .select("id")
      .single();
    const assetId = asset!.id as string;
    assetIds.push(assetId);

    const { data: version } = await service
      .from("asset_versions")
      .insert({
        organization_id: ORG_A,
        asset_id: assetId,
        version_kind: "original",
        storage_bucket: "originals",
        object_key: `${ORG_A}/${shootId}/${label}-${index}.arw`,
        sha256: await digest(`${label}-${index}-${Date.now()}`),
        bytes: 1000,
        mime_type: "image/jpeg",
        created_by: OWNER,
      })
      .select("id")
      .single();
    versionIds.push(version!.id as string);
  }

  return { shootId, assetIds, versionIds };
}

async function memberRows(packageId: string) {
  const service = serviceClient();
  const { data } = await service
    .from("package_assets")
    .select("asset_id, asset_version_id, position")
    .eq("package_id", packageId)
    .order("position");
  return data ?? [];
}

afterAll(async () => {
  for (const shootId of createdShoots) await purgeShoot(shootId);
});

describeIf("the delivery flow draft package", () => {
  it("resumes the same draft rather than creating a second one", async () => {
    const owner = await clientFor("owner");
    const { shootId } = await shootWithAssets("draftresume", 1);

    const first = await ensureDraftPackage({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      shootId,
    });
    expect(first.created).toBe(true);

    const second = await ensureDraftPackage({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      shootId,
    });
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it("converges on one draft when two requests race", async () => {
    const owner = await clientFor("owner");
    const { shootId } = await shootWithAssets("draftrace", 1);

    const [a, b] = await Promise.all([
      ensureDraftPackage({ client: owner, organizationId: ORG_A, actorId: OWNER, shootId }),
      ensureDraftPackage({ client: owner, organizationId: ORG_A, actorId: OWNER, shootId }),
    ]);
    expect(a.id).toBe(b.id);

    const service = serviceClient();
    const { data: drafts } = await service
      .from("packages")
      .select("id")
      .eq("shoot_id", shootId)
      .eq("status", "draft");
    expect(drafts).toHaveLength(1);
    expect(drafts![0].id).toBe(a.id);
  });

  it("reconciles the selection: order is position, a repeat is a no-op, removal removes", async () => {
    const owner = await clientFor("owner");
    const { shootId, assetIds } = await shootWithAssets("draftselect", 3);
    const draft = await ensureDraftPackage({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      shootId,
    });

    const chosen = [assetIds[2], assetIds[0]];
    const saved = await setPackageSelection({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      packageId: draft.id,
      assetIds: chosen,
    });
    expect(saved.count).toBe(2);

    let rows = await memberRows(draft.id);
    expect(rows.map((row) => row.asset_id)).toEqual(chosen);
    expect(rows.map((row) => row.position)).toEqual([0, 1]);

    // The same list again is the same selection: same rows, same order.
    await setPackageSelection({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      packageId: draft.id,
      assetIds: chosen,
    });
    rows = await memberRows(draft.id);
    expect(rows.map((row) => row.asset_id)).toEqual(chosen);

    // Reorder and drop one; the stored state is exactly the new list.
    await setPackageSelection({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      packageId: draft.id,
      assetIds: [assetIds[0]],
    });
    rows = await memberRows(draft.id);
    expect(rows.map((row) => row.asset_id)).toEqual([assetIds[0]]);
    expect(rows[0].position).toBe(0);
  });

  it("keeps the version pinned when a frame entered the package", async () => {
    const owner = await clientFor("owner");
    const service = serviceClient();
    const { shootId, assetIds } = await shootWithAssets("draftpin", 1);
    const draft = await ensureDraftPackage({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      shootId,
    });

    await setPackageSelection({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      packageId: draft.id,
      assetIds,
    });
    const before = await memberRows(draft.id);

    // A delivery derivative appears after the frame was selected. A later save
    // must not silently repoint the entry at it.
    await service.from("asset_versions").insert({
      organization_id: ORG_A,
      asset_id: assetIds[0],
      version_kind: "delivery",
      storage_bucket: "derivatives",
      object_key: `${ORG_A}/${shootId}/late-delivery.jpg`,
      sha256: await digest(`late-${Date.now()}`),
      bytes: 900,
      mime_type: "image/jpeg",
      created_by: OWNER,
    });

    await setPackageSelection({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      packageId: draft.id,
      assetIds,
    });
    const after = await memberRows(draft.id);
    expect(after[0].asset_version_id).toBe(before[0].asset_version_id);
  });

  it("refuses a frame from another workspace's shoot", async () => {
    const owner = await clientFor("owner");
    const { shootId } = await shootWithAssets("draftforeign", 1);
    const draft = await ensureDraftPackage({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      shootId,
    });

    await expect(
      setPackageSelection({
        client: owner,
        organizationId: ORG_A,
        actorId: OWNER,
        packageId: draft.id,
        assetIds: ["b0000000-0000-0000-0000-0000000000d1"],
      }),
    ).rejects.toThrow(/not on this shoot|no longer exists/);
  });

  it("freezes solid at approval: the flow refuses, and so does the database", async () => {
    const owner = await clientFor("owner");
    const service = serviceClient();
    const { shootId, assetIds, versionIds } = await shootWithAssets("draftfreeze", 2);
    const draft = await ensureDraftPackage({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      shootId,
    });

    await setPackageSelection({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      packageId: draft.id,
      assetIds: [assetIds[0]],
    });

    // The recipient facts approval requires.
    await owner
      .from("packages")
      .update({
        buyer_id: BACKGRID,
        delivery_method: "Private delivery link",
        proposed_terms: "Non-exclusive, editorial.",
        restrictions: "Editorial use only. No commercial use.",
      })
      .eq("id", draft.id);

    const { error: approveError } = await owner.rpc("approve_package", {
      target_package: draft.id,
    });
    expect(approveError).toBeNull();

    // The flow's own answer: a sentence, not a constraint violation.
    await expect(
      setPackageSelection({
        client: owner,
        organizationId: ORG_A,
        actorId: OWNER,
        packageId: draft.id,
        assetIds,
      }),
    ).rejects.toThrow(/approved/);

    // The database's answer to a direct write: refused by the freeze trigger.
    const { error: directInsert } = await service.from("package_assets").insert({
      package_id: draft.id,
      organization_id: ORG_A,
      asset_id: assetIds[1],
      asset_version_id: versionIds[1],
      position: 5,
    });
    expect(directInsert).not.toBeNull();
    expect(directInsert!.message).toMatch(/frozen/);

    const rows = await memberRows(draft.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].asset_id).toBe(assetIds[0]);
  });
});
