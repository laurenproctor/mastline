/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDelivery } from "../src/lib/data/delivery-links";
import {
  ORG_A,
  ORG_A_ASSET,
  ORG_A_SUBMISSION,
  type SeededUser,
  anonClient,
  clientFor,
  hasLocalSupabase,
  serviceClient,
} from "./helpers/supabase";

/**
 * Delivery evidence is written by functions and read by the workspace.
 *
 * `delivery_access_events` is the record the security page promises: every
 * open, acceptance, download, and refusal, with the time and the address.
 * The only things that may write it are the security definer functions on
 * the recipient surface and the download route running as the service role.
 * A signed-in member reads their workspace's rows and writes none; an
 * anonymous caller does neither.
 *
 * Two controls, tested separately: the grant, which refuses a client before
 * any policy is consulted, and row level security, which decides which rows
 * a member may read. The grant is the one that matters here, because a
 * policy is one accidental migration away from being permissive.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const DISPATCHER = "33333333-3333-3333-3333-333333333333";
const MEMBERS: readonly SeededUser[] = ["viewer", "editor", "dispatcher", "owner"];

async function eventsFor(deliveryId: string) {
  const { data, error } = await serviceClient()
    .from("delivery_access_events")
    .select("id, kind, detail, asset_id")
    .eq("delivery_id", deliveryId)
    .order("occurred_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function linkFor(label: string) {
  const dispatcher = await clientFor("dispatcher");
  return createDelivery({
    client: dispatcher,
    organizationId: ORG_A,
    actorId: DISPATCHER,
    submissionId: ORG_A_SUBMISSION,
    recipientLabel: label,
    windowDays: 7,
  });
}

beforeAll(async () => {
  if (!hasLocalSupabase()) return;
  await Promise.all(MEMBERS.map((user) => clientFor(user)));
}, 60_000);

afterAll(async () => {
  if (!hasLocalSupabase()) return;
  const { error } = await serviceClient().rpc("purge_delivery_links");
  if (error) throw new Error(`Could not clear delivery links: ${error.message}`);
});

describeIf("delivery evidence privileges", () => {
  it("shows only the intended grants: select for members and the service role, nothing for anon", async () => {
    const service = serviceClient();
    for (const table of ["delivery_access_events", "delivery_acceptances"]) {
      const { data, error } = await service.rpc("table_grants_admin", { target_table: table });
      expect(error, table).toBeNull();
      const grants = (data ?? []).map(
        (row: { grantee: string; privilege_type: string }) =>
          `${row.grantee}:${row.privilege_type}`,
      );
      expect(grants.sort(), table).toEqual(["authenticated:SELECT", "service_role:SELECT"]);
    }

    // The inspection itself is closed to everyone but the service role.
    const owner = await clientFor("owner");
    expect(
      (await owner.rpc("table_grants_admin", { target_table: "delivery_access_events" })).error,
    ).toBeTruthy();
    expect(
      (await anonClient().rpc("table_grants_admin", { target_table: "delivery_access_events" }))
        .error,
    ).toBeTruthy();
  });

  it("refuses anon any direct insert, update, or delete of an event", async () => {
    const link = await linkFor("Anon desk");
    const anon = anonClient();
    const before = (await eventsFor(link.id)).length;

    const insert = await anon.from("delivery_access_events").insert({
      organization_id: ORG_A,
      delivery_id: link.id,
      kind: "downloaded",
      asset_id: ORG_A_ASSET,
    });
    expect(insert.error?.code).toBe("42501");

    const update = await anon
      .from("delivery_access_events")
      .update({ detail: "rewritten" })
      .eq("delivery_id", link.id);
    expect(update.error?.code).toBe("42501");

    const remove = await anon.from("delivery_access_events").delete().eq("delivery_id", link.id);
    expect(remove.error?.code).toBe("42501");

    // Nor can anon see what is there.
    const read = await anon.from("delivery_access_events").select("id").eq("delivery_id", link.id);
    expect(read.error?.code).toBe("42501");

    expect((await eventsFor(link.id)).length).toBe(before);
  });

  it("refuses every member role a direct insert, update, or delete, and says so at the grant layer", async () => {
    const link = await linkFor("Members desk");
    // An open, so there is a row a member could try to rewrite.
    await anonClient().rpc("open_delivery", { delivery_token: link.token });
    const before = await eventsFor(link.id);
    expect(before.map((event) => event.kind)).toEqual(["opened"]);

    for (const user of MEMBERS) {
      const client = await clientFor(user);

      const insert = await client.from("delivery_access_events").insert({
        organization_id: ORG_A,
        delivery_id: link.id,
        kind: "downloaded",
        asset_id: ORG_A_ASSET,
      });
      expect(insert.error?.code, `${user} insert`).toBe("42501");
      /*
       * "permission denied for table", not "violates row-level security
       * policy": the refusal comes from the grant, before any policy is read.
       * That is the proof that a permissive policy added later could not, on
       * its own, let a member write evidence.
       */
      expect(insert.error?.message, `${user} insert`).toMatch(/permission denied for table/i);
      expect(insert.error?.message, `${user} insert`).not.toMatch(/row-level security/i);

      const update = await client
        .from("delivery_access_events")
        .update({ detail: "rewritten" })
        .eq("delivery_id", link.id);
      expect(update.error?.code, `${user} update`).toBe("42501");
      expect(update.error?.message, `${user} update`).toMatch(/permission denied for table/i);

      const remove = await client
        .from("delivery_access_events")
        .delete()
        .eq("delivery_id", link.id);
      expect(remove.error?.code, `${user} delete`).toBe("42501");
      expect(remove.error?.message, `${user} delete`).toMatch(/permission denied for table/i);

      // ...while the read that the submission screen depends on still works.
      const read = await client
        .from("delivery_access_events")
        .select("kind")
        .eq("delivery_id", link.id);
      expect(read.error, `${user} read`).toBeNull();
      expect(
        read.data?.map((row) => row.kind),
        `${user} read`,
      ).toEqual(["opened"]);
    }

    expect(await eventsFor(link.id)).toEqual(before);
  });

  it("still records the recipient's own acts through the functions meant to write them", async () => {
    const link = await linkFor("Functions desk");
    const anon = anonClient();

    const opened = await anon.rpc("open_delivery", { delivery_token: link.token });
    expect(opened.error).toBeNull();
    const agreed = await anon.rpc("accept_delivery", {
      delivery_token: link.token,
      accepted_by_name: "Dana Whitfield",
    });
    expect(agreed.error).toBeNull();
    expect(agreed.data).toHaveLength(1);

    expect((await eventsFor(link.id)).map((event) => event.kind)).toEqual(["opened", "accepted"]);

    const { data: acceptance } = await serviceClient()
      .from("delivery_acceptances")
      .select("accepted_by")
      .eq("delivery_id", link.id)
      .single();
    expect(acceptance?.accepted_by).toBe("Dana Whitfield");
  });

  it("records exactly one downloaded event for a valid exact-version download, and none before acceptance", async () => {
    const link = await linkFor("Download desk");
    const anon = anonClient();
    const trusted = serviceClient();
    await anon.rpc("open_delivery", { delivery_token: link.token });

    // The route's order: authorise, sign, record. Before the yes, the gate
    // refuses and records the refusal; nothing is downloaded.
    const early = await trusted.rpc("authorize_delivery_download", {
      delivery_token: link.token,
      target_asset: ORG_A_ASSET,
    });
    expect(early.error).toBeNull();
    expect(early.data ?? []).toHaveLength(0);

    await anon.rpc("accept_delivery", {
      delivery_token: link.token,
      accepted_by_name: "Dana Whitfield",
    });

    const authorised = await trusted.rpc("authorize_delivery_download", {
      delivery_token: link.token,
      target_asset: ORG_A_ASSET,
    });
    expect(authorised.error).toBeNull();
    expect(authorised.data).toHaveLength(1);
    // The seeded submission's frozen object: the delivery JPEG its manifest
    // named, not the RAW original.
    expect(authorised.data![0].object_key).toMatch(/MH_0819_0472_delivery\.jpg$/);
    expect(authorised.data![0].storage_bucket).toBe("derivatives");

    const recorded = await trusted.rpc("record_delivery_download", {
      delivery_token: link.token,
      target_asset: ORG_A_ASSET,
    });
    expect(recorded.error).toBeNull();
    expect(recorded.data).toHaveLength(1);

    const events = await eventsFor(link.id);
    expect(events.map((event) => event.kind)).toEqual([
      "opened",
      "refused",
      "accepted",
      "downloaded",
    ]);
    expect(events.filter((event) => event.kind === "downloaded")).toHaveLength(1);
    expect(events.find((event) => event.kind === "downloaded")?.asset_id).toBe(ORG_A_ASSET);
    expect(events.find((event) => event.kind === "refused")?.detail).toBe(
      "download before accepting the terms",
    );
  });
});
