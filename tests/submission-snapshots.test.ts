/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAssets } from "../src/lib/data/assets";
import { createPackageFromSelection } from "../src/lib/data/packages";
import { markedPreviewKey, reviewPreviewVersion } from "../src/lib/preview-selection";
import {
  approvePackageAndCreateSubmission,
  listSubmissionAssets,
  unresolvedManifestEntries,
} from "../src/lib/data/submissions";
import { createDelivery, revokeDelivery } from "../src/lib/data/delivery-links";
import {
  ORG_A,
  ORG_A_SUBMISSION,
  ORG_B,
  ORG_B_ASSET,
  anonClient,
  clientFor,
  hasLocalSupabase,
  purgeShoot,
  serviceClient,
} from "./helpers/supabase";

/**
 * The exact photographs and editorial information approved by the photographer
 * must be exactly what the recipient later sees and downloads.
 *
 * Every test here runs against the real database with row level security in
 * force. The subject is the approval transaction and the recipient functions
 * behind a delivery link: that they read the approved snapshot, and only the
 * approved snapshot, whatever happens to the asset, the package, or the
 * derivatives afterwards.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const EDITOR = "22222222-2222-2222-2222-222222222222";
const DISPATCHER = "33333333-3333-3333-3333-333333333333";
const OWNER_B = "99999999-9999-9999-9999-999999999999";
const BACKGRID = "a0000000-0000-0000-0000-0000000000b1";

const shoots: string[] = [];
const orgBShoots: string[] = [];

async function digest(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Frame {
  assetId: string;
  originalId: string;
  originalKey: string;
  deliveryId?: string;
  deliveryKey?: string;
  previewId?: string;
  previewKey?: string;
}

/**
 * A shoot with fully described, selected frames. Each has an original; with
 * `withDelivery` each also has a delivery JPEG, which is what the package
 * builder prefers and therefore what gets frozen; with `withPreview` each also
 * has the preview derivative the review screen would have shown.
 */
async function readyShoot(
  label: string,
  options: {
    frames?: number;
    withDelivery?: boolean;
    withPreview?: boolean;
    organization?: "A" | "B";
  } = {},
) {
  const frames = options.frames ?? 2;
  const withDelivery = options.withDelivery ?? true;
  const org = options.organization === "B" ? ORG_B : ORG_A;
  const owner = options.organization === "B" ? OWNER_B : OWNER;
  const service = serviceClient();

  const { data: shoot, error: shootError } = await service
    .from("shoots")
    .insert({
      organization_id: org,
      title: `${label} ${Date.now()}`,
      status: "preparing",
      starts_at: new Date(Date.now() - 1_800_000).toISOString(),
      created_by: owner,
    })
    .select("id")
    .single();
  if (shootError) throw new Error(shootError.message);
  const shootId = shoot!.id as string;
  (org === ORG_B ? orgBShoots : shoots).push(shootId);

  const made: Frame[] = [];
  for (let index = 0; index < frames; index += 1) {
    const { data: asset, error: assetError } = await service
      .from("assets")
      .insert({
        organization_id: org,
        shoot_id: shootId,
        status: "active",
        canonical_filename: `SNAP_${label}_${index}`,
        captured_at: new Date(Date.now() - 1_800_000).toISOString(),
        headline: `${label} headline ${index}`,
        caption: `The approved caption for ${label} frame ${index}.`,
        subjects: ["Avery Hart"],
        credit_line: "Marcus Hale / Mastline",
        copyright_notice: "© 2026 Marcus Hale",
        copyright_owner: "Marcus Hale",
        location_name: "Hotel Chelsea, New York",
        usage_restrictions: "Editorial use only.",
        selected: true,
        created_by: owner,
      })
      .select("id")
      .single();
    if (assetError) throw new Error(assetError.message);
    const assetId = asset!.id as string;

    const originalKey = `${org}/${shootId}/${label}_${index}.arw`;
    const { data: original, error: originalError } = await service
      .from("asset_versions")
      .insert({
        organization_id: org,
        asset_id: assetId,
        version_kind: "original",
        storage_bucket: "originals",
        object_key: originalKey,
        sha256: await digest(`${label}-${index}-${shootId}-original`),
        bytes: 1000,
        mime_type: "image/x-sony-arw",
        created_by: owner,
      })
      .select("id")
      .single();
    if (originalError) throw new Error(originalError.message);

    const frame: Frame = {
      assetId,
      originalId: original!.id as string,
      originalKey,
    };

    if (withDelivery) {
      const deliveryKey = `${org}/${shootId}/${label}_${index}_delivery.jpg`;
      const { data: delivery, error: deliveryError } = await service
        .from("asset_versions")
        .insert({
          organization_id: org,
          asset_id: assetId,
          version_kind: "delivery",
          storage_bucket: "derivatives",
          object_key: deliveryKey,
          sha256: await digest(`${label}-${index}-${shootId}-delivery`),
          bytes: 500,
          mime_type: "image/jpeg",
          width: 3000,
          height: 2000,
          created_by: owner,
        })
        .select("id")
        .single();
      if (deliveryError) throw new Error(deliveryError.message);
      frame.deliveryId = delivery!.id as string;
      frame.deliveryKey = deliveryKey;
    }

    if (options.withPreview) {
      const previewKey = `${org}/${shootId}/${label}_${index}_preview.jpg`;
      const { data: preview, error: previewError } = await service
        .from("asset_versions")
        .insert({
          organization_id: org,
          asset_id: assetId,
          version_kind: "preview",
          storage_bucket: "derivatives",
          object_key: previewKey,
          sha256: await digest(`${label}-${index}-${shootId}-preview`),
          bytes: 120,
          mime_type: "image/jpeg",
          width: 1400,
          height: 933,
          created_by: owner,
        })
        .select("id")
        .single();
      if (previewError) throw new Error(previewError.message);
      frame.previewId = preview!.id as string;
      frame.previewKey = previewKey;
    }

    made.push(frame);
  }

  return { shootId, frames: made, org };
}

