/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { canonicalObjectKey, registerImport, stagingKeyFor } from "../src/lib/data/imports";
import { ORG_A, clientFor, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * The real import orchestration, not a re-implementation of it in SQL.
 *
 * registerImport takes the caller's client, so these run through exactly the
 * code path a Server Action uses, with row level security in force.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const EDITOR = "22222222-2222-2222-2222-222222222222";
const shoots: string[] = [];

async function digest(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeShoot(): Promise<string> {
  const { data } = await serviceClient()
    .from("shoots")
    .insert({
      organization_id: ORG_A,
      title: `Orchestration ${Date.now()}-${Math.round(performance.now())}`,
      status: "draft",
      created_by: EDITOR,
    })
    .select("id")
    .single();
  shoots.push(data!.id as string);
  return data!.id as string;
}

/** Stage bytes the way the browser does, and return the staging key. */
async function stage(content: string): Promise<{ key: string; sha: string; bytes: number }> {
  const editor = await clientFor("editor");
  const token = crypto.randomUUID().replace(/-/g, "");
  const key = stagingKeyFor(ORG_A, token);
  const blob = new Blob([content], { type: "image/jpeg" });
  const { error } = await editor.storage.from("originals").upload(key, blob, {
    contentType: "image/jpeg",
  });
  if (error) throw new Error(`staging failed: ${error.message}`);
  return { key, sha: await digest(content), bytes: blob.size };
}

afterAll(async () => {
  for (const shootId of shoots) await purgeShoot(shootId);
});

describeIf("registerImport", () => {
  it("creates the record, promotes the bytes, and marks the asset active", async () => {
    const editor = await clientFor("editor");
    const shootId = await makeShoot();
    const content = `original-${Date.now()}`;
    const staged = await stage(content);

    const result = await registerImport({
      supabase: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      facts: {
        filename: "MH_0819_0501.jpg",
        sha256: staged.sha,
        bytes: staged.bytes,
        mimeType: "image/jpeg",
        capturedAt: "2026-08-19T18:47:18.000Z",
        width: 8640,
        height: 5760,
        stagingKey: staged.key,
      },
      defaults: {
        creatorName: "Jordan Ellis",
        creditLine: "Jordan Ellis / Marcus Hale Studio",
        copyrightNotice: "© 2026 Jordan Ellis",
        locationName: "New York, NY",
      },
    });

    expect(result.assetId).toBeTruthy();

    const service = serviceClient();
    const { data: asset } = await service
      .from("assets")
      .select(
        "status, canonical_filename, captured_at, credit_line, copyright_notice, location_name",
      )
      .eq("id", result.assetId)
      .single();

    expect(asset?.status).toBe("active");
    // The extension is stripped so the record reads like a frame number.
    expect(asset?.canonical_filename).toBe("MH_0819_0501");
    expect(asset?.captured_at).toBe("2026-08-19T18:47:18+00:00");
    // Facts inherited from the workspace and the shoot, entered once.
    expect(asset?.credit_line).toBe("Jordan Ellis / Marcus Hale Studio");
    expect(asset?.copyright_notice).toBe("© 2026 Jordan Ellis");
    expect(asset?.location_name).toBe("New York, NY");

    const expectedKey = canonicalObjectKey(ORG_A, shootId, staged.sha, "MH_0819_0501.jpg");
    const { data: version } = await service
      .from("asset_versions")
      .select(
        "version_kind, storage_bucket, object_key, sha256, bytes, mime_type, technical_metadata",
      )
      .eq("asset_id", result.assetId)
      .single();

    expect(version?.version_kind).toBe("original");
    expect(version?.storage_bucket).toBe("originals");
    expect(version?.object_key).toBe(expectedKey);
    expect(version?.sha256).toBe(staged.sha);
    expect(Number(version?.bytes)).toBe(staged.bytes);
    expect((version?.technical_metadata as Record<string, string>)?.imported_at).toBeTruthy();
    expect((version?.technical_metadata as Record<string, string>)?.original_filename).toBe(
      "MH_0819_0501.jpg",
    );

    // The bytes are actually at the canonical key, and are the bytes we staged.
    const download = await editor.storage.from("originals").download(expectedKey);
    expect(download.error).toBeNull();
    expect(await download.data!.text()).toBe(content);

    // Nothing is left behind in staging.
    const { data: leftovers } = await editor.storage.from("originals").list(`${ORG_A}/_staging`);
    expect((leftovers ?? []).some((entry) => staged.key.endsWith(entry.name))).toBe(false);
  });

  it("writes an activity event carrying the traceable facts", async () => {
    const editor = await clientFor("editor");
    const shootId = await makeShoot();
    const staged = await stage(`event-${Date.now()}`);

    const result = await registerImport({
      supabase: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      facts: {
        filename: "MH_EVENT.jpg",
        sha256: staged.sha,
        bytes: staged.bytes,
        mimeType: "image/jpeg",
        stagingKey: staged.key,
      },
      defaults: {},
    });

    const { data: events } = await serviceClient()
      .from("activity_events")
      .select("action, actor_id, event_data")
      .eq("entity_id", result.assetId);

    expect(events).toHaveLength(1);
    expect(events![0].action).toBe("asset.imported");
    expect(events![0].actor_id).toBe(EDITOR);
    const payload = events![0].event_data as Record<string, unknown>;
    expect(payload.sha256).toBe(staged.sha);
    expect(payload.object_key).toBeTruthy();
  });

  it("reports a duplicate without refusing the import", async () => {
    const editor = await clientFor("editor");
    const shootId = await makeShoot();
    const content = `duplicate-${Date.now()}`;

    const first = await stage(content);
    const original = await registerImport({
      supabase: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      facts: {
        filename: "MH_DUP_A.jpg",
        sha256: first.sha,
        bytes: first.bytes,
        mimeType: "image/jpeg",
        stagingKey: first.key,
      },
      defaults: {},
    });
    expect(original.duplicateOf).toBeUndefined();

    // The same bytes again, into the same shoot under a different name.
    const second = await stage(content);
    const again = await registerImport({
      supabase: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      facts: {
        filename: "MH_DUP_B.jpg",
        sha256: second.sha,
        bytes: second.bytes,
        mimeType: "image/jpeg",
        stagingKey: second.key,
      },
      defaults: {},
    });

    // Reported, not blocked: the same frame may legitimately belong twice.
    expect(again.duplicateOf).toBe(original.assetId);
    expect(again.assetId).not.toBe(original.assetId);
  });

  it("refuses a staging key belonging to another workspace", async () => {
    const editor = await clientFor("editor");
    const shootId = await makeShoot();

    await expect(
      registerImport({
        supabase: editor,
        organizationId: ORG_A,
        actorId: EDITOR,
        shootId,
        facts: {
          filename: "MH_FOREIGN.jpg",
          sha256: await digest("foreign"),
          bytes: 10,
          mimeType: "image/jpeg",
          stagingKey: "bbbbbbbb-0000-0000-0000-000000000002/_staging/foreign",
        },
        defaults: {},
      }),
    ).rejects.toThrow(/does not belong to this workspace/i);
  });

  it("refuses a digest that is not SHA-256", async () => {
    const editor = await clientFor("editor");
    const shootId = await makeShoot();

    await expect(
      registerImport({
        supabase: editor,
        organizationId: ORG_A,
        actorId: EDITOR,
        shootId,
        facts: {
          filename: "MH_BADHASH.jpg",
          sha256: "nope",
          bytes: 10,
          mimeType: "image/jpeg",
          stagingKey: stagingKeyFor(ORG_A, "abc"),
        },
        defaults: {},
      }),
    ).rejects.toThrow(/SHA-256/i);
  });

  it("refuses a zero-byte file", async () => {
    const editor = await clientFor("editor");
    const shootId = await makeShoot();

    await expect(
      registerImport({
        supabase: editor,
        organizationId: ORG_A,
        actorId: EDITOR,
        shootId,
        facts: {
          filename: "MH_EMPTY.jpg",
          sha256: await digest("empty"),
          bytes: 0,
          mimeType: "image/jpeg",
          stagingKey: stagingKeyFor(ORG_A, "def"),
        },
        defaults: {},
      }),
    ).rejects.toThrow(/must have a size/i);
  });

  it("leaves nothing behind when the bytes were never staged", async () => {
    const editor = await clientFor("editor");
    const shootId = await makeShoot();
    const service = serviceClient();

    const before = await service.from("assets").select("id").eq("shoot_id", shootId);
    expect(before.data ?? []).toHaveLength(0);

    await expect(
      registerImport({
        supabase: editor,
        organizationId: ORG_A,
        actorId: EDITOR,
        shootId,
        facts: {
          filename: "MH_MISSING.jpg",
          sha256: await digest("missing"),
          bytes: 100,
          mimeType: "image/jpeg",
          // A well-formed key that holds nothing.
          stagingKey: stagingKeyFor(ORG_A, crypto.randomUUID().replace(/-/g, "")),
        },
        defaults: {},
      }),
    ).rejects.toThrow();

    // The promotion failed, so no asset should be left claiming those bytes.
    const after = await service
      .from("assets")
      .select("id, status")
      .eq("shoot_id", shootId)
      .eq("status", "active");
    expect(after.data ?? []).toHaveLength(0);
  });

  it("does not let a viewer import", async () => {
    const viewer = await clientFor("viewer");
    const shootId = await makeShoot();
    const staged = await stage(`viewer-${Date.now()}`);

    await expect(
      registerImport({
        supabase: viewer,
        organizationId: ORG_A,
        actorId: "66666666-6666-6666-6666-666666666666",
        shootId,
        facts: {
          filename: "MH_VIEWER.jpg",
          sha256: staged.sha,
          bytes: staged.bytes,
          mimeType: "image/jpeg",
          stagingKey: staged.key,
        },
        defaults: {},
      }),
    ).rejects.toThrow();
  });
});
