/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { ORG_A, ORG_B, clientFor, hasLocalSupabase, serviceClient } from "./helpers/supabase";

/**
 * Billing state, enforced by the database.
 *
 * The interesting case is not the happy path: it is whether a workspace owner
 * can put themselves on a better plan, and whether a past-due workspace stops
 * writing without anything having to run on a schedule.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const NADIA = "99999999-9999-9999-9999-999999999999";

async function applyBilling(patch: Record<string, unknown>) {
  const { error } = await serviceClient().rpc("apply_billing_state", {
    target_org: ORG_B,
    ...patch,
  });
  if (error) throw new Error(error.message);
}

async function restoreOrgB() {
  await serviceClient().rpc("apply_billing_state", {
    target_org: ORG_B,
    new_plan: "pro",
    new_status: "trialing",
    new_trial_ends_at: new Date(Date.now() + 24 * 86_400_000).toISOString(),
    new_storage_limit_bytes: 25 * 1024 ** 3,
    new_seat_limit: 1,
    clear_payment_method: true,
    clear_subscription: true,
    clear_customer: true,
  });
}

afterAll(async () => {
  await restoreOrgB();
});

describeIf("an owner cannot put themselves on a better plan", () => {
  it("refuses a direct plan change", async () => {
    const nadia = await clientFor("otherOrgOwner");
    const { error } = await nadia.from("organizations").update({ plan: "studio" }).eq("id", ORG_B);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/follows from a payment/i);
  });

  it("refuses a direct subscription status change", async () => {
    const nadia = await clientFor("otherOrgOwner");
    const { error } = await nadia
      .from("organizations")
      .update({ subscription_status: "active" })
      .eq("id", ORG_B);
    expect(error?.message).toMatch(/follows from a payment/i);
  });

  it("refuses extending their own trial", async () => {
    const nadia = await clientFor("otherOrgOwner");
    const { error } = await nadia
      .from("organizations")
      .update({ trial_ends_at: new Date(Date.now() + 3650 * 86_400_000).toISOString() })
      .eq("id", ORG_B);
    expect(error?.message).toMatch(/follows from a payment/i);
  });

  it("refuses raising their own storage allowance", async () => {
    const nadia = await clientFor("otherOrgOwner");
    const { error } = await nadia
      .from("organizations")
      .update({ storage_limit_bytes: 10 * 1024 ** 4 })
      .eq("id", ORG_B);
    expect(error?.message).toMatch(/follows from a payment/i);
  });

  it("refuses claiming somebody else's Stripe customer", async () => {
    const nadia = await clientFor("otherOrgOwner");
    const { error } = await nadia
      .from("organizations")
      .update({ stripe_customer_id: "cus_someone_else" })
      .eq("id", ORG_B);
    expect(error?.message).toMatch(/follows from a payment/i);
  });

  it("still lets an owner change what is genuinely theirs", async () => {
    const nadia = await clientFor("otherOrgOwner");
    const { error } = await nadia
      .from("organizations")
      .update({ timezone: "America/Denver", name: "Northline Photo" })
      .eq("id", ORG_B);
    expect(error).toBeNull();

    await serviceClient()
      .from("organizations")
      .update({ timezone: "America/Chicago" })
      .eq("id", ORG_B);
  });

  it("two workspaces cannot share a Stripe subscription", async () => {
    const shared = `sub_shared_${Date.now()}`;
    await applyBilling({ new_subscription_id: shared });

    // Through the sanctioned path, so the protection trigger is not what stops
    // it: the unique constraint is.
    const { error } = await serviceClient().rpc("apply_billing_state", {
      target_org: ORG_A,
      new_subscription_id: shared,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505");

    await serviceClient().rpc("apply_billing_state", {
      target_org: ORG_B,
      clear_subscription: true,
    });
  });
});

describeIf("the past-due grace window", () => {
  it("keeps the workspace writing while the window is open", async () => {
    await applyBilling({
      new_status: "past_due",
      new_past_due_since: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });

    const nadia = await clientFor("otherOrgOwner");
    const { data, error } = await nadia
      .from("shoots")
      .insert({ organization_id: ORG_B, title: `In grace ${Date.now()}`, created_by: NADIA })
      .select("id");

    expect(error).toBeNull();
    await serviceClient().from("shoots").delete().eq("id", data![0].id);
    await restoreOrgB();
  });

  /**
   * Nothing runs on a schedule. The workspace becomes read-only because the
   * recorded date is old, not because a job flipped a status.
   */
  it("stops writes once the window has run out, with no job having run", async () => {
    await applyBilling({
      new_status: "past_due",
      new_past_due_since: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    });

    const service = serviceClient();
    const { data: org } = await service
      .from("organizations")
      .select("subscription_status")
      .eq("id", ORG_B)
      .single();
    // The stored status is untouched; only the date has aged.
    expect(org!.subscription_status).toBe("past_due");

    const nadia = await clientFor("otherOrgOwner");
    const { error } = await nadia.from("shoots").insert({
      organization_id: ORG_B,
      title: "After the grace window",
      created_by: NADIA,
    });
    expect(error?.message).toMatch(/read-only/i);

    // And reading still works.
    const { error: readError } = await nadia.from("shoots").select("id");
    expect(readError).toBeNull();

    await restoreOrgB();
  });

  it("clears the past-due date when a payment recovers", async () => {
    await applyBilling({
      new_status: "past_due",
      new_past_due_since: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });
    await applyBilling({ new_status: "active" });

    const { data: org } = await serviceClient()
      .from("organizations")
      .select("subscription_status, past_due_since")
      .eq("id", ORG_B)
      .single();

    expect(org!.subscription_status).toBe("active");
    expect(org!.past_due_since).toBeNull();
    await restoreOrgB();
  });

  it("refuses a past-due workspace with no start date", async () => {
    const { error } = await serviceClient()
      .from("organizations")
      .update({ subscription_status: "past_due", past_due_since: null })
      .eq("id", ORG_B);
    expect(error).not.toBeNull();
  });
});

