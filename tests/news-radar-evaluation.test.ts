/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EvaluationError,
  acceptSuggestion,
  evaluateOpportunity,
  getEvaluation,
  getShootBrief,
  getSignalContext,
  listArchiveMatches,
  saveSignalContext,
} from "@/lib/data/news-radar-evaluations";
import { createManualStory } from "@/lib/data/opportunities";
import { EVALUATOR_VERSION } from "@/lib/news-radar-evaluation";
import {
  ORG_A,
  ORG_B,
  clientFor,
  hasLocalSupabase,
  purgeShoot,
  serviceClient,
} from "./helpers/supabase";

/**
 * News Radar evaluation against the real policies and constraints.
 *
 * Everything goes through the data layer with an AUTHENTICATED client, the
 * way a Server Action does. The service role only arranges fixtures (a shoot
 * with photographs of every status) and reads results back.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const EDITOR_A = "22222222-2222-2222-2222-222222222222";
const VIEWER_A = "66666666-6666-6666-6666-666666666666";
const OWNER_B = "99999999-9999-9999-9999-999999999999";

const PERSON = "Radar Fixture Person";
const VENUE = "Radar Fixture Hall";

const signals: string[] = [];
let fixtureShoot: string | undefined;
// Every shoot arranged, including one left behind by a retried arrangement.
const fixtureShoots: string[] = [];
const assets: Record<"active" | "restricted" | "bare" | "ingesting" | "tombstoned", string> = {
  active: "",
  restricted: "",
  bare: "",
  ingesting: "",
  tombstoned: "",
};
let counter = 0;

async function arrangeArchive(): Promise<void> {
  const service = serviceClient();
  const { data: shoot, error: shootError } = await service
    .from("shoots")
    .insert({
      organization_id: ORG_A,
      title: `Radar evaluation fixture ${Date.now()}`,
      created_by: OWNER_A,
    })
    .select("id")
    .single();
  if (shootError || !shoot)
    throw new Error(`Could not arrange the fixture shoot: ${shootError?.message}`);
  fixtureShoot = shoot.id as string;
  fixtureShoots.push(fixtureShoot);

  const base = {
    organization_id: ORG_A,
    shoot_id: fixtureShoot,
    created_by: OWNER_A,
    captured_at: "2026-08-20T10:00:00.000Z",
  };
  const rows = [
    {
      ...base,
      status: "active",
      canonical_filename: "RADAR_ACTIVE",
      headline: `${PERSON} arrives at ${VENUE}`,
      caption: `${PERSON} is seen arriving at ${VENUE}.`,
      subjects: [PERSON],
      keywords: ["radar-fixture", "arrival"],
      location_name: VENUE,
      copyright_notice: "© 2026 Fixture",
      credit_line: "Fixture / Mastline",
      usage_restrictions: "Editorial use only.",
    },
    {
      ...base,
      status: "restricted",
      canonical_filename: "RADAR_RESTRICTED",
      headline: `${PERSON} leaves`,
      subjects: [PERSON],
      keywords: [],
      credit_line: "Fixture / Mastline",
    },
    {
      ...base,
      status: "active",
      canonical_filename: "RADAR_BARE",
      subjects: [PERSON],
      keywords: [],
    },
    {
      ...base,
      status: "ingesting",
      canonical_filename: "RADAR_INGESTING",
      subjects: [PERSON],
      keywords: ["radar-fixture"],
    },
    {
      ...base,
      status: "tombstoned",
      tombstoned_at: new Date().toISOString(),
      tombstone_reason: "fixture",
      canonical_filename: "RADAR_TOMBSTONED",
      subjects: [PERSON],
      keywords: ["radar-fixture"],
    },
  ];
  const { data, error } = await service
    .from("assets")
    .insert(rows)
    .select("id, canonical_filename");
  if (error || !data) throw new Error(`Could not arrange the fixture assets: ${error?.message}`);
  for (const row of data) {
    const name = row.canonical_filename as string;
    if (name === "RADAR_ACTIVE") assets.active = row.id as string;
    if (name === "RADAR_RESTRICTED") assets.restricted = row.id as string;
    if (name === "RADAR_BARE") assets.bare = row.id as string;
    if (name === "RADAR_INGESTING") assets.ingesting = row.id as string;
    if (name === "RADAR_TOMBSTONED") assets.tombstoned = row.id as string;
  }
}

// A local stack's first request after idle can take tens of seconds and its
// gateway occasionally drops one request; the fixture is six rows, not a slow
// query, so it is given time and one retry.
beforeAll(async () => {
  if (!hasLocalSupabase()) return;
  try {
    await arrangeArchive();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await arrangeArchive();
  }
}, 60_000);

afterAll(async () => {
  if (!hasLocalSupabase()) return;
  const service = serviceClient();
  if (signals.length > 0) {
    const { data: paths } = await service
      .from("opportunities")
      .select("id")
      .in("news_signal_id", signals);
    const entityIds = [...signals, ...(paths ?? []).map((row) => row.id as string)];
    await service.from("activity_events").delete().in("entity_id", entityIds);
    // Deleting the signal cascades into paths, context, entities, evaluations, matches and briefs.
    const { error } = await service.from("news_signals").delete().in("id", signals);
    if (error) throw new Error(`Could not clean up news signals: ${error.message}`);
  }
  for (const shootId of fixtureShoots) await purgeShoot(shootId);
});

/** One story about the fixture person, both paths, as the owner. */
async function enterStory(overrides: Partial<Parameters<typeof createManualStory>[0]> = {}) {
  const client = await clientFor("owner");
  counter += 1;
  const input = {
    organizationId: ORG_A,
    title: `Radar evaluation ${Date.now()}-${counter}`,
    sourceUrl: `https://radar-evaluation.example/${Date.now()}-${counter}`,
    signal: "watch" as const,
    client,
    ...overrides,
  };
  let result;
  try {
    result = await createManualStory(input);
  } catch (error) {
    // Fixture arrangement, not the subject under test. A local gateway under
    // several stacks occasionally answers one request with "An invalid
    // response was received from the upstream server"; the data layer
    // classifies any error as a refusal, so the one retry is here.
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      result = await createManualStory(input);
    } catch {
      throw error;
    }
  }
  signals.push(result.signalId);
  return {
    ...result,
    archiveId: result.archiveOpportunityId!,
    shootId: result.shootOpportunityId!,
  };
}

