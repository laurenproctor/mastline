/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateOpportunity, saveSignalContext } from "@/lib/data/news-radar-evaluations";
import {
  getHandoff,
  handoffArchivePackage,
  handoffShootDraft,
} from "@/lib/data/news-radar-handoffs";
import { createManualStory } from "@/lib/data/opportunities";
import { EVALUATOR_VERSION } from "@/lib/news-radar-evaluation";
import { composeShootNotes } from "@/lib/news-radar-handoff";
import {
  ORG_A,
  ORG_B,
  clientFor,
  hasLocalSupabase,
  purgeShoot,
  serviceClient,
} from "./helpers/supabase";

/**
 * News Radar handoffs against the real functions, policies and constraints.
 *
 * Everything goes through the data layer with an AUTHENTICATED client, the
 * way a Server Action does. The service role only arranges fixtures (a shoot
 * with photographs, a story, an evaluation) and reads results back.
 *
 * What is proven: one idempotent draft package from selected matches and one
 * idempotent draft shoot from confirmed facts; that the database refuses the
 * wrong kind, the wrong workspace, a forged author, a rewrite of provenance,
 * an anonymous caller, a role without the capability, a stale evaluation, a
 * restricted or unmatched frame; that a failure rolls the whole handoff back;
 * and that nothing beyond the draft -- no approval, submission, snapshot,
 * recipient, delivery link, buyer -- comes into existence.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const EDITOR_A = "22222222-2222-2222-2222-222222222222";

const PERSON = "Handoff Fixture Person";
const VENUE = "Handoff Fixture Plaza";
const HASH_ZERO = "0".repeat(64);

const signals: string[] = [];
const shoots: string[] = [];
let fixtureShoot = "";
let secondShoot = "";
const assets: Record<"a" | "b" | "restricted" | "other" | "unshot", string> = {
  a: "",
  b: "",
  restricted: "",
  other: "",
  unshot: "",
};

function key(): string {
  return crypto.randomUUID();
}

async function count(table: string, filter: Record<string, string>): Promise<number> {
  let query = serviceClient().from(table).select("*", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filter)) query = query.eq(column, value);
  const { count: total, error } = await query;
  if (error) throw new Error(`Could not count ${table}: ${error.message}`);
  return total ?? 0;
}

async function insertAsset(row: Record<string, unknown>): Promise<string> {
  const service = serviceClient();
  const { data, error } = await service.from("assets").insert(row).select("id").single();
  if (error || !data) throw new Error(`Could not arrange an asset: ${error?.message}`);
  const id = data.id as string;
  // Every frame has an original; the archive frame also has a delivery version.
  const stamp = id.slice(0, 8);
  const { error: versionError } = await service.from("asset_versions").insert({
    organization_id: ORG_A,
    asset_id: id,
    version_kind: "original",
    storage_bucket: "originals",
    object_key: `${ORG_A}/${row.shoot_id ?? "unshot"}/${row.canonical_filename}-${stamp}.arw`,
    sha256: stamp.padEnd(64, "0"),
    bytes: 1,
    mime_type: "image/x-sony-arw",
    created_by: OWNER_A,
  });
  if (versionError) throw new Error(`Could not arrange a version: ${versionError.message}`);
  return id;
}

async function arrange(): Promise<void> {
  const service = serviceClient();
  for (const label of ["primary", "second"]) {
    const { data, error } = await service
      .from("shoots")
      .insert({
        organization_id: ORG_A,
        title: `Handoff fixture ${label} ${Date.now()}`,
        created_by: OWNER_A,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Could not arrange the ${label} shoot: ${error?.message}`);
    if (label === "primary") fixtureShoot = data.id as string;
    else secondShoot = data.id as string;
    shoots.push(data.id as string);
  }
  const base = {
    organization_id: ORG_A,
    created_by: OWNER_A,
    captured_at: "2026-08-20T10:00:00.000Z",
    subjects: [PERSON],
    keywords: ["handoff-fixture"],
    location_name: VENUE,
    copyright_notice: "© 2026 Fixture",
    credit_line: "Fixture / Mastline",
  };
  assets.a = await insertAsset({
    ...base,
    shoot_id: fixtureShoot,
    status: "active",
    canonical_filename: "HANDOFF_A",
    headline: `${PERSON} at ${VENUE}`,
    caption: `${PERSON} arrives at ${VENUE}.`,
  });
  assets.b = await insertAsset({
    ...base,
    shoot_id: fixtureShoot,
    status: "archived",
    canonical_filename: "HANDOFF_B",
    headline: `${PERSON} leaves ${VENUE}`,
  });
  assets.restricted = await insertAsset({
    ...base,
    shoot_id: fixtureShoot,
    status: "restricted",
    canonical_filename: "HANDOFF_R",
    headline: `${PERSON} restricted`,
  });
  assets.other = await insertAsset({
    ...base,
    shoot_id: secondShoot,
    status: "active",
    canonical_filename: "HANDOFF_O",
    headline: `${PERSON} elsewhere`,
  });
  assets.unshot = await insertAsset({
    ...base,
    shoot_id: null,
    status: "active",
    canonical_filename: "HANDOFF_U",
    headline: `${PERSON} unfiled`,
  });
  // A delivery version on A, so the package names it rather than the original.
  const { error } = await service.from("asset_versions").insert({
    organization_id: ORG_A,
    asset_id: assets.a,
    version_kind: "delivery",
    storage_bucket: "derivatives",
    object_key: `${ORG_A}/${fixtureShoot}/HANDOFF_A-delivery.jpg`,
    sha256: "d".repeat(64),
    bytes: 1,
    mime_type: "image/jpeg",
    created_by: OWNER_A,
  });
  if (error) throw new Error(`Could not arrange the delivery version: ${error.message}`);
}

/**
 * Arrangement, retried once. The local gateway has been seen to reset an
 * upstream connection right after a burst of writes on a loaded host (Kong
 * 502, nothing logged by PostgREST). Fixtures are arranged, not tested, so
 * one retry keeps a host-load artefact from reading as a failure of the
 * thing under test; the subjects themselves are never retried here.
 */
