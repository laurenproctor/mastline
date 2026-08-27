/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyGeneratedMetadata,
  applyTechnicalMetadata,
  confirmMetadata,
  ensureMetadataRecord,
  getMetadata,
  listMetadata,
  saveMetadata,
} from "../src/lib/data/asset-metadata";
import { type MetadataInput, resolveMetadata } from "../src/lib/asset-metadata";
import type { GeneratedMetadata } from "../src/lib/metadata-suggestions";
import type { Shoot } from "../src/lib/domain";
import {
  ORG_A,
  ORG_B,
  ORG_B_ASSET,
  clientFor,
  hasLocalSupabase,
  purgeShoot,
  serviceClient,
} from "./helpers/supabase";

/**
 * The photograph metadata record, against the real database.
 *
 * Every rule this feature promises is enforced in two places -- application
 * code and a policy or trigger -- and only the second of those can be trusted
 * when the first is bypassed. These run against Postgres with row level
 * security in force so both are exercised, not a re-implementation of either.
 *
 * The AI provider is not involved here at all: nothing in this file calls a
 * model. `applyGeneratedMetadata` is handed a response directly, which is what
 * the worker does after the provider has answered.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const EDITOR = "22222222-2222-2222-2222-222222222222";

const shoots: string[] = [];

function shootRecord(id: string, overrides: Partial<Shoot> = {}): Shoot {
  return {
    id,
    organizationId: ORG_A,
    title: "Metadata fixture shoot",
    status: "preparing",
    priority: "standard",
    locationName: "Dean Street, London",
    targetBuyerIds: [],
    sensitiveContent: false,
    hasSensitiveNote: false,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
    ...overrides,
  };
}

async function makeShoot(title: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("shoots")
    .insert({
      organization_id: ORG_A,
      title: `${title} ${Date.now()}-${Math.round(performance.now())}`,
      status: "preparing",
      location_name: "Dean Street, London",
      created_by: OWNER,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  shoots.push(data!.id as string);
  return data!.id as string;
}

async function makeAsset(shootId: string, filename = "MH_0001"): Promise<string> {
  const { data, error } = await serviceClient()
    .from("assets")
    .insert({
      organization_id: ORG_A,
      shoot_id: shootId,
      status: "active",
      canonical_filename: `${filename}_${Math.round(performance.now())}`,
      caption: "A caption typed by hand.",
      credit_line: "Marcus Hale / Mastline",
      copyright_notice: "© 2026 Marcus Hale",
      captured_at: "2026-08-19T18:47:03.000Z",
      created_by: OWNER,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}

/** A complete form payload, as the panel submits one. */
function input(overrides: Partial<MetadataInput> = {}): MetadataInput {
  return {
    subjects: [],
    objects: [],
    clothing: [],
    brands: [],
    keywords: [],
    sensitivity: "none",
    editorialUseOnly: true,
    commercialUseEligible: "unknown",
    modelReleaseStatus: "unknown",
    propertyReleaseStatus: "unknown",
    sensitiveOrMinor: false,
    ...overrides,
  };
}

function generated(overrides: Partial<GeneratedMetadata> = {}): GeneratedMetadata {
  return {
    headline: "Two people leave a hotel",
    editorialCaption: "Two people walk out of a lit side entrance at night.",
    altText: "Two people walking out of a lit doorway at night.",
    scene: "walking to a waiting car",
    objects: ["car"],
    clothing: ["dark coat"],
    brands: [],
    keywords: ["hotel", "night"],
    contentCategory: "candid",
    qualityEstimate: "good",
    sensitivity: "none",
    basis: "Read from the image.",
    confidence: 0.68,
    fieldConfidence: { editorialCaption: 0.7 },
    ...overrides,
  };
}

afterAll(async () => {
  for (const shootId of shoots) await purgeShoot(shootId);
});

// ---------------------------------------------------------------------------