const asOwner = async () => ({
  organizationId: ORG_A,
  actorId: OWNER_A,
  client: await clientFor("owner"),
});

async function recordPerson(signalId: string) {
  const base = await asOwner();
  return saveSignalContext({
    ...base,
    newsSignalId: signalId,
    input: {
      people: [PERSON],
      organizations: [],
      topics: [],
      keywords: ["radar-fixture"],
      locationName: VENUE,
    },
  });
}

describeIf("archive matching", () => {
  it("ranks the real photographs that overlap, excludes tombstoned and ingesting records, and never invents overlap", async () => {
    const story = await enterStory();
    await recordPerson(story.signalId);
    const base = await asOwner();

    const run = await evaluateOpportunity({ ...base, opportunityId: story.archiveId });
    expect(run.outcome).toBe("recorded");
    expect(run.state).toBe("ready");
    expect(run.evaluation.evaluatorVersion).toBe(EVALUATOR_VERSION);
    expect(run.evaluation.inputHash).toMatch(/^[a-f0-9]{64}$/);

    const matches = await listArchiveMatches(ORG_A, story.archiveId, base.client);
    const ids = matches.map((match) => match.assetId);
    expect(ids).toContain(assets.active);
    expect(ids).toContain(assets.restricted);
    expect(ids).toContain(assets.bare);
    expect(ids).not.toContain(assets.ingesting);
    expect(ids).not.toContain(assets.tombstoned);
    // Seeded photographs of other people share nothing with this story.
    expect(ids).not.toContain("a0000000-0000-0000-0000-0000000000d3");

    // Stable rank, strongest first, and the reasons name the overlap.
    expect(matches.map((match) => match.rank)).toEqual(matches.map((_, index) => index + 1));
    expect(matches[0].assetId).toBe(assets.active);
    expect(matches[0].reasons.join(" ")).toMatch(new RegExp(`matches a subject.*${PERSON}`));
    expect(matches[0].reasons.join(" ")).toMatch(/Same recorded location/);
    expect(matches[0].breakdown.people).toBeGreaterThan(0);
  });

  it("states readiness precisely: restricted is flagged, recorded rights are named, absence is not clearance", async () => {
    const story = await enterStory();
    await recordPerson(story.signalId);
    const base = await asOwner();
    await evaluateOpportunity({ ...base, opportunityId: story.archiveId });
    const matches = await listArchiveMatches(ORG_A, story.archiveId, base.client);

    const active = matches.find((match) => match.assetId === assets.active)!.asset!;
    expect(active.restricted).toBe(false);
    expect(active.metadataComplete).toBe(true);
    expect(active.rights).toEqual([
      "copyright_recorded",
      "credit_recorded",
      "restriction_recorded",
    ]);

    const restricted = matches.find((match) => match.assetId === assets.restricted)!.asset!;
    expect(restricted.restricted).toBe(true);
    expect(restricted.metadataComplete).toBe(false);
    expect(restricted.rights).toEqual([
      "credit_recorded",
      "no_restriction_recorded",
      "rights_incomplete",
    ]);

    const bare = matches.find((match) => match.assetId === assets.bare)!.asset!;
    expect(bare.rights).toEqual(["no_restriction_recorded", "rights_incomplete"]);
    for (const match of matches) {
      expect(JSON.stringify(match).toLowerCase()).not.toMatch(/cleared|ready to use/);
    }
  });

  it("does not run twice over the same input: no duplicate rows, results or events", async () => {
    const story = await enterStory();
    await recordPerson(story.signalId);
    const base = await asOwner();

    const first = await evaluateOpportunity({ ...base, opportunityId: story.archiveId });
    const again = await evaluateOpportunity({ ...base, opportunityId: story.archiveId });
    expect(first.outcome).toBe("recorded");
    expect(again.outcome).toBe("unchanged");
    expect(again.evaluation.evaluatedAt).toBe(first.evaluation.evaluatedAt);

    const service = serviceClient();
    const { count: matchCount } = await service
      .from("opportunity_asset_matches")
      .select("id", { count: "exact", head: true })
      .eq("opportunity_id", story.archiveId);
    expect(matchCount).toBe(3);
    const { count: evaluationCount } = await service
      .from("opportunity_evaluations")
      .select("opportunity_id", { count: "exact", head: true })
      .eq("opportunity_id", story.archiveId);
    expect(evaluationCount).toBe(1);
    const { data: events } = await service
      .from("activity_events")
      .select("action")
      .eq("entity_id", story.archiveId)
      .eq("action", "opportunity.evaluated");
    expect(events).toHaveLength(1);
  });

  it("changes the input hash when the context changes, and re-evaluates", async () => {
    const story = await enterStory();
    const base = await asOwner();
    const before = await evaluateOpportunity({ ...base, opportunityId: story.archiveId });
    expect(before.outcome).toBe("recorded");
    // Headline only: nothing to compare on, and the state says so.
    expect(before.state).toBe("needs_context");

    await recordPerson(story.signalId);
    const after = await evaluateOpportunity({ ...base, opportunityId: story.archiveId });
    expect(after.outcome).toBe("recorded");
    expect(after.state).toBe("ready");
    expect(after.evaluation.inputHash).not.toBe(before.evaluation.inputHash);
  });

  it("never touches a photograph: no selection flip, no metadata write", async () => {
    const story = await enterStory();
    await recordPerson(story.signalId);
    const service = serviceClient();
    const snapshot = async () =>
      (
        await service
          .from("assets")
          .select("id, selected, updated_at, headline, subjects, keywords")
          .eq("organization_id", ORG_A)
          .order("id")
      ).data;
    const before = await snapshot();
    await evaluateOpportunity({ ...(await asOwner()), opportunityId: story.archiveId });
    expect(await snapshot()).toEqual(before);
  });

  it("creates no package, shoot, submission, buyer, license or delivery record", async () => {
    const story = await enterStory();
    await recordPerson(story.signalId);
    const service = serviceClient();
    const tables = [
      "packages",
      "shoots",
      "submissions",
      "buyers",
      "licenses",
      "submission_deliveries",
    ];
    const counts = async () =>
      Promise.all(
        tables.map(async (table) => {
          const { count } = await service
            .from(table)
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ORG_A);
          return count ?? 0;
        }),
      );
    const before = await counts();
    const base = await asOwner();
    await evaluateOpportunity({ ...base, opportunityId: story.archiveId });
    await evaluateOpportunity({ ...base, opportunityId: story.shootId });
    expect(await counts()).toEqual(before);
  });
});