async function arranged<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return step();
  }
}

/** A story about the fixture person, evaluated on both paths as the owner. */
async function story(
  label: string,
): Promise<{ archiveId: string; shootId: string; signalId: string }> {
  const owner = await clientFor("owner");
  const created = await arranged(() =>
    createManualStory({
      client: owner,
      organizationId: ORG_A,
      title: `${PERSON} expected at ${VENUE} — ${label}`,
      sourceName: "Handoff fixture wire",
      sourceUrl: `https://handoff.example/${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      summary: `${PERSON} is expected at ${VENUE}.`,
      signal: "rising",
    }),
  );
  if (!created.archiveOpportunityId || !created.shootOpportunityId) {
    throw new Error("The fixture story did not open both paths.");
  }
  signals.push(created.signalId);
  await arranged(() =>
    saveSignalContext({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER_A,
      newsSignalId: created.signalId,
      input: {
        people: [PERSON],
        organizations: [],
        topics: [],
        keywords: ["handoff-fixture"],
        locationName: VENUE,
        eventStartsAt: "2026-09-10T15:00:00.000Z",
      },
    }),
  );
  for (const id of [created.archiveOpportunityId, created.shootOpportunityId]) {
    const result = await arranged(async () => {
      const outcome = await evaluateOpportunity({
        client: owner,
        organizationId: ORG_A,
        actorId: OWNER_A,
        opportunityId: id,
      });
      if (outcome.outcome === "failed")
        throw new Error(`Fixture evaluation failed: ${outcome.failureCode}`);
      return outcome;
    });
    void result;
  }
  return {
    archiveId: created.archiveOpportunityId,
    shootId: created.shootOpportunityId,
    signalId: created.signalId,
  };
}

async function evaluationIdentity(
  opportunityId: string,
): Promise<{ evaluatorVersion: string; inputHash: string }> {
  const { data } = await serviceClient()
    .from("opportunity_evaluations")
    .select("result_evaluator_version, result_input_hash")
    .eq("opportunity_id", opportunityId)
    .single();
  return {
    evaluatorVersion: data!.result_evaluator_version as string,
    inputHash: data!.result_input_hash as string,
  };
}

describeIf("news radar handoffs", () => {
  beforeAll(async () => {
    await arrange();
    // Warm the seeded sign-ins before anything is timed.
    await Promise.all([
      clientFor("owner"),
      clientFor("editor"),
      clientFor("viewer"),
      clientFor("otherOrgOwner"),
    ]);
  }, 60_000);

  afterAll(async () => {
    const service = serviceClient();
    // Handoff rows cascade with the signal; the packages a test made hang off
    // the fixture shoots and go with them.
    if (signals.length > 0) await service.from("news_signals").delete().in("id", signals);
    if (assets.unshot) {
      const { error } = await service.rpc("purge_asset_admin", { target_asset: assets.unshot });
      if (error) throw new Error(`Could not purge the unfiled asset: ${error.message}`);
    }
    for (const shootId of shoots) await purgeShoot(shootId);
    // Shoots the shoot handoff created carry no assets; a plain delete suffices.
    await service
      .from("shoots")
      .delete()
      .eq("organization_id", ORG_A)
      .like("title", `${PERSON} expected at%`);
  }, 60_000);

  describe("archive → draft package", () => {
    it("creates one draft package from the selected matches, records provenance, and is idempotent", async () => {
      const { archiveId, signalId } = await story("archive");
      const identity = await evaluationIdentity(archiveId);
      const editor = await clientFor("editor");
      const requestKey = key();

      const first = await handoffArchivePackage({
        client: editor,
        organizationId: ORG_A,
        opportunityId: archiveId,
        ...identity,
        requestKey,
        // Selected out of order, and once twice: the package follows the contract.
        selectedAssetIds: [assets.b, assets.a, assets.b],
      });
      expect(first.outcome).toBe("created");
      if (first.outcome !== "created") return;
      expect(first.shootId).toBe(fixtureShoot);
      expect(first.frameCount).toBe(2);
      const packageId = first.packageId!;

      // The package: unapproved, no buyer, needs review, named after the story.
      const service = serviceClient();
      const { data: pkg } = await service.from("packages").select("*").eq("id", packageId).single();
      expect(pkg).toMatchObject({
        organization_id: ORG_A,
        shoot_id: fixtureShoot,
        status: "needs_review",
        buyer_id: null,
        approved_at: null,
        approved_by: null,
        created_by: EDITOR_A,
      });
      expect(String(pkg!.name)).toContain(PERSON);

      // Exactly the selected frames, in canonical filename order, the
      // delivery version where one exists and the original otherwise.
      const { data: members } = await service
        .from("package_assets")
        .select("asset_id, position, asset_versions(version_kind)")
        .eq("package_id", packageId)
        .order("position");
      expect(members!.map((m) => m.asset_id)).toEqual([assets.a, assets.b]);
      expect(
        members!.map((m) => (m.asset_versions as unknown as { version_kind: string }).version_kind),
      ).toEqual(["delivery", "original"]);

      // Provenance: which path, which signal, which evaluation, who, and the selection.
      const handoff = await getHandoff(ORG_A, archiveId, editor);
      expect(handoff).toMatchObject({
        kind: "archive_match",
        action: "package_draft",
        evaluatorVersion: identity.evaluatorVersion,
        inputHash: identity.inputHash,
        packageId,
        packageShootId: fixtureShoot,
        createdBy: EDITOR_A,
      });
      expect(handoff!.details).toMatchObject({
        selected_asset_ids: [assets.a, assets.b],
        shoot_id: fixtureShoot,
      });
      const { data: row } = await service
        .from("opportunity_handoffs")
        .select("news_signal_id, request_key")
        .eq("id", handoff!.id)
        .single();
      expect(row).toEqual({ news_signal_id: signalId, request_key: requestKey });

      // The path is acted, and both events are on the record.
      const { data: path } = await service
        .from("opportunities")
        .select("status, acted_at")
        .eq("id", archiveId)
        .single();
      expect(path!.status).toBe("acted");
      expect(path!.acted_at).not.toBeNull();
      expect(
        await count("activity_events", { entity_id: archiveId, action: "opportunity.acted" }),
      ).toBe(1);
      expect(
        await count("activity_events", { entity_id: packageId, action: "package.created" }),
      ).toBe(1);

      // The evaluation and its matches were not touched.
      const after = await evaluationIdentity(archiveId);
      expect(after).toEqual(identity);
      expect(
        await count("opportunity_asset_matches", { opportunity_id: archiveId }),
      ).toBeGreaterThanOrEqual(4);

      // Nothing beyond the draft.
      expect(await count("submissions", { package_id: packageId })).toBe(0);
      expect(
        await count("submission_asset_snapshots", {
          organization_id: ORG_A,
          package_id: packageId,
        }).catch(() => 0),
      ).toBe(0);
      const { data: assetRows } = await service
        .from("assets")
        .select("selected")
        .in("id", [assets.a, assets.b]);
      expect(assetRows!.every((a) => a.selected === false)).toBe(true);

      // A retry with the same key, and a second confirmation with a new key,
      // both return the original package and create nothing.
      const retry = await handoffArchivePackage({
        client: editor,
        organizationId: ORG_A,
        opportunityId: archiveId,
        ...identity,
        requestKey,
        selectedAssetIds: [assets.a, assets.b],
      });
      expect(retry).toMatchObject({ outcome: "existing", packageId, sameRequest: true });
      const again = await handoffArchivePackage({
        client: editor,
        organizationId: ORG_A,
        opportunityId: archiveId,
        ...identity,
        requestKey: key(),
        selectedAssetIds: [assets.a],
      });
      expect(again).toMatchObject({ outcome: "existing", packageId, sameRequest: false });
      expect(await count("packages", { shoot_id: fixtureShoot })).toBe(1);
      expect(await count("opportunity_handoffs", { opportunity_id: archiveId })).toBe(1);
    }, 30_000);

    it("serializes concurrent duplicate confirmations into one package", async () => {
      const { archiveId } = await story("concurrent");
      const identity = await evaluationIdentity(archiveId);
      const owner = await clientFor("owner");
      const before = await count("packages", { shoot_id: fixtureShoot });
      const results = await Promise.all(
        [1, 2, 3, 4].map(() =>
          handoffArchivePackage({
            client: owner,
            organizationId: ORG_A,
            opportunityId: archiveId,
            ...identity,
            requestKey: key(),
            selectedAssetIds: [assets.a],
          }),
        ),
      );
      const created = results.filter((r) => r.outcome === "created");
      const existing = results.filter((r) => r.outcome === "existing");
      expect(created).toHaveLength(1);
      expect(existing).toHaveLength(3);
      const packageId = (created[0] as { packageId?: string }).packageId;
      expect(existing.every((r) => (r as { packageId?: string }).packageId === packageId)).toBe(
        true,
      );
      expect(await count("packages", { shoot_id: fixtureShoot })).toBe(before + 1);
    }, 30_000);

    it("refuses a restricted frame, an unmatched frame, a frame on no shoot, and a selection across shoots -- and writes nothing", async () => {
      const { archiveId } = await story("refusals");
      const identity = await evaluationIdentity(archiveId);
      const owner = await clientFor("owner");
      const base = { client: owner, organizationId: ORG_A, opportunityId: archiveId, ...identity };
      const before = await count("packages", { organization_id: ORG_A });

      expect(
        await handoffArchivePackage({
          ...base,
          requestKey: key(),
          selectedAssetIds: [assets.a, assets.restricted],
        }),
      ).toMatchObject({
        outcome: "invalid_selection",
        reason: "restricted",
        assetIds: [assets.restricted],
      });
      expect(
        await handoffArchivePackage({
          ...base,
          requestKey: key(),
          selectedAssetIds: [assets.a, crypto.randomUUID()],
        }),
      ).toMatchObject({ outcome: "invalid_selection", reason: "not_matched" });
      expect(
        await handoffArchivePackage({
          ...base,
          requestKey: key(),
          selectedAssetIds: [assets.a, assets.unshot],
        }),
      ).toMatchObject({
        outcome: "invalid_selection",
        reason: "no_shoot",
        assetIds: [assets.unshot],
      });
      expect(
        await handoffArchivePackage({
          ...base,
          requestKey: key(),
          selectedAssetIds: [assets.a, assets.other],
        }),
      ).toMatchObject({ outcome: "invalid_selection", reason: "mixed_shoots" });
      expect(
        await handoffArchivePackage({ ...base, requestKey: key(), selectedAssetIds: [] }),
      ).toMatchObject({ outcome: "invalid_selection", reason: "empty" });

      expect(await count("packages", { organization_id: ORG_A })).toBe(before);
      expect(await count("opportunity_handoffs", { opportunity_id: archiveId })).toBe(0);
      const { data: path } = await serviceClient()
        .from("opportunities")
        .select("status")
        .eq("id", archiveId)
        .single();
      expect(path!.status).toBe("new");
    }, 30_000);

    it("refuses a stale evaluation identity without writing", async () => {
      const { archiveId } = await story("stale");
      const identity = await evaluationIdentity(archiveId);
      const owner = await clientFor("owner");
      const stale = await handoffArchivePackage({
        client: owner,
        organizationId: ORG_A,
        opportunityId: archiveId,
        evaluatorVersion: identity.evaluatorVersion,
        inputHash: HASH_ZERO,
        requestKey: key(),
        selectedAssetIds: [assets.a],
      });
      expect(stale).toMatchObject({
        outcome: "stale_evaluation",
        currentEvaluatorVersion: EVALUATOR_VERSION,
        currentInputHash: identity.inputHash,
      });
      const olderEvaluator = await handoffArchivePackage({
        client: owner,
        organizationId: ORG_A,
        opportunityId: archiveId,
        evaluatorVersion: "news-radar/0",
        inputHash: identity.inputHash,
        requestKey: key(),
        selectedAssetIds: [assets.a],
      });
      expect(olderEvaluator.outcome).toBe("stale_evaluation");
      expect(await count("opportunity_handoffs", { opportunity_id: archiveId })).toBe(0);
    }, 30_000);

    it("rolls the whole handoff back when a frame has no stored file", async () => {
      const { archiveId } = await story("rollback");
      const identity = await evaluationIdentity(archiveId);
      const service = serviceClient();
      // Arrange a matched frame with no version at all, on the fixture shoot.
      const { data: bare } = await service
        .from("assets")
        .insert({
          organization_id: ORG_A,
          shoot_id: fixtureShoot,
          created_by: OWNER_A,
          status: "active",
          canonical_filename: "HANDOFF_NOFILE",
          subjects: [PERSON],
          keywords: ["handoff-fixture"],
        })
        .select("id")
        .single();
      const owner = await clientFor("owner");
      const reevaluated = await evaluateOpportunity({
        client: owner,
        organizationId: ORG_A,
        actorId: OWNER_A,
        opportunityId: archiveId,
      });
      expect(reevaluated.outcome).toBe("recorded");
      const fresh = await evaluationIdentity(archiveId);
      expect(fresh.inputHash).not.toBe(identity.inputHash);

      const before = await count("packages", { shoot_id: fixtureShoot });
      const result = await handoffArchivePackage({
        client: owner,
        organizationId: ORG_A,
        opportunityId: archiveId,
        ...fresh,
        requestKey: key(),
        selectedAssetIds: [assets.a, bare!.id as string],
      });
      expect(result).toMatchObject({ outcome: "invalid_selection", reason: "no_file" });
      // The package row inserted before the failure is gone with the block.
      expect(await count("packages", { shoot_id: fixtureShoot })).toBe(before);
      expect(await count("opportunity_handoffs", { opportunity_id: archiveId })).toBe(0);
      const { data: path } = await service
        .from("opportunities")
        .select("status")
        .eq("id", archiveId)
        .single();
      expect(path!.status).toBe("new");
      await service.rpc("purge_asset_admin", { target_asset: bare!.id });
    }, 30_000);

    it("answers a viewer, an outsider, and an anonymous caller without writing", async () => {
      const { archiveId } = await story("roles");
      const identity = await evaluationIdentity(archiveId);
      const selectedAssetIds = [assets.a];

      const viewer = await clientFor("viewer");
      expect(
        (
          await handoffArchivePackage({
            client: viewer,
            organizationId: ORG_A,
            opportunityId: archiveId,
            ...identity,
            requestKey: key(),
            selectedAssetIds,
          })
        ).outcome,
      ).toBe("forbidden");

      const outsider = await clientFor("otherOrgOwner");
      expect(
        (
          await handoffArchivePackage({
            client: outsider,
            organizationId: ORG_B,
            opportunityId: archiveId,
            ...identity,
            requestKey: key(),
            selectedAssetIds,
          })
        ).outcome,
      ).toBe("not_found");

      const { anonClient } = await import("./helpers/supabase");
      const { error } = await anonClient().rpc("handoff_archive_package", {
        target_opportunity: archiveId,
        evaluator: identity.evaluatorVersion,
        input_digest: identity.inputHash,
        selected_assets: selectedAssetIds,
        request_key: key(),
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");

      expect(await count("opportunity_handoffs", { opportunity_id: archiveId })).toBe(0);
    }, 30_000);

    it("is refused on a shoot path, and cannot be written by hand against the wrong kind or workspace", async () => {
      const { shootId, archiveId, signalId } = await story("kind");
      const identity = await evaluationIdentity(shootId);
      const owner = await clientFor("owner");
      expect(
        (
          await handoffArchivePackage({
            client: owner,
            organizationId: ORG_A,
            opportunityId: shootId,
            ...identity,
            requestKey: key(),
            selectedAssetIds: [assets.a],
          })
        ).outcome,
      ).toBe("not_found");

      // Direct writes, as the service role, hit the constraints.
      const service = serviceClient();
      const { data: pkg } = await service
        .from("packages")
        .insert({
          organization_id: ORG_A,
          shoot_id: fixtureShoot,
          name: "constraint probe",
          status: "draft",
          created_by: OWNER_A,
        })
        .select("id")
        .single();
      const probe = (row: Record<string, unknown>) =>
        service.from("opportunity_handoffs").insert({
          organization_id: ORG_A,
          news_signal_id: signalId,
          evaluator_version: EVALUATOR_VERSION,
          input_hash: HASH_ZERO,
          request_key: key(),
          created_by: OWNER_A,
          ...row,
        });
      // A shoot path cannot carry a package handoff.
      expect(
        (
          await probe({
            opportunity_id: shootId,
            opportunity_kind: "shoot_opportunity",
            action_type: "package_draft",
            package_id: pkg!.id,
          })
        ).error?.code,
      ).toBe("23514");
      // The kind must match the path's own kind.
      expect(
        (
          await probe({
            opportunity_id: shootId,
            opportunity_kind: "archive_match",
            action_type: "package_draft",
            package_id: pkg!.id,
          })
        ).error?.code,
      ).toBe("23503");
      // An archive path cannot carry a shoot handoff.
      expect(
        (
          await probe({
            opportunity_id: archiveId,
            opportunity_kind: "archive_match",
            action_type: "shoot_draft",
            shoot_id: fixtureShoot,
          })
        ).error?.code,
      ).toBe("23514");
      // A package in another workspace cannot be referenced.
      expect(
        (
          await probe({
            organization_id: ORG_B,
            opportunity_id: archiveId,
            opportunity_kind: "archive_match",
            action_type: "package_draft",
            package_id: pkg!.id,
          })
        ).error?.code,
      ).toBe("23503");
      await service.from("packages").delete().eq("id", pkg!.id);
    }, 30_000);

    it("pins authorship and refuses any rewrite of provenance", async () => {
      const { archiveId } = await story("immutable");
      const identity = await evaluationIdentity(archiveId);
      const editor = await clientFor("editor");
      const created = await handoffArchivePackage({
        client: editor,
        organizationId: ORG_A,
        opportunityId: archiveId,
        ...identity,
        requestKey: key(),
        selectedAssetIds: [assets.a],
      });
      expect(created.outcome).toBe("created");
      const handoff = await getHandoff(ORG_A, archiveId, editor);

      // A forged author: the insert policy pins created_by to the caller.
      const { data: signal } = await serviceClient()
        .from("opportunities")
        .select("news_signal_id")
        .eq("id", archiveId)
        .single();
      const forged = await editor.from("opportunity_handoffs").insert({
        organization_id: ORG_A,
        opportunity_id: archiveId,
        opportunity_kind: "archive_match",
        news_signal_id: signal!.news_signal_id,
        action_type: "package_draft",
        evaluator_version: EVALUATOR_VERSION,
        input_hash: HASH_ZERO,
        package_id: (created as { packageId?: string }).packageId,
        request_key: key(),
        created_by: OWNER_A,
      });
      expect(forged.error).not.toBeNull();

      // A rewrite by a member: no grant, no policy.
      const { error: updateError, data: updated } = await editor
        .from("opportunity_handoffs")
        .update({ input_hash: HASH_ZERO })
        .eq("id", handoff!.id)
        .select("id");
      expect(updateError !== null || (updated ?? []).length === 0).toBe(true);
      // A rewrite by the service role: the trigger refuses.
      const { error: serviceError } = await serviceClient()
        .from("opportunity_handoffs")
        .update({ input_hash: HASH_ZERO })
        .eq("id", handoff!.id);
      expect(serviceError?.code).toBe("42501");
      // A delete by a member: refused.
      const { data: deleted } = await editor
        .from("opportunity_handoffs")
        .delete()
        .eq("id", handoff!.id)
        .select("id");
      expect(deleted ?? []).toHaveLength(0);
      expect((await getHandoff(ORG_A, archiveId, editor))!.inputHash).toBe(identity.inputHash);
    }, 30_000);
  });

  describe("shoot → draft shoot", () => {
    it("creates one draft shoot from confirmed facts only, keeps suggestions as suggestions, and is idempotent", async () => {
      const { shootId: pathId, signalId } = await story("shoot");
      const identity = await evaluationIdentity(pathId);
      const editor = await clientFor("editor");
      const requestKey = key();
      const confirmed = {
        title: "Fixture plaza arrival",
        locationName: VENUE,
        startsAt: "2026-09-10T15:00:00.000Z",
        endsAt: undefined,
        timezone: "America/New_York",
        priority: "high" as const,
        people: [PERSON],
        copiedSuggestions: ["shot:Wide of the plaza"],
        ownNotes: "Long lens.",
      };
      const notes = composeShootNotes(confirmed, `${PERSON} expected at ${VENUE}`);

      const first = await handoffShootDraft({
        client: editor,
        organizationId: ORG_A,
        opportunityId: pathId,
        ...identity,
        requestKey,
        confirmed,
        notes,
      });
      expect(first.outcome).toBe("created");
      if (first.outcome !== "created") return;
      const newShoot = first.shootId!;
      shoots.push(newShoot);

      const service = serviceClient();
      const { data: shoot } = await service.from("shoots").select("*").eq("id", newShoot).single();
      expect(shoot).toMatchObject({
        organization_id: ORG_A,
        opportunity_id: pathId,
        status: "draft",
        title: "Fixture plaza arrival",
        location_name: VENUE,
        starts_at: "2026-09-10T15:00:00+00:00",
        ends_at: null,
        timezone: "America/New_York",
        priority: "high",
        story_angle: null,
        created_by: EDITOR_A,
      });
      expect(String(shoot!.notes)).toContain(
        "People expected (confirmed by the photographer): " + PERSON,
      );
      expect(String(shoot!.notes)).toContain(
        "Suggested shots (News Radar suggestions, not confirmed):",
      );
      expect(String(shoot!.notes)).not.toMatch(/confirmed to appear|access|credential/i);

      const handoff = await getHandoff(ORG_A, pathId, editor);
      expect(handoff).toMatchObject({
        kind: "shoot_opportunity",
        action: "shoot_draft",
        shootId: newShoot,
        evaluatorVersion: identity.evaluatorVersion,
        inputHash: identity.inputHash,
        createdBy: EDITOR_A,
      });
      expect(handoff!.details).toMatchObject({
        confirmed: {
          title: "Fixture plaza arrival",
          location_name: VENUE,
          timezone: "America/New_York",
          people: [PERSON],
        },
        copied_suggestions: ["shot:Wide of the plaza"],
      });
      const { data: row } = await service
        .from("opportunity_handoffs")
        .select("news_signal_id")
        .eq("id", handoff!.id)
        .single();
      expect(row!.news_signal_id).toBe(signalId);

      const { data: path } = await service
        .from("opportunities")
        .select("status")
        .eq("id", pathId)
        .single();
      expect(path!.status).toBe("acted");
      expect(await count("activity_events", { entity_id: newShoot, action: "shoot.created" })).toBe(
        1,
      );
      expect(
        await count("activity_events", { entity_id: pathId, action: "opportunity.acted" }),
      ).toBe(1);
      // The brief and evaluation were not touched.
      expect(await evaluationIdentity(pathId)).toEqual(identity);
      expect(await count("opportunity_shoot_briefs", { opportunity_id: pathId })).toBe(1);
      // Nothing beyond the draft.
      expect(await count("packages", { shoot_id: newShoot })).toBe(0);
      expect(await count("assets", { shoot_id: newShoot })).toBe(0);

      const retry = await handoffShootDraft({
        client: editor,
        organizationId: ORG_A,
        opportunityId: pathId,
        ...identity,
        requestKey,
        confirmed,
        notes,
      });
      expect(retry).toMatchObject({ outcome: "existing", shootId: newShoot, sameRequest: true });
      const again = await handoffShootDraft({
        client: editor,
        organizationId: ORG_A,
        opportunityId: pathId,
        ...identity,
        requestKey: key(),
        confirmed: { ...confirmed, title: "Another" },
        notes,
      });
      expect(again).toMatchObject({ outcome: "existing", shootId: newShoot });
      expect(await count("shoots", { opportunity_id: pathId })).toBe(1);
    }, 30_000);

    it("allows an incomplete draft, leaving unconfirmed facts empty rather than copied", async () => {
      const { shootId: pathId } = await story("incomplete");
      const identity = await evaluationIdentity(pathId);
      const owner = await clientFor("owner");
      const result = await handoffShootDraft({
        client: owner,
        organizationId: ORG_A,
        opportunityId: pathId,
        ...identity,
        requestKey: key(),
        confirmed: {
          title: "Unconfirmed plaza",
          priority: "standard",
          people: [],
          copiedSuggestions: [],
        },
      });
      expect(result.outcome).toBe("created");
      if (result.outcome !== "created") return;
      shoots.push(result.shootId!);
      const { data: shoot } = await serviceClient()
        .from("shoots")
        .select("location_name, starts_at, timezone, notes")
        .eq("id", result.shootId!)
        .single();
      // The brief KNOWS the venue and the time; the draft does not, because nobody confirmed them.
      expect(shoot).toEqual({ location_name: null, starts_at: null, timezone: null, notes: null });
    }, 30_000);

    it("refuses a stale evaluation, an archive path, an unknown time zone, and a viewer -- without writing", async () => {
      const { shootId: pathId, archiveId } = await story("shoot-refusals");
      const identity = await evaluationIdentity(pathId);
      const owner = await clientFor("owner");
      const confirmed = {
        title: "Probe",
        priority: "standard" as const,
        people: [],
        copiedSuggestions: [],
      };
      expect(
        (
          await handoffShootDraft({
            client: owner,
            organizationId: ORG_A,
            opportunityId: pathId,
            evaluatorVersion: identity.evaluatorVersion,
            inputHash: HASH_ZERO,
            requestKey: key(),
            confirmed,
          })
        ).outcome,
      ).toBe("stale_evaluation");
      expect(
        (
          await handoffShootDraft({
            client: owner,
            organizationId: ORG_A,
            opportunityId: archiveId,
            ...(await evaluationIdentity(archiveId)),
            requestKey: key(),
            confirmed,
          })
        ).outcome,
      ).toBe("not_found");
      expect(
        await handoffShootDraft({
          client: owner,
          organizationId: ORG_A,
          opportunityId: pathId,
          ...identity,
          requestKey: key(),
          confirmed: { ...confirmed, timezone: "Nowhere/Land" },
        }),
      ).toMatchObject({ outcome: "invalid_selection", reason: "timezone" });
      expect(
        await handoffShootDraft({
          client: owner,
          organizationId: ORG_A,
          opportunityId: pathId,
          ...identity,
          requestKey: key(),
          confirmed: {
            ...confirmed,
            startsAt: "2026-09-10T15:00:00.000Z",
            endsAt: "2026-09-10T14:00:00.000Z",
          },
        }),
      ).toMatchObject({ outcome: "invalid_selection", reason: "time" });
      const viewer = await clientFor("viewer");
      expect(
        (
          await handoffShootDraft({
            client: viewer,
            organizationId: ORG_A,
            opportunityId: pathId,
            ...identity,
            requestKey: key(),
            confirmed,
          })
        ).outcome,
      ).toBe("forbidden");
      expect(await count("shoots", { opportunity_id: pathId })).toBe(0);
      expect(await count("opportunity_handoffs", { opportunity_id: pathId })).toBe(0);
    }, 30_000);

    it("refuses a path that was dismissed", async () => {
      const { shootId: pathId } = await story("closed");
      const identity = await evaluationIdentity(pathId);
      await serviceClient()
        .from("opportunities")
        .update({ status: "dismissed", dismissal_reason: "fixture" })
        .eq("id", pathId);
      const owner = await clientFor("owner");
      const result = await handoffShootDraft({
        client: owner,
        organizationId: ORG_A,
        opportunityId: pathId,
        ...identity,
        requestKey: key(),
        confirmed: { title: "Closed", priority: "standard", people: [], copiedSuggestions: [] },
      });
      expect(result.outcome).toBe("path_closed");
    }, 30_000);
  });
});
