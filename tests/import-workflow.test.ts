/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { ORG_A, clientFor, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * The import contract from docs/ACCEPTANCE.md, exercised against the database
 * and real storage rather than against a mock of either.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const created: string[] = [];

async function digest(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeShoot(title: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("shoots")
    .insert({ organization_id: ORG_A, title, status: "draft", created_by: OWNER })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  created.push(data!.id as string);
  return data!.id as string;
}

afterAll(async () => {
  for (const shootId of created) await purgeShoot(shootId);
});

describeIf("a shoot exists before any file does", () => {
  it("creates a draft shoot with no assets", async () => {
    const shootId = await makeShoot(`Brief only ${Date.now()}`);
    const service = serviceClient();

    const { data: shoot } = await service
      .from("shoots")
      .select("status")
      .eq("id", shootId)
      .single();
    expect(shoot?.status).toBe("draft");

    const { data: assets } = await service.from("assets").select("id").eq("shoot_id", shootId);
    expect(assets ?? []).toHaveLength(0);
  });

  it("does not require a date or a location", async () => {
    const { data, error } = await serviceClient()
      .from("shoots")
      .insert({
        organization_id: ORG_A,
        title: `No time or place ${Date.now()}`,
        status: "draft",
        created_by: OWNER,
      })
      .select("id, starts_at, location_name")
      .single();

    expect(error).toBeNull();
    expect(data?.starts_at).toBeNull();
    expect(data?.location_name).toBeNull();
    created.push(data!.id as string);
  });
});

describeIf("an imported file records the facts that make it traceable", () => {
  it("stores hash, size, MIME type, object key, and import time", async () => {
    const shootId = await makeShoot(`Import facts ${Date.now()}`);
    const service = serviceClient();
    const sha = await digest(`bytes-${Date.now()}`);

    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_A,
        shoot_id: shootId,
        status: "ingesting",
        canonical_filename: "MH_TEST_0001",
        created_by: OWNER,
      })
      .select("id")
      .single();

    const objectKey = `${ORG_A}/${shootId}/${sha.slice(0, 12)}-MH_TEST_0001.arw`;
    const { data: version, error } = await service
      .from("asset_versions")
      .insert({
        organization_id: ORG_A,
        asset_id: asset!.id,
        version_kind: "original",
        storage_bucket: "originals",
        object_key: objectKey,
        sha256: sha,
        bytes: 52_428_800,
        mime_type: "image/x-sony-arw",
        created_by: OWNER,
      })
      .select("sha256, bytes, mime_type, object_key, created_at")
      .single();

    expect(error).toBeNull();
    expect(version?.sha256).toBe(sha);
    expect(Number(version?.bytes)).toBe(52_428_800);
    expect(version?.mime_type).toBe("image/x-sony-arw");
    expect(version?.object_key).toBe(objectKey);
    expect(version?.created_at).toBeTruthy();
  });

  it("refuses a digest that is not a SHA-256 hex string", async () => {
    const shootId = await makeShoot(`Bad digest ${Date.now()}`);
    const service = serviceClient();
    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_A,
        shoot_id: shootId,
        status: "ingesting",
        canonical_filename: "MH_BAD",
        created_by: OWNER,
      })
      .select("id")
      .single();

    const { error } = await service.from("asset_versions").insert({
      organization_id: ORG_A,
      asset_id: asset!.id,
      version_kind: "original",
      storage_bucket: "originals",
      object_key: `${ORG_A}/${shootId}/bad.arw`,
      sha256: "not-a-hash",
      bytes: 10,
      mime_type: "image/jpeg",
      created_by: OWNER,
    });
    expect(error).not.toBeNull();
  });

  it("refuses a zero-byte file", async () => {
    const shootId = await makeShoot(`Zero bytes ${Date.now()}`);
    const service = serviceClient();
    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_A,
        shoot_id: shootId,
        status: "ingesting",
        canonical_filename: "MH_ZERO",
        created_by: OWNER,
      })
      .select("id")
      .single();

    const { error } = await service.from("asset_versions").insert({
      organization_id: ORG_A,
      asset_id: asset!.id,
      version_kind: "original",
      storage_bucket: "originals",
      object_key: `${ORG_A}/${shootId}/zero.arw`,
      sha256: await digest("zero"),
      bytes: 0,
      mime_type: "image/jpeg",
      created_by: OWNER,
    });
    expect(error).not.toBeNull();
  });

  it("refuses two files at the same object key in one workspace", async () => {
    const shootId = await makeShoot(`Key collision ${Date.now()}`);
    const service = serviceClient();
    const key = `${ORG_A}/${shootId}/collide.arw`;

    const makeAsset = async (name: string) => {
      const { data } = await service
        .from("assets")
        .insert({
          organization_id: ORG_A,
          shoot_id: shootId,
          status: "ingesting",
          canonical_filename: name,
          created_by: OWNER,
        })
        .select("id")
        .single();
      return data!.id as string;
    };

    const first = await makeAsset("MH_A");
    const second = await makeAsset("MH_B");

    await service.from("asset_versions").insert({
      organization_id: ORG_A,
      asset_id: first,
      version_kind: "original",
      storage_bucket: "originals",
      object_key: key,
      sha256: await digest("one"),
      bytes: 10,
      mime_type: "image/jpeg",
      created_by: OWNER,
    });

    const { error } = await service.from("asset_versions").insert({
      organization_id: ORG_A,
      asset_id: second,
      version_kind: "original",
      storage_bucket: "originals",
      object_key: key,
      sha256: await digest("two"),
      bytes: 10,
      mime_type: "image/jpeg",
      created_by: OWNER,
    });
    expect(error?.code).toBe("23505");
  });
});