describeIf("attaching a card during a trial", () => {
  it("lifts the storage cap without ending the trial", async () => {
    const service = serviceClient();
    await applyBilling({ new_payment_method_attached_at: new Date().toISOString() });

    const { data: org } = await service
      .from("organizations")
      .select("subscription_status, payment_method_attached_at, trial_ends_at")
      .eq("id", ORG_B)
      .single();

    // Still a trial: the card does not bring the charge forward.
    expect(org!.subscription_status).toBe("trialing");
    expect(org!.payment_method_attached_at).not.toBeNull();
    expect(org!.trial_ends_at).not.toBeNull();

    // And the allowance is now the plan's, not the trial cap. A version larger
    // than the 25 GB cap is accepted.
    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_B,
        status: "active",
        canonical_filename: `NL_CARD_${Date.now()}`,
        created_by: NADIA,
      })
      .select("id")
      .single();

    const digest = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`card-${Date.now()}`)),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const { error } = await service.from("asset_versions").insert({
      organization_id: ORG_B,
      asset_id: asset!.id,
      version_kind: "edit",
      storage_bucket: "derivatives",
      object_key: `${ORG_B}/card-lifted-${Date.now()}.jpg`,
      sha256: digest,
      bytes: 40 * 1024 ** 3,
      mime_type: "image/jpeg",
      created_by: NADIA,
    });

    expect(error).toBeNull();

    await service.rpc("purge_asset_admin", { target_asset: asset!.id });
    await restoreOrgB();
  });

  it("still caps a trial with no card on file", async () => {
    await restoreOrgB();
    const service = serviceClient();

    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_B,
        status: "active",
        canonical_filename: `NL_NOCARD_${Date.now()}`,
        created_by: NADIA,
      })
      .select("id")
      .single();

    const digest = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`nocard-${Date.now()}`)),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const { error } = await service.from("asset_versions").insert({
      organization_id: ORG_B,
      asset_id: asset!.id,
      version_kind: "edit",
      storage_bucket: "derivatives",
      object_key: `${ORG_B}/nocard-${Date.now()}.jpg`,
      sha256: digest,
      bytes: 40 * 1024 ** 3,
      mime_type: "image/jpeg",
      created_by: NADIA,
    });

    expect(error?.message).toMatch(/storage is full/i);
    await service.rpc("purge_asset_admin", { target_asset: asset!.id });
  });
});

describeIf("the reported allowance matches what is enforced", () => {
  it("reports the trial cap while there is no card on file", async () => {
    await restoreOrgB();
    const { data } = await serviceClient()
      .from("organization_storage_usage")
      .select("allowance_bytes")
      .eq("organization_id", ORG_B)
      .single();
    expect(Number(data!.allowance_bytes)).toBe(25 * 1024 ** 3);
  });

  /**
   * Reading storage_limit_bytes alone would show a paying customer their old
   * trial cap while the database happily accepted a terabyte.
   */
  it("reports the plan allowance once a card is attached", async () => {
    await applyBilling({ new_payment_method_attached_at: new Date().toISOString() });
    const { data } = await serviceClient()
      .from("organization_storage_usage")
      .select("allowance_bytes")
      .eq("organization_id", ORG_B)
      .single();
    // Pro, not the 25 GB the column still records.
    expect(Number(data!.allowance_bytes)).toBe(1024 ** 4);
    await restoreOrgB();
  });

  it("reports no allowance at all for a negotiated plan", async () => {
    await applyBilling({
      new_plan: "agency",
      new_status: "active",
      clear_storage_limit: true,
    });

    const { data } = await serviceClient()
      .from("organization_storage_usage")
      .select("allowance_bytes")
      .eq("organization_id", ORG_B)
      .single();
    // Null means negotiated: there is nothing to enforce.
    expect(data!.allowance_bytes).toBeNull();
    await restoreOrgB();
  });

  it("does not treat an Agency plan alone as unlimited", async () => {
    // The plan is negotiated, but until the allowance is cleared the recorded
    // limit still applies. Otherwise switching plan would silently grant
    // unlimited storage.
    await applyBilling({ new_plan: "agency", new_status: "active" });
    const { data } = await serviceClient()
      .from("organization_storage_usage")
      .select("allowance_bytes")
      .eq("organization_id", ORG_B)
      .single();
    expect(Number(data!.allowance_bytes)).toBe(25 * 1024 ** 3);
    await restoreOrgB();
  });
});
