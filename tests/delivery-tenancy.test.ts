/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDelivery, markDeliveryShared } from "../src/lib/data/delivery-links";
import {
  ORG_A,
  ORG_B,
  anonClient,
  clientFor,
  hasLocalSupabase,
  serviceClient,
} from "./helpers/supabase";

/**
 * Delivery links, across an organization boundary.
 *
 * These tables each carried an organization_id AND a parent id, with nothing
 * making the two agree. A row could name organization A and point at
 * organization B's submission, and Postgres would take it: the foreign keys
 * were on the parent id alone, and row level security then read the
 * organization_id it had been handed. The forged row was visible to A and
 * attached to B's work.
 *
 * Server-action validation was the only thing in the way, which is the kind of
 * check that is correct right up until somebody adds a second caller. So the
 * subject of most of these tests is the SERVICE ROLE -- deliberately, because
 * it bypasses row level security entirely. If a forged pairing is refused for
 * the service role, it is refused for everyone, and what refused it was the
 * database rather than a policy that a future code path might not go through.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const DISPATCHER_A = "33333333-3333-3333-3333-333333333333";
const OWNER_B = "99999999-9999-9999-9999-999999999999";
const NORTHLINE_BUYER = "b0000000-0000-0000-0000-0000000000b1";
const ORG_A_SUBMISSION = "a0000000-0000-0000-0000-00000000a001";
const ORG_B_SHOOT = "b0000000-0000-0000-0000-0000000000c1";

let orgBPackage: string;
let orgBSubmission: string;
let orgADelivery: string;

beforeAll(async () => {
  if (!hasLocalSupabase()) return;
  const service = serviceClient();

  const { data: pkg } = await service
    .from("packages")
    .insert({
      organization_id: ORG_B,
      shoot_id: ORG_B_SHOOT,
      buyer_id: NORTHLINE_BUYER,
      name: "Northline package",
      status: "ready",
      delivery_method: "SFTP",
      proposed_terms: "Northline terms.",
      created_by: OWNER_B,
    })
    .select("id")
    .single();
  orgBPackage = pkg!.id as string;

  await service
    .from("packages")
    .update({ status: "approved", approved_by: OWNER_B, approved_at: new Date().toISOString() })
    .eq("id", orgBPackage);

  const { data: submission } = await service
    .from("submissions")
    .insert({
      organization_id: ORG_B,
      package_id: orgBPackage,
      buyer_id: NORTHLINE_BUYER,
      status: "queued",
      delivery_method: "SFTP",
      external_reference: `NL-TEN-${Date.now()}`,
      created_by: OWNER_B,
    })
    .select("id")
    .single();
  orgBSubmission = submission!.id as string;

  // A legitimate link in organization A, to forge against.
  const { data: link } = await service
    .from("submission_deliveries")
    .insert({
      organization_id: ORG_A,
      submission_id: ORG_A_SUBMISSION,
      token: `tenancy${"a".repeat(40)}`,
      recipient_label: "New York picture desk",
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      created_by: OWNER_A,
    })
    .select("id")
    .single();
  orgADelivery = link!.id as string;
});

afterAll(async () => {
  if (!hasLocalSupabase()) return;
  const service = serviceClient();
  await service.rpc("purge_delivery_links");
  await service.rpc("purge_submission_admin", { target_submission: orgBSubmission });
  await service.rpc("purge_package_admin", { target_package: orgBPackage });
});

describeIf("a member of one workspace and a submission in another", () => {
  it("cannot create a delivery link for it", async () => {
    const dispatcher = await clientFor("dispatcher");

    await expect(
      createDelivery({
        client: dispatcher,
        organizationId: ORG_A,
        actorId: DISPATCHER_A,
        submissionId: orgBSubmission,
        recipientLabel: "Stolen",
        windowDays: 7,
      }),
    ).rejects.toThrow(/could not be found/i);

    const { data } = await serviceClient()
      .from("submission_deliveries")
      .select("id")
      .eq("submission_id", orgBSubmission);
    expect(data ?? []).toHaveLength(0);
  });

  it("cannot reach it by naming its own organization either", async () => {
    const dispatcher = await clientFor("dispatcher");

    // Claiming organization B while signed in as an A dispatcher.
    await expect(
      createDelivery({
        client: dispatcher,
        organizationId: ORG_B,
        actorId: DISPATCHER_A,
        submissionId: orgBSubmission,
        windowDays: 7,
      }),
    ).rejects.toThrow();
  });

  it("cannot mark another workspace's link as shared", async () => {
    const service = serviceClient();
    const { data: link } = await service
      .from("submission_deliveries")
      .insert({
        organization_id: ORG_B,
        submission_id: orgBSubmission,
        token: `northline${"b".repeat(40)}`,
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        created_by: OWNER_B,
      })
      .select("id")
      .single();

    const dispatcher = await clientFor("dispatcher");
    await expect(
      markDeliveryShared({
        client: dispatcher,
        organizationId: ORG_A,
        actorId: DISPATCHER_A,
        submissionId: ORG_A_SUBMISSION,
        deliveryId: link!.id as string,
      }),
    ).rejects.toThrow(/could not be found/i);

    const { data: after } = await service
      .from("submission_deliveries")
      .select("shared_at")
      .eq("id", link!.id)
      .single();
    expect(after!.shared_at).toBeNull();
  });

  it("cannot move another submission by forging a delivery id it does not own", async () => {
    const dispatcher = await clientFor("dispatcher");

    // A real delivery in A, but named against B's submission.
    await expect(
      markDeliveryShared({
        client: dispatcher,
        organizationId: ORG_A,
        actorId: DISPATCHER_A,
        submissionId: orgBSubmission,
        deliveryId: orgADelivery,
      }),
    ).rejects.toThrow(/could not be found/i);

    const { data } = await serviceClient()
      .from("submissions")
      .select("status, sent_at")
      .eq("id", orgBSubmission)
      .single();
    expect(data!.status).toBe("queued");
    expect(data!.sent_at).toBeNull();
  });
});

/**
 * The service role is the subject here on purpose: it bypasses row level
 * security, so anything that refuses it is the database itself.
 */
