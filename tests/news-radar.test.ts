/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  OpportunityError,
  allowedOpportunityDecisions,
  createManualStory,
  dismissOpportunity,
  getOpportunity,
  getSiblingPath,
  listOpportunities,
  markOpportunityActed,
  updateOpportunityStatus,
  watchOpportunity,
} from "@/lib/data/opportunities";
import { OPPORTUNITY_STATUSES } from "@/lib/domain";
import { ORG_A, ORG_B, clientFor, hasLocalSupabase, serviceClient } from "./helpers/supabase";

/**
 * News Radar against the real policies: one canonical news signal, two
 * independent evaluation paths.
 *
 * Everything here goes through the data layer or direct table access with an
 * AUTHENTICATED client, the same way a Server Action does. The service role
 * only arranges fixtures and reads results back -- with two deliberate,
 * labelled exceptions where the subject under test is a schema property
 * rather than row level security (the author-deletion FK behavior, which
 * needs an auth admin call, and nothing else).
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const EDITOR_A = "22222222-2222-2222-2222-222222222222";
const VIEWER_A = "66666666-6666-6666-6666-666666666666";
const OWNER_B = "99999999-9999-9999-9999-999999999999";

const signals: string[] = [];
let counter = 0;

afterAll(async () => {
  if (!hasLocalSupabase() || signals.length === 0) return;
  const service = serviceClient();
  const { data: paths } = await service
    .from("opportunities")
    .select("id")
    .in("news_signal_id", signals);
  const entityIds = [...signals, ...(paths ?? []).map((row) => row.id as string)];
  await service.from("activity_events").delete().in("entity_id", entityIds);
  // Deleting the signal cascades into its paths through the composite FK.
  const { error } = await service.from("news_signals").delete().in("id", signals);
  if (error) throw new Error(`Could not clean up news signals: ${error.message}`);
});

function uniqueUrl(): string {
  counter += 1;
  return `https://news-radar-fixture.example/${Date.now()}-${counter}`;
}

/** One story entered as the owner, both paths created, tracked for cleanup. */
async function enterStory(overrides: Partial<Parameters<typeof createManualStory>[0]> = {}) {
  const client = await clientFor("owner");
  const result = await createManualStory({
    organizationId: ORG_A,
    title: `Radar fixture ${Date.now()}-${(counter += 1)}`,
    signal: "watch",
    client,
    ...overrides,
  });
  if (!signals.includes(result.signalId)) signals.push(result.signalId);
  return result;
}

