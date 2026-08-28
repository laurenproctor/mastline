/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assignRequest,
  createRequest,
  getRequest,
  getRequestSensitiveNote,
  listRequests,
  sortForInbox,
  transitionRequest,
  updateRequest,
} from "@/lib/data/requests";
import { getWorkQueue } from "@/lib/data/work-queue";
import { REQUEST_STATUSES, type BuyerRequest, type RequestStatus } from "@/lib/domain";
import { RequestError, isClosed } from "@/lib/requests";
import { workspaceRoutes } from "@/lib/workspace-routes";
import type { RequestIntakeInput } from "@/lib/validation";
import {
  ORG_A,
  ORG_A_PACKAGE_DELIVERED,
  ORG_A_SHOOT,
  ORG_B,
  type SeededUser,
  clientFor,
  hasLocalSupabase,
  serviceClient,
} from "./helpers/supabase";

/**
 * Buyer requests against the real policies.
 *
 * Everything here goes through the data layer with an authenticated client, the
 * same way a Server Action does. The service client only arranges fixtures and
 * reads results back: a test that writes as the service role proves nothing
 * about row level security, because the service role bypasses it entirely.
 *
 * The four things these exist to keep true:
 *
 *   1. A repeat of a capture lands on the request it already made.
 *   2. "The buyer did not say" survives a round trip through Postgres as
 *      something different from zero, worldwide, perpetual and unrestricted.
 *   3. A closed request stays closed, whatever the client believes.
 *   4. Nothing crosses a workspace boundary -- not a read, not a buyer
 *      reference, not an assignment.
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

const ORG_A_BUYER = "a0000000-0000-0000-0000-0000000000b1";
const ORG_B_BUYER = "b0000000-0000-0000-0000-0000000000b1";

const created: string[] = [];
let counter = 0;

/** A unique idempotency key per call. The constraint is per workspace. */
function newKey(label: string): string {
  counter += 1;
  return `test-${label}-${counter}-${process.pid}`;
}

/**
 * The minimum a request needs.
 *
 * Deliberately almost entirely empty: a picture desk gives you a line and a
 * deadline, and everything else has to be allowed to stay unknown. Each test
 * adds only the fields it is actually about.
 */
function intake(overrides: Partial<RequestIntakeInput> = {}): RequestIntakeInput {
  return {
    title: "Anything from the Chelsea departure?",
    requestType: "archive",
    subjectNames: [],
    topics: [],
    requestedFormats: [],
    budgetDisclosed: false,
    currency: "USD",
    ...overrides,
  };
}

async function record(
  user: SeededUser,
  overrides: Partial<RequestIntakeInput> = {},
  options: { key?: string; status?: "draft" | "new"; organizationId?: string } = {},
) {
  const client = await clientFor(user);
  const result = await createRequest({
    organizationId: options.organizationId ?? ORG_A,
    actorId: UID[user],
    intake: intake(overrides),
    idempotencyKey: options.key ?? newKey(user),
    status: options.status,
    client,
  });
  created.push(result.id);
  return { ...result, client };
}

async function rowOf(id: string): Promise<Record<string, unknown>> {
  const { data } = await serviceClient().from("buyer_requests").select("*").eq("id", id).single();
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

/** Run something and report the RequestError reason, or "ok". */
async function reasonOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof RequestError) return error.reason;
    throw error;
  }
}

afterAll(async () => {
  if (!hasLocalSupabase()) return;
  const service = serviceClient();
  // The sensitive notes cascade from the request; the activity events are
  // append-only by design and are left where they are, as the rights tests do.
  for (const id of created) {
    await service.from("buyer_requests").delete().eq("id", id);
  }
});