describeIf("shoot brief", () => {
  it("needs context until where and when are recorded, and lists exactly what to confirm", async () => {
    const story = await enterStory();
    const base = await asOwner();

    const first = await evaluateOpportunity({ ...base, opportunityId: story.shootId });
    expect(first.outcome).toBe("recorded");
    expect(first.state).toBe("needs_context");
    const brief = await getShootBrief(ORG_A, story.shootId, base.client);
    expect(brief?.readiness).toBe("needs_context");
    expect(brief?.missingConfirmations).toContain("Event time: none recorded");
    expect(brief?.missingConfirmations).toContain("Location: none recorded");
    expect(brief?.suggestedAngle).toBeUndefined();
    expect(brief?.suggestedShots).toEqual([]);
    expect(brief?.knownLocation).toBeUndefined();

    await saveSignalContext({
      ...base,
      newsSignalId: story.signalId,
      input: {
        people: [PERSON],
        organizations: [],
        topics: [],
        keywords: [],
        locationName: VENUE,
        eventStartsAt: "2036-01-01T18:00:00.000Z",
      },
    });
    const second = await evaluateOpportunity({ ...base, opportunityId: story.shootId });
    expect(second.state).toBe("ready");
    const ready = await getShootBrief(ORG_A, story.shootId, base.client);
    expect(ready?.readiness).toBe("ready");
    expect(ready?.knownPeople).toEqual([PERSON]);
    expect(ready?.knownLocation).toBe(VENUE);
    expect(ready?.eventStartsAt).toBe("2036-01-01T18:00:00+00:00");
    expect(ready?.suggestedAngle).toBe(`${PERSON} at ${VENUE}`);
    expect(ready?.missingConfirmations).toContain(
      "Access and credentials: Mastline records none; confirm before travelling",
    );
    // The seeded workspace recorded no base city and no specialties: neither is claimed.
    expect(ready?.geographicRelevance).toMatch(/no base city on record/);
    expect(ready?.specialtyRelevance).toBeUndefined();
  });

  it("is evaluated independently of the archive path, over the same canonical facts", async () => {
    const story = await enterStory();
    await recordPerson(story.signalId);
    const base = await asOwner();

    const archive = await evaluateOpportunity({ ...base, opportunityId: story.archiveId });
    expect(await getEvaluation(ORG_A, story.shootId, base.client)).toBeNull();

    const shoot = await evaluateOpportunity({ ...base, opportunityId: story.shootId });
    expect(shoot.outcome).toBe("recorded");
    const archiveAfter = await getEvaluation(ORG_A, story.archiveId, base.client);
    expect(archiveAfter?.evaluatedAt).toBe(archive.evaluation.evaluatedAt);
    expect(archiveAfter?.inputHash).toBe(archive.evaluation.inputHash);

    // One edit to the canonical facts changes both inputs: both re-evaluate.
    const editor = await clientFor("editor");
    const { error } = await editor
      .from("news_signals")
      .update({ title: `Corrected ${Date.now()}` })
      .eq("id", story.signalId);
    expect(error).toBeNull();
    const archiveAgain = await evaluateOpportunity({ ...base, opportunityId: story.archiveId });
    const shootAgain = await evaluateOpportunity({ ...base, opportunityId: story.shootId });
    expect(archiveAgain.outcome).toBe("recorded");
    expect(shootAgain.outcome).toBe("recorded");
    expect(archiveAgain.evaluation.inputHash).not.toBe(archive.evaluation.inputHash);
    expect(shootAgain.evaluation.inputHash).not.toBe(shoot.evaluation.inputHash);
  });
});