describeIf("one entry, one signal, two paths", () => {
  it("creates exactly one canonical signal and exactly two paths, atomically authored", async () => {
    const sourceUrl = uniqueUrl();
    const result = await enterStory({
      title: "Gallery opening on the South Bank",
      sourceName: "Evening Standard",
      sourceUrl,
      sourcePublishedAt: "2026-08-20T10:30:00.000Z",
      summary: "A scheduled public event.",
      signal: "rising",
      windowClosesAt: "2026-08-22T18:00:00.000Z",
      suggestionBasis: "Two represented subjects are named in the invitation.",
      confidence: 0.72,
    });

    expect(result.outcome).toBe("created");
    expect(result.archiveOpportunityId).toBeTruthy();
    expect(result.shootOpportunityId).toBeTruthy();

    const service = serviceClient();
    const { data: storedSignals } = await service
      .from("news_signals")
      .select("id, created_by, title")
      .eq("organization_id", ORG_A)
      .eq("source_url", sourceUrl);
    expect(storedSignals).toHaveLength(1);
    // Authorship came from auth.uid() inside the database, not from a client.
    expect(storedSignals?.[0]?.created_by).toBe(OWNER_A);

    const { data: paths } = await service
      .from("opportunities")
      .select("id, news_signal_id, opportunity_kind, status")
      .eq("news_signal_id", result.signalId)
      .order("opportunity_kind");
    expect(paths).toHaveLength(2);
    // Both paths reference the same canonical signal, one of each kind.
    expect(paths?.map((path) => path.opportunity_kind)).toEqual([
      "archive_match",
      "shoot_opportunity",
    ]);
    expect(new Set(paths?.map((path) => path.news_signal_id))).toEqual(new Set([result.signalId]));

    // The entry wrote ONE canonical event, on the signal -- path decisions
    // will write their own, distinguishable by entity type.
    const { data: events } = await service
      .from("activity_events")
      .select("entity_type, action, actor_id")
      .eq("entity_id", result.signalId);
    expect(events).toEqual([
      { entity_type: "news_signal", action: "news_signal.created", actor_id: OWNER_A },
    ]);
  });

  it("shows the same story once in each mode, sharing one set of facts", async () => {
    const title = `Same story, both modes ${Date.now()}`;
    const result = await enterStory({ title, sourceUrl: uniqueUrl() });

    const owner = await clientFor("owner");
    const archive = await listOpportunities(ORG_A, { kind: "archive_match" }, owner);
    const shoot = await listOpportunities(ORG_A, { kind: "shoot_opportunity" }, owner);

    const archivePath = archive.find((path) => path.id === result.archiveOpportunityId);
    const shootPath = shoot.find((path) => path.id === result.shootOpportunityId);
    expect(archivePath?.story.title).toBe(title);
    expect(shootPath?.story.title).toBe(title);
    expect(archivePath?.newsSignalId).toBe(shootPath?.newsSignalId);

    // Each path can find its sibling for the "view the other path" link.
    const sibling = await getSiblingPath(
      ORG_A,
      result.signalId,
      result.archiveOpportunityId!,
      owner,
    );
    expect(sibling?.id).toBe(result.shootOpportunityId);
  });

  it("an editor may enter a story; a viewer is refused with a role answer", async () => {
    const editor = await clientFor("editor");
    const result = await createManualStory({
      organizationId: ORG_A,
      title: `Entered by the editor ${Date.now()}`,
      signal: "watch",
      client: editor,
    });
    signals.push(result.signalId);
    expect(result.outcome).toBe("created");

    const viewer = await clientFor("viewer");
    await expect(
      createManualStory({
        organizationId: ORG_A,
        title: "A viewer typing",
        signal: "watch",
        client: viewer,
      }),
    ).rejects.toMatchObject({ name: "OpportunityError", reason: "denied" });
  });
});