describeIf("Postgres refuses a forged organization pairing", () => {
  it("will not attach a delivery to a submission in another organization", async () => {
    const { error } = await serviceClient()
      .from("submission_deliveries")
      .insert({
        organization_id: ORG_A,
        submission_id: orgBSubmission,
        token: `forged${"c".repeat(40)}`,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        created_by: OWNER_A,
      });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/foreign key|violates/i);
  });

  it("will not attach an access event to a delivery in another organization", async () => {
    const { error } = await serviceClient().from("delivery_access_events").insert({
      organization_id: ORG_B,
      delivery_id: orgADelivery,
      kind: "opened",
    });
    expect(error).toBeTruthy();
  });

  it("will not attach an acceptance to a delivery in another organization", async () => {
    const { error } = await serviceClient().from("delivery_acceptances").insert({
      organization_id: ORG_B,
      delivery_id: orgADelivery,
      submission_id: orgBSubmission,
      accepted_by: "Somebody Else",
    });
    expect(error).toBeTruthy();
  });

  it("will not attach a viewing session to a delivery in another organization", async () => {
    const { error } = await serviceClient()
      .from("delivery_view_sessions")
      .insert({
        organization_id: ORG_B,
        delivery_id: orgADelivery,
        visitor_key: "f".repeat(64),
        session_key: "e".repeat(64),
      });
    expect(error).toBeTruthy();
  });

  it("will not attach a frame view to an asset in another organization", async () => {
    const service = serviceClient();
    const { data: session } = await service
      .from("delivery_view_sessions")
      .insert({
        organization_id: ORG_A,
        delivery_id: orgADelivery,
        visitor_key: "a".repeat(64),
        session_key: "b".repeat(64),
      })
      .select("id")
      .single();

    const { error } = await service.from("delivery_asset_views").insert({
      organization_id: ORG_A,
      delivery_id: orgADelivery,
      session_id: session!.id,
      // Northline's frame, in Mastline's session.
      asset_id: "b0000000-0000-0000-0000-0000000000d1",
    });
    expect(error).toBeTruthy();

    await service.from("delivery_view_sessions").delete().eq("id", session!.id);
  });

  it("will not attach a submission to a package in another organization", async () => {
    const { error } = await serviceClient()
      .from("submissions")
      .insert({
        organization_id: ORG_A,
        package_id: orgBPackage,
        status: "queued",
        external_reference: `FORGED-${Date.now()}`,
        created_by: OWNER_A,
      });
    expect(error).toBeTruthy();
  });
});