describeIf("failure keeps the last good result", () => {
  it("a failed rerun marks the run failed and retains the previous matches", async () => {
    const story = await enterStory();
    await recordPerson(story.signalId);
    const base = await asOwner();
    const good = await evaluateOpportunity({ ...base, opportunityId: story.archiveId });
    expect(good.state).toBe("ready");

    // The same INVOKER function the data layer calls, handed a result naming
    // a photograph in another workspace: the composite foreign key refuses
    // it, the block rolls back, and the run is recorded as failed.
    const { data, error } = await base.client.rpc("record_opportunity_evaluation", {
      target_opportunity: story.archiveId,
      evaluator: EVALUATOR_VERSION,
      input_digest: "f".repeat(64),
      outcome: "ready",
      result: {
        score: 40,
        explanation: "forged",
        matches: [
          {
            asset_id: "b0000000-0000-0000-0000-0000000000d1",
            score: 40,
            rank: 1,
            reasons: ["not ours"],
            breakdown: {},
          },
        ],
      },
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ outcome: "failed", failure_code: "asset_not_in_workspace" });

    const evaluation = await getEvaluation(ORG_A, story.archiveId, base.client);
    expect(evaluation?.state).toBe("failed");
    expect(evaluation?.failureCode).toBe("asset_not_in_workspace");
    expect(evaluation?.retainedPreviousResult).toBe(true);
    expect(evaluation?.resultAt).toBe(good.evaluation.resultAt);
    expect(evaluation?.resultInputHash).toBe(good.evaluation.inputHash);

    const matches = await listArchiveMatches(ORG_A, story.archiveId, base.client);
    expect(matches.map((match) => match.assetId)).toContain(assets.active);
    expect(matches.map((match) => match.assetId)).not.toContain(
      "b0000000-0000-0000-0000-0000000000d1",
    );

    // And a rerun over the real inputs recovers.
    const recovered = await evaluateOpportunity({ ...base, opportunityId: story.archiveId });
    expect(recovered.outcome).toBe("recorded");
    expect(recovered.state).toBe("ready");
  });

  it("refuses a result of the wrong shape for the path without writing anything", async () => {
    const story = await enterStory();
    const base = await asOwner();
    const { data } = await base.client.rpc("record_opportunity_evaluation", {
      target_opportunity: story.archiveId,
      evaluator: EVALUATOR_VERSION,
      input_digest: "e".repeat(64),
      outcome: "ready",
      result: { brief: { readiness_score: 10 } },
    });
    expect(data).toMatchObject({ outcome: "failed", failure_code: "invalid_result" });
    const service = serviceClient();
    const { count } = await service
      .from("opportunity_shoot_briefs")
      .select("opportunity_id", { count: "exact", head: true })
      .eq("opportunity_id", story.archiveId);
    expect(count).toBe(0);
  });
});

