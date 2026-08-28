/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { registerImport, stagingKeyFor } from "../src/lib/data/imports";
import { updateAssetMetadata } from "../src/lib/data/assets";
import { createShoot, shootCreatedWithToken } from "../src/lib/data/shoots";
import {
  parseShootAssetDefaults,
  parseShootBrief,
  parseStagedPhotographs,
} from "../src/lib/validation";
import {
  ORG_A,
  ORG_B,
  clientFor,
  hasLocalSupabase,
  purgeShoot,
  serviceClient,
} from "./helpers/supabase";

/**
 * Creating a shoot on one page, against the database.
 *
 * The Server Action cannot be called from here -- it reads the session from
 * request cookies -- so this exercises the sequence it performs, as the roles
 * that really perform it: parse what the browser sent, create the draft, then
 * register each staged file against it. The form's half is covered in
 * src/app/[workspace]/shoots/new/shoot-form.test.tsx, and the two meet in the
 * browser tests.
 *
 * The property under test is mostly about what does NOT happen. Creating a
 * shoot is private workspace activity: one draft row, its assets, and nothing
 * else. No package, no submission, no delivery, no change to the shoot's
 * status, and nothing another organization can see.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const EDITOR = "22222222-2222-2222-2222-222222222222";
const VIEWER = "66666666-6666-6666-6666-666666666666";
/** Nadia, the owner of Org B. Used to prove the boundary from the outside. */
const OUTSIDER = "99999999-9999-9999-9999-999999999999";

const shoots: string[] = [];

afterAll(async () => {
  for (const shootId of shoots) await purgeShoot(shootId);
});

async function digest(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Put bytes where the browser would have put them, and describe them as it would. */
async function stage(content: string, filename: string) {
  const editor = await clientFor("editor");
  const token = crypto.randomUUID().replace(/-/g, "");
  const key = stagingKeyFor(ORG_A, token);
  const blob = new Blob([content], { type: "image/jpeg" });
  const { error } = await editor.storage
    .from("originals")
    .upload(key, blob, { contentType: "image/jpeg" });
  if (error) throw new Error(`staging failed: ${error.message}`);

  return {
    filename,
    sha256: await digest(content),
    bytes: blob.size,
    mimeType: "image/jpeg",
    capturedAt: "2026-08-27T18:47:18.000Z",
    width: 6000,
    height: 4000,
    stagingKey: key,
  };
}

/** The form the creation page submits. */
function submission(fields: Record<string, string>, photographs: unknown[] = []): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set("photographs", JSON.stringify(photographs));
  return form;
}

/**
 * What createShootAction does with a parsed submission, minus the redirect.
 *
 * Kept deliberately close to the action so a change there that this does not
 * mirror shows up as a compile error rather than as a passing test of code
 * nobody runs.
 */
async function createDraft(form: FormData, actorId = EDITOR, user: "editor" | "viewer" = "editor") {
  const client = await clientFor(user);
  const brief = parseShootBrief(form);
  const staged = parseStagedPhotographs(form);
  const defaults = parseShootAssetDefaults(form);

  if (!brief.ok) return { ok: false as const, errors: brief.errors };
  if (!staged.ok) return { ok: false as const, errors: { photographs: staged.error } };

  const clientToken = String(form.get("clientToken") ?? "");
  const already = await shootCreatedWithToken({
    client,
    organizationId: ORG_A,
    actorId,
    clientToken,
  });
  if (already) return { ok: true as const, shootId: already, repeated: true, assetIds: [] };

  const created = await createShoot({
    client,
    organizationId: ORG_A,
    actorId,
    brief: brief.value,
    clientToken,
  });
  shoots.push(created.id);

  const assetIds: string[] = [];
  for (const photograph of staged.value) {
    const imported = await registerImport({
      supabase: client,
      organizationId: ORG_A,
      actorId,
      shootId: created.id,
      facts: photograph,
      defaults: {
        creatorName: "Jordan Ellis",
        creditLine: defaults.creditLine,
        copyrightNotice: defaults.copyrightNotice,
        locationName: brief.value.locationName,
        usageRestrictions: defaults.usageRestrictions,
      },
    });
    assetIds.push(imported.assetId);

    await updateAssetMetadata({
      client,
      organizationId: ORG_A,
      actorId,
      assetId: imported.assetId,
      metadata: {
        ...photograph.metadata,
        keywords: [...new Set([...defaults.keywords, ...photograph.metadata.keywords])],
        locationName: photograph.metadata.locationName ?? brief.value.locationName,
        creditLine: photograph.metadata.creditLine ?? defaults.creditLine,
        copyrightNotice: photograph.metadata.copyrightNotice ?? defaults.copyrightNotice,
        usageRestrictions: photograph.metadata.usageRestrictions ?? defaults.usageRestrictions,
      },
    });
  }

  return { ok: true as const, shootId: created.id, repeated: false, assetIds };
}