describeIf("recording a request", () => {
  it("writes a reference somebody can read down a phone", async () => {
    const { reference, existed } = await record("owner");
    expect(existed).toBe(false);
    expect(reference).toMatch(/^REQ-\d{4}-\d{4}$/);
  });

  it("needs nothing but a title", async () => {
    const { id } = await record("owner", { title: "One line, nothing else" });
    const request = await getRequest(ORG_A, id, await clientFor("owner"));

    expect(request?.title).toBe("One line, nothing else");
    // Everything a desk did not say stays unknown. None of these may acquire a
    // default on the way through the database.
    expect(request?.territory).toBeUndefined();
    expect(request?.usageDuration).toBeUndefined();
    expect(request?.exclusivity).toBeUndefined();
    expect(request?.usageMedia).toBeUndefined();
    expect(request?.responseDeadline).toBeUndefined();
    expect(request?.approximateQuantity).toBeUndefined();
    expect(request?.buyerId).toBeUndefined();
    expect(request?.orientation).toBeUndefined();
    expect(request?.requestedFormats).toEqual([]);
  });

  it("lands on the request it already made when the same key comes back", async () => {
    const key = newKey("idempotent");
    const first = await record("owner", { title: "First attempt" }, { key });
    const second = await record("owner", { title: "Second attempt" }, { key });

    expect(second.id).toBe(first.id);
    expect(second.reference).toBe(first.reference);
    expect(second.existed).toBe(true);

    // And the second attempt's different title did not overwrite the first.
    const request = await getRequest(ORG_A, first.id, await clientFor("owner"));
    expect(request?.title).toBe("First attempt");
  });

  it("gives two different keys two different requests", async () => {
    const first = await record("owner");
    const second = await record("owner");
    expect(second.id).not.toBe(first.id);
    expect(second.reference).not.toBe(first.reference);
  });

  it("starts in the inbox, or as a private draft when asked", async () => {
    const posted = await record("owner", {}, { status: "new" });
    const draft = await record("owner", {}, { status: "draft" });

    expect((await rowOf(posted.id)).status).toBe("new");
    expect((await rowOf(draft.id)).status).toBe("draft");
  });

  it("records one activity event, naming the actor", async () => {
    const { id } = await record("editor");
    const events = await eventsFor(id);

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("request.created");
    expect(events[0].entity_type).toBe("buyer_request");
    expect(events[0].actor_id).toBe(UID.editor);
  });
});

describeIf("a budget nobody stated", () => {
  it("is stored as undisclosed with no figures", async () => {
    const { id } = await record("owner");
    const row = await rowOf(id);

    expect(row.budget_disclosed).toBe(false);
    expect(row.budget_min_minor).toBeNull();
    expect(row.budget_max_minor).toBeNull();
  });

  it("is a different row from a stated budget of zero", async () => {
    const silent = await record("owner");
    const zero = await record("owner", {
      budgetDisclosed: true,
      budgetMinMinor: 0,
      budgetMaxMinor: 0,
    });

    const silentRow = await rowOf(silent.id);
    const zeroRow = await rowOf(zero.id);

    expect(silentRow.budget_disclosed).toBe(false);
    expect(silentRow.budget_min_minor).toBeNull();

    expect(zeroRow.budget_disclosed).toBe(true);
    expect(Number(zeroRow.budget_min_minor)).toBe(0);

    // And the two survive the trip back out as different domain values.
    const client = await clientFor("owner");
    expect((await getRequest(ORG_A, silent.id, client))?.budgetMin).toBeUndefined();
    expect((await getRequest(ORG_A, zero.id, client))?.budgetMin?.minor).toBe(0);
  });

  it("is refused by the database when figures arrive without a disclosure", async () => {
    // The check constraint, not the parser. A client that skipped validation
    // still cannot write a budget nobody said.
    const { error } = await serviceClient()
      .from("buyer_requests")
      .insert({
        organization_id: ORG_A,
        created_by: UID.owner,
        idempotency_key: newKey("undisclosed-figure"),
        reference: `REQ-9999-${String(1000 + counter).slice(0, 4)}`,
        title: "Figures with no disclosure",
        budget_disclosed: false,
        budget_min_minor: 50000,
      });

    expect(error?.code).toBe("23514");
  });

  it("is refused when a disclosure carries no figure at all", async () => {
    const { error } = await serviceClient()
      .from("buyer_requests")
      .insert({
        organization_id: ORG_A,
        created_by: UID.owner,
        idempotency_key: newKey("empty-disclosure"),
        reference: `REQ-9998-${String(2000 + counter).slice(0, 4)}`,
        title: "Disclosure with no figure",
        budget_disclosed: true,
      });

    expect(error?.code).toBe("23514");
  });
});

