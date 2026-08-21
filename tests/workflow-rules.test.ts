/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  ORG_A,
  ORG_A_ASSET,
  ORG_A_ORIGINAL_VERSION,
  ORG_A_SUBMISSION,
  clientFor,
  hasLocalSupabase,
  serviceClient,
} from "./helpers/supabase";

/**
 * Business rules that must hold in the database itself, not only in
 * application code. Each one corresponds to a line in docs/ACCEPTANCE.md or to
 * a defect corrected in the initial migration.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";

describeIf("originals are immutable", () => {
  it("an original version cannot be updated", async () => {
    const editor = await clientFor("editor");
    const { data } = await editor
      .from("asset_versions")
      .update({ sha256: "f".repeat(64) })
      .eq("id", ORG_A_ORIGINAL_VERSION)
      .select();
    expect(data ?? []).toHaveLength(0);

    const check = await serviceClient()
      .from("asset_versions")
      .select("sha256")
      .eq("id", ORG_A_ORIGINAL_VERSION)
      .single();
    expect(check.data?.sha256).toBe("a".repeat(64));
  });

  it("an asset cannot gain a second original", async () => {
    const { error } = await serviceClient()
      .from("asset_versions")
      .insert({
        organization_id: ORG_A,
        asset_id: ORG_A_ASSET,
        version_kind: "original",
        storage_bucket: "originals",
        object_key: `${ORG_A}/second-original-${Date.now()}.arw`,
        sha256: "9".repeat(64),
        bytes: 100,
        mime_type: "image/x-sony-arw",
        created_by: OWNER,
      });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/already has an original/i);
  });

  it("a derivative cannot claim the originals bucket", async () => {
    const { error } = await serviceClient()
      .from("asset_versions")
      .insert({
        organization_id: ORG_A,
        asset_id: ORG_A_ASSET,
        version_kind: "delivery",
        storage_bucket: "originals",
        object_key: `${ORG_A}/mislabelled-${Date.now()}.jpg`,
        sha256: "8".repeat(64),
        bytes: 100,
        mime_type: "image/jpeg",
        created_by: OWNER,
      });
    expect(error).not.toBeNull();
  });

  it("the append-only trigger no longer deadlocks a cascading delete", async () => {
    // The original schema aborted any organization delete because the trigger
    // raised on the cascade. The purge routine now completes.
    const service = serviceClient();
    const { data: org } = await service
      .from("organizations")
      .insert({
        name: `Purge Test ${Date.now()}`,
        slug: `purge-test-${Date.now()}`,
        created_by: OWNER,
      })
      .select("id")
      .single();
    const orgId = org!.id as string;

    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: orgId,
        status: "active",
        canonical_filename: "PURGE_0001",
        created_by: OWNER,
      })
      .select("id")
      .single();

    await service.from("asset_versions").insert({
      organization_id: orgId,
      asset_id: asset!.id,
      version_kind: "original",
      storage_bucket: "originals",
      object_key: `${orgId}/PURGE_0001.arw`,
      sha256: "7".repeat(64),
      bytes: 100,
      mime_type: "image/x-sony-arw",
      created_by: OWNER,
    });

    // A plain delete is still refused: originals are not casually destroyed.
    const plain = await service.from("organizations").delete().eq("id", orgId).select();
    expect(plain.error).not.toBeNull();

    // The deliberate, auditable path succeeds.
    const { error: purgeError } = await service.rpc("purge_organization_admin", {
      target_org: orgId,
    });
    expect(purgeError).toBeNull();

    const check = await service.from("organizations").select("id").eq("id", orgId);
    expect(check.data ?? []).toHaveLength(0);
  });

  it("tombstoning stamps who and when", async () => {
    const service = serviceClient();
    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_A,
        status: "active",
        canonical_filename: `TOMB_${Date.now()}`,
        created_by: OWNER,
      })
      .select("id")
      .single();

    const owner = await clientFor("owner");
    const { data: updated } = await owner
      .from("assets")
      .update({ status: "tombstoned", tombstone_reason: "Subject requested removal" })
      .eq("id", asset!.id)
      .select("status, tombstoned_at, tombstoned_by")
      .single();

    expect(updated?.status).toBe("tombstoned");
    expect(updated?.tombstoned_at).not.toBeNull();
    expect(updated?.tombstoned_by).toBe(OWNER);

    await service.rpc("purge_asset_admin", { target_asset: asset!.id });
  });
});

describeIf("caption history is a log", () => {
  it("records prior values without destroying them", async () => {
    const client = await clientFor("editor");
    const { data } = await client
      .from("asset_caption_revisions")
      .select("caption, created_at")
      .eq("asset_id", ORG_A_ASSET)
      .order("created_at", { ascending: true });
    expect((data ?? []).length).toBeGreaterThanOrEqual(2);
    expect(data?.[0]?.caption).toMatch(/leaving a hotel/i);
  });

  it("cannot be rewritten", async () => {
    const client = await clientFor("editor");
    const { data: rows } = await client
      .from("asset_caption_revisions")
      .select("id")
      .eq("asset_id", ORG_A_ASSET)
      .limit(1);
    const { data } = await client
      .from("asset_caption_revisions")
      .update({ caption: "rewritten" })
      .eq("id", rows![0].id)
      .select();
    expect(data ?? []).toHaveLength(0);
  });
});

describeIf("a sent submission preserves what was sent", () => {
  it("refuses to change the delivery manifest", async () => {
    const { error } = await serviceClient()
      .from("submissions")
      .update({ delivery_manifest: { versions: [] } })
      .eq("id", ORG_A_SUBMISSION);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/immutable/i);
  });

  it("refuses to change the terms that were sent", async () => {
    const { error } = await serviceClient()
      .from("submissions")
      .update({ terms_snapshot: "Rewritten after the fact" })
      .eq("id", ORG_A_SUBMISSION);
    expect(error).not.toBeNull();
  });

  it("refuses to change the buyer it went to", async () => {
    const { error } = await serviceClient()
      .from("submissions")
      .update({ buyer_id: null })
      .eq("id", ORG_A_SUBMISSION);
    expect(error).not.toBeNull();
  });

  it("still allows an outcome to be recorded afterwards", async () => {
    const dispatcher = await clientFor("dispatcher");
    const { data, error } = await dispatcher
      .from("submissions")
      .update({ status: "sold", outcome_note: "Sold to two outlets." })
      .eq("id", ORG_A_SUBMISSION)
      .select("status");
    expect(error).toBeNull();
    expect(data?.[0]?.status).toBe("sold");

    await serviceClient()
      .from("submissions")
      .update({ status: "delivered", outcome_note: null })
      .eq("id", ORG_A_SUBMISSION);
  });
});

describeIf("a package cannot ship without approval", () => {
  it("refuses a delivered status with no recorded approval", async () => {
    const { error } = await serviceClient().from("packages").insert({
      organization_id: ORG_A,
      shoot_id: "a0000000-0000-0000-0000-0000000000c1",
      name: "Unapproved but delivered",
      status: "delivered",
      created_by: OWNER,
    });
    expect(error).not.toBeNull();
  });

  it("refuses a half-recorded approval", async () => {
    const { error } = await serviceClient().from("packages").insert({
      organization_id: ORG_A,
      shoot_id: "a0000000-0000-0000-0000-0000000000c1",
      name: "Half approved",
      status: "draft",
      approved_by: OWNER,
      created_by: OWNER,
    });
    expect(error).not.toBeNull();
  });
});

describeIf("the Sales Engine share is enforced by the database", () => {
  it("refuses a platform fee on an externally generated license", async () => {
    const { error } = await serviceClient().from("licenses").insert({
      organization_id: ORG_A,
      status: "proposed",
      licensee_name: "External with a fee",
      origin: "external",
      sale_base_minor: 10000,
      sales_engine_share_minor: 3000,
      photographer_share_minor: 7000,
      created_by: OWNER,
    });
    expect(error).not.toBeNull();
  });

  it("refuses shares that do not reconstitute the base", async () => {
    const { error } = await serviceClient().from("licenses").insert({
      organization_id: ORG_A,
      status: "proposed",
      licensee_name: "Lost a cent",
      origin: "mastline_sales_engine",
      sale_base_minor: 10000,
      sales_engine_share_minor: 3000,
      photographer_share_minor: 6999,
      created_by: OWNER,
    });
    expect(error).not.toBeNull();
  });

  it("accepts a correctly split Mastline license", async () => {
    const service = serviceClient();
    const { data, error } = await service
      .from("licenses")
      .insert({
        organization_id: ORG_A,
        status: "proposed",
        licensee_name: "Correctly split",
        origin: "mastline_sales_engine",
        sale_base_minor: 5,
        sales_engine_share_minor: 2,
        photographer_share_minor: 3,
        created_by: OWNER,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    await service.from("licenses").delete().eq("id", data!.id);
  });
});

describeIf("refunds are representable", () => {
  it("stores a reversal as a negative payment pointing at the original", async () => {
    const service = serviceClient();
    const { data: original } = await service
      .from("payments")
      .insert({
        organization_id: ORG_A,
        status: "received",
        source: "checkout",
        external_reference: `REFUND-BASE-${Date.now()}`,
        gross_minor: 64000,
        platform_fee_minor: 19200,
        net_minor: 44800,
        created_by: OWNER,
      })
      .select("id")
      .single();

    const { data: reversal, error } = await service
      .from("payments")
      .insert({
        organization_id: ORG_A,
        status: "received",
        source: "checkout",
        external_reference: `REFUND-REV-${Date.now()}`,
        reverses_payment_id: original!.id,
        gross_minor: -64000,
        platform_fee_minor: -19200,
        net_minor: -44800,
        created_by: OWNER,
      })
      .select("id, net_minor")
      .single();

    expect(error).toBeNull();
    expect(reversal?.net_minor).toBe(-44800);

    await service.from("payments").delete().eq("id", reversal!.id);
    await service.from("payments").delete().eq("id", original!.id);
  });

  it("refuses a negative amount on an ordinary payment", async () => {
    const { error } = await serviceClient()
      .from("payments")
      .insert({
        organization_id: ORG_A,
        status: "received",
        source: "manual",
        external_reference: `BAD-NEG-${Date.now()}`,
        gross_minor: -100,
        net_minor: -100,
        created_by: OWNER,
      });
    expect(error).not.toBeNull();
  });

  it("refuses a zero allocation", async () => {
    const { error } = await serviceClient().from("payment_allocations").insert({
      organization_id: ORG_A,
      payment_id: "a0000000-0000-0000-0000-00000000c001",
      asset_id: ORG_A_ASSET,
      allocated_minor: 0,
      created_by: OWNER,
    });
    expect(error).not.toBeNull();
  });
});

describeIf("delivery webhooks are idempotent", () => {
  it("refuses a duplicate external event id", async () => {
    const service = serviceClient();
    const eventId = `evt_${Date.now()}`;

    const first = await service
      .from("webhook_events")
      .insert({ organization_id: ORG_A, provider: "backgrid", external_event_id: eventId })
      .select("id")
      .single();
    expect(first.error).toBeNull();

    const second = await service
      .from("webhook_events")
      .insert({ organization_id: ORG_A, provider: "backgrid", external_event_id: eventId });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505");

    await service.from("webhook_events").delete().eq("id", first.data!.id);
  });

  it("is not readable by an authenticated user", async () => {
    // Supabase default privileges hand new public tables to authenticated, so
    // this table has its grant revoked explicitly as well as being RLS-forced.
    const owner = await clientFor("owner");
    const { data, error } = await owner.from("webhook_events").select("*");
    expect(error).not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("is not writable by an authenticated user", async () => {
    const owner = await clientFor("owner");
    const { error } = await owner
      .from("webhook_events")
      .insert({ provider: "forged", external_event_id: `forged-${Date.now()}` });
    expect(error).not.toBeNull();
  });
});

describeIf("the activity log is append-only", () => {
  it("cannot be edited", async () => {
    const { error } = await serviceClient()
      .from("activity_events")
      .update({ action: "rewritten" })
      .eq("organization_id", ORG_A);
    expect(error).not.toBeNull();
  });

  it("does not let a member log an action as someone else", async () => {
    const editor = await clientFor("editor");
    const { error } = await editor.from("activity_events").insert({
      organization_id: ORG_A,
      actor_id: OWNER,
      entity_type: "shoot",
      action: "forged.event",
    });
    expect(error).not.toBeNull();
  });
});