describeIf("what an anonymous link holder can reach", () => {
  it.each([
    "submission_deliveries",
    "delivery_access_events",
    "delivery_acceptances",
    "delivery_view_sessions",
    "delivery_asset_views",
    "delivery_engagement_totals",
    "delivery_asset_engagement_totals",
  ])("cannot read %s directly", async (table) => {
    const { data } = await anonClient().from(table).select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it.each(["submission_deliveries", "delivery_view_sessions", "delivery_engagement_totals"])(
    "cannot write to %s directly",
    async (table) => {
      const { error } = await anonClient().from(table).insert({ organization_id: ORG_A });
      expect(error).toBeTruthy();
    },
  );

  it("cannot call the operator-only share function", async () => {
    const { error } = await anonClient().rpc("mark_delivery_shared", {
      target_delivery: orgADelivery,
    });
    expect(error).toBeTruthy();
  });

  it("cannot call the retention or purge routines", async () => {
    const anon = anonClient();
    for (const fn of ["prune_delivery_analytics", "purge_delivery_analytics"]) {
      const { error } = await anon.rpc(
        fn,
        fn === "prune_delivery_analytics" ? { retain_days: 1 } : {},
      );
      expect(error, `${fn} should be closed to anon`).toBeTruthy();
    }
  });
});

describeIf("a viewer in the right workspace", () => {
  it("can read the delivery record but cannot share a link", async () => {
    const viewer = await clientFor("viewer");

    const { data } = await viewer
      .from("submission_deliveries")
      .select("id")
      .eq("organization_id", ORG_A);
    expect((data ?? []).length).toBeGreaterThan(0);

    const { error } = await viewer.rpc("mark_delivery_shared", { target_delivery: orgADelivery });
    expect(error).toBeTruthy();
  });

  it("cannot create a link", async () => {
    const viewer = await clientFor("viewer");
    await expect(
      createDelivery({
        client: viewer,
        organizationId: ORG_A,
        actorId: "66666666-6666-6666-6666-666666666666",
        submissionId: ORG_A_SUBMISSION,
        windowDays: 7,
      }),
    ).rejects.toThrow();
  });
});

describeIf("attribution is never an authorization input", () => {
  it("opens on the token alone, whatever the stored parameters say", async () => {
    const service = serviceClient();
    const token = `paramsafe${"d".repeat(40)}`;

    await service.from("submission_deliveries").insert({
      organization_id: ORG_A,
      submission_id: ORG_A_SUBMISSION,
      token,
      recipient_label: "New York picture desk",
      custom_parameters: { campaign: "awards-season" },
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      created_by: OWNER_A,
    });

    const anon = anonClient();
    // The real token opens.
    const opened = await anon.rpc("open_delivery", { delivery_token: token });
    expect((opened.data ?? []).length).toBe(1);

    // A wrong token does not, and no parameter can change that: nothing in the
    // open path reads them, and the ones that could be mistaken for a
    // credential cannot be stored in the first place.
    const wrong = await anon.rpc("open_delivery", { delivery_token: `wrong${"z".repeat(40)}` });
    expect(wrong.data ?? []).toHaveLength(0);
  });

  it.each([
    { token: "anything" },
    { sig: "forged" },
    { expires: "2099-01-01" },
    // Built through JSON.parse rather than as a literal: `{ __proto__: ... }`
    // in JavaScript sets the prototype instead of creating a key, so the
    // obvious spelling of this test would have sent `{}` and passed for the
    // wrong reason.
    JSON.parse('{"__proto__":"polluted"}'),
    JSON.parse('{"constructor":"polluted"}'),
    { email: "jane@example.com" },
    { CAMPAIGN: "uppercase-key" },
    { "bad key": "spaces" },
    { campaign: "x".repeat(121) },
    { campaign: 42 },
  ])("refuses to store the dangerous parameter set %j", async (parameters) => {
    const { error } = await serviceClient()
      .from("submission_deliveries")
      .insert({
        organization_id: ORG_A,
        submission_id: ORG_A_SUBMISSION,
        token: `danger${Math.random().toString(36).slice(2)}`.padEnd(40, "q"),
        custom_parameters: parameters,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        created_by: OWNER_A,
      });
    expect(error).toBeTruthy();
  });

  it("refuses more parameters than the cap allows", async () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [`k${index}`, "value"]),
    );
    const { error } = await serviceClient()
      .from("submission_deliveries")
      .insert({
        organization_id: ORG_A,
        submission_id: ORG_A_SUBMISSION,
        token: `toomany${"r".repeat(40)}`,
        custom_parameters: tooMany,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        created_by: OWNER_A,
      });
    expect(error).toBeTruthy();
  });
});
