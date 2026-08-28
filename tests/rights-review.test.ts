/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RightsReviewError,
  TRIAGE_STATUSES,
  type TriageStatus,
  allowedTransitions,
  getRightsMatch,
  reviewRightsMatch,
} from "@/lib/data/rights";
import {
  ORG_A,
  ORG_A_ASSET,
  ORG_B,
  ORG_B_ASSET,
  type SeededUser,
  clientFor,
  hasLocalSupabase,
  serviceClient,
} from "./helpers/supabase";

/**
 * Rights triage against the real policies.
 *
 * Everything here goes through the data layer with an authenticated client, the
 * same way a Server Action does. Nothing uses the service role as a subject:
 * the service client only arranges fixtures and reads results back, because a
 * test that writes as the service role proves nothing about row level security.
 *
 * Four things stay separate, and these tests are how that stays true: the
 * machine's observation, the search of our own license records, the human
 * decision, and a legal conclusion -- which this product does not make.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const UID: Record<string, string> = {
  owner: "11111111-1111-1111-1111-111111111111",
  editor: "22222222-2222-2222-2222-222222222222",
  dispatcher: "33333333-3333-3333-3333-333333333333",
  finance: "44444444-4444-4444-4444-444444444444",
  rights: "55555555-5555-5555-5555-555555555555",
  viewer: "66666666-6666-6666-6666-666666666666",
  otherOrgOwner: "99999999-9999-9999-9999-999999999999",
};

const created: string[] = [];
let counter = 0;

interface Fixture {
  readonly id: string;
  readonly updatedAt: string;
}

/**
 * A match to triage.
 *
 * Written with the service role because an observation is not something a
 * member records by hand -- it is what the (not yet built) matching pass would
 * insert. The source URL is unique per row: the table has a
 * (organization, asset, source URL) uniqueness constraint, and a fixed one
 * would work exactly once.
 */
async function makeMatch(
  overrides: Record<string, unknown> = {},
  organizationId: string = ORG_A,
  assetId: string = ORG_A_ASSET,
): Promise<Fixture> {
  counter += 1;
  const { data, error } = await serviceClient()
    .from("rights_matches")
    .insert({
      organization_id: organizationId,
      asset_id: assetId,
      status: "new",
      source_url: `https://triage-fixture.example/${Date.now()}-${counter}`,
      publisher_name: "Fixture Press",
      publisher_domain: "triage-fixture.example",
      page_title: "A fixture page",
      first_observed_at: "2026-08-20T13:02:00Z",
      last_observed_at: "2026-08-20T16:02:00Z",
      match_method: "Perceptual hash + crop tolerance",
      confidence: 0.9312,
      license_check: "no_linked_license_found",
      evidence_bucket: "evidence",
      evidence_object_key: `${organizationId}/rights/fixture-${counter}.png`,
      ...overrides,
    })
    .select("id, updated_at")
    .single();

  if (error) throw new Error(`Could not arrange a match: ${error.message}`);
  created.push(data.id as string);
  return { id: data.id as string, updatedAt: data.updated_at as string };
}

async function rowOf(id: string) {
  const { data } = await serviceClient().from("rights_matches").select("*").eq("id", id).single();
  return data as Record<string, unknown>;
}

async function eventsFor(id: string) {
  const { data } = await serviceClient()
    .from("activity_events")
    .select("action, actor_id, entity_type, event_data")
    .eq("entity_id", id)
    .order("created_at", { ascending: true });
  return data ?? [];
}