/** A derivative made after approval, of whichever kind the test needs. */
async function laterVersion(
  assetId: string,
  shootId: string,
  kind: "preview" | "delivery",
  label: string,
): Promise<{ id: string; key: string }> {
  const key = `${ORG_A}/${shootId}/${label}_later_${kind}.jpg`;
  const { data, error } = await serviceClient()
    .from("asset_versions")
    .insert({
      organization_id: ORG_A,
      asset_id: assetId,
      version_kind: kind,
      storage_bucket: "derivatives",
      object_key: key,
      sha256: await digest(`${label}-later-${kind}-${key}`),
      bytes: 400,
      mime_type: "image/jpeg",
      created_by: OWNER,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data!.id as string, key };
}

/** Package, approve, and link, the way the Server Actions do it. */
async function approved(
  label: string,
  options: { frames?: number; withDelivery?: boolean; withPreview?: boolean } = {},
) {
  const editor = await clientFor("editor");
  const dispatcher = await clientFor("dispatcher");
  const shoot = await readyShoot(label, options);

  const { id: packageId } = await createPackageFromSelection({
    client: editor,
    organizationId: ORG_A,
    actorId: EDITOR,
    shootId: shoot.shootId,
    buyerId: BACKGRID,
    name: `${label} package`,
    deliveryMethod: "SFTP",
    proposedTerms: "Non-exclusive agency distribution.",
    restrictions: "Editorial use only.",
  });

  const { submissionId, reference } = await approvePackageAndCreateSubmission({
    client: dispatcher,
    organizationId: ORG_A,
    actorId: DISPATCHER,
    packageId,
    recipientLabel: "New York picture desk",
  });

  return { ...shoot, packageId, submissionId, reference, dispatcher, editor };
}

async function linkFor(submissionId: string, label = "New York picture desk") {
  const dispatcher = await clientFor("dispatcher");
  return createDelivery({
    client: dispatcher,
    organizationId: ORG_A,
    actorId: DISPATCHER,
    submissionId,
    recipientLabel: label,
    windowDays: 7,
  });
}

async function accept(token: string) {
  const { error } = await anonClient().rpc("accept_delivery", {
    delivery_token: token,
    accepted_by_name: "Dana Whitfield",
  });
  if (error) throw new Error(error.message);
}

async function snapshotRows(submissionId: string) {
  const { data, error } = await serviceClient()
    .from("submission_assets")
    .select("*")
    .eq("submission_id", submissionId)
    .order("position");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function eventsFor(deliveryId: string) {
  const { data } = await serviceClient()
    .from("delivery_access_events")
    .select("kind, detail, asset_id")
    .eq("delivery_id", deliveryId)
    .order("occurred_at");
  return data ?? [];
}

/*
 * Sign everybody in up front. The first sign-in against a freshly started
 * local stack has been measured at over ten seconds, which is longer than a
 * test is allowed and has nothing to do with what these tests measure.
 */
beforeAll(async () => {
  if (!hasLocalSupabase()) return;
  await Promise.all(
    (["editor", "dispatcher", "owner", "viewer", "otherOrgOwner"] as const).map((user) =>
      clientFor(user),
    ),
  );
}, 60_000);

afterAll(async () => {
  await serviceClient().rpc("purge_delivery_links");
  for (const shootId of shoots) await purgeShoot(shootId);
  for (const shootId of orgBShoots) await purgeShoot(shootId);
});

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

describeIf("approval writes the snapshot in the same transaction", () => {
  it("records every frame with its exact version, object, and metadata at approval", async () => {
    const { submissionId, frames, packageId, dispatcher } = await approved("ATOMIC");

    const rows = await snapshotRows(submissionId);
    expect(rows).toHaveLength(frames.length);

    for (const [index, frame] of frames.entries()) {
      const row = rows[index];
      expect(row.asset_id).toBe(frame.assetId);
      expect(row.asset_version_id).toBe(frame.deliveryId);
      expect(row.position).toBe(index);
      expect(row.storage_bucket_snapshot).toBe("derivatives");
      expect(row.object_key_snapshot).toBe(frame.deliveryKey);
      expect(row.mime_type_snapshot).toBe("image/jpeg");
      expect(row.version_kind_snapshot).toBe("delivery");
      expect(Number(row.bytes_snapshot)).toBe(500);
      expect(row.width_snapshot).toBe(3000);
      expect(row.height_snapshot).toBe(2000);
      expect(row.filename_snapshot).toBe(`SNAP_ATOMIC_${index}`);
      expect(row.headline_snapshot).toBe(`ATOMIC headline ${index}`);
      expect(row.caption_snapshot).toBe(`The approved caption for ATOMIC frame ${index}.`);
      expect(row.people_snapshot).toEqual(["Avery Hart"]);
      expect(row.credit_line_snapshot).toBe("Marcus Hale / Mastline");
      expect(row.copyright_notice_snapshot).toBe("© 2026 Marcus Hale");
      expect(row.copyright_owner_snapshot).toBe("Marcus Hale");
      expect(row.location_snapshot).toBe("Hotel Chelsea, New York");
      expect(row.usage_restrictions_snapshot).toBe("Editorial use only.");
      expect(row.captured_at_snapshot).toBeTruthy();
      expect(row.snapshot_origin).toBe("approval");
      // No preview derivative existed at approval, so none is claimed.
      expect(row.preview_asset_version_id).toBeNull();
      expect(row.preview_object_key_snapshot).toBeNull();
      // The snapshot timestamp is the approval instant.
      expect(row.created_at).toBeTruthy();
    }

    const { data: approvedPackage } = await serviceClient()
      .from("packages")
      .select("approved_at")
      .eq("id", packageId)
      .single();
    expect(new Date(rows[0].created_at).getTime()).toBe(
      new Date(approvedPackage!.approved_at as string).getTime(),
    );

    // The package is approved, the submission is queued, nothing sent.
    const { data: pkg } = await serviceClient()
      .from("packages")
      .select("status, approved_by")
      .eq("id", packageId)
      .single();
    expect(pkg!.status).toBe("approved");
    expect(pkg!.approved_by).toBe(DISPATCHER);

    // The audit event landed inside the transaction.
    const { data: events } = await serviceClient()
      .from("activity_events")
      .select("action, event_data")
      .eq("entity_id", packageId);
    const approvedEvent = (events ?? []).find((event) => event.action === "package.approved");
    expect(approvedEvent).toBeTruthy();
    expect((approvedEvent!.event_data as Record<string, unknown>).snapshot_frames).toBe(
      frames.length,
    );

    // ...and the workspace can read the record through the ordinary policy.
    const seen = await listSubmissionAssets(ORG_A, submissionId, dispatcher);
    expect(seen.map((frame) => frame.assetVersionId)).toEqual(frames.map((f) => f.deliveryId));
  });

  it("keeps the manifest and the relational snapshot in agreement", async () => {
    const { submissionId, frames } = await approved("AGREE", { frames: 3 });

    const { data: submission } = await serviceClient()
      .from("submissions")
      .select("delivery_manifest")
      .eq("id", submissionId)
      .single();
    const manifest = (
      submission!.delivery_manifest as {
        assets: { assetId: string; assetVersionId: string; position: number }[];
        asset_count: number;
      }
    ).assets;
    const rows = await snapshotRows(submissionId);

    expect(manifest.map((entry) => entry.assetId)).toEqual(rows.map((row) => row.asset_id));
    expect(manifest.map((entry) => entry.assetVersionId)).toEqual(
      rows.map((row) => row.asset_version_id),
    );
    expect(manifest.map((entry) => entry.position)).toEqual(rows.map((row) => row.position));
    expect((submission!.delivery_manifest as { asset_count: number }).asset_count).toBe(
      rows.length,
    );
    expect(rows).toHaveLength(frames.length);

    // The database's own check says the same for every submission that has a snapshot.
    const drift = await serviceClient().rpc("submission_snapshot_drift_admin");
    expect(drift.error).toBeNull();
    expect(
      (drift.data ?? []).map((row: { submission_id: string }) => row.submission_id),
    ).not.toContain(submissionId);
  });

  it("rolls the approval and the submission back when a snapshot row cannot be written", async () => {
    /*
     * A version whose stored object key is empty. asset_versions accepts it;
     * the snapshot does not (`char_length(object_key_snapshot) > 0`), and the
     * snapshot insert happens AFTER the package has been marked approved and
     * the submission created -- so this is a failure late in the transaction,
     * and everything before it must unwind.
     */
    const editor = await clientFor("editor");
    const dispatcher = await clientFor("dispatcher");
    const service = serviceClient();
    const { shootId, frames } = await readyShoot("ROLLBACK", { frames: 1, withDelivery: false });

    const { data: blank, error: blankError } = await service
      .from("asset_versions")
      .insert({
        organization_id: ORG_A,
        asset_id: frames[0].assetId,
        version_kind: "delivery",
        storage_bucket: "derivatives",
        object_key: "",
        sha256: await digest(`blank-${shootId}`),
        bytes: 1,
        mime_type: "image/jpeg",
        created_by: OWNER,
      })
      .select("id")
      .single();
    expect(blankError).toBeNull();

    const { id: packageId } = await createPackageFromSelection({
      client: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      buyerId: BACKGRID,
      name: "Rollback package",
      deliveryMethod: "SFTP",
      proposedTerms: "Terms.",
    });
    // The builder prefers the delivery version, which is the blank one.
    const { data: member } = await service
      .from("package_assets")
      .select("asset_version_id")
      .eq("package_id", packageId)
      .single();
    expect(member!.asset_version_id).toBe(blank!.id);

    await expect(
      approvePackageAndCreateSubmission({
        client: dispatcher,
        organizationId: ORG_A,
        actorId: DISPATCHER,
        packageId,
      }),
    ).rejects.toThrow();

    const { data: pkg } = await service
      .from("packages")
      .select("status, approved_at, approved_by")
      .eq("id", packageId)
      .single();
    expect(pkg!.status).toBe("needs_review");
    expect(pkg!.approved_at).toBeNull();
    expect(pkg!.approved_by).toBeNull();

    const { data: submissions } = await service
      .from("submissions")
      .select("id")
      .eq("package_id", packageId);
    expect(submissions ?? []).toHaveLength(0);

    const { data: events } = await service
      .from("activity_events")
      .select("action")
      .eq("entity_id", packageId)
      .eq("action", "package.approved");
    expect(events ?? []).toHaveLength(0);

    // The package is still editable, so it can be repaired and approved later.
    const removal = await service
      .from("package_assets")
      .delete()
      .eq("package_id", packageId)
      .eq("asset_id", frames[0].assetId);
    expect(removal.error).toBeNull();
  });

  it("refuses a package whose member names a version of a different asset, leaving nothing behind", async () => {
    const dispatcher = await clientFor("dispatcher");
    const service = serviceClient();
    const { shootId, frames } = await readyShoot("CROSSVERSION", { frames: 2 });

    const { data: pkg } = await service
      .from("packages")
      .insert({
        organization_id: ORG_A,
        shoot_id: shootId,
        buyer_id: BACKGRID,
        name: "Cross-version package",
        status: "ready",
        delivery_method: "SFTP",
        proposed_terms: "Terms.",
        created_by: OWNER,
      })
      .select("id")
      .single();
    // package_assets has no cross-check between asset and version; the
    // approval transaction does.
    const { error: memberError } = await service.from("package_assets").insert({
      package_id: pkg!.id,
      organization_id: ORG_A,
      asset_id: frames[0].assetId,
      asset_version_id: frames[1].deliveryId,
      position: 0,
    });
    expect(memberError).toBeNull();

    await expect(
      approvePackageAndCreateSubmission({
        client: dispatcher,
        organizationId: ORG_A,
        actorId: DISPATCHER,
        packageId: pkg!.id as string,
      }),
    ).rejects.toThrow(/version that no longer exists or belongs to another asset/i);

    const { data: after } = await service
      .from("packages")
      .select("status, approved_at")
      .eq("id", pkg!.id)
      .single();
    expect(after!.status).toBe("ready");
    expect(after!.approved_at).toBeNull();
    const { data: submissions } = await service
      .from("submissions")
      .select("id")
      .eq("package_id", pkg!.id);
    expect(submissions ?? []).toHaveLength(0);

    // The cross-pointing row is removed here rather than left for afterAll:
    // it names frames[1]'s version from frames[0]'s asset, so whichever
    // asset the purge reaches first, the other's versions are still referenced
    // and the purge fails on the foreign key. The package was never approved,
    // so a plain delete is allowed.
    const detach = await service.from("package_assets").delete().eq("package_id", pkg!.id);
    expect(detach.error).toBeNull();
  });

  it("approves a package exactly once, even when asked twice at the same moment", async () => {
    const editor = await clientFor("editor");
    const dispatcher = await clientFor("dispatcher");
    const { shootId } = await readyShoot("RACE", { frames: 1 });

    const { id: packageId } = await createPackageFromSelection({
      client: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      buyerId: BACKGRID,
      name: "Race package",
      deliveryMethod: "SFTP",
      proposedTerms: "Terms.",
    });

    const attempt = () =>
      approvePackageAndCreateSubmission({
        client: dispatcher,
        organizationId: ORG_A,
        actorId: DISPATCHER,
        packageId,
      });
    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const failure of rejected) {
      expect(String((failure as PromiseRejectedResult).reason)).toMatch(/already been approved/i);
    }

    const { data: submissions } = await serviceClient()
      .from("submissions")
      .select("id")
      .eq("package_id", packageId);
    expect(submissions).toHaveLength(1);
    expect(await snapshotRows(submissions![0].id as string)).toHaveLength(1);
  });

  it("does not let an editor approve, and does not let a stranger find the package", async () => {
    const editor = await clientFor("editor");
    const { shootId } = await readyShoot("EDITORAPPROVE", { frames: 1 });
    const { id: packageId } = await createPackageFromSelection({
      client: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      buyerId: BACKGRID,
      name: "Editor package",
      deliveryMethod: "SFTP",
      proposedTerms: "Terms.",
    });

    await expect(
      approvePackageAndCreateSubmission({
        client: editor,
        organizationId: ORG_A,
        actorId: EDITOR,
        packageId,
      }),
    ).rejects.toThrow(/cannot approve/i);

    // The database function itself, called directly by a member of another
    // workspace: the same "not found" a stranger gets from RLS.
    const outsider = await clientFor("otherOrgOwner");
    const direct = await outsider.rpc("approve_package", { target_package: packageId });
    expect(direct.error).toBeTruthy();
    expect(direct.error!.message).toMatch(/could not be found/i);

    // ...and by nobody at all.
    const anonymous = await anonClient().rpc("approve_package", { target_package: packageId });
    expect(anonymous.error).toBeTruthy();

    const { data: pkg } = await serviceClient()
      .from("packages")
      .select("status")
      .eq("id", packageId)
      .single();
    expect(pkg!.status).toBe("needs_review");
  });
});

// ---------------------------------------------------------------------------
// Immutability and tenancy of the snapshot rows
// ---------------------------------------------------------------------------

describeIf("a snapshot row cannot be changed", () => {
  it("refuses updates and deletes, even from the service role", async () => {
    const { submissionId } = await approved("IMMUTABLE", { frames: 1 });
    const [row] = await snapshotRows(submissionId);
    const service = serviceClient();

    const update = await service
      .from("submission_assets")
      .update({ caption_snapshot: "Rewritten after approval" })
      .eq("id", row.id);
    expect(update.error).toBeTruthy();

    const remove = await service.from("submission_assets").delete().eq("id", row.id);
    expect(remove.error).toBeTruthy();

    const [after] = await snapshotRows(submissionId);
    expect(after.caption_snapshot).toBe(row.caption_snapshot);
  });

  it("refuses direct writes from a signed-in member of the workspace", async () => {
    const { submissionId, frames } = await approved("MEMBERWRITE", { frames: 1 });
    const owner = await clientFor("owner");
    const [row] = await snapshotRows(submissionId);

    const insert = await owner.from("submission_assets").insert({
      organization_id: ORG_A,
      submission_id: submissionId,
      asset_id: frames[0].assetId,
      asset_version_id: frames[0].originalId,
      position: 5,
      storage_bucket_snapshot: "originals",
      object_key_snapshot: frames[0].originalKey,
      sha256_snapshot: "a".repeat(64),
      mime_type_snapshot: "image/x-sony-arw",
      filename_snapshot: "forged",
      snapshot_origin: "approval",
    });
    expect(insert.error).toBeTruthy();

    const update = await owner
      .from("submission_assets")
      .update({ caption_snapshot: "Rewritten" })
      .eq("id", row.id);
    expect(update.error).toBeTruthy();

    const remove = await owner.from("submission_assets").delete().eq("id", row.id);
    expect(remove.error).toBeTruthy();

    expect(await snapshotRows(submissionId)).toHaveLength(1);
  });

  it("can be read by a member and by nobody outside the workspace", async () => {
    const { submissionId } = await approved("READERS", { frames: 1 });

    const viewer = await clientFor("viewer");
    const seen = await viewer
      .from("submission_assets")
      .select("id")
      .eq("submission_id", submissionId);
    expect(seen.data).toHaveLength(1);

    const outsider = await clientFor("otherOrgOwner");
    const unseen = await outsider
      .from("submission_assets")
      .select("id")
      .eq("submission_id", submissionId);
    expect(unseen.data ?? []).toHaveLength(0);

    // Nor by naming the organization, nor with no session at all.
    const byOrg = await outsider
      .from("submission_assets")
      .select("id")
      .eq("organization_id", ORG_A);
    expect(byOrg.data ?? []).toHaveLength(0);
    const anonymous = await anonClient().from("submission_assets").select("id");
    expect(anonymous.data ?? []).toHaveLength(0);
  });

  it("refuses a version from another asset, another workspace, or a different object", async () => {
    const { submissionId, frames } = await approved("FORGERY", { frames: 2 });
    const service = serviceClient();
    const [first, second] = frames;

    const base = {
      organization_id: ORG_A,
      submission_id: submissionId,
      position: 9,
      sha256_snapshot: "a".repeat(64),
      mime_type_snapshot: "image/jpeg",
      filename_snapshot: "forged",
      snapshot_origin: "approval",
    };

    // A version that belongs to a different asset of the same workspace.
    const otherAsset = await service.from("submission_assets").insert({
      ...base,
      asset_id: first.assetId,
      asset_version_id: second.deliveryId,
      storage_bucket_snapshot: "derivatives",
      object_key_snapshot: second.deliveryKey,
    });
    expect(otherAsset.error).toBeTruthy();

    // A version from another workspace's asset.
    const { data: foreign } = await service
      .from("asset_versions")
      .select("id, object_key, sha256")
      .eq("asset_id", ORG_B_ASSET)
      .limit(1)
      .single();
    const otherOrg = await service.from("submission_assets").insert({
      ...base,
      asset_id: ORG_B_ASSET,
      asset_version_id: foreign!.id,
      storage_bucket_snapshot: "originals",
      object_key_snapshot: foreign!.object_key,
      sha256_snapshot: foreign!.sha256,
    });
    expect(otherOrg.error).toBeTruthy();

    // A submission in another workspace, named with this workspace's asset.
    const crossSubmission = await service.from("submission_assets").insert({
      ...base,
      organization_id: ORG_B,
      asset_id: first.assetId,
      asset_version_id: first.deliveryId,
      storage_bucket_snapshot: "derivatives",
      object_key_snapshot: first.deliveryKey,
    });
    expect(crossSubmission.error).toBeTruthy();

    // The right version, but a different object than that version holds.
    const wrongObject = await service.from("submission_assets").insert({
      ...base,
      asset_id: first.assetId,
      asset_version_id: first.originalId,
      storage_bucket_snapshot: "originals",
      object_key_snapshot: `${ORG_A}/somewhere-else.arw`,
    });
    expect(wrongObject.error).toBeTruthy();
    expect(wrongObject.error!.message).toMatch(/exact object|foreign key|violates/i);

    expect(await snapshotRows(submissionId)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// What the recipient reads
// ---------------------------------------------------------------------------

describeIf("a recipient link reads the snapshot and nothing else", () => {
  it("ignores asset metadata edited after approval", async () => {
    const { submissionId, frames } = await approved("METAEDIT", { frames: 2 });
    const link = await linkFor(submissionId);
    const anon = anonClient();
    const service = serviceClient();

    const before = await anon.rpc("delivery_assets", { delivery_token: link.token });
    expect(before.error).toBeNull();
    expect(before.data).toHaveLength(2);
    expect(before.data![0].caption).toBe("The approved caption for METAEDIT frame 0.");
    expect(before.data![0].people).toEqual(["Avery Hart"]);

    const opened = await anon.rpc("open_delivery", { delivery_token: link.token });
    expect(opened.data![0].credit_line).toBe("Marcus Hale / Mastline");
    expect(opened.data![0].asset_count).toBe(2);

    // The photographer corrects the frame afterwards, for future packages.
    const edit = await service
      .from("assets")
      .update({
        headline: "Rewritten headline",
        caption: "A caption written after approval.",
        subjects: ["Somebody Else"],
        credit_line: "Different credit",
        canonical_filename: "RENAMED",
        captured_at: "2020-01-01T00:00:00Z",
      })
      .eq("id", frames[0].assetId);
    expect(edit.error).toBeNull();

    const after = await anon.rpc("delivery_assets", { delivery_token: link.token });
    expect(after.data).toEqual(before.data);

    const reopened = await anon.rpc("open_delivery", { delivery_token: link.token });
    expect(reopened.data![0].credit_line).toBe("Marcus Hale / Mastline");

    // No storage location reaches the recipient surface.
    for (const row of after.data!) {
      const keys = Object.keys(row as Record<string, unknown>);
      expect(keys).not.toContain("preview_key");
      expect(keys).not.toContain("object_key");
      expect(keys).not.toContain("storage_bucket");
      expect(JSON.stringify(row)).not.toContain(frames[0].deliveryKey);
    }
  });

  it("previews and downloads the exact approved object, never a later derivative or the original", async () => {
    const { submissionId, frames, shootId } = await approved("LATERDERIV", { frames: 1 });
    const [frame] = frames;
    const link = await linkFor(submissionId);
    const service = serviceClient();

    // After approval: a new preview, a new delivery derivative. Both would
    // have been "preferred" by the old selection.
    for (const [kind, key] of [
      ["preview", `${ORG_A}/${shootId}/later_preview.jpg`],
      ["delivery", `${ORG_A}/${shootId}/later_delivery.jpg`],
    ] as const) {
      const { error } = await service.from("asset_versions").insert({
        organization_id: ORG_A,
        asset_id: frame.assetId,
        version_kind: kind,
        storage_bucket: "derivatives",
        object_key: key,
        sha256: await digest(`${kind}-${key}`),
        bytes: 400,
        mime_type: "image/jpeg",
        created_by: OWNER,
      });
      expect(error).toBeNull();
    }

    const preview = await serviceClient().rpc("delivery_preview", {
      delivery_token: link.token,
      target_asset: frame.assetId,
    });
    expect(preview.error).toBeNull();
    expect(preview.data).toHaveLength(1);
    expect(preview.data![0].object_key).toBe(frame.deliveryKey);
    expect(preview.data![0].storage_bucket).toBe("derivatives");

    await accept(link.token);

    const download = await serviceClient().rpc("authorize_delivery_download", {
      delivery_token: link.token,
      target_asset: frame.assetId,
    });
    expect(download.error).toBeNull();
    expect(download.data).toHaveLength(1);
    expect(download.data![0].object_key).toBe(frame.deliveryKey);
    expect(download.data![0].object_key).not.toBe(frame.originalKey);
    expect(download.data![0].filename).toBe("SNAP_LATERDERIV_0");
    // The digest of the approved object, so the route can prove which file
    // it signed -- and the snapshot row it came from.
    const [row] = await snapshotRows(submissionId);
    expect(download.data![0].sha256).toBe(row.sha256_snapshot);
    expect(download.data![0].snapshot_id).toBe(row.id);
    expect(download.data![0].mime_type).toBe("image/jpeg");

    // Authorising is not downloading.
    expect((await eventsFor(link.id)).map((event) => event.kind)).not.toContain("downloaded");

    const recorded = await serviceClient().rpc("record_delivery_download", {
      delivery_token: link.token,
      target_asset: frame.assetId,
    });
    expect(recorded.error).toBeNull();
    expect(recorded.data).toHaveLength(1);
    const downloads = (await eventsFor(link.id)).filter((event) => event.kind === "downloaded");
    expect(downloads).toHaveLength(1);
    expect(downloads[0].asset_id).toBe(frame.assetId);
  });

  it("is unaffected by the package, which cannot change either", async () => {
    const { submissionId, packageId, frames } = await approved("PACKAGEEDIT", { frames: 1 });
    const link = await linkFor(submissionId);
    const service = serviceClient();
    const { frames: others } = await readyShoot("PACKAGEEDIT_OTHER", { frames: 1 });

    // Membership: frozen by the trigger.
    const add = await service.from("package_assets").insert({
      package_id: packageId,
      organization_id: ORG_A,
      asset_id: others[0].assetId,
      asset_version_id: others[0].deliveryId,
      position: 1,
    });
    expect(add.error).toBeTruthy();

    // Name and note: frozen too, because the recipient sees them.
    for (const patch of [{ name: "Renamed" }, { package_note: "A different headline" }]) {
      const { error } = await service.from("packages").update(patch).eq("id", packageId);
      expect(error, `${Object.keys(patch)[0]} should be frozen`).toBeTruthy();
    }

    const seen = await anonClient().rpc("delivery_assets", { delivery_token: link.token });
    expect(seen.data!.map((row: { asset_id: string }) => row.asset_id)).toEqual([
      frames[0].assetId,
    ]);

    // A frame from another package is not this submission's frame.
    await accept(link.token);
    const outside = await serviceClient().rpc("authorize_delivery_download", {
      delivery_token: link.token,
      target_asset: others[0].assetId,
    });
    expect(outside.data ?? []).toHaveLength(0);
    const refusal = (await eventsFor(link.id)).find(
      (event) => event.detail === "frame not in this submission",
    );
    expect(refusal).toBeTruthy();
  });

  it("refuses a download before acceptance, on an expired link, and on a withdrawn link", async () => {
    const { submissionId, frames } = await approved("GATES", { frames: 1 });
    const [frame] = frames;
    const anon = anonClient();
    const service = serviceClient();
    const dispatcher = await clientFor("dispatcher");

    // Before accepting.
    const early = await linkFor(submissionId, "Early desk");
    const beforeYes = await serviceClient().rpc("authorize_delivery_download", {
      delivery_token: early.token,
      target_asset: frame.assetId,
    });
    expect(beforeYes.data ?? []).toHaveLength(0);
    expect((await eventsFor(early.id)).map((event) => event.detail)).toContain(
      "download before accepting the terms",
    );
    // ...and recording is gated the same way, so no route can write a download
    // for an unaccepted link even if it skipped authorisation.
    const recordedEarly = await serviceClient().rpc("record_delivery_download", {
      delivery_token: early.token,
      target_asset: frame.assetId,
    });
    expect(recordedEarly.data ?? []).toHaveLength(0);
    expect((await eventsFor(early.id)).map((event) => event.kind)).not.toContain("downloaded");

    // Expired.
    const expired = await linkFor(submissionId, "Expired desk");
    await accept(expired.token);
    // A link made two hours ago that closed an hour ago: expires_at must
    // still follow created_at, which the table checks.
    const expire = await service
      .from("submission_deliveries")
      .update({
        created_at: new Date(Date.now() - 7_200_000).toISOString(),
        expires_at: new Date(Date.now() - 3_600_000).toISOString(),
      })
      .eq("id", expired.id);
    expect(expire.error).toBeNull();
    const afterExpiry = await serviceClient().rpc("authorize_delivery_download", {
      delivery_token: expired.token,
      target_asset: frame.assetId,
    });
    expect(afterExpiry.data ?? []).toHaveLength(0);
    expect((await eventsFor(expired.id)).map((event) => event.detail)).toContain(
      "download after the link stopped working",
    );
    expect(
      (await anon.rpc("delivery_assets", { delivery_token: expired.token })).data,
    ).toHaveLength(0);

    // Withdrawn.
    const withdrawn = await linkFor(submissionId, "Withdrawn desk");
    await accept(withdrawn.token);
    await revokeDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      deliveryId: withdrawn.id,
    });
    const afterWithdrawal = await serviceClient().rpc("authorize_delivery_download", {
      delivery_token: withdrawn.token,
      target_asset: frame.assetId,
    });
    expect(afterWithdrawal.data ?? []).toHaveLength(0);
    const preview = await serviceClient().rpc("delivery_preview", {
      delivery_token: withdrawn.token,
      target_asset: frame.assetId,
    });
    expect(preview.data ?? []).toHaveLength(0);
  });

  it("refuses a frame from another workspace without attributing it, and reveals nothing for an unknown token", async () => {
    const { submissionId } = await approved("STRANGERS", { frames: 1 });
    const link = await linkFor(submissionId);
    await accept(link.token);
    const anon = anonClient();

    const foreign = await serviceClient().rpc("authorize_delivery_download", {
      delivery_token: link.token,
      target_asset: ORG_B_ASSET,
    });
    expect(foreign.error).toBeNull();
    expect(foreign.data ?? []).toHaveLength(0);
    const refusal = (await eventsFor(link.id)).find(
      (event) => event.detail === "frame not in this submission",
    );
    expect(refusal).toBeTruthy();
    // A frame this workspace does not own is not attached to the refusal.
    expect(refusal!.asset_id).toBeNull();

    const { count: before } = await serviceClient()
      .from("delivery_access_events")
      .select("id", { count: "exact", head: true });

    const unknown = `unknown${"x".repeat(40)}`;
    // One at a time: the property under test is the neutral answer, and this
    // local stack has answered a burst of five with a gateway error.
    const calls = [
      async () => anon.rpc("open_delivery", { delivery_token: unknown }),
      async () => anon.rpc("delivery_assets", { delivery_token: unknown }),
      async () =>
        serviceClient().rpc("delivery_preview", {
          delivery_token: unknown,
          target_asset: ORG_B_ASSET,
        }),
      async () =>
        serviceClient().rpc("authorize_delivery_download", {
          delivery_token: unknown,
          target_asset: ORG_B_ASSET,
        }),
      async () =>
        serviceClient().rpc("record_delivery_download", {
          delivery_token: unknown,
          target_asset: ORG_B_ASSET,
        }),
    ];
    for (const call of calls) {
      const result = await call();
      expect(result.error).toBeNull();
      expect(result.data ?? []).toHaveLength(0);
    }

    const { count: after } = await serviceClient()
      .from("delivery_access_events")
      .select("id", { count: "exact", head: true });
    expect(after).toBe(before);
  });

  it("freezes the preview the reviewer was shown, and ignores a preview made afterwards", async () => {
    const { submissionId, frames, shootId } = await approved("PREVIEWID", {
      frames: 1,
      withPreview: true,
    });
    const [frame] = frames;

    // Both identities are on the row: the approved delivery object, and the
    // preview that was on the review screen.
    const [row] = await snapshotRows(submissionId);
    expect(row.asset_version_id).toBe(frame.deliveryId);
    expect(row.preview_asset_version_id).toBe(frame.previewId);
    expect(row.preview_object_key_snapshot).toBe(frame.previewKey);
    expect(row.preview_storage_bucket_snapshot).toBe("derivatives");
    expect(row.preview_sha256_snapshot).toMatch(/^[a-f0-9]{64}$/);
    expect(row.preview_mime_type_snapshot).toBe("image/jpeg");

    const link = await linkFor(submissionId);
    const before = await serviceClient().rpc("delivery_preview", {
      delivery_token: link.token,
      target_asset: frame.assetId,
    });
    expect(before.error).toBeNull();
    expect(before.data![0].object_key).toBe(frame.previewKey);
    expect(before.data![0].sha256).toBe(row.preview_sha256_snapshot);
    expect(before.data![0].snapshot_id).toBe(row.id);

    // A newer preview and a newer delivery derivative. Neither is chosen.
    const laterPreview = await laterVersion(frame.assetId, shootId, "preview", "PREVIEWID");
    await laterVersion(frame.assetId, shootId, "delivery", "PREVIEWID");

    const after = await serviceClient().rpc("delivery_preview", {
      delivery_token: link.token,
      target_asset: frame.assetId,
    });
    expect(after.data).toEqual(before.data);
    expect(after.data![0].object_key).not.toBe(laterPreview.key);

    // ...and the download is still the approved delivery object.
    await accept(link.token);
    const download = await serviceClient().rpc("authorize_delivery_download", {
      delivery_token: link.token,
      target_asset: frame.assetId,
    });
    expect(download.data![0].object_key).toBe(frame.deliveryKey);

    // The frozen preview cannot be repointed either.
    const repoint = await serviceClient()
      .from("submission_assets")
      .update({ preview_asset_version_id: laterPreview.id })
      .eq("id", row.id);
    expect(repoint.error).toBeTruthy();
  });

  it("renders the preview from the approved object when none was frozen, never from a later preview", async () => {
    // A delivery JPEG and no preview derivative at approval: the recipient
    // preview is scaled and marked from the approved object itself.
    const { submissionId, frames, shootId } = await approved("NOPREVIEW", { frames: 1 });
    const [frame] = frames;
    const anon = anonClient();
    const link = await linkFor(submissionId);

    const [row] = await snapshotRows(submissionId);
    expect(row.preview_asset_version_id).toBeNull();

    const listed = await anon.rpc("delivery_assets", { delivery_token: link.token });
    expect(listed.data![0].has_preview).toBe(true);

    const before = await serviceClient().rpc("delivery_preview", {
      delivery_token: link.token,
      target_asset: frame.assetId,
    });
    expect(before.data![0].object_key).toBe(frame.deliveryKey);
    expect(before.data![0].sha256).toBe(row.sha256_snapshot);

    // A preview made after approval would have been "preferred" by the old
    // selection. It is not looked at.
    const later = await laterVersion(frame.assetId, shootId, "preview", "NOPREVIEW");
    const after = await serviceClient().rpc("delivery_preview", {
      delivery_token: link.token,
      target_asset: frame.assetId,
    });
    expect(after.data![0].object_key).toBe(frame.deliveryKey);
    expect(after.data![0].object_key).not.toBe(later.key);
  });

  it("shows no preview for a frame whose approved object is a RAW original, rather than another file", async () => {
    const { submissionId, frames, shootId } = await approved("RAWONLY", {
      frames: 1,
      withDelivery: false,
    });
    const [frame] = frames;
    const link = await linkFor(submissionId);
    const anon = anonClient();

    // A preview derivative made later. The old selection would have shown it.
    await serviceClient()
      .from("asset_versions")
      .insert({
        organization_id: ORG_A,
        asset_id: frame.assetId,
        version_kind: "preview",
        storage_bucket: "derivatives",
        object_key: `${ORG_A}/${shootId}/rawonly_preview.jpg`,
        sha256: await digest(`rawonly-preview-${shootId}`),
        bytes: 400,
        mime_type: "image/jpeg",
        created_by: OWNER,
      });

    const listed = await anon.rpc("delivery_assets", { delivery_token: link.token });
    expect(listed.data![0].has_preview).toBe(false);
    const preview = await serviceClient().rpc("delivery_preview", {
      delivery_token: link.token,
      target_asset: frame.assetId,
    });
    expect(preview.data ?? []).toHaveLength(0);

    // The download is still the exact approved object: the original.
    await accept(link.token);
    const download = await serviceClient().rpc("authorize_delivery_download", {
      delivery_token: link.token,
      target_asset: frame.assetId,
    });
    expect(download.data![0].object_key).toBe(frame.originalKey);
    expect(download.data![0].storage_bucket).toBe("originals");
  });
});

// ---------------------------------------------------------------------------
// Legacy submissions
// ---------------------------------------------------------------------------

describeIf("submissions approved before the snapshot existed", () => {
  it("were backfilled from the frozen version and marked as such", async () => {
    const rows = await snapshotRows(ORG_A_SUBMISSION);
    expect(rows).toHaveLength(1);
    expect(rows[0].snapshot_origin).toBe("legacy_backfill");
    // The version the seed's manifest froze, and its real object.
    expect(rows[0].asset_version_id).toBe("a0000000-0000-0000-0000-0000000000e2");
    expect(rows[0].storage_bucket_snapshot).toBe("derivatives");
    expect(rows[0].object_key_snapshot).toBe(
      "aaaaaaaa-0000-0000-0000-000000000001/a0000000-0000-0000-0000-0000000000c1/MH_0819_0472_delivery.jpg",
    );

    const dispatcher = await clientFor("dispatcher");
    const [frame] = await listSubmissionAssets(ORG_A, ORG_A_SUBMISSION, dispatcher);
    expect(frame.origin).toBe("legacy_backfill");
  });

  it("freeze the frames that resolve, list the ones that do not, and substitute nothing", async () => {
    const service = serviceClient();
    const anon = anonClient();
    const { shootId, frames } = await readyShoot("GAP", { frames: 2 });
    const [good, bad] = frames;

    const { data: pkg } = await service
      .from("packages")
      .insert({
        organization_id: ORG_A,
        shoot_id: shootId,
        buyer_id: BACKGRID,
        name: "Gap package",
        status: "ready",
        delivery_method: "SFTP",
        proposed_terms: "Terms.",
        created_by: OWNER,
      })
      .select("id")
      .single();
    await service
      .from("packages")
      .update({ status: "approved", approved_by: OWNER, approved_at: new Date().toISOString() })
      .eq("id", pkg!.id);

    /*
     * The backfill reports counts for the whole database, and other suites
     * leave legacy-shaped submissions behind (direct inserts whose assets were
     * later purged): those resolve nothing and are counted as unresolved on
     * every call, forever. Take that baseline first, so the exact counts
     * asserted below are the DELTA this submission produces, not a claim about
     * whichever file happened to run before this one.
     */
    const baselineRun = await service.rpc("backfill_submission_assets_admin");
    expect(baselineRun.error).toBeNull();
    const baseline = (baselineRun.data ?? [])[0] as {
      frames_written: number;
      frames_unresolved: number;
    };

    /*
     * The shape of a legacy submission: a manifest and nothing else. One entry
     * names a real version of its asset; the other names a version that does
     * not exist -- purged, or never valid -- although the asset itself has a
     * perfectly good delivery derivative the old code would have picked.
     */
    const { data: submission } = await service
      .from("submissions")
      .insert({
        organization_id: ORG_A,
        package_id: pkg!.id,
        buyer_id: BACKGRID,
        status: "queued",
        delivery_manifest: {
          assets: [
            { assetId: good.assetId, assetVersionId: good.deliveryId, position: 0 },
            {
              assetId: bad.assetId,
              assetVersionId: "00000000-0000-0000-0000-00000000dead",
              position: 1,
            },
          ],
          asset_count: 2,
        },
        external_reference: `GAP-${Date.now()}`,
        created_by: OWNER,
      })
      .select("id")
      .single();
    const submissionId = submission!.id as string;

    // Nothing yet: the backfill has not run for this row, and nothing else
    // writes snapshot rows.
    expect(await snapshotRows(submissionId)).toHaveLength(0);

    const backfill = await service.rpc("backfill_submission_assets_admin");
    expect(backfill.error).toBeNull();
    const counts = (backfill.data ?? [])[0] as {
      submissions_seen: number;
      frames_written: number;
      frames_unresolved: number;
    };
    // Exactly one frame written and exactly one more unresolved than before:
    // the resolvable entry and the dead one, and nothing else.
    expect(counts.frames_written).toBe(1);
    expect(counts.frames_unresolved).toBe(baseline.frames_unresolved + 1);

    // The frame that resolved is frozen from its manifest version, honestly
    // marked; the one that did not has no row and no stand-in.
    const rows = await snapshotRows(submissionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].asset_id).toBe(good.assetId);
    expect(rows[0].asset_version_id).toBe(good.deliveryId);
    expect(rows[0].object_key_snapshot).toBe(good.deliveryKey);
    expect(rows[0].snapshot_origin).toBe("legacy_backfill");
    expect(rows[0].preview_asset_version_id).toBeNull();

    const gaps = await service.rpc("submission_snapshot_gaps_admin");
    expect(gaps.error).toBeNull();
    const listed = (gaps.data ?? []).filter(
      (row: { submission_id: string }) => row.submission_id === submissionId,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      manifest_position: 1,
      manifest_asset_id: bad.assetId,
      manifest_asset_version_id: "00000000-0000-0000-0000-00000000dead",
    });

    // Running it again changes nothing: a submission with rows is left alone.
    const again = await service.rpc("backfill_submission_assets_admin");
    expect(again.error).toBeNull();
    expect(await snapshotRows(submissionId)).toHaveLength(1);

    // A recipient sees the one frozen frame and cannot reach the other, even
    // though the old selection would have found a delivery JPEG for it.
    const link = await linkFor(submissionId);
    const shown = await anon.rpc("delivery_assets", { delivery_token: link.token });
    expect(shown.data!.map((row: { asset_id: string }) => row.asset_id)).toEqual([good.assetId]);
    const opened = await anon.rpc("open_delivery", { delivery_token: link.token });
    expect(opened.data![0].asset_count).toBe(1);

    await accept(link.token);
    const refused = await serviceClient().rpc("authorize_delivery_download", {
      delivery_token: link.token,
      target_asset: bad.assetId,
    });
    expect(refused.data ?? []).toHaveLength(0);
    expect((await eventsFor(link.id)).map((event) => event.detail)).toContain(
      "frame not in this submission",
    );
    const preview = await serviceClient().rpc("delivery_preview", {
      delivery_token: link.token,
      target_asset: bad.assetId,
    });
    expect(preview.data ?? []).toHaveLength(0);

    // The workspace's own record names the gap rather than hiding it.
    const dispatcher = await clientFor("dispatcher");
    const seen = await listSubmissionAssets(ORG_A, submissionId, dispatcher);
    const unresolved = unresolvedManifestEntries(
      [
        { assetId: good.assetId, assetVersionId: good.deliveryId!, position: 0 },
        {
          assetId: bad.assetId,
          assetVersionId: "00000000-0000-0000-0000-00000000dead",
          position: 1,
        },
      ],
      seen,
    );
    expect(unresolved.map((entry) => entry.assetId)).toEqual([bad.assetId]);

    // The check functions and the backfill are closed to everyone but the
    // service role.
    const owner = await clientFor("owner");
    expect((await owner.rpc("submission_snapshot_gaps_admin")).error).toBeTruthy();
    expect((await owner.rpc("backfill_submission_assets_admin")).error).toBeTruthy();
    expect((await anon.rpc("submission_snapshot_drift_admin")).error).toBeTruthy();
    expect((await anon.rpc("backfill_submission_assets_admin")).error).toBeTruthy();
  });

  it("never drift from their manifest", async () => {
    const drift = await serviceClient().rpc("submission_snapshot_drift_admin");
    expect(drift.error).toBeNull();
    expect(drift.data ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Who may call what
// ---------------------------------------------------------------------------

describeIf(
  "the functions that name a private object or write evidence are closed to browsers",
  () => {
    const SENSITIVE = [
      "delivery_preview",
      "authorize_delivery_download",
      "record_delivery_download",
    ] as const;

    it("refuses anon and signed-in callers with permission denied, and never runs the body", async () => {
      const { submissionId, frames } = await approved("PRIVS", { frames: 1 });
      const link = await linkFor(submissionId);
      await accept(link.token);
      const before = (await eventsFor(link.id)).length;

      const callers = [
        ["anon", anonClient()],
        ["viewer", await clientFor("viewer")],
        ["owner", await clientFor("owner")],
      ] as const;

      for (const [who, client] of callers) {
        for (const fn of SENSITIVE) {
          const result = await client.rpc(fn, {
            delivery_token: link.token,
            target_asset: frames[0].assetId,
          });
          expect(result.error, `${who} calling ${fn}`).toBeTruthy();
          expect(result.error!.code, `${who} calling ${fn}`).toBe("42501");
          expect(result.error!.message).toMatch(/permission denied/i);
          expect(result.data ?? []).toHaveLength(0);
        }
      }

      // A refused call is refused before the function runs: no refusal event,
      // and above all no `downloaded` event, was written by any of them.
      expect((await eventsFor(link.id)).length).toBe(before);

      // The route's role can still do all three, in order.
      const trusted = serviceClient();
      const preview = await trusted.rpc("delivery_preview", {
        delivery_token: link.token,
        target_asset: frames[0].assetId,
      });
      expect(preview.error).toBeNull();
      expect(preview.data![0].object_key).toBe(frames[0].deliveryKey);
      const authorised = await trusted.rpc("authorize_delivery_download", {
        delivery_token: link.token,
        target_asset: frames[0].assetId,
      });
      expect(authorised.error).toBeNull();
      expect(authorised.data![0].object_key).toBe(frames[0].deliveryKey);
      const recorded = await trusted.rpc("record_delivery_download", {
        delivery_token: link.token,
        target_asset: frames[0].assetId,
      });
      expect(recorded.error).toBeNull();
      expect(recorded.data).toHaveLength(1);
      expect(
        (await eventsFor(link.id)).filter((event) => event.kind === "downloaded"),
      ).toHaveLength(1);
    });

    it("gives a recipient no way to fabricate a download through PostgREST", async () => {
      const { submissionId, frames } = await approved("FORGE", { frames: 1 });
      const link = await linkFor(submissionId);
      await accept(link.token);
      const anon = anonClient();

      // Not through the function...
      const viaFunction = await anon.rpc("record_delivery_download", {
        delivery_token: link.token,
        target_asset: frames[0].assetId,
      });
      expect(viaFunction.error?.code).toBe("42501");

      // ...and not through the table, which anon holds no privilege on.
      const viaTable = await anon.from("delivery_access_events").insert({
        organization_id: ORG_A,
        delivery_id: link.id,
        kind: "downloaded",
        asset_id: frames[0].assetId,
      });
      expect(viaTable.error).toBeTruthy();

      // Nor can it read the record back.
      const read = await anon
        .from("delivery_access_events")
        .select("id")
        .eq("delivery_id", link.id);
      expect(read.data ?? []).toHaveLength(0);

      const downloads = (await eventsFor(link.id)).filter((event) => event.kind === "downloaded");
      expect(downloads).toHaveLength(0);
    });

    it("leaves the safe-output functions open, returning nothing private", async () => {
      const { submissionId, frames } = await approved("SAFEOUT", { frames: 1 });
      const link = await linkFor(submissionId);
      const anon = anonClient();

      const opened = await anon.rpc("open_delivery", { delivery_token: link.token });
      expect(opened.error).toBeNull();
      const listed = await anon.rpc("delivery_assets", { delivery_token: link.token });
      expect(listed.error).toBeNull();
      const agreed = await anon.rpc("accept_delivery", {
        delivery_token: link.token,
        accepted_by_name: "Dana Whitfield",
      });
      expect(agreed.error).toBeNull();

      const rendered = JSON.stringify([opened.data, listed.data, agreed.data]);
      for (const secret of [
        frames[0].deliveryKey!,
        frames[0].originalKey,
        link.token,
        "object_key",
        "storage_bucket",
        "preview_key",
        "ip_address",
        "user_agent",
        "organization_id",
        "delivery_id",
      ]) {
        expect(rendered, `safe output must not carry ${secret}`).not.toContain(secret);
      }
    });
  },
);

// ---------------------------------------------------------------------------
// One preview: reviewed, frozen, served
// ---------------------------------------------------------------------------

describeIf("review, approval, and recipient agree on the preview", () => {
  it("freezes the preview the review screen selects, whatever order the rows arrive in", async () => {
    const editor = await clientFor("editor");
    const dispatcher = await clientFor("dispatcher");
    const service = serviceClient();
    const { shootId, frames } = await readyShoot("MULTIPREVIEW", {
      frames: 1,
      withPreview: true,
    });
    const [frame] = frames;

    // A second preview of the same frame, older than the one the fixture made
    // and inserted afterwards, so insertion order and created_at disagree.
    const olderKey = `${ORG_A}/${shootId}/MULTIPREVIEW_0_older_preview.jpg`;
    const { data: older, error: olderError } = await service
      .from("asset_versions")
      .insert({
        organization_id: ORG_A,
        asset_id: frame.assetId,
        version_kind: "preview",
        storage_bucket: "derivatives",
        object_key: olderKey,
        sha256: await digest(`older-preview-${shootId}`),
        bytes: 110,
        mime_type: "image/jpeg",
        created_by: OWNER,
        created_at: new Date(Date.now() - 3_600_000).toISOString(),
      })
      .select("id, sha256")
      .single();
    expect(olderError).toBeNull();

    // What the review screen renders: the shared rule over the loaded versions.
    const [asset] = await listAssets(ORG_A, { shootId }, dispatcher);
    const reviewed = reviewPreviewVersion(asset.versions);
    expect(reviewed?.id).toBe(older!.id);
    expect(reviewed?.objectKey).toBe(olderKey);

    const { id: packageId } = await createPackageFromSelection({
      client: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      buyerId: BACKGRID,
      name: "Multi-preview package",
      deliveryMethod: "SFTP",
      proposedTerms: "Terms.",
    });
    const { submissionId } = await approvePackageAndCreateSubmission({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      packageId,
    });

    // What approval froze: the same version, the same digest.
    const [row] = await snapshotRows(submissionId);
    expect(row.preview_asset_version_id).toBe(reviewed!.id);
    expect(row.preview_object_key_snapshot).toBe(reviewed!.objectKey);
    expect(row.preview_sha256_snapshot).toBe(reviewed!.sha256);
    expect(row.preview_sha256_snapshot).toBe(older!.sha256);

    // What the recipient is served: the same object again.
    const link = await linkFor(submissionId);
    const served = await service.rpc("delivery_preview", {
      delivery_token: link.token,
      target_asset: frame.assetId,
    });
    expect(served.data![0].object_key).toBe(reviewed!.objectKey);
    expect(served.data![0].sha256).toBe(reviewed!.sha256);
    expect(served.data![0].snapshot_id).toBe(row.id);

    // A preview and a delivery derivative made afterwards change neither the
    // preview nor the download.
    const laterPreview = await laterVersion(frame.assetId, shootId, "preview", "MULTIPREVIEW");
    const laterDelivery = await laterVersion(frame.assetId, shootId, "delivery", "MULTIPREVIEW");
    const servedAgain = await service.rpc("delivery_preview", {
      delivery_token: link.token,
      target_asset: frame.assetId,
    });
    expect(servedAgain.data).toEqual(served.data);
    expect(servedAgain.data![0].object_key).not.toBe(laterPreview.key);

    await accept(link.token);
    const download = await service.rpc("authorize_delivery_download", {
      delivery_token: link.token,
      target_asset: frame.assetId,
    });
    expect(download.data![0].object_key).toBe(frame.deliveryKey);
    expect(download.data![0].object_key).not.toBe(laterDelivery.key);

    // The review screen's rule still names the frozen preview afterwards, so
    // a reviewer reopening the package sees what was approved.
    const [reloaded] = await listAssets(ORG_A, { shootId }, dispatcher);
    expect(reviewPreviewVersion(reloaded.versions)?.id).toBe(row.preview_asset_version_id);
  });

  it("caches a marked preview per snapshot, so a second approval of the same frame never reuses it", async () => {
    const editor = await clientFor("editor");
    const dispatcher = await clientFor("dispatcher");
    const service = serviceClient();
    const {
      submissionId: first,
      frames,
      shootId,
    } = await approved("CACHEKEY", {
      frames: 1,
      withPreview: true,
    });
    const [frame] = frames;

    // The frame is corrected and re-approved in a new package: a new preview
    // is what the photographer wants the next recipient to see.
    const revised = await laterVersion(frame.assetId, shootId, "preview", "CACHEKEY");
    // The rule freezes the earliest preview, so the revision has to be the
    // earliest: the first preview is what the first approval froze, and its
    // row cannot be removed -- so this test makes the revision older instead.
    await service
      .from("asset_versions")
      .update({ created_at: new Date(Date.now() - 7_200_000).toISOString() })
      .eq("id", revised.id)
      .then((result) => {
        // asset_versions is append-only; an update is refused. That is the
        // point: the frozen preview cannot be re-pointed by editing versions.
        expect(result.error).toBeTruthy();
      });

    const { id: packageId } = await createPackageFromSelection({
      client: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      buyerId: BACKGRID,
      name: "Second approval",
      deliveryMethod: "SFTP",
      proposedTerms: "Terms.",
    });
    const { submissionId: second } = await approvePackageAndCreateSubmission({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      packageId,
    });

    const [firstRow] = await snapshotRows(first);
    const [secondRow] = await snapshotRows(second);
    expect(secondRow.id).not.toBe(firstRow.id);

    const token = "T".repeat(43);
    const firstKey = markedPreviewKey({
      token,
      snapshotId: firstRow.id,
      sha256: firstRow.preview_sha256_snapshot,
    });
    const secondKey = markedPreviewKey({
      token,
      snapshotId: secondRow.id,
      sha256: secondRow.preview_sha256_snapshot,
    });
    expect(firstKey).not.toBe(secondKey);

    // ...and through the functions the routes actually call.
    const firstLink = await linkFor(first, "First desk");
    const secondLink = await linkFor(second, "Second desk");
    const [a, b] = await Promise.all([
      service.rpc("delivery_preview", {
        delivery_token: firstLink.token,
        target_asset: frame.assetId,
      }),
      service.rpc("delivery_preview", {
        delivery_token: secondLink.token,
        target_asset: frame.assetId,
      }),
    ]);
    expect(a.data![0].snapshot_id).toBe(firstRow.id);
    expect(b.data![0].snapshot_id).toBe(secondRow.id);
    expect(
      markedPreviewKey({
        token: firstLink.token,
        snapshotId: a.data![0].snapshot_id,
        sha256: a.data![0].sha256,
      }),
    ).not.toBe(
      markedPreviewKey({
        token: secondLink.token,
        snapshotId: b.data![0].snapshot_id,
        sha256: b.data![0].sha256,
      }),
    );
  });
});