describeIf("moving a request along", () => {
  async function move(
    user: SeededUser,
    id: string,
    status: RequestStatus,
    reason?: string,
  ): Promise<string> {
    const client = await clientFor(user);
    const current = await getRequest(ORG_A, id, client);
    return reasonOf(() =>
      transitionRequest({
        organizationId: ORG_A,
        actorId: UID[user],
        requestId: id,
        status,
        reason,
        expectedUpdatedAt: current?.updatedAt ?? "",
        client,
      }),
    );
  }

  /*
   * The ordinary path, once the work exists to justify it.
   *
   * This test used to walk straight from qualified to submitted on an empty
   * request. It cannot any more, and that is the point of the phase that
   * connected requests to the work answering them: coverage_planned needs a
   * linked shoot, preparing_response needs a linked package, and submitted
   * needs a submission somebody actually sent. Arranging the evidence here is
   * not test scaffolding around an inconvenience -- it is the lifecycle.
   *
   * The refusals themselves are asserted in tests/request-relationships.test.ts.
   */
  it("walks the ordinary path once the evidence exists", async () => {
    const { id } = await record("owner");
    const admin = serviceClient();
    const { data: owner } = await admin
      .from("memberships")
      .select("user_id")
      .eq("organization_id", ORG_A)
      .eq("role", "owner")
      .limit(1)
      .single();
    const linkedBy = owner!.user_id;

    expect(await move("owner", id, "qualified")).toBe("ok");

    await admin.from("request_shoots").insert({
      organization_id: ORG_A,
      request_id: id,
      shoot_id: ORG_A_SHOOT,
      linked_by: linkedBy,
    });
    expect(await move("owner", id, "coverage_planned")).toBe("ok");

    await admin.from("request_packages").insert({
      organization_id: ORG_A,
      request_id: id,
      package_id: ORG_A_PACKAGE_DELIVERED,
      linked_by: linkedBy,
    });
    expect(await move("owner", id, "preparing_response")).toBe("ok");

    // A submission that was actually sent. Creating a delivery link, or a
    // buyer opening one, would not be enough and must not be.
    const { data: submission } = await admin
      .from("submissions")
      .insert({
        organization_id: ORG_A,
        package_id: ORG_A_PACKAGE_DELIVERED,
        status: "sent",
        created_by: linkedBy,
        sent_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    await admin.from("request_submissions").insert({
      organization_id: ORG_A,
      request_id: id,
      submission_id: submission!.id,
      linked_by: linkedBy,
    });
    expect(await move("owner", id, "submitted")).toBe("ok");
  });

  it("stamps qualified_at once, and never again", async () => {
    const { id } = await record("owner");
    await move("owner", id, "qualified");
    const first = (await rowOf(id)).qualified_at as string;
    expect(first).toBeTruthy();

    await move("owner", id, "needs_clarification");
    await move("owner", id, "qualified");
    expect((await rowOf(id)).qualified_at).toBe(first);
  });

  it("refuses a move the transition table does not allow", async () => {
    const { id } = await record("owner");
    // new -> submitted skips qualification entirely.
    expect(await move("owner", id, "submitted")).toBe("invalid_transition");
  });

  it("refuses a win, because no license connection exists yet", async () => {
    const { id } = await record("owner");
    await move("owner", id, "qualified");
    await move("owner", id, "preparing_response");
    await move("owner", id, "submitted");
    expect(await move("owner", id, "won")).toBe("unavailable_in_phase");
  });

  it("will not record lost or declined without a reason", async () => {
    const lost = await record("owner");
    await move("owner", lost.id, "qualified");
    expect(await move("owner", lost.id, "lost")).toBe("reason_required");

    const declined = await record("owner");
    expect(await move("owner", declined.id, "declined", "   ")).toBe("reason_required");
  });

  it("records the reason on the request, not in the activity stream", async () => {
    const { id } = await record("owner");
    await move("owner", id, "qualified");
    expect(await move("owner", id, "lost", "Backgrid had it first")).toBe("ok");

    expect((await rowOf(id)).closed_reason).toBe("Backgrid had it first");

    // An event stream is read by every member of the workspace; a closing note
    // can name a desk or a person, so only the fact of one is logged.
    const closing = (await eventsFor(id)).find((event) => event.action === "request.lost");
    expect(closing?.event_data).toMatchObject({ reasonRecorded: true });
    expect(JSON.stringify(closing?.event_data)).not.toContain("Backgrid had it first");
  });

  it("keeps cancelled distinct from declined", async () => {
    const cancelled = await record("owner");
    expect(await move("owner", cancelled.id, "cancelled")).toBe("ok");
    expect((await rowOf(cancelled.id)).status).toBe("cancelled");

    const declined = await record("owner");
    expect(await move("owner", declined.id, "declined", "Not our story")).toBe("ok");
    expect((await rowOf(declined.id)).status).toBe("declined");
  });

  it("writes one event per move, with the previous status on it", async () => {
    const { id } = await record("owner");
    await move("owner", id, "qualified");

    const events = await eventsFor(id);
    const moved = events.find((event) => event.action === "request.qualified");
    expect(moved?.event_data).toMatchObject({ previousStatus: "new", status: "qualified" });
  });
});

describeIf("a closed request", () => {
  async function closedRequest(): Promise<string> {
    const { id } = await record("owner");
    const client = await clientFor("owner");
    const current = await getRequest(ORG_A, id, client);
    await transitionRequest({
      organizationId: ORG_A,
      actorId: UID.owner,
      requestId: id,
      status: "declined",
      reason: "Not something we cover",
      expectedUpdatedAt: current?.updatedAt ?? "",
      client,
    });
    return id;
  }

  it("stamps closed_at", async () => {
    const id = await closedRequest();
    expect((await rowOf(id)).closed_at).toBeTruthy();
  });

  it("cannot be moved back to an active state", async () => {
    const id = await closedRequest();
    const client = await clientFor("owner");
    const current = await getRequest(ORG_A, id, client);

    const reason = await reasonOf(() =>
      transitionRequest({
        organizationId: ORG_A,
        actorId: UID.owner,
        requestId: id,
        status: "new",
        expectedUpdatedAt: current?.updatedAt ?? "",
        client,
      }),
    );
    expect(reason).toBe("invalid_transition");
    expect((await rowOf(id)).status).toBe("declined");
  });

  it("cannot be rewritten as a different ending either", async () => {
    // Recording it as lost after it was declined would change what happened.
    const id = await closedRequest();
    const client = await clientFor("owner");
    const current = await getRequest(ORG_A, id, client);

    expect(
      await reasonOf(() =>
        transitionRequest({
          organizationId: ORG_A,
          actorId: UID.owner,
          requestId: id,
          status: "lost",
          reason: "Actually they went elsewhere",
          expectedUpdatedAt: current?.updatedAt ?? "",
          client,
        }),
      ),
    ).toBe("invalid_transition");
  });

  it("is refused by the database even when the application layer is bypassed", async () => {
    // The trigger, not the transition table. A client talking straight to
    // PostgREST gets the same answer.
    const id = await closedRequest();
    const { error } = await (
      await clientFor("owner")
    )
      .from("buyer_requests")
      .update({ status: "new" })
      .eq("id", id);

    expect(error).not.toBeNull();
    expect((await rowOf(id)).status).toBe("declined");
  });

  it("cannot have its facts edited", async () => {
    const id = await closedRequest();
    const client = await clientFor("owner");
    const current = await getRequest(ORG_A, id, client);

    expect(
      await reasonOf(() =>
        updateRequest({
          organizationId: ORG_A,
          actorId: UID.owner,
          requestId: id,
          intake: intake({ title: "Rewritten after the fact" }),
          expectedUpdatedAt: current?.updatedAt ?? "",
          client,
        }),
      ),
    ).toBe("invalid_transition");
  });

  it("cannot be reassigned", async () => {
    const id = await closedRequest();
    const client = await clientFor("owner");
    const current = await getRequest(ORG_A, id, client);

    expect(
      await reasonOf(() =>
        assignRequest({
          organizationId: ORG_A,
          actorId: UID.owner,
          requestId: id,
          assignedTo: UID.editor,
          expectedUpdatedAt: current?.updatedAt ?? "",
          client,
        }),
      ),
    ).toBe("invalid_transition");
  });
});

describeIf("identity is fixed at creation", () => {
  it("refuses to change the reference, the key, the author or the workspace", async () => {
    const { id } = await record("owner");
    const client = await clientFor("owner");

    for (const patch of [
      { reference: "REQ-0000-0000" },
      { idempotency_key: "something-else-entirely" },
      { created_by: UID.editor },
      { organization_id: ORG_B },
    ]) {
      const { error } = await client.from("buyer_requests").update(patch).eq("id", id);
      expect(error, JSON.stringify(patch)).not.toBeNull();
    }
  });
});

describeIf("two people editing one request", () => {
  it("refuses the second save rather than losing the first", async () => {
    const { id } = await record("owner");
    const ownerClient = await clientFor("owner");
    const editorClient = await clientFor("editor");

    // Both read the same version.
    const asOwner = await getRequest(ORG_A, id, ownerClient);
    const asEditor = await getRequest(ORG_A, id, editorClient);
    expect(asOwner?.updatedAt).toBe(asEditor?.updatedAt);

    await transitionRequest({
      organizationId: ORG_A,
      actorId: UID.owner,
      requestId: id,
      status: "qualified",
      expectedUpdatedAt: asOwner?.updatedAt ?? "",
      client: ownerClient,
    });

    const reason = await reasonOf(() =>
      updateRequest({
        organizationId: ORG_A,
        actorId: UID.editor,
        requestId: id,
        intake: intake({ title: "Written over the top" }),
        expectedUpdatedAt: asEditor?.updatedAt ?? "",
        client: editorClient,
      }),
    );

    expect(reason).toBe("conflict");
    expect((await rowOf(id)).title).not.toBe("Written over the top");
  });

  it("tells a stale writer apart from a forbidden one", async () => {
    const { id } = await record("owner");
    const viewerClient = await clientFor("viewer");
    const current = await getRequest(ORG_A, id, viewerClient);

    // A viewer reads the current version, so nothing raced: the zero-row write
    // is a permission refusal and must be reported as one.
    const reason = await reasonOf(() =>
      transitionRequest({
        organizationId: ORG_A,
        actorId: UID.viewer,
        requestId: id,
        status: "qualified",
        expectedUpdatedAt: current?.updatedAt ?? "",
        client: viewerClient,
      }),
    );
    expect(reason).toBe("denied");
  });
});

describeIf("assignment", () => {
  it("records who owns answering it, and when", async () => {
    const { id } = await record("owner");
    const client = await clientFor("owner");
    const current = await getRequest(ORG_A, id, client);

    const saved = await assignRequest({
      organizationId: ORG_A,
      actorId: UID.owner,
      requestId: id,
      assignedTo: UID.editor,
      expectedUpdatedAt: current?.updatedAt ?? "",
      client,
    });

    expect(saved.assignedTo).toBe(UID.editor);
    expect(saved.assignedAt).toBeTruthy();
    expect(saved.assignedBy).toBe(UID.owner);
  });

  it("clears the timestamp when the request is released", async () => {
    const { id } = await record("owner");
    const client = await clientFor("owner");

    const first = await getRequest(ORG_A, id, client);
    await assignRequest({
      organizationId: ORG_A,
      actorId: UID.owner,
      requestId: id,
      assignedTo: UID.editor,
      expectedUpdatedAt: first?.updatedAt ?? "",
      client,
    });

    const second = await getRequest(ORG_A, id, client);
    const released = await assignRequest({
      organizationId: ORG_A,
      actorId: UID.owner,
      requestId: id,
      assignedTo: null,
      expectedUpdatedAt: second?.updatedAt ?? "",
      client,
    });

    expect(released.assignedTo).toBeUndefined();
    // A time attached to nobody is worse than no time at all.
    expect(released.assignedAt).toBeUndefined();
    expect(released.assignedBy).toBeUndefined();
  });

  it("logs the assignment and the release as different events", async () => {
    const { id } = await record("owner");
    const client = await clientFor("owner");

    const first = await getRequest(ORG_A, id, client);
    await assignRequest({
      organizationId: ORG_A,
      actorId: UID.owner,
      requestId: id,
      assignedTo: UID.editor,
      expectedUpdatedAt: first?.updatedAt ?? "",
      client,
    });
    const second = await getRequest(ORG_A, id, client);
    await assignRequest({
      organizationId: ORG_A,
      actorId: UID.owner,
      requestId: id,
      assignedTo: null,
      expectedUpdatedAt: second?.updatedAt ?? "",
      client,
    });

    const actions = (await eventsFor(id)).map((event) => event.action);
    expect(actions).toContain("request.assigned");
    expect(actions).toContain("request.unassigned");
  });
});

describeIf("workspace boundaries", () => {
  it("refuses a buyer from another workspace", async () => {
    const client = await clientFor("owner");
    const reason = await reasonOf(() =>
      createRequest({
        organizationId: ORG_A,
        actorId: UID.owner,
        intake: intake({ buyerId: ORG_B_BUYER }),
        idempotencyKey: newKey("cross-buyer"),
        client,
      }),
    );

    // The composite foreign key, not a policy: (buyer_id, organization_id)
    // references buyers (id, organization_id), so this cannot be written even
    // if a policy were wrong.
    expect(reason).toBe("cross_workspace");
  });

  it("accepts a buyer from this workspace", async () => {
    const { id } = await record("owner", { buyerId: ORG_A_BUYER });
    const request = await getRequest(ORG_A, id, await clientFor("owner"));
    expect(request?.buyerId).toBe(ORG_A_BUYER);
    expect(request?.buyerName).toBeTruthy();
  });

  it("refuses to assign somebody from another workspace", async () => {
    const { id } = await record("owner");
    const client = await clientFor("owner");
    const current = await getRequest(ORG_A, id, client);

    const reason = await reasonOf(() =>
      assignRequest({
        organizationId: ORG_A,
        actorId: UID.owner,
        requestId: id,
        assignedTo: UID.otherOrgOwner,
        expectedUpdatedAt: current?.updatedAt ?? "",
        client,
      }),
    );

    expect(reason).toBe("not_a_member");
    expect((await rowOf(id)).assigned_to).toBeNull();
  });

  it("does not show another workspace's requests", async () => {
    const { id } = await record("owner");
    const outsider = await clientFor("otherOrgOwner");

    // A non-member reading with the right organization id still sees nothing:
    // row level security, not the explicit filter, is the boundary.
    expect(await getRequest(ORG_A, id, outsider)).toBeNull();
    expect(await listRequests(ORG_A, {}, outsider)).toEqual([]);
  });

  it("does not let an outsider move one", async () => {
    const { id } = await record("owner");
    const outsider = await clientFor("otherOrgOwner");
    const version = (await rowOf(id)).updated_at as string;

    const reason = await reasonOf(() =>
      transitionRequest({
        organizationId: ORG_A,
        actorId: UID.otherOrgOwner,
        requestId: id,
        status: "qualified",
        expectedUpdatedAt: version,
        client: outsider,
      }),
    );

    // Not found rather than denied: whether a particular studio holds a
    // particular record is not something to confirm to somebody outside it.
    expect(reason).toBe("not_found");
    expect((await rowOf(id)).status).toBe("new");
  });
});

describeIf("confidential notes", () => {
  it("are readable by an owner and invisible to a dispatcher", async () => {
    const { id } = await record("owner", {
      sourceNote: "Tip came from the doorman.",
      confidentialLocation: "Service entrance, 23rd St",
    });

    const asOwner = await getRequestSensitiveNote(ORG_A, id, await clientFor("owner"));
    expect(asOwner?.sourceNote).toContain("doorman");

    // Not a hidden field on a row a dispatcher can read: a different table with
    // a narrower policy, so the bytes never reach them.
    expect(await getRequestSensitiveNote(ORG_A, id, await clientFor("dispatcher"))).toBeNull();
    expect(await getRequestSensitiveNote(ORG_A, id, await clientFor("finance"))).toBeNull();
    expect(await getRequestSensitiveNote(ORG_A, id, await clientFor("viewer"))).toBeNull();
  });

  it("do not leak into the request row or the activity stream", async () => {
    const { id } = await record("owner", { sourceNote: "Tip came from the doorman." });

    expect(JSON.stringify(await rowOf(id))).not.toContain("doorman");
    expect(JSON.stringify(await eventsFor(id))).not.toContain("doorman");
  });

  it("tell a dispatcher a note exists without telling them what it says", async () => {
    // Only for roles that could read it. For everybody else the flag is false,
    // and absence of the flag is not evidence of absence of a note.
    const { id } = await record("owner", { sourceNote: "Tip came from the doorman." });

    expect((await getRequest(ORG_A, id, await clientFor("owner")))?.hasSensitiveNote).toBe(true);
    expect((await getRequest(ORG_A, id, await clientFor("dispatcher")))?.hasSensitiveNote).toBe(
      false,
    );
  });

  it("are not written at all when nothing confidential was entered", async () => {
    const { id } = await record("owner");
    const { data } = await serviceClient()
      .from("request_sensitive_notes")
      .select("request_id")
      .eq("request_id", id);
    expect(data ?? []).toEqual([]);
  });
});

describeIf("who may record a request", () => {
  const ALLOWED: SeededUser[] = ["owner", "editor", "dispatcher"];
  const REFUSED: SeededUser[] = ["finance", "rights", "viewer"];

  for (const user of ALLOWED) {
    it(`lets a ${user} record one`, async () => {
      const { id } = await record(user);
      expect(id).toBeTruthy();
    });
  }

  for (const user of REFUSED) {
    it(`refuses a ${user}`, async () => {
      const client = await clientFor(user);
      const reason = await reasonOf(() =>
        createRequest({
          organizationId: ORG_A,
          actorId: UID[user],
          intake: intake(),
          idempotencyKey: newKey(`denied-${user}`),
          client,
        }),
      );
      expect(reason).toBe("denied");
    });
  }

  it("lets every role read the inbox", async () => {
    await record("owner");
    for (const user of [...ALLOWED, ...REFUSED]) {
      const requests = await listRequests(ORG_A, {}, await clientFor(user));
      expect(requests.length, user).toBeGreaterThan(0);
    }
  });
});

describeIf("the inbox", () => {
  it("filters by status, buyer and assignee", async () => {
    const plain = await record("owner");
    const withBuyer = await record("owner", { buyerId: ORG_A_BUYER });
    const client = await clientFor("owner");

    const byBuyer = await listRequests(ORG_A, { buyerId: ORG_A_BUYER }, client);
    expect(byBuyer.map((request) => request.id)).toContain(withBuyer.id);
    expect(byBuyer.map((request) => request.id)).not.toContain(plain.id);

    const current = await getRequest(ORG_A, plain.id, client);
    await assignRequest({
      organizationId: ORG_A,
      actorId: UID.owner,
      requestId: plain.id,
      assignedTo: UID.dispatcher,
      expectedUpdatedAt: current?.updatedAt ?? "",
      client,
    });

    const mine = await listRequests(ORG_A, { assignedTo: UID.dispatcher }, client);
    expect(mine.map((request) => request.id)).toContain(plain.id);
    expect(mine.map((request) => request.id)).not.toContain(withBuyer.id);

    const drafts = await listRequests(ORG_A, { status: ["draft"] }, client);
    expect(drafts.every((request) => request.status === "draft")).toBe(true);
  });

  it("finds what is past its deadline without writing anything down", async () => {
    const late = await record("owner", { responseDeadline: "2020-01-01T00:00:00Z" });
    const client = await clientFor("owner");

    const overdue = await listRequests(ORG_A, { deadline: "past_deadline" }, client);
    expect(overdue.map((request) => request.id)).toContain(late.id);

    // Nothing moved it to expired. There is no scheduler, so a passing deadline
    // is a derived fact and the status stays exactly where the operator left it.
    expect((await rowOf(late.id)).status).toBe("new");
  });

  it("puts what is late first, then what is nearly late, then the rest", () => {
    const now = new Date("2026-08-28T12:00:00Z");
    const base = {
      organizationId: ORG_A,
      createdBy: UID.owner,
      source: "manual",
      requestType: "archive",
      subjectNames: [],
      topics: [],
      requestedFormats: [],
      budgetDisclosed: false,
      currency: "USD",
      hasSensitiveNote: false,
    } as const;

    const rows = [
      {
        ...base,
        id: "d",
        reference: "D",
        title: "closed",
        status: "lost",
        responseDeadline: "2026-08-01T00:00:00Z",
        createdAt: "2026-08-28T11:00:00Z",
        updatedAt: "x",
      },
      {
        ...base,
        id: "c",
        reference: "C",
        title: "no deadline",
        status: "new",
        createdAt: "2026-08-28T10:00:00Z",
        updatedAt: "x",
      },
      {
        ...base,
        id: "b",
        reference: "B",
        title: "due later",
        status: "new",
        responseDeadline: "2026-08-29T00:00:00Z",
        createdAt: "2026-08-28T09:00:00Z",
        updatedAt: "x",
      },
      {
        ...base,
        id: "a",
        reference: "A",
        title: "late",
        status: "new",
        responseDeadline: "2026-08-27T00:00:00Z",
        createdAt: "2026-08-28T08:00:00Z",
        updatedAt: "x",
      },
    ] as unknown as BuyerRequest[];

    expect(sortForInbox(rows, now).map((request) => request.id)).toEqual(["a", "b", "c", "d"]);
  });
});

/**
 * Statuses that a request cannot be born into, because each one asserts
 * something about work that does not exist yet at creation. The refusals are
 * asserted properly in tests/request-relationships.test.ts; here they only need
 * to be expected.
 */
const EVIDENCE_GATED: readonly RequestStatus[] = [
  "matching",
  "coverage_planned",
  "preparing_response",
  "submitted",
  "won",
];

describeIf("the status enum", () => {
  it("holds exactly what src/lib/domain.ts says it does", async () => {
    // A value in TypeScript that Postgres does not have is a runtime failure
    // nobody meets until somebody clicks the control. Each one is written and
    // removed, which is the only way to ask the enum from over the Data API.
    const service = serviceClient();

    for (const status of REQUEST_STATUSES) {
      counter += 1;
      const { data, error } = await service
        .from("buyer_requests")
        .insert({
          organization_id: ORG_A,
          created_by: UID.owner,
          idempotency_key: newKey(`enum-${status}`),
          reference: `REQ-0000-${String(1000 + (counter % 9000))}`,
          title: `enum probe ${status}`,
          status,
          // lost and declined need one whatever wrote them.
          closed_reason: status === "lost" || status === "declined" ? "enum probe" : null,
        })
        .select("id, status, closed_at")
        .single();

      /*
       * Five statuses cannot be written onto a brand new row any more, because
       * a request that has just been created has no linked shoot, package or
       * submission to justify them. A refusal here is still proof the enum
       * holds the value: Postgres casts the text to buyer_request_status before
       * any trigger runs, so a value the type did not have would come back as
       * 22P02 invalid input, not as 23001 restrict_violation.
       */
      if (EVIDENCE_GATED.includes(status)) {
        expect(error?.code, `${status}: expected the evidence gate`).toBe("23001");
        counter -= 0; // the row was never created; nothing to clean up
        continue;
      }

      expect(error, `${status}: ${error?.message}`).toBeNull();
      expect(data?.status).toBe(status);
      // Closed on arrival still gets its timestamp stamped by the trigger.
      if (isClosed(status)) expect(data?.closed_at).toBeTruthy();

      if (data?.id) await service.from("buyer_requests").delete().eq("id", data.id);
    }
  });

  it("refuses a status the vocabulary does not contain", async () => {
    const { error } = await serviceClient()
      .from("buyer_requests")
      .insert({
        organization_id: ORG_A,
        created_by: UID.owner,
        idempotency_key: newKey("bad-status"),
        reference: "REQ-0000-0001",
        title: "not a status",
        status: "canceled",
      });

    // Note the single L: the American spelling is not in this vocabulary, and
    // the database is where that is settled rather than in a code review.
    expect(error).not.toBeNull();
  });
});

describeIf("editing", () => {
  it("saves the facts and logs one event", async () => {
    const { id } = await record("owner");
    const client = await clientFor("owner");
    const current = await getRequest(ORG_A, id, client);

    const saved = await updateRequest({
      organizationId: ORG_A,
      actorId: UID.owner,
      requestId: id,
      intake: intake({ title: "Corrected title", territory: "UK only" }),
      expectedUpdatedAt: current?.updatedAt ?? "",
      client,
    });

    expect(saved.title).toBe("Corrected title");
    expect(saved.territory).toBe("UK only");
    // The status is not the edit form's business.
    expect(saved.status).toBe("new");
    expect((await eventsFor(id)).map((event) => event.action)).toContain("request.updated");
  });

  it("clears a confidential note when its fields are emptied", async () => {
    const { id } = await record("owner", { sourceNote: "Tip came from the doorman." });
    const client = await clientFor("owner");
    const current = await getRequest(ORG_A, id, client);

    await updateRequest({
      organizationId: ORG_A,
      actorId: UID.owner,
      requestId: id,
      intake: intake(),
      expectedUpdatedAt: current?.updatedAt ?? "",
      client,
    });

    expect(await getRequestSensitiveNote(ORG_A, id, client)).toBeNull();
  });
});

describeIf("nothing here deletes a request", () => {
  it("gives an authenticated member no delete grant", async () => {
    const { id } = await record("owner");
    const client: SupabaseClient = await clientFor("owner");

    await client.from("buyer_requests").delete().eq("id", id);

    // A request that came to nothing is recorded as declined or cancelled with
    // a reason. Making it disappear is how a workspace forgets that a desk
    // asked three times and got no answer.
    expect(await rowOf(id)).toBeTruthy();
  });
});

describeIf("the work queue", () => {
  const routes = workspaceRoutes("hale-studio");

  it("puts a new request on the one list a photographer already reads", async () => {
    const { id } = await record("owner");
    const queue = await getWorkQueue(ORG_A, routes, await clientFor("owner"));
    const item = queue.find((entry) => entry.id === `wq_request_${id}`);

    expect(item).toBeTruthy();
    expect(item?.kind).toBe("Request");
    // Every destination carries its own workspace, so a queue row rendered in
    // one tab cannot send the next click into another studio.
    expect(item?.href).toBe(`/hale-studio/requests/${id}`);
    expect(item?.rankingBasis).toMatch(/qualified/i);
  });

  it("marks a request past its deadline as urgent, and says why", async () => {
    const { id } = await record("owner", { responseDeadline: "2020-01-01T00:00:00Z" });
    const queue = await getWorkQueue(ORG_A, routes, await clientFor("owner"));
    const item = queue.find((entry) => entry.id === `wq_request_${id}`);

    expect(item?.urgent).toBe(true);
    expect(item?.detail).toMatch(/past deadline/i);
    expect(item?.rankingBasis).toMatch(/deadline has passed/i);
  });

  it("surfaces one waiting on the buyer to answer", async () => {
    const { id } = await record("owner");
    const client = await clientFor("owner");
    const current = await getRequest(ORG_A, id, client);
    await transitionRequest({
      organizationId: ORG_A,
      actorId: UID.owner,
      requestId: id,
      status: "needs_clarification",
      expectedUpdatedAt: current?.updatedAt ?? "",
      client,
    });

    const queue = await getWorkQueue(ORG_A, routes, client);
    const item = queue.find((entry) => entry.id === `wq_request_${id}`);
    expect(item?.rankingBasis).toMatch(/waiting on an answer/i);
  });

  it("leaves a closed request off it entirely", async () => {
    const { id } = await record("owner");
    const client = await clientFor("owner");
    const current = await getRequest(ORG_A, id, client);
    await transitionRequest({
      organizationId: ORG_A,
      actorId: UID.owner,
      requestId: id,
      status: "declined",
      reason: "Not our story",
      expectedUpdatedAt: current?.updatedAt ?? "",
      client,
    });

    const queue = await getWorkQueue(ORG_A, routes, client);
    expect(queue.find((entry) => entry.id === `wq_request_${id}`)).toBeUndefined();
  });

  it("leaves a private draft off it, because nobody has posted it yet", async () => {
    const { id } = await record("owner", {}, { status: "draft" });
    const queue = await getWorkQueue(ORG_A, routes, await clientFor("owner"));
    expect(queue.find((entry) => entry.id === `wq_request_${id}`)).toBeUndefined();
  });

  it("does not create a second queue anywhere", async () => {
    // One list. A request sits in it beside a package waiting on approval and a
    // payment that has gone overdue, ranked by the same rules.
    const { id } = await record("owner");
    const queue = await getWorkQueue(ORG_A, routes, await clientFor("owner"));

    expect(queue.some((entry) => entry.id === `wq_request_${id}`)).toBe(true);
    expect(new Set(queue.map((entry) => entry.kind)).size).toBeGreaterThan(1);
  });
});