describeIf("duplicate protection lives on the canonical signal", () => {
  it("answers a repeated URL with the existing records, creating nothing", async () => {
    const sourceUrl = uniqueUrl();
    const first = await enterStory({ sourceUrl });

    const repeat = await enterStory({ title: "Typed again by somebody else's tab", sourceUrl });
    expect(repeat.outcome).toBe("duplicate");
    expect(repeat.signalId).toBe(first.signalId);
    expect(repeat.archiveOpportunityId).toBe(first.archiveOpportunityId);
    expect(repeat.shootOpportunityId).toBe(first.shootOpportunityId);

    const service = serviceClient();
    const { count: signalCount } = await service
      .from("news_signals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_A)
      .eq("source_url", sourceUrl);
    expect(signalCount).toBe(1);
    const { count: pathCount } = await service
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("news_signal_id", first.signalId);
    expect(pathCount).toBe(2);
  });

  it("lets a different organization hold the same source URL", async () => {
    const sourceUrl = uniqueUrl();
    await enterStory({ sourceUrl });

    const otherOrg = await clientFor("otherOrgOwner");
    const theirs = await createManualStory({
      organizationId: ORG_B,
      title: "The same article, another studio",
      sourceUrl,
      signal: "watch",
      client: otherOrg,
    });
    signals.push(theirs.signalId);
    expect(theirs.outcome).toBe("created");
  });

  it("does not refuse stories that have no source URL to compare", async () => {
    const first = await enterStory({ title: `A tip with no link ${Date.now()}` });
    const second = await enterStory({ title: `Another tip with no link ${Date.now()}` });
    expect(first.signalId).not.toBe(second.signalId);
    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("created");
  });
});

describeIf("creation is atomic", () => {
  it("a failure after the signal insert leaves neither signal nor paths behind", async () => {
    const sourceUrl = uniqueUrl();
    const owner = await clientFor("owner");
    // An invalid path signal passes no parser here on purpose: it fails the
    // paths' check constraint AFTER the signal insert succeeded, so anything
    // less than a transaction would strand a signal with no evaluations.
    const { error } = await owner.rpc("create_news_story", {
      target_organization: ORG_A,
      story_title: "A story whose paths cannot be written",
      story_source_url: sourceUrl,
      path_signal: "not-a-signal",
    });
    expect(error).toBeTruthy();

    const service = serviceClient();
    const { count } = await service
      .from("news_signals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_A)
      .eq("source_url", sourceUrl);
    expect(count).toBe(0);
  });
});

describeIf("workspace isolation", () => {
  it("keeps another organization's radar unreadable and unwritable", async () => {
    const story = await enterStory({ sourceUrl: uniqueUrl() });
    const otherOrg = await clientFor("otherOrgOwner");

    expect(await getOpportunity(ORG_A, story.archiveOpportunityId!, otherOrg)).toBeNull();
    const theirList = await listOpportunities(ORG_B, {}, otherOrg);
    expect(theirList.some((path) => path.newsSignalId === story.signalId)).toBe(false);

    const { data } = await otherOrg
      .from("opportunities")
      .update({ status: "dismissed" })
      .eq("id", story.archiveOpportunityId!)
      .select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("the database refuses a path in one workspace referencing a signal in another", async () => {
    // A bare org A signal with no paths yet, so the refusal below can only be
    // the composite foreign key -- not the one-path-per-kind uniqueness.
    const service = serviceClient();
    const { data: bare } = await service
      .from("news_signals")
      .insert({ organization_id: ORG_A, title: `Cross-org probe ${Date.now()}` })
      .select("id")
      .single();
    if (!bare) throw new Error("Could not arrange the bare signal");
    signals.push(bare.id as string);

    // As org B's owner: the write policy would allow an org B row, but the
    // composite foreign key (news_signal_id, organization_id) cannot resolve
    // an org A signal under org B, so the constraint refuses it.
    const otherOrg = await clientFor("otherOrgOwner");
    const { data, error } = await otherOrg
      .from("opportunities")
      .insert({
        organization_id: ORG_B,
        news_signal_id: bare.id,
        opportunity_kind: "archive_match",
        signal: "watch",
        status: "new",
      })
      .select("id");
    expect(data ?? []).toHaveLength(0);
    expect(error?.code).toBe("23503");
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

describeIf("authorship", () => {
  it("cannot be forged on a direct insert", async () => {
    const editor = await clientFor("editor");
    const { data, error } = await editor
      .from("news_signals")
      .insert({
        organization_id: ORG_A,
        title: "A signal claiming somebody else typed it",
        created_by: OWNER_A, // not the editor
      })
      .select("id");
    expect(data ?? []).toHaveLength(0);
    expect(error).toBeTruthy();
  });

  it("cannot be rewritten after the fact", async () => {
    const story = await enterStory({ sourceUrl: uniqueUrl() });
    const owner = await clientFor("owner");
    // The update grant is column-scoped to the source facts; created_by is
    // not in it, so this is refused at the grant layer before any policy.
    const { error } = await owner
      .from("news_signals")
      .update({ created_by: EDITOR_A })
      .eq("id", story.signalId);
    expect(error?.code).toBe("42501");
  });

  it("outlives its author: deleting the account keeps the signal, unattributed", async () => {
    // Schema property, not RLS: arranging a disposable author needs the auth
    // admin API, which is the one deliberate service-role act in this file.
    const service = serviceClient();
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: `disposable-${Date.now()}@mastline.test`,
      password: "mastline-dev-password",
      email_confirm: true,
    });
    if (createError || !created?.user) throw new Error("Could not arrange a disposable author");
    const authorId = created.user.id;

    const { data: signal, error } = await service
      .from("news_signals")
      .insert({
        organization_id: ORG_A,
        title: "A story whose author will leave",
        created_by: authorId,
      })
      .select("id")
      .single();
    if (error || !signal) throw new Error("Could not arrange the authored signal");
    signals.push(signal.id as string);

    const { error: deleteError } = await service.auth.admin.deleteUser(authorId);
    expect(deleteError).toBeNull();

    const { data: after } = await service
      .from("news_signals")
      .select("id, created_by")
      .eq("id", signal.id)
      .single();
    expect(after?.id).toBe(signal.id);
    expect(after?.created_by).toBeNull();
  });
});

describeIf("the two paths are decided independently", () => {
  it("dismissing the archive path leaves the shoot path exactly where it stood", async () => {
    const story = await enterStory({ sourceUrl: uniqueUrl() });
    const owner = await clientFor("owner");
    const base = { organizationId: ORG_A, actorId: OWNER_A, client: owner };

    await watchOpportunity({ ...base, opportunityId: story.shootOpportunityId! });
    const dismissed = await dismissOpportunity({
      ...base,
      opportunityId: story.archiveOpportunityId!,
      dismissalReason: "The frames it would need were sold exclusively.",
    });
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.dismissalReason).toBe("The frames it would need were sold exclusively.");

    const shootPath = await getOpportunity(ORG_A, story.shootOpportunityId!, owner);
    expect(shootPath?.status).toBe("watching");
    expect(shootPath?.dismissalReason).toBeUndefined();

    // The histories name their own paths, both distinguishable from the entry.
    const { data: events } = await serviceClient()
      .from("activity_events")
      .select("entity_type, entity_id, action")
      .in("entity_id", [story.signalId, story.archiveOpportunityId!, story.shootOpportunityId!])
      .order("created_at", { ascending: true });
    expect(events?.map((event) => `${event.entity_type}:${event.action}`)).toEqual([
      "news_signal:news_signal.created",
      "opportunity:opportunity.watching",
      "opportunity:opportunity.dismissed",
    ]);
    expect(events?.[1]?.entity_id).toBe(story.shootOpportunityId);
    expect(events?.[2]?.entity_id).toBe(story.archiveOpportunityId);
  });

  it("canonical facts cannot diverge: one edit is what both paths read", async () => {
    const story = await enterStory({ sourceUrl: uniqueUrl() });
    const editor = await clientFor("editor");

    const corrected = `Corrected headline ${Date.now()}`;
    const { error } = await editor
      .from("news_signals")
      .update({ title: corrected })
      .eq("id", story.signalId);
    expect(error).toBeNull();

    const archivePath = await getOpportunity(ORG_A, story.archiveOpportunityId!, editor);
    const shootPath = await getOpportunity(ORG_A, story.shootOpportunityId!, editor);
    expect(archivePath?.story.title).toBe(corrected);
    expect(shootPath?.story.title).toBe(corrected);
    // There is no second copy to disagree: both read the same row.
    expect(archivePath?.story.id).toBe(shootPath?.story.id);
  });

  it("treats a repeated decision as already recorded: no error, no second event", async () => {
    const story = await enterStory({ sourceUrl: uniqueUrl() });
    const owner = await clientFor("owner");
    const base = {
      organizationId: ORG_A,
      actorId: OWNER_A,
      opportunityId: story.archiveOpportunityId!,
      client: owner,
    };

    await watchOpportunity(base);
    const again = await watchOpportunity(base);
    expect(again.status).toBe("watching");

    const { data: events } = await serviceClient()
      .from("activity_events")
      .select("action")
      .eq("entity_id", story.archiveOpportunityId!)
      .eq("action", "opportunity.watching");
    expect(events).toHaveLength(1);
  });

  it("never lets a dismissed or expired path be worked as if it were new", async () => {
    const story = await enterStory({ sourceUrl: uniqueUrl() });
    const owner = await clientFor("owner");
    const base = {
      organizationId: ORG_A,
      actorId: OWNER_A,
      opportunityId: story.archiveOpportunityId!,
      client: owner,
    };

    await dismissOpportunity(base);
    await expect(watchOpportunity(base)).rejects.toMatchObject({ reason: "invalid_transition" });
    await expect(markOpportunityActed(base)).rejects.toMatchObject({
      reason: "invalid_transition",
    });

    expect(allowedOpportunityDecisions("expired")).toEqual([]);
    expect(allowedOpportunityDecisions("dismissed")).toEqual([]);
    expect(allowedOpportunityDecisions("acted")).toEqual([]);
    for (const status of OPPORTUNITY_STATUSES) {
      expect(Array.isArray(allowedOpportunityDecisions(status))).toBe(true);
    }
  });

  it("stamps acted_at when an operator records an act, idempotently", async () => {
    const story = await enterStory({ sourceUrl: uniqueUrl() });
    const owner = await clientFor("owner");
    const base = {
      organizationId: ORG_A,
      actorId: OWNER_A,
      opportunityId: story.shootOpportunityId!,
      client: owner,
    };

    const acted = await markOpportunityActed(base);
    expect(acted.status).toBe("acted");
    expect(acted.actedAt).toBeTruthy();
    const again = await markOpportunityActed(base);
    expect(again.actedAt).toBe(acted.actedAt);
  });

  it("tells a read-only role the refusal is about their role", async () => {
    const story = await enterStory({ sourceUrl: uniqueUrl() });
    const viewer = await clientFor("viewer");

    // The viewer can read the path...
    expect(await getOpportunity(ORG_A, story.archiveOpportunityId!, viewer)).not.toBeNull();
    // ...but not decide it.
    await expect(
      watchOpportunity({
        organizationId: ORG_A,
        actorId: VIEWER_A,
        opportunityId: story.archiveOpportunityId!,
        client: viewer,
      }),
    ).rejects.toMatchObject({ name: "OpportunityError", reason: "denied" });

    const after = await getOpportunity(
      ORG_A,
      story.archiveOpportunityId!,
      await clientFor("owner"),
    );
    expect(after?.status).toBe("new");
  });

  it("refuses a decision the vocabulary does not contain", async () => {
    const story = await enterStory({ sourceUrl: uniqueUrl() });
    const owner = await clientFor("owner");
    await expect(
      updateOpportunityStatus({
        organizationId: ORG_A,
        actorId: OWNER_A,
        opportunityId: story.archiveOpportunityId!,
        decision: "pitching" as never,
        client: owner,
      }),
    ).rejects.toMatchObject({ reason: "invalid_status" });
  });

  it("keeps a dismissal reason from surviving outside a dismissal", async () => {
    const story = await enterStory({ sourceUrl: uniqueUrl() });
    const { error } = await serviceClient()
      .from("opportunities")
      .update({ dismissal_reason: "left over" })
      .eq("id", story.archiveOpportunityId!);
    expect(error?.code).toBe("23514");
  });

  it("a decision on a record in another workspace answers not found, not denied", async () => {
    const otherOrg = await clientFor("otherOrgOwner");
    const story = await enterStory({ sourceUrl: uniqueUrl() });
    await expect(
      watchOpportunity({
        organizationId: ORG_B,
        actorId: OWNER_B,
        opportunityId: story.archiveOpportunityId!,
        client: otherOrg,
      }),
    ).rejects.toMatchObject({ reason: "not_found" });
  });

  it("throws OpportunityError instances, not driver errors", async () => {
    const story = await enterStory({ sourceUrl: uniqueUrl() });
    const viewer = await clientFor("viewer");
    try {
      await dismissOpportunity({
        organizationId: ORG_A,
        actorId: VIEWER_A,
        opportunityId: story.archiveOpportunityId!,
        client: viewer,
      });
      expect.unreachable("a viewer's dismissal must be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(OpportunityError);
      expect((error as Error).message).not.toMatch(/policy|column|row-level/i);
    }
  });
});