/** Run a decision as one of the seeded people and report how it failed. */
async function decideAs(
  user: SeededUser,
  input: {
    organizationId?: string;
    matchId: string;
    status: TriageStatus;
    note?: string;
    expectedUpdatedAt: string;
  },
): Promise<{ ok: true } | { ok: false; reason: string; message: string }> {
  const client: SupabaseClient = await clientFor(user);
  try {
    await reviewRightsMatch({
      organizationId: input.organizationId ?? ORG_A,
      actorId: UID[user],
      matchId: input.matchId,
      status: input.status,
      note: input.note,
      expectedUpdatedAt: input.expectedUpdatedAt,
      client,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof RightsReviewError) {
      return { ok: false, reason: error.reason, message: error.message };
    }
    throw error;
  }
}

afterAll(async () => {
  if (!hasLocalSupabase() || created.length === 0) return;
  // The activity events these tests write are append-only by design and stay.
  // They point at matches that no longer exist, which is exactly what an
  // append-only history looks like after a record is purged.
  const { error } = await serviceClient().from("rights_matches").delete().in("id", created);
  if (error) throw new Error(`Could not clean up the fixtures: ${error.message}`);
});

describeIf("who may record a decision", () => {
  it("owner can start review", async () => {
    const match = await makeMatch();
    expect(await decideAs("owner", { matchId: match.id, status: "reviewing", expectedUpdatedAt: match.updatedAt })).toEqual({ ok: true });
    expect((await rowOf(match.id)).status).toBe("reviewing");
  });

  it("rights reviewer can start review", async () => {
    const match = await makeMatch();
    expect(await decideAs("rights", { matchId: match.id, status: "reviewing", expectedUpdatedAt: match.updatedAt })).toEqual({ ok: true });
    expect((await rowOf(match.id)).status).toBe("reviewing");
  });

  it.each(["editor", "dispatcher", "finance", "viewer"] as const)(
    "%s cannot modify a rights match",
    async (user) => {
      const match = await makeMatch();
      const result = await decideAs(user, {
        matchId: match.id,
        status: "reviewing",
        expectedUpdatedAt: match.updatedAt,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("denied");
      const row = await rowOf(match.id);
      expect(row.status).toBe("new");
      expect(row.reviewed_by).toBeNull();
      expect(await eventsFor(match.id)).toHaveLength(0);
    },
  );
});

describeIf("a match belongs to exactly one workspace", () => {
  it("a Workspace A user cannot modify a Workspace B match", async () => {
    const match = await makeMatch({}, ORG_B, ORG_B_ASSET);

    // Naming their own organization: the row is not in it.
    const scoped = await decideAs("owner", {
      matchId: match.id,
      status: "reviewing",
      expectedUpdatedAt: match.updatedAt,
    });
    expect(scoped).toMatchObject({ ok: false, reason: "not_found" });

    // Naming the other organization: row level security answers with nothing,
    // and the refusal is identical, so neither attempt confirms the row exists.
    const forged = await decideAs("owner", {
      organizationId: ORG_B,
      matchId: match.id,
      status: "reviewing",
      expectedUpdatedAt: match.updatedAt,
    });
    expect(forged).toMatchObject({ ok: false, reason: "not_found" });
    expect(scoped).toEqual(forged);

    expect((await rowOf(match.id)).status).toBe("new");
    expect(await eventsFor(match.id)).toHaveLength(0);
  });

  it("cannot even read a match from the other workspace", async () => {
    const match = await makeMatch({}, ORG_B, ORG_B_ASSET);
    const client = await clientFor("owner");
    expect(await getRightsMatch(ORG_B, match.id, client)).toBeNull();
    expect(await getRightsMatch(ORG_A, match.id, client)).toBeNull();
  });

  it.each([
    ["a malformed id", "not-a-uuid"],
    ["an id shaped right but belonging to nothing", "00000000-0000-4000-8000-000000000000"],
    ["a SQL fragment", "' or true --"],
  ])("safely rejects %s", async (_label, forged) => {
    const result = await decideAs("rights", {
      matchId: forged,
      status: "reviewing",
      expectedUpdatedAt: new Date().toISOString(),
    });
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describeIf("what each decision records", () => {
  it("reviewing stamps the reviewer and the review time", async () => {
    const match = await makeMatch();
    const before = Date.now();
    expect(await decideAs("rights", { matchId: match.id, status: "reviewing", expectedUpdatedAt: match.updatedAt })).toEqual({ ok: true });

    const row = await rowOf(match.id);
    expect(row.status).toBe("reviewing");
    expect(row.reviewed_by).toBe(UID.rights);
    expect(new Date(row.reviewed_at as string).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("monitoring persists an optional note", async () => {
    const match = await makeMatch();
    expect(
      await decideAs("rights", {
        matchId: match.id,
        status: "monitoring",
        note: "  Waiting on the syndication list from the desk.  ",
        expectedUpdatedAt: match.updatedAt,
      }),
    ).toEqual({ ok: true });

    const row = await rowOf(match.id);
    expect(row.status).toBe("monitoring");
    expect(row.decision_note).toBe("Waiting on the syndication list from the desk.");
    expect(row.reviewed_by).toBe(UID.rights);
  });

  it("monitoring is allowed with no note at all", async () => {
    const match = await makeMatch();
    expect(await decideAs("rights", { matchId: match.id, status: "monitoring", expectedUpdatedAt: match.updatedAt })).toEqual({ ok: true });
    const row = await rowOf(match.id);
    expect(row.status).toBe("monitoring");
    expect(row.decision_note).toBeNull();
  });

  it.each([
    ["an empty note", ""],
    ["whitespace only", "   \n\t "],
  ])("ignoring refuses %s", async (_label, note) => {
    const match = await makeMatch();
    const result = await decideAs("rights", {
      matchId: match.id,
      status: "ignored",
      note,
      expectedUpdatedAt: match.updatedAt,
    });
    expect(result).toMatchObject({ ok: false, reason: "note_required" });
    expect((await rowOf(match.id)).status).toBe("new");
    expect(await eventsFor(match.id)).toHaveLength(0);
  });

  it("ignoring refuses a note too short to mean anything", async () => {
    const match = await makeMatch();
    const result = await decideAs("rights", {
      matchId: match.id,
      status: "ignored",
      note: "no",
      expectedUpdatedAt: match.updatedAt,
    });
    expect(result).toMatchObject({ ok: false, reason: "note_too_short" });
  });

  it("ignoring preserves the observation, its evidence, and the source", async () => {
    const match = await makeMatch();
    const before = await rowOf(match.id);

    expect(
      await decideAs("rights", {
        matchId: match.id,
        status: "ignored",
        note: "Our own frame, licensed to this publisher under the 2025 wire agreement.",
        expectedUpdatedAt: match.updatedAt,
      }),
    ).toEqual({ ok: true });

    const after = await rowOf(match.id);
    expect(after.status).toBe("ignored");
    for (const field of [
      "source_url",
      "publisher_name",
      "publisher_domain",
      "page_title",
      "first_observed_at",
      "last_observed_at",
      "match_method",
      "confidence",
      "license_check",
      "evidence_bucket",
      "evidence_object_key",
      "asset_id",
      "created_at",
    ]) {
      expect(after[field]).toEqual(before[field]);
    }
  });

  it("licensed is refused when no linked license was found", async () => {
    const match = await makeMatch();
    const result = await decideAs("rights", {
      matchId: match.id,
      status: "licensed",
      note: "The desk says they bought it from the agency in July.",
      expectedUpdatedAt: match.updatedAt,
    });
    expect(result).toMatchObject({ ok: false, reason: "license_required" });
    if (result.ok) return;
    expect(result.message).toBe(
      "Link and verify the applicable license before marking this use as licensed.",
    );

    const row = await rowOf(match.id);
    expect(row.status).toBe("new");
    // The refusal must not quietly rewrite the observation to make itself true.
    expect(row.license_check).toBe("no_linked_license_found");
    expect(await eventsFor(match.id)).toHaveLength(0);
  });

  it("licensed is allowed on a linked license, and leaves the observation alone", async () => {
    const match = await makeMatch({ license_check: "linked_license_found" });
    const before = await rowOf(match.id);

    expect(
      await decideAs("rights", {
        matchId: match.id,
        status: "licensed",
        note: "Matches license MST-2026-0114, checked against the signed terms.",
        expectedUpdatedAt: match.updatedAt,
      }),
    ).toEqual({ ok: true });

    const after = await rowOf(match.id);
    expect(after.status).toBe("licensed");
    expect(after.license_check).toBe("linked_license_found");
    expect(after.confidence).toEqual(before.confidence);
    expect(after.match_method).toEqual(before.match_method);
    expect(after.first_observed_at).toEqual(before.first_observed_at);
    expect(after.last_observed_at).toEqual(before.last_observed_at);
    expect(after.evidence_object_key).toEqual(before.evidence_object_key);
  });

  it("resolved needs a note, and only after a review has started", async () => {
    const fresh = await makeMatch();
    expect(
      await decideAs("rights", {
        matchId: fresh.id,
        status: "resolved",
        note: "Nothing further to do here.",
        expectedUpdatedAt: fresh.updatedAt,
      }),
    ).toMatchObject({ ok: false, reason: "invalid_transition" });

    const match = await makeMatch();
    expect(await decideAs("rights", { matchId: match.id, status: "reviewing", expectedUpdatedAt: match.updatedAt })).toEqual({ ok: true });
    const reviewing = await rowOf(match.id);

    expect(
      await decideAs("rights", {
        matchId: match.id,
        status: "resolved",
        expectedUpdatedAt: reviewing.updated_at as string,
      }),
    ).toMatchObject({ ok: false, reason: "note_required" });

    expect(
      await decideAs("rights", {
        matchId: match.id,
        status: "resolved",
        note: "The publisher took the page down before we asked anything of them.",
        expectedUpdatedAt: reviewing.updated_at as string,
      }),
    ).toEqual({ ok: true });
    expect((await rowOf(match.id)).status).toBe("resolved");
  });
});

describeIf("escalation is not part of this sprint", () => {
  it("is not offered as a triage status", () => {
    expect(TRIAGE_STATUSES).not.toContain("escalated");
  });

  it("is not reachable from any status", () => {
    for (const from of ["new", "reviewing", "monitoring", "licensed", "ignored", "resolved", "escalated"] as const) {
      expect(allowedTransitions(from)).not.toContain("escalated");
    }
  });

  it("is refused by the data layer even when asked for directly", async () => {
    const match = await makeMatch();
    const result = await decideAs("rights", {
      matchId: match.id,
      // Deliberately past the type, the way a forged form field would arrive.
      status: "escalated" as unknown as TriageStatus,
      note: "Sending a demand letter to the publisher today.",
      expectedUpdatedAt: match.updatedAt,
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid_status" });
    expect((await rowOf(match.id)).status).toBe("new");
    expect(await eventsFor(match.id)).toHaveLength(0);
  });
});

describeIf("the activity history", () => {
  it("writes exactly one correct event per successful transition", async () => {
    const match = await makeMatch();
    expect(await decideAs("owner", { matchId: match.id, status: "reviewing", expectedUpdatedAt: match.updatedAt })).toEqual({ ok: true });

    const afterFirst = await rowOf(match.id);
    expect(
      await decideAs("rights", {
        matchId: match.id,
        status: "monitoring",
        note: "Waiting for the next crawl of the same page.",
        expectedUpdatedAt: afterFirst.updated_at as string,
      }),
    ).toEqual({ ok: true });

    const events = await eventsFor(match.id);
    expect(events.map((event) => event.action)).toEqual([
      "rights_match.reviewing",
      "rights_match.monitoring",
    ]);
    expect(events[0].entity_type).toBe("rights_match");
    expect(events[0].actor_id).toBe(UID.owner);
    expect(events[1].actor_id).toBe(UID.rights);
    expect(events[0].event_data).toMatchObject({ previousStatus: "new", status: "reviewing", noteRecorded: false });
    expect(events[1].event_data).toMatchObject({ previousStatus: "reviewing", status: "monitoring", noteRecorded: true });

    // The note lives on the match. An event stream is a wider audience than the
    // record it describes, so the reasoning itself is not copied into it.
    expect(JSON.stringify(events[1].event_data)).not.toContain("next crawl");
  });

  it("writes nothing when the transition fails", async () => {
    const match = await makeMatch();
    await decideAs("rights", { matchId: match.id, status: "ignored", note: "", expectedUpdatedAt: match.updatedAt });
    await decideAs("viewer", { matchId: match.id, status: "reviewing", expectedUpdatedAt: match.updatedAt });
    await decideAs("rights", { matchId: match.id, status: "resolved", note: "Closing without review.", expectedUpdatedAt: match.updatedAt });
    expect(await eventsFor(match.id)).toHaveLength(0);
  });
});

describeIf("two reviewers on one queue", () => {
  it("a stale updated_at loses safely", async () => {
    const match = await makeMatch();
    expect(await decideAs("owner", { matchId: match.id, status: "reviewing", expectedUpdatedAt: match.updatedAt })).toEqual({ ok: true });

    // The second reviewer is still holding the version they loaded.
    const late = await decideAs("rights", {
      matchId: match.id,
      status: "ignored",
      note: "Not worth chasing, we shot it on assignment for them.",
      expectedUpdatedAt: match.updatedAt,
    });
    expect(late).toMatchObject({ ok: false, reason: "conflict" });
    if (!late.ok) expect(late.message).toMatch(/reload/i);

    const row = await rowOf(match.id);
    expect(row.status).toBe("reviewing");
    expect(row.decision_note).toBeNull();
    expect(await eventsFor(match.id)).toHaveLength(1);
  });

  it("two concurrent reviewers cannot silently overwrite each other", async () => {
    const match = await makeMatch();

    const [first, second] = await Promise.all([
      decideAs("owner", {
        matchId: match.id,
        status: "monitoring",
        note: "Holding until the syndication list arrives.",
        expectedUpdatedAt: match.updatedAt,
      }),
      decideAs("rights", {
        matchId: match.id,
        status: "ignored",
        note: "Setting aside, this is the agency's own frame.",
        expectedUpdatedAt: match.updatedAt,
      }),
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const loser = outcomes.find((outcome) => !outcome.ok);
    expect(loser).toMatchObject({ ok: false, reason: "conflict" });

    const row = await rowOf(match.id);
    const events = await eventsFor(match.id);
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe(`rights_match.${row.status}`);
  });
});

describeIf("completed decisions are forward-only", () => {
  it.each(["licensed", "ignored", "resolved"] as const)(
    "a %s match offers no further transition",
    (status) => {
      expect(allowedTransitions(status)).toEqual([]);
    },
  );

  it("refuses to reopen an ignored match", async () => {
    const match = await makeMatch();
    expect(
      await decideAs("rights", {
        matchId: match.id,
        status: "ignored",
        note: "Licensed to them directly last winter, nothing to chase.",
        expectedUpdatedAt: match.updatedAt,
      }),
    ).toEqual({ ok: true });

    const ignored = await rowOf(match.id);
    for (const status of ["reviewing", "monitoring", "licensed", "resolved"] as const) {
      expect(
        await decideAs("owner", {
          matchId: match.id,
          status,
          note: "Changed my mind about this one after all.",
          expectedUpdatedAt: ignored.updated_at as string,
        }),
      ).toMatchObject({ ok: false, reason: "invalid_transition" });
    }

    expect((await rowOf(match.id)).status).toBe("ignored");
    expect(await eventsFor(match.id)).toHaveLength(1);
  });

  it("refuses to reopen a licensed match", async () => {
    const match = await makeMatch({ license_check: "linked_license_found" });
    expect(
      await decideAs("rights", {
        matchId: match.id,
        status: "licensed",
        note: "Covered by MST-2026-0210, verified against the invoice.",
        expectedUpdatedAt: match.updatedAt,
      }),
    ).toEqual({ ok: true });

    const licensed = await rowOf(match.id);
    expect(
      await decideAs("rights", {
        matchId: match.id,
        status: "reviewing",
        expectedUpdatedAt: licensed.updated_at as string,
      }),
    ).toMatchObject({ ok: false, reason: "invalid_transition" });
  });
});