describeIf("the database refuses what the application must not do", () => {
  it("a shoot path cannot receive archive matches, and an archive path cannot receive a brief", async () => {
    const story = await enterStory();
    const owner = await clientFor("owner");

    const { error: matchError } = await owner.from("opportunity_asset_matches").insert({
      organization_id: ORG_A,
      opportunity_id: story.shootId,
      opportunity_kind: "archive_match",
      asset_id: assets.active,
      score: 50,
      rank: 1,
      reasons: ["forged"],
      evaluator_version: EVALUATOR_VERSION,
    });
    expect(matchError?.code).toBe("23503");

    const { error: briefError } = await owner.from("opportunity_shoot_briefs").insert({
      organization_id: ORG_A,
      opportunity_id: story.archiveId,
      opportunity_kind: "shoot_opportunity",
      readiness: "ready",
      readiness_score: 10,
      window_state: "unknown",
      geographic_relevance: "forged",
      evaluator_version: EVALUATOR_VERSION,
    });
    expect(briefError?.code).toBe("23503");
  });

  it("a match, a brief, an entity and a context row cannot cross workspaces", async () => {
    const story = await enterStory();
    const otherOrg = await clientFor("otherOrgOwner");

    // Org B's owner may write org B rows; the composite keys cannot resolve org A's records under org B.
    const { error: matchError } = await otherOrg.from("opportunity_asset_matches").insert({
      organization_id: ORG_B,
      opportunity_id: story.archiveId,
      opportunity_kind: "archive_match",
      asset_id: "b0000000-0000-0000-0000-0000000000d1",
      score: 50,
      rank: 1,
      reasons: ["forged"],
      evaluator_version: EVALUATOR_VERSION,
    });
    expect(matchError?.code).toBe("23503");

    const { error: entityError } = await otherOrg.from("news_signal_entities").insert({
      organization_id: ORG_B,
      news_signal_id: story.signalId,
      entity_kind: "person",
      value: "Planted",
      created_by: OWNER_B,
    });
    expect(entityError?.code).toBe("23503");

    const { error: contextError } = await otherOrg.from("news_signal_context").insert({
      organization_id: ORG_B,
      news_signal_id: story.signalId,
      location_name: "Planted",
      updated_by: OWNER_B,
    });
    expect(contextError?.code).toBe("23503");

    // Org A's owner cannot reach across either: the match names org B's asset.
    const owner = await clientFor("owner");
    const { error: assetError } = await owner.from("opportunity_asset_matches").insert({
      organization_id: ORG_A,
      opportunity_id: story.archiveId,
      opportunity_kind: "archive_match",
      asset_id: "b0000000-0000-0000-0000-0000000000d1",
      score: 50,
      rank: 1,
      reasons: ["forged"],
      evaluator_version: EVALUATOR_VERSION,
    });
    expect(assetError?.code).toBe("23503");
  });

  it("keeps another workspace's evaluation unreadable", async () => {
    const story = await enterStory();
    await recordPerson(story.signalId);
    await evaluateOpportunity({ ...(await asOwner()), opportunityId: story.archiveId });

    const otherOrg = await clientFor("otherOrgOwner");
    expect(await getEvaluation(ORG_A, story.archiveId, otherOrg)).toBeNull();
    expect(await listArchiveMatches(ORG_A, story.archiveId, otherOrg)).toEqual([]);
    const { data } = await otherOrg.from("opportunity_asset_matches").select("id");
    expect(data ?? []).toHaveLength(0);
    await expect(
      evaluateOpportunity({
        organizationId: ORG_B,
        actorId: OWNER_B,
        opportunityId: story.archiveId,
        client: otherOrg,
      }),
    ).rejects.toMatchObject({ name: "EvaluationError", reason: "not_found" });
  });

  it("keeps preview signing workspace-scoped", async () => {
    const service = serviceClient();
    const key = `${ORG_A}/${fixtureShoot}/radar-preview-fixture.jpg`;
    const { error: uploadError } = await service.storage
      .from("derivatives")
      .upload(key, new Blob(["not-really-a-jpeg"]), { upsert: true, contentType: "image/jpeg" });
    expect(uploadError).toBeNull();
    try {
      const owner = await clientFor("owner");
      const mine = await owner.storage.from("derivatives").createSignedUrls([key], 60);
      expect(mine.error).toBeNull();
      expect(mine.data?.[0]?.signedUrl).toBeTruthy();

      const otherOrg = await clientFor("otherOrgOwner");
      const theirs = await otherOrg.storage.from("derivatives").createSignedUrls([key], 60);
      expect(theirs.data?.[0]?.signedUrl ?? null).toBeNull();
    } finally {
      await service.storage.from("derivatives").remove([key]);
    }
  });
});