describeIf("a photograph gets a metadata record", () => {
  let shootId: string;
  let assetId: string;

  beforeAll(async () => {
    shootId = await makeShoot("Initialization");
    assetId = await makeAsset(shootId);
  });

  it("creates one seeded with what the container already told us", async () => {
    const editor = await clientFor("editor");
    await ensureMetadataRecord({
      supabase: editor,
      organizationId: ORG_A,
      assetId,
      seed: {
        originalFilename: "MH_0001.ARW",
        mimeType: "image/x-sony-arw",
        fileBytes: 52_428_800,
        width: 8640,
        height: 5760,
        checksumSha256: "a".repeat(64),
      },
    });

    const record = await getMetadata(ORG_A, assetId, editor);
    expect(record).not.toBeNull();
    expect(record?.generationStatus).toBe("not_generated");
    expect(record?.technical.originalFilename).toBe("MH_0001.ARW");
    expect(record?.technical.fileBytes).toBe(52_428_800);
    expect(record?.technical.source).toBe("file");
    expect(record?.version).toBe(1);
  });

  it("is idempotent, so a re-import does not fail and does not blank anything", async () => {
    const editor = await clientFor("editor");
    await ensureMetadataRecord({ supabase: editor, organizationId: ORG_A, assetId });

    const record = await getMetadata(ORG_A, assetId, editor);
    // The seed from the first call survives the second, which has none.
    expect(record?.technical.originalFilename).toBe("MH_0001.ARW");
  });

  it("records EXIF separately, and does not blank a value a later pass could not read", async () => {
    const editor = await clientFor("editor");

    await applyTechnicalMetadata({
      supabase: editor,
      organizationId: ORG_A,
      assetId,
      exif: {
        cameraMake: "SONY",
        cameraModel: "ILCE-1",
        lens: "FE 70-200mm F2.8 GM OSS II",
        iso: 800,
        apertureF: 2.8,
        capturedAt: "2026-08-19T17:47:03.000Z",
        capturedAtHasZone: false,
        extra: { software: "Mastline test" },
      },
    });

    let record = await getMetadata(ORG_A, assetId, editor);
    expect(record?.technical.cameraModel).toBe("ILCE-1");
    expect(record?.technical.source).toBe("exif");
    expect(record?.technical.raw.captured_at_zone).toBe("not recorded");

    // A second pass that read nothing must not undo the first.
    await applyTechnicalMetadata({ supabase: editor, organizationId: ORG_A, assetId, exif: null });
    record = await getMetadata(ORG_A, assetId, editor);
    expect(record?.technical.cameraModel).toBe("ILCE-1");
  });
});

// ---------------------------------------------------------------------------