describeIf("a derivative cannot displace an original", () => {
  it("keeps the original and the derivative as separate rows", async () => {
    const shootId = await makeShoot(`Two versions ${Date.now()}`);
    const service = serviceClient();
    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_A,
        shoot_id: shootId,
        status: "ingesting",
        canonical_filename: "MH_VERSIONS",
        created_by: OWNER,
      })
      .select("id")
      .single();

    await service.from("asset_versions").insert({
      organization_id: ORG_A,
      asset_id: asset!.id,
      version_kind: "original",
      storage_bucket: "originals",
      object_key: `${ORG_A}/${shootId}/versions.arw`,
      sha256: await digest("original"),
      bytes: 50_000_000,
      mime_type: "image/x-sony-arw",
      created_by: OWNER,
    });

    const { error } = await service.from("asset_versions").insert({
      organization_id: ORG_A,
      asset_id: asset!.id,
      version_kind: "preview",
      storage_bucket: "derivatives",
      object_key: `${ORG_A}/derivatives/${asset!.id}/preview.jpg`,
      sha256: await digest("preview"),
      bytes: 200_000,
      mime_type: "image/jpeg",
      created_by: OWNER,
    });
    expect(error).toBeNull();

    const { data: versions } = await service
      .from("asset_versions")
      .select("version_kind, storage_bucket")
      .eq("asset_id", asset!.id);

    expect(versions).toHaveLength(2);
    const original = versions!.find((v) => v.version_kind === "original");
    expect(original?.storage_bucket).toBe("originals");
  });
});

describeIf("editing metadata never destroys what was there", () => {
  it("keeps the prior caption in the revision log", async () => {
    const shootId = await makeShoot(`Caption history ${Date.now()}`);
    const service = serviceClient();
    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_A,
        shoot_id: shootId,
        status: "active",
        canonical_filename: "MH_CAPTION",
        caption: "First description of the frame.",
        created_by: OWNER,
      })
      .select("id, caption")
      .single();

    // What the data layer does: log the old value, then write the new one.
    await service.from("asset_caption_revisions").insert({
      organization_id: ORG_A,
      asset_id: asset!.id,
      caption: asset!.caption,
      edited_by: OWNER,
    });
    await service
      .from("assets")
      .update({ caption: "Second, corrected description." })
      .eq("id", asset!.id);

    const { data: current } = await service
      .from("assets")
      .select("caption")
      .eq("id", asset!.id)
      .single();
    expect(current?.caption).toBe("Second, corrected description.");

    const { data: history } = await service
      .from("asset_caption_revisions")
      .select("caption")
      .eq("asset_id", asset!.id);
    expect(history).toHaveLength(1);
    expect(history![0].caption).toBe("First description of the frame.");
  });

  it("cannot rewrite a revision after the fact", async () => {
    const shootId = await makeShoot(`Immutable history ${Date.now()}`);
    const service = serviceClient();
    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_A,
        shoot_id: shootId,
        status: "active",
        canonical_filename: "MH_IMMUTABLE",
        created_by: OWNER,
      })
      .select("id")
      .single();

    const { data: revision } = await service
      .from("asset_caption_revisions")
      .insert({
        organization_id: ORG_A,
        asset_id: asset!.id,
        caption: "Original wording",
        edited_by: OWNER,
      })
      .select("id")
      .single();

    const { error } = await service
      .from("asset_caption_revisions")
      .update({ caption: "Rewritten" })
      .eq("id", revision!.id);
    expect(error).not.toBeNull();
  });
});