describeIf("roles", () => {
  it("a viewer reads the evaluation but can neither evaluate nor edit context", async () => {
    const story = await enterStory();
    await recordPerson(story.signalId);
    await evaluateOpportunity({ ...(await asOwner()), opportunityId: story.archiveId });

    const viewer = await clientFor("viewer");
    expect((await getEvaluation(ORG_A, story.archiveId, viewer))?.state).toBe("ready");
    expect((await listArchiveMatches(ORG_A, story.archiveId, viewer)).length).toBeGreaterThan(0);
    expect((await getSignalContext(ORG_A, story.signalId, viewer)).entities.length).toBeGreaterThan(
      0,
    );

    await expect(
      saveSignalContext({
        organizationId: ORG_A,
        actorId: VIEWER_A,
        newsSignalId: story.signalId,
        input: { people: ["Somebody"], organizations: [], topics: [], keywords: [] },
        client: viewer,
      }),
    ).rejects.toMatchObject({ name: "EvaluationError", reason: "denied" });

    // A rerun over changed input is what a viewer would need to be refused on.
    const otherStory = await enterStory();
    await expect(
      evaluateOpportunity({
        organizationId: ORG_A,
        actorId: VIEWER_A,
        opportunityId: otherStory.archiveId,
        client: viewer,
      }),
    ).rejects.toMatchObject({ name: "EvaluationError", reason: "denied" });
    expect(await getEvaluation(ORG_A, otherStory.archiveId, viewer)).toBeNull();
  });

  it("an editor evaluates and records context; the answers are typed refusals, never driver text", async () => {
    const story = await enterStory();
    const editor = await clientFor("editor");
    const base = { organizationId: ORG_A, actorId: EDITOR_A, client: editor };

    const saved = await saveSignalContext({
      ...base,
      newsSignalId: story.signalId,
      input: {
        people: [PERSON],
        organizations: [],
        topics: ["radar"],
        keywords: [],
        locationName: VENUE,
      },
    });
    expect(saved.entities.map((entity) => entity.value).sort()).toEqual([PERSON, "radar"]);
    expect(saved.entities.every((entity) => entity.provenance === "manual")).toBe(true);
    expect(saved.context.locationProvenance).toBe("manual");

    const run = await evaluateOpportunity({ ...base, opportunityId: story.archiveId });
    expect(run.outcome).toBe("recorded");

    const viewer = await clientFor("viewer");
    try {
      await evaluateOpportunity({
        organizationId: ORG_A,
        actorId: VIEWER_A,
        opportunityId: story.shootId,
        client: viewer,
      });
      expect.unreachable("a viewer's evaluation must be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(EvaluationError);
      expect((error as Error).message).not.toMatch(/policy|column|row-level/i);
    }
  });
});

describeIf("suggestions", () => {
  it("records an accepted suggestion with its basis, once, and reconciles it on later saves", async () => {
    const story = await enterStory({
      title: `Radar evaluation ${Date.now()} Fixture Person departs`,
    });
    const base = await asOwner();
    const suggestion = {
      kind: "person" as const,
      value: "Fixture Person",
      basis: "Capitalised phrase in the headline",
      confidence: 0.4,
    };
    const first = await acceptSuggestion({ ...base, newsSignalId: story.signalId, suggestion });
    const accepted = first.entities.find((entity) => entity.value === "Fixture Person");
    expect(accepted).toMatchObject({
      provenance: "system",
      basis: suggestion.basis,
      confidence: 0.4,
    });

    const again = await acceptSuggestion({ ...base, newsSignalId: story.signalId, suggestion });
    expect(again.entities.filter((entity) => entity.value === "Fixture Person")).toHaveLength(1);

    // Leaving it in the list keeps its provenance; removing it deletes it.
    const kept = await saveSignalContext({
      ...base,
      newsSignalId: story.signalId,
      input: {
        people: ["fixture person", "Another Person"],
        organizations: [],
        topics: [],
        keywords: [],
      },
    });
    expect(kept.entities.find((entity) => entity.value === "Fixture Person")?.provenance).toBe(
      "system",
    );
    expect(kept.entities.find((entity) => entity.value === "Another Person")?.provenance).toBe(
      "manual",
    );

    const removed = await saveSignalContext({
      ...base,
      newsSignalId: story.signalId,
      input: { people: ["Another Person"], organizations: [], topics: [], keywords: [] },
    });
    expect(removed.entities.map((entity) => entity.value)).toEqual(["Another Person"]);

    const { data: events } = await serviceClient()
      .from("activity_events")
      .select("action")
      .eq("entity_id", story.signalId)
      .order("created_at");
    expect(events?.map((event) => event.action)).toEqual([
      "news_signal.created",
      "news_signal.suggestion_accepted",
      "news_signal.context_edited",
      "news_signal.context_edited",
    ]);
  });
});