describeIf("creating a shoot on one page", () => {
  it("writes exactly one draft, with its photographs and their metadata", async () => {
    const service = serviceClient();
    const title = `One page ${Date.now()}`;
    const first = await stage(`frame-a-${Date.now()}`, "MH_0001.jpg");
    const second = await stage(`frame-b-${Date.now()}`, "MH_0002.jpg");

    const result = await createDraft(
      submission(
        {
          title,
          priority: "high",
          locationName: "West 23rd Street",
          defaultCreditLine: "Jordan Ellis / Marcus Hale Studio",
          defaultCopyrightNotice: "© 2026 Jordan Ellis",
          defaultUsageRestrictions: "Editorial use only",
          defaultKeywords: "street, night",
        },
        [
          { ...first, metadata: { caption: "Leaving the hotel.", keywords: ["arrival"] } },
          { ...second, metadata: {} },
        ],
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Exactly one shoot carries this title. A second would mean the flow
    // created a record it did not tell anyone about.
    const { data: matching } = await service.from("shoots").select("id, status").eq("title", title);
    expect(matching).toHaveLength(1);
    expect(matching?.[0].status).toBe("draft");

    const { data: assets } = await service
      .from("assets")
      .select(
        "id, status, caption, credit_line, copyright_notice, usage_restrictions, keywords, location_name",
      )
      .eq("shoot_id", result.shootId)
      .order("canonical_filename");

    expect(assets).toHaveLength(2);
    expect(assets?.every((asset) => asset.status === "active")).toBe(true);

    // One fact entered once: the shoot's metadata is on every frame.
    for (const asset of assets ?? []) {
      expect(asset.credit_line).toBe("Jordan Ellis / Marcus Hale Studio");
      expect(asset.copyright_notice).toBe("© 2026 Jordan Ellis");
      expect(asset.usage_restrictions).toBe("Editorial use only");
      expect(asset.location_name).toBe("West 23rd Street");
      expect(asset.keywords).toEqual(expect.arrayContaining(["street", "night"]));
    }

    // And the per-frame caption is on the frame it was typed against.
    const captioned = assets?.find((asset) => asset.caption === "Leaving the hotel.");
    expect(captioned).toBeDefined();
    expect(captioned?.keywords).toEqual(expect.arrayContaining(["street", "night", "arrival"]));
  });

  it("preserves each original untouched, with its digest", async () => {
    const service = serviceClient();
    const content = `original-${Date.now()}`;
    const staged = await stage(content, "MH_0010.jpg");

    const result = await createDraft(
      submission({ title: `Originals ${Date.now()}`, priority: "standard" }, [
        { ...staged, metadata: {} },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: versions } = await service
      .from("asset_versions")
      .select("version_kind, storage_bucket, sha256, bytes")
      .eq("asset_id", result.assetIds[0]);

    expect(versions).toHaveLength(1);
    expect(versions?.[0]).toMatchObject({
      version_kind: "original",
      storage_bucket: "originals",
      sha256: await digest(content),
    });
  });

  it("leaves the shoot a private draft and nothing else", async () => {
    const service = serviceClient();
    const staged = await stage(`quiet-${Date.now()}`, "MH_0020.jpg");

    const result = await createDraft(
      submission({ title: `Nothing sent ${Date.now()}`, priority: "urgent" }, [
        { ...staged, metadata: { caption: "A complete caption." } },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // No package, so no submission, so no delivery and no buyer heard anything.
    const { data: packages } = await service
      .from("packages")
      .select("id")
      .eq("shoot_id", result.shootId);
    expect(packages ?? []).toEqual([]);

    // Nothing is selected for dispatch either: selection is a later decision.
    const { data: assets } = await service
      .from("assets")
      .select("selected")
      .eq("shoot_id", result.shootId);
    expect(assets?.every((asset) => asset.selected === false)).toBe(true);

    // The only events are the ones creating a draft produces. Nothing here
    // sends, delivers, licenses, or bills, so no such event may exist.
    const { data: shootEvents } = await service
      .from("activity_events")
      .select("action")
      .eq("organization_id", ORG_A)
      .eq("entity_id", result.shootId);
    expect(shootEvents?.map((event) => event.action)).toEqual(["shoot.created"]);

    const { data: assetEvents } = await service
      .from("activity_events")
      .select("action")
      .eq("organization_id", ORG_A)
      .in("entity_id", result.assetIds);
    expect([...new Set((assetEvents ?? []).map((event) => event.action))].sort()).toEqual([
      "asset.imported",
      "asset.metadata_edited",
    ]);
  });

  it("does not advance the shoot past draft when files arrive with it", async () => {
    const service = serviceClient();
    const staged = await stage(`still-draft-${Date.now()}`, "MH_0030.jpg");

    const result = await createDraft(
      submission({ title: `Still a draft ${Date.now()}`, priority: "standard" }, [
        { ...staged, metadata: {} },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: shoot } = await service
      .from("shoots")
      .select("status")
      .eq("id", result.shootId)
      .single();
    expect(shoot?.status).toBe("draft");
  });
});

describeIf("a submission that is repeated or refused", () => {
  it("lands a repeat on the shoot the first attempt made", async () => {
    const service = serviceClient();
    const title = `Double click ${Date.now()}`;
    const clientToken = crypto.randomUUID();
    const form = () => submission({ title, priority: "standard", clientToken });

    const first = await createDraft(form());
    const second = await createDraft(form());

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.shootId).toBe(first.shootId);
    expect(second.repeated).toBe(true);

    const { data: matching } = await service.from("shoots").select("id").eq("title", title);
    expect(matching).toHaveLength(1);
  });

  it("treats two shoots briefed with different tokens as two shoots", async () => {
    const title = `Same name ${Date.now()}`;
    const first = await createDraft(
      submission({ title, priority: "standard", clientToken: crypto.randomUUID() }),
    );
    const second = await createDraft(
      submission({ title, priority: "standard", clientToken: crypto.randomUUID() }),
    );

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.shootId).not.toBe(first.shootId);
  });

  it("writes nothing at all when the brief is refused", async () => {
    const service = serviceClient();
    const { count: before } = await service
      .from("shoots")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_A);

    const refused = await createDraft(submission({ title: "  ", priority: "standard" }));
    expect(refused.ok).toBe(false);

    const { count: after } = await service
      .from("shoots")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_A);
    expect(after).toBe(before);
  });

  it("writes nothing when a photograph's digest is not a digest", async () => {
    const service = serviceClient();
    const { count: before } = await service
      .from("shoots")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_A);

    const refused = await createDraft(
      submission({ title: `Bad digest ${Date.now()}`, priority: "standard" }, [
        { filename: "MH_0040.jpg", sha256: "nope", bytes: 10, stagingKey: "x", metadata: {} },
      ]),
    );
    expect(refused.ok).toBe(false);

    const { count: after } = await service
      .from("shoots")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_A);
    expect(after).toBe(before);
  });
});

describeIf("a draft belongs to the workspace that created it", () => {
  it("refuses a role that may read shoots but not write them", async () => {
    const viewer = await clientFor("viewer");

    await expect(
      createShoot({
        client: viewer,
        organizationId: ORG_A,
        actorId: VIEWER,
        brief: {
          title: `Viewer attempt ${Date.now()}`,
          priority: "standard",
          targetBuyerIds: [],
          sensitiveContent: false,
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a member of one workspace writing into another", async () => {
    const outsider = await clientFor("otherOrgOwner");

    await expect(
      createShoot({
        client: outsider,
        organizationId: ORG_A,
        actorId: OUTSIDER,
        brief: {
          title: `Cross tenant ${Date.now()}`,
          priority: "standard",
          targetBuyerIds: [],
          sensitiveContent: false,
        },
      }),
    ).rejects.toThrow();
  });

  it("hides a fresh draft from another workspace entirely", async () => {
    const created = await createDraft(
      submission({ title: `Private draft ${Date.now()}`, priority: "standard" }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const outsider = await clientFor("otherOrgOwner");
    const { data } = await outsider.from("shoots").select("id").eq("id", created.shootId);
    expect(data ?? []).toEqual([]);

    // And the idempotency lookup cannot be used to probe for one either.
    const probed = await shootCreatedWithToken({
      client: outsider,
      organizationId: ORG_B,
      actorId: OUTSIDER,
      clientToken: "anything",
    });
    expect(probed).toBeNull();
  });
});
