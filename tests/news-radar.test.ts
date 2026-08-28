/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  OpportunityError,
  allowedOpportunityDecisions,
  createManualOpportunity,
  dismissOpportunity,
  getOpportunity,
  listOpportunities,
  markOpportunityActed,
  updateOpportunityStatus,
  watchOpportunity,
} from "@/lib/data/opportunities";
import { OPPORTUNITY_STATUSES } from "@/lib/domain";
import { ORG_A, ORG_B, clientFor, hasLocalSupabase, serviceClient } from "./helpers/supabase";

/**
 * News Radar against the real policies.
 *
 * Everything here goes through the data layer with an authenticated client,
 * the same way a Server Action does. The service role only arranges fixtures
 * and reads results back -- a test that writes as the service role proves
 * nothing about row level security.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const EDITOR_A = "22222222-2222-2222-2222-222222222222";
const VIEWER_A = "66666666-6666-6666-6666-666666666666";

const created: string[] = [];
let counter = 0;

afterAll(async () => {
  if (!hasLocalSupabase() || created.length === 0) return;
  const service = serviceClient();
  await service.from("activity_events").delete().in("entity_id", created);
  const { error } = await service.from("opportunities").delete().in("id", created);
  if (error) throw new Error(`Could not clean up opportunities: ${error.message}`);
});

function uniqueUrl(): string {
  counter += 1;
  return `https://news-radar-fixture.example/${Date.now()}-${counter}`;
}

async function enterStory(overrides: Partial<Parameters<typeof createManualOpportunity>[0]> = {}) {
  const client = await clientFor("owner");
  const saved = await createManualOpportunity({
    organizationId: ORG_A,
    actorId: OWNER_A,
    kind: "archive_match",
    title: `Radar fixture ${Date.now()}-${(counter += 1)}`,
    signal: "watch",
    client,
    ...overrides,
  });
  created.push(saved.id);
  return saved;
}

describeIf("entering a story by hand", () => {
  it("creates a private record and one activity event, and nothing else", async () => {
    const saved = await enterStory({
      kind: "shoot_opportunity",
      title: "Gallery opening on the South Bank",
      sourceName: "Evening Standard",
      sourceUrl: uniqueUrl(),
      sourcePublishedAt: "2026-08-20T10:30:00.000Z",
      summary: "A scheduled public event.",
      signal: "rising",
      windowClosesAt: "2026-08-22T18:00:00.000Z",
      suggestionBasis: "Two represented subjects are named in the invitation.",
      confidence: 0.72,
    });

    expect(saved.kind).toBe("shoot_opportunity");
    expect(saved.status).toBe("new");
    expect(saved.createdBy).toBe(OWNER_A);
    expect(saved.confidence).toBeCloseTo(0.72);
    expect(saved.suggestionBasis).toBe("Two represented subjects are named in the invitation.");

    const { data: events } = await serviceClient()
      .from("activity_events")
      .select("action, actor_id")
      .eq("entity_id", saved.id);
    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({ action: "opportunity.created", actor_id: OWNER_A });
  });

  it("lets an editor enter a story too", async () => {
    const client = await clientFor("editor");
    const saved = await createManualOpportunity({
      organizationId: ORG_A,
      actorId: EDITOR_A,
      kind: "archive_match",
      title: "Entered by the editor",
      signal: "watch",
      client,
    });
    created.push(saved.id);
    expect(saved.createdBy).toBe(EDITOR_A);
  });

  it("refuses a viewer, and tells them it is a role refusal", async () => {
    const client = await clientFor("viewer");
    await expect(
      createManualOpportunity({
        organizationId: ORG_A,
        actorId: VIEWER_A,
        kind: "archive_match",
        title: "A viewer typing",
        signal: "watch",
        client,
      }),
    ).rejects.toMatchObject({ name: "OpportunityError", reason: "denied" });
  });

  it("refuses the database's rule too: a confidence may not arrive without a basis", async () => {
    // Straight at the table, bypassing the parser, as a buggy caller would.
    const { error } = await serviceClient().from("opportunities").insert({
      organization_id: ORG_A,
      title: "Confidence with nothing behind it",
      confidence: 0.9,
    });
    expect(error?.code).toBe("23514");
  });
});

describeIf("duplicate protection", () => {
  it("refuses the same story twice as the same kind, allows it once per kind", async () => {
    const sourceUrl = uniqueUrl();
    await enterStory({ kind: "archive_match", sourceUrl });

    await expect(enterStory({ kind: "archive_match", sourceUrl })).rejects.toMatchObject({
      name: "OpportunityError",
      reason: "duplicate",
    });

    // The other job is a different record of the same story. Allowed.
    const asShoot = await enterStory({ kind: "shoot_opportunity", sourceUrl });
    expect(asShoot.kind).toBe("shoot_opportunity");
  });

  it("does not refuse stories that have no source URL to compare", async () => {
    const first = await enterStory({ title: "A tip with no link" });
    const second = await enterStory({ title: "Another tip with no link" });
    expect(first.id).not.toBe(second.id);
  });
});

describeIf("workspace isolation", () => {
  it("keeps another organization's radar unreadable and unwritable", async () => {
    const story = await enterStory();
    const otherOrg = await clientFor("otherOrgOwner");

    // Reading through the data layer answers "no such record".
    expect(await getOpportunity(ORG_A, story.id, otherOrg)).toBeNull();
    // Listing their own organization does not leak org A rows.
    const theirList = await listOpportunities(ORG_B, {}, otherOrg);
    expect(theirList.some((opportunity) => opportunity.id === story.id)).toBe(false);
    // A raw update attempt matches no rows at all.
    const { data } = await otherOrg
      .from("opportunities")
      .update({ status: "dismissed" })
      .eq("id", story.id)
      .select("id");
    expect(data ?? []).toHaveLength(0);

    const after = await getOpportunity(ORG_A, story.id, await clientFor("owner"));
    expect(after?.status).toBe("new");
  });

  it("answers a malformed id as no record, not as an error", async () => {
    const owner = await clientFor("owner");
    expect(await getOpportunity(ORG_A, "not-a-uuid", owner)).toBeNull();
    await expect(
      watchOpportunity({
        organizationId: ORG_A,
        actorId: OWNER_A,
        opportunityId: "not-a-uuid",
        client: owner,
      }),
    ).rejects.toMatchObject({ reason: "not_found" });
  });
});

describeIf("the lifecycle", () => {
  it("records watch, then dismissal with the reason on the record", async () => {
    const story = await enterStory();
    const owner = await clientFor("owner");
    const base = {
      organizationId: ORG_A,
      actorId: OWNER_A,
      opportunityId: story.id,
      client: owner,
    };

    const watched = await watchOpportunity(base);
    expect(watched.status).toBe("watching");

    const dismissed = await dismissOpportunity({
      ...base,
      dismissalReason: "Covered by the agency pool already.",
    });
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.dismissalReason).toBe("Covered by the agency pool already.");

    const { data: events } = await serviceClient()
      .from("activity_events")
      .select("action")
      .eq("entity_id", story.id)
      .order("created_at", { ascending: true });
    expect(events?.map((event) => event.action)).toEqual([
      "opportunity.created",
      "opportunity.watching",
      "opportunity.dismissed",
    ]);
  });

  it("treats a repeated decision as already recorded: no error, no second event", async () => {
    const story = await enterStory();
    const owner = await clientFor("owner");
    const base = {
      organizationId: ORG_A,
      actorId: OWNER_A,
      opportunityId: story.id,
      client: owner,
    };

    await watchOpportunity(base);
    const again = await watchOpportunity(base);
    expect(again.status).toBe("watching");

    const { data: events } = await serviceClient()
      .from("activity_events")
      .select("action")
      .eq("entity_id", story.id)
      .eq("action", "opportunity.watching");
    expect(events).toHaveLength(1);
  });

  it("never lets a dismissed or expired opportunity be worked as if it were new", async () => {
    const story = await enterStory();
    const owner = await clientFor("owner");
    const base = {
      organizationId: ORG_A,
      actorId: OWNER_A,
      opportunityId: story.id,
      client: owner,
    };

    await dismissOpportunity(base);
    await expect(watchOpportunity(base)).rejects.toMatchObject({ reason: "invalid_transition" });
    await expect(markOpportunityActed(base)).rejects.toMatchObject({
      reason: "invalid_transition",
    });

    // The same holds for expiry, which only the clock writes.
    expect(allowedOpportunityDecisions("expired")).toEqual([]);
    expect(allowedOpportunityDecisions("dismissed")).toEqual([]);
    expect(allowedOpportunityDecisions("acted")).toEqual([]);
    // And every status the schema knows has an explicit answer here.
    for (const status of OPPORTUNITY_STATUSES) {
      expect(Array.isArray(allowedOpportunityDecisions(status))).toBe(true);
    }
  });

  it("stamps acted_at when an operator records an act", async () => {
    const story = await enterStory();
    const owner = await clientFor("owner");
    const base = {
      organizationId: ORG_A,
      actorId: OWNER_A,
      opportunityId: story.id,
      client: owner,
    };

    const acted = await markOpportunityActed(base);
    expect(acted.status).toBe("acted");
    expect(acted.actedAt).toBeTruthy();

    // Repeating it is safe and moves nothing.
    const again = await markOpportunityActed(base);
    expect(again.actedAt).toBe(acted.actedAt);
  });

  it("tells a read-only role the refusal is about their role", async () => {
    const story = await enterStory();
    const viewer = await clientFor("viewer");

    await expect(
      watchOpportunity({
        organizationId: ORG_A,
        actorId: VIEWER_A,
        opportunityId: story.id,
        client: viewer,
      }),
    ).rejects.toMatchObject({ name: "OpportunityError", reason: "denied" });

    const after = await getOpportunity(ORG_A, story.id, await clientFor("owner"));
    expect(after?.status).toBe("new");
  });

  it("refuses a decision the vocabulary does not contain", async () => {
    const story = await enterStory();
    const owner = await clientFor("owner");
    await expect(
      updateOpportunityStatus({
        organizationId: ORG_A,
        actorId: OWNER_A,
        opportunityId: story.id,
        // The compile-time union is the real guard; this is the runtime copy.
        decision: "pitching" as never,
        client: owner,
      }),
    ).rejects.toMatchObject({ reason: "invalid_status" });
  });

  it("keeps a dismissal reason from surviving outside a dismissal", async () => {
    // The schema's own honesty check, exercised directly.
    const story = await enterStory();
    const { error } = await serviceClient()
      .from("opportunities")
      .update({ dismissal_reason: "left over" })
      .eq("id", story.id);
    expect(error?.code).toBe("23514");
  });

  it("is refused politely when an OpportunityError is not the failure", async () => {
    // A decision on a record in another workspace: not found, not denied --
    // the caller must not learn the record exists elsewhere.
    const otherOrg = await clientFor("otherOrgOwner");
    const story = await enterStory();
    await expect(
      watchOpportunity({
        organizationId: ORG_B,
        actorId: "99999999-9999-9999-9999-999999999999",
        opportunityId: story.id,
        client: otherOrg,
      }),
    ).rejects.toMatchObject({ reason: "not_found" });
  });

  it("throws OpportunityError instances, not driver errors", async () => {
    const story = await enterStory();
    const viewer = await clientFor("viewer");
    try {
      await dismissOpportunity({
        organizationId: ORG_A,
        actorId: VIEWER_A,
        opportunityId: story.id,
        client: viewer,
      });
      expect.unreachable("a viewer's dismissal must be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(OpportunityError);
      // The message is written for a person; no column or policy names leak.
      expect((error as Error).message).not.toMatch(/policy|column|row-level/i);
    }
  });
});