describeIf("editing and confirming", () => {
  let shootId: string;
  let assetId: string;
  let shoot: Shoot;

  beforeAll(async () => {
    shootId = await makeShoot("Editing");
    assetId = await makeAsset(shootId);
    shoot = shootRecord(shootId);
    await ensureMetadataRecord({
      supabase: await clientFor("editor"),
      organizationId: ORG_A,
      assetId,
    });
  });

  it("records an edited field as a manual override and bumps the version", async () => {
    const editor = await clientFor("editor");
    const before = await getMetadata(ORG_A, assetId, editor);

    const outcome = await saveMetadata({
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId,
      values: input({ headline: "What I actually saw" }),
      expectedVersion: before!.version,
      shoot,
      client: editor,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.metadata.editorial.headline).toBe("What I actually saw");
    expect(outcome.metadata.manualOverrides).toContain("headline");
    expect(outcome.metadata.version).toBe(before!.version + 1);
  });

  it("does not freeze an inherited value the form sent back unchanged", async () => {
    // The venue arrives from the shoot brief and the panel renders it, so it
    // round-trips through the form. Saving must not turn it into an override,
    // or a later correction to the brief would stop reaching this frame.
    const editor = await clientFor("editor");
    const other = await makeAsset(shootId, "INH_0001");
    await ensureMetadataRecord({ supabase: editor, organizationId: ORG_A, assetId: other });

    const saved = await saveMetadata({
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId: other,
      values: input({ venue: shoot.locationName, eventName: shoot.title }),
      expectedVersion: 1,
      shoot,
      client: editor,
    });

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.metadata.manualOverrides).not.toContain("venue");
    expect(saved.metadata.manualOverrides).not.toContain("eventName");

    // The brief moves, and the frame follows it.
    const renamed = shootRecord(shootId, { locationName: "Greek Street, London" });
    const record = await getMetadata(ORG_A, other, editor);
    expect(resolveMetadata(record, renamed).fields.venue).toEqual({
      value: "Greek Street, London",
      provenance: "inherited",
    });
  });

  it("treats deliberately clearing an inherited value as an edit that sticks", async () => {
    // This is the case a null column alone cannot express: without recording
    // the override, the shoot's answer would simply flow back in on the next
    // render and the deletion would look like a bug.
    const editor = await clientFor("editor");
    const other = await makeAsset(shootId, "INH_0002");
    await ensureMetadataRecord({ supabase: editor, organizationId: ORG_A, assetId: other });

    const saved = await saveMetadata({
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId: other,
      values: input({ venue: undefined, eventName: shoot.title }),
      expectedVersion: 1,
      shoot,
      client: editor,
    });

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.metadata.manualOverrides).toContain("venue");
    expect(resolveMetadata(saved.metadata, shoot).fields.venue.value).toBeUndefined();
  });

  it("refuses a save carrying a stale version rather than overwriting a newer edit", async () => {
    const editor = await clientFor("editor");
    const current = await getMetadata(ORG_A, assetId, editor);

    const stale = await saveMetadata({
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId,
      values: input({ headline: "A second tab's idea" }),
      expectedVersion: current!.version - 1,
      shoot,
      client: editor,
    });

    expect(stale.ok).toBe(false);
    expect(stale.ok === false && stale.reason).toBe("stale");

    const after = await getMetadata(ORG_A, assetId, editor);
    expect(after?.editorial.headline).toBe("What I actually saw");
  });

  it("confirms, stamps who and when, and copies the words onto the asset", async () => {
    const editor = await clientFor("editor");
    const current = await getMetadata(ORG_A, assetId, editor);

    const saved = await saveMetadata({
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId,
      values: input({
        headline: "Two people leave a hotel",
        editorialCaption: "Two people walk out of a lit side entrance at night.",
        keywords: ["hotel", "night"],
      }),
      expectedVersion: current!.version,
      shoot,
      confirm: true,
      client: editor,
    });

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.metadata.generationStatus).toBe("confirmed");
    expect(saved.metadata.confirmedBy).toBe(EDITOR);
    expect(saved.metadata.confirmedAt).toBeTruthy();

    // The promise the confirmation dialog makes: these become the words a
    // dispatch sends.
    const { data: asset } = await serviceClient()
      .from("assets")
      .select("headline, caption, keywords")
      .eq("id", assetId)
      .single();
    expect(asset?.headline).toBe("Two people leave a hotel");
    expect(asset?.caption).toBe("Two people walk out of a lit side entrance at night.");
    expect(asset?.keywords).toEqual(["hotel", "night"]);

    // And the caption it replaced is still in the append-only log.
    const { data: revisions } = await serviceClient()
      .from("asset_caption_revisions")
      .select("caption")
      .eq("asset_id", assetId);
    expect((revisions ?? []).some((row) => row.caption === "A caption typed by hand.")).toBe(true);
  });

  it("confirms without a form when the photographer only wants to agree", async () => {
    const editor = await clientFor("editor");
    const other = await makeAsset(shootId, "MH_0002");
    await ensureMetadataRecord({ supabase: editor, organizationId: ORG_A, assetId: other });

    const outcome = await confirmMetadata({
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId: other,
      expectedVersion: 1,
      client: editor,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.metadata.generationStatus).toBe("confirmed");

    // And a second confirmation carrying the same version is refused.
    const replay = await confirmMetadata({
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId: other,
      expectedVersion: 1,
      client: editor,
    });
    expect(replay.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describeIf("generation against an existing record", () => {
  let shootId: string;
  let shoot: Shoot;

  beforeAll(async () => {
    shootId = await makeShoot("Generation");
    shoot = shootRecord(shootId);
  });

  async function prepared(filename: string): Promise<string> {
    const editor = await clientFor("editor");
    const assetId = await makeAsset(shootId, filename);
    await ensureMetadataRecord({ supabase: editor, organizationId: ORG_A, assetId });
    return assetId;
  }

  it("writes into empty fields and leaves the record needing review", async () => {
    const editor = await clientFor("editor");
    const assetId = await prepared("GEN_0001");

    const applied = await applyGeneratedMetadata({
      supabase: editor,
      organizationId: ORG_A,
      assetId,
      generated: generated(),
      model: "claude-haiku-4-5",
      modelVersion: "claude-haiku-4-5-20251001",
    });

    expect(applied.status).toBe("needs_review");
    expect(applied.written).toContain("headline");

    const record = await getMetadata(ORG_A, assetId, editor);
    expect(record?.generationStatus).toBe("needs_review");
    expect(record?.editorial.headline).toBe("Two people leave a hotel");
    expect(record?.aiModel).toBe("claude-haiku-4-5");
    expect(record?.overallConfidence).toBeCloseTo(0.68, 4);
    expect(record?.generatedValues).toMatchObject({ headline: "Two people leave a hotel" });
  });

  it("does not overwrite a field the photographer typed", async () => {
    const editor = await clientFor("editor");
    const assetId = await prepared("GEN_0002");

    await saveMetadata({
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId,
      values: input({ headline: "What I actually saw" }),
      expectedVersion: 1,
      shoot,
      client: editor,
    });

    const applied = await applyGeneratedMetadata({
      supabase: editor,
      organizationId: ORG_A,
      assetId,
      generated: generated(),
      model: "claude-haiku-4-5",
    });

    expect(applied.skipped).toContainEqual({ field: "headline", reason: "edited_by_hand" });

    const record = await getMetadata(ORG_A, assetId, editor);
    expect(record?.editorial.headline).toBe("What I actually saw");
    // Everything else still landed.
    expect(record?.editorial.scene).toBe("walking to a waiting car");
    // And the proposal is preserved for audit even though it was refused.
    expect(record?.generatedValues).toMatchObject({ headline: "Two people leave a hotel" });
  });

  it("writes nothing into a confirmed record, and does not un-confirm it", async () => {
    const editor = await clientFor("editor");
    const assetId = await prepared("GEN_0003");

    await saveMetadata({
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId,
      values: input({ headline: "Confirmed by a person" }),
      expectedVersion: 1,
      shoot,
      confirm: true,
      client: editor,
    });

    const applied = await applyGeneratedMetadata({
      supabase: editor,
      organizationId: ORG_A,
      assetId,
      generated: generated(),
      model: "claude-haiku-4-5",
    });

    expect(applied.written).toEqual([]);
    expect(applied.status).toBe("confirmed");

    const record = await getMetadata(ORG_A, assetId, editor);
    expect(record?.editorial.headline).toBe("Confirmed by a person");
    expect(record?.generationStatus).toBe("confirmed");
    expect(record?.confirmedBy).toBe(EDITOR);
    // The later opinion is still recorded, just not applied.
    expect(record?.generatedValues).toMatchObject({ headline: "Two people leave a hotel" });
  });

  it("never lowers a sensitivity somebody raised", async () => {
    const editor = await clientFor("editor");
    const assetId = await prepared("GEN_0004");

    await saveMetadata({
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId,
      values: input({ sensitivity: "sensitive" }),
      expectedVersion: 1,
      shoot,
      client: editor,
    });

    await applyGeneratedMetadata({
      supabase: editor,
      organizationId: ORG_A,
      assetId,
      generated: generated({ sensitivity: "none" }),
      model: "claude-haiku-4-5",
    });

    const record = await getMetadata(ORG_A, assetId, editor);
    expect(record?.editorial.sensitivity).toBe("sensitive");
  });
});

// ---------------------------------------------------------------------------

describeIf("the database refuses what the application also refuses", () => {
  let shootId: string;
  let assetId: string;

  beforeAll(async () => {
    shootId = await makeShoot("Triggers");
    assetId = await makeAsset(shootId, "TRG_0001");
    await ensureMetadataRecord({
      supabase: await clientFor("editor"),
      organizationId: ORG_A,
      assetId,
    });
  });

  it("refuses a generation write that touches a rights field", async () => {
    // The worker holds the service role and bypasses row level security, so
    // this rule cannot live only in the code the worker runs.
    const { error } = await serviceClient()
      .from("asset_metadata")
      .update({
        generated_at: new Date().toISOString(),
        commercial_use_eligible: "eligible",
      })
      .eq("asset_id", assetId);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/may not set rights, releases, or confirmation/);
  });

  it("refuses a generation write that touches a confirmed record's words", async () => {
    const service = serviceClient();
    await service
      .from("asset_metadata")
      .update({
        generation_status: "confirmed",
        confirmed_at: new Date().toISOString(),
        confirmed_by: EDITOR,
      })
      .eq("asset_id", assetId);

    const { error } = await service
      .from("asset_metadata")
      .update({ generated_at: new Date().toISOString(), headline: "A machine's guess" })
      .eq("asset_id", assetId);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/This metadata is confirmed/);
  });

  it("refuses a record that claims to be confirmed with nobody's name against it", async () => {
    const other = await makeAsset(shootId, "TRG_0002");
    const { error } = await serviceClient().from("asset_metadata").insert({
      asset_id: other,
      organization_id: ORG_A,
      generation_status: "confirmed",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/asset_metadata_confirmation_stamped/);
  });

  it("allows a photographer's own edit to a confirmed record", async () => {
    // The trigger keys on a generation write, not on the row being confirmed.
    // A person typing into their own confirmed record is the ordinary case.
    const { error } = await serviceClient()
      .from("asset_metadata")
      .update({ headline: "Corrected by the photographer" })
      .eq("asset_id", assetId);
    expect(error).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describeIf("tenant isolation", () => {
  let shootId: string;
  let assetId: string;

  beforeAll(async () => {
    shootId = await makeShoot("Isolation");
    assetId = await makeAsset(shootId, "ISO_0001");
    await ensureMetadataRecord({
      supabase: await clientFor("editor"),
      organizationId: ORG_A,
      assetId,
    });
  });

  it("does not let another workspace read a metadata record by guessing its id", async () => {
    const outsider = await clientFor("otherOrgOwner");
    const { data } = await outsider
      .from("asset_metadata")
      .select("asset_id, headline")
      .eq("asset_id", assetId);
    expect(data ?? []).toHaveLength(0);
  });

  it("does not let another workspace read one by claiming its own organization id", async () => {
    // The id in the URL is not what decides. Changing organization_id to one
    // the caller IS a member of still matches no row.
    const outsider = await clientFor("otherOrgOwner");
    const { data } = await outsider
      .from("asset_metadata")
      .select("asset_id")
      .eq("organization_id", ORG_B)
      .eq("asset_id", assetId);
    expect(data ?? []).toHaveLength(0);
  });

  it("does not let another workspace write to it", async () => {
    const outsider = await clientFor("otherOrgOwner");
    const { data } = await outsider
      .from("asset_metadata")
      .update({ headline: "Written from outside" })
      .eq("asset_id", assetId)
      .select("asset_id");
    expect(data ?? []).toHaveLength(0);

    const record = await getMetadata(ORG_A, assetId, serviceClient());
    expect(record?.editorial.headline).not.toBe("Written from outside");
  });

  it("does not let another workspace queue work against it", async () => {
    const outsider = await clientFor("otherOrgOwner");
    const { error } = await outsider.from("asset_metadata_jobs").insert({
      organization_id: ORG_B,
      asset_id: assetId,
      requested_by: "44444444-4444-4444-4444-444444444444",
    });
    // The asset belongs to another organization, so this is refused whichever
    // way round the ids are put.
    expect(error).not.toBeNull();
  });

  it("returns nothing rather than erroring when a listing crosses a boundary", async () => {
    const editor = await clientFor("editor");
    const records = await listMetadata(ORG_A, [assetId, ORG_B_ASSET], editor);
    expect(records.has(assetId)).toBe(true);
    expect(records.has(ORG_B_ASSET)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describeIf("role permissions", () => {
  let shootId: string;
  let assetId: string;

  beforeAll(async () => {
    shootId = await makeShoot("Roles");
    assetId = await makeAsset(shootId, "ROL_0001");
    await ensureMetadataRecord({
      supabase: await clientFor("editor"),
      organizationId: ORG_A,
      assetId,
    });
  });

  it("lets every member read", async () => {
    const viewer = await clientFor("viewer");
    const record = await getMetadata(ORG_A, assetId, viewer);
    expect(record).not.toBeNull();
  });

  it("does not let a viewer write", async () => {
    const viewer = await clientFor("viewer");
    const { data } = await viewer
      .from("asset_metadata")
      .update({ headline: "Written by a viewer" })
      .eq("asset_id", assetId)
      .select("asset_id");
    expect(data ?? []).toHaveLength(0);
  });

  it("does not let a dispatcher write, matching the policy on assets themselves", async () => {
    const dispatcher = await clientFor("dispatcher");
    const { data } = await dispatcher
      .from("asset_metadata")
      .update({ headline: "Written by a dispatcher" })
      .eq("asset_id", assetId)
      .select("asset_id");
    expect(data ?? []).toHaveLength(0);
  });

  it("does not let anyone advance a job of their own", async () => {
    // Enqueueing is a member's business; deciding a job succeeded is not.
    const service = serviceClient();
    const { data: job } = await service
      .from("asset_metadata_jobs")
      .insert({ organization_id: ORG_A, asset_id: assetId, requested_by: EDITOR })
      .select("id")
      .single();

    const editor = await clientFor("editor");
    const { data } = await editor
      .from("asset_metadata_jobs")
      .update({ status: "succeeded", finished_at: new Date().toISOString() })
      .eq("id", job!.id)
      .select("id");
    expect(data ?? []).toHaveLength(0);

    await service.from("asset_metadata_jobs").delete().eq("id", job!.id);
  });
});