describeIf("tombstoning replaces deletion", () => {
  it("marks the asset and keeps its original version", async () => {
    const shootId = await makeShoot(`Tombstone ${Date.now()}`);
    const service = serviceClient();
    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_A,
        shoot_id: shootId,
        status: "active",
        canonical_filename: "MH_TOMB",
        created_by: OWNER,
      })
      .select("id")
      .single();

    await service.from("asset_versions").insert({
      organization_id: ORG_A,
      asset_id: asset!.id,
      version_kind: "original",
      storage_bucket: "originals",
      object_key: `${ORG_A}/${shootId}/tomb.arw`,
      sha256: await digest("tomb"),
      bytes: 1000,
      mime_type: "image/x-sony-arw",
      created_by: OWNER,
    });

    const owner = await clientFor("owner");
    const { error } = await owner
      .from("assets")
      .update({ status: "tombstoned", tombstone_reason: "Subject requested removal" })
      .eq("id", asset!.id);
    expect(error).toBeNull();

    const { data: after } = await service
      .from("assets")
      .select("status, tombstoned_at, tombstoned_by, tombstone_reason")
      .eq("id", asset!.id)
      .single();
    expect(after?.status).toBe("tombstoned");
    expect(after?.tombstoned_at).not.toBeNull();
    expect(after?.tombstoned_by).toBe(OWNER);

    // The bytes are retained.
    const { data: versions } = await service
      .from("asset_versions")
      .select("id")
      .eq("asset_id", asset!.id);
    expect(versions).toHaveLength(1);
  });
});

describeIf("private storage round trip", () => {
  it("uploads, promotes, reads back, and stays unreadable to another workspace", async () => {
    const shootId = await makeShoot(`Storage ${Date.now()}`);
    const editor = await clientFor("editor");
    const other = await clientFor("otherOrgOwner");

    const stagingKey = `${ORG_A}/_staging/${crypto.randomUUID().replace(/-/g, "")}`;
    const finalKey = `${ORG_A}/${shootId}/promoted.jpg`;
    const body = new Blob(["real-original-bytes"], { type: "image/jpeg" });

    const upload = await editor.storage.from("originals").upload(stagingKey, body, {
      contentType: "image/jpeg",
    });
    expect(upload.error).toBeNull();

    const moved = await editor.storage.from("originals").move(stagingKey, finalKey);
    expect(moved.error).toBeNull();

    const signed = await editor.storage.from("originals").createSignedUrl(finalKey, 60);
    expect(signed.data?.signedUrl).toBeTruthy();

    const download = await editor.storage.from("originals").download(finalKey);
    expect(download.error).toBeNull();
    expect(await download.data!.text()).toBe("real-original-bytes");

    const foreign = await other.storage.from("originals").createSignedUrl(finalKey, 60);
    expect(foreign.data?.signedUrl ?? null).toBeNull();

    await serviceClient().storage.from("originals").remove([finalKey]);
  });

  it("refuses an upload into another workspace's prefix", async () => {
    const editor = await clientFor("editor");
    const { error } = await editor.storage
      .from("originals")
      .upload(`bbbbbbbb-0000-0000-0000-000000000002/_staging/rogue`, new Blob(["x"]));
    expect(error).not.toBeNull();
  });
});
