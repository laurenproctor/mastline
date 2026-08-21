/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { ORG_A, ORG_B, clientFor, hasLocalSupabase, serviceClient } from "./helpers/supabase";

/**
 * Trial expiry, storage caps, and seat limits, enforced by the database.
 *
 * The interface decides what to offer. These prove the database decides what
 * actually happens, so a Server Action nobody remembered to guard cannot write
 * into a lapsed workspace.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const NADIA = "99999999-9999-9999-9999-999999999999";
const createdOrgs: string[] = [];

/**
 * Put Org B into a given subscription state for the duration of one test.
 *
 * Billing columns are protected by a trigger, so even the service role goes
 * through apply_billing_state. That is the point: a workspace owner cannot
 * grant themselves a plan, and neither can a stray UPDATE.
 */
async function setOrgB(patch: Record<string, unknown>) {
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

/** The bytes the seed puts in Org B. Anything else means a test leaked. */
const ORG_B_SEEDED_BYTES = 48_000_000;

afterAll(async () => {
  const service = serviceClient();

  // Purge first. Asserting before cleaning up meant a failed check left
  // workspaces behind for every later run.
  for (const orgId of createdOrgs) {
    await service.rpc("purge_organization_admin", { target_org: orgId });
  }
  await restoreOrgB();

  // A leaked version silently changes what every storage assertion means, and
  // it is how a 10 TB phantom got into the workspace once already.
  const { data: usage } = await serviceClient()
    .from("organization_storage_usage")
    .select("bytes_used")
    .eq("organization_id", ORG_B)
    .single();
  if (Number(usage?.bytes_used) !== ORG_B_SEEDED_BYTES) {
    throw new Error(
      `Storage tests leaked: Org B holds ${usage?.bytes_used} bytes, expected ${ORG_B_SEEDED_BYTES}.`,
    );
  }
});

describeIf("a lapsed workspace is read-only, not locked", () => {
  it("refuses a write once the trial has ended", async () => {
    await setOrgB({ new_status: "expired" });
    const nadia = await clientFor("otherOrgOwner");

    const { error } = await nadia.from("shoots").insert({
      organization_id: ORG_B,
      title: "After the trial ended",
      created_by: NADIA,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/read-only/i);
    await restoreOrgB();
  });

  it("still lets everything be read", async () => {
    await setOrgB({ new_status: "expired" });
    const nadia = await clientFor("otherOrgOwner");

    const { data: shoots, error } = await nadia.from("shoots").select("id, title");
    expect(error).toBeNull();
    expect((shoots ?? []).length).toBeGreaterThan(0);

    // And the derived money view, which the export depends on.
    const { error: viewError } = await nadia.from("asset_lifetime_earnings").select("asset_id");
    expect(viewError).toBeNull();

    await restoreOrgB();
  });

  it("refuses an update and a delete, not only an insert", async () => {
    const service = serviceClient();
    const { data: shoot } = await service
      .from("shoots")
      .select("id")
      .eq("organization_id", ORG_B)
      .limit(1)
      .single();

    await setOrgB({ new_status: "expired" });
    const nadia = await clientFor("otherOrgOwner");

    const update = await nadia.from("shoots").update({ status: "ready" }).eq("id", shoot!.id);
    expect(update.error?.message).toMatch(/read-only/i);

    const remove = await nadia.from("shoots").delete().eq("id", shoot!.id);
    expect(remove.error?.message).toMatch(/read-only/i);

    await restoreOrgB();
  });

  it("still lets the workspace change its own plan, which is how it stops being lapsed", async () => {
    await setOrgB({ new_status: "expired" });
    const nadia = await clientFor("otherOrgOwner");

    const { error } = await nadia
      .from("organizations")
      .update({ timezone: "America/Denver" })
      .eq("id", ORG_B);
    expect(error).toBeNull();

    await serviceClient()
      .from("organizations")
      .update({ timezone: "America/Chicago" })
      .eq("id", ORG_B);
    await restoreOrgB();
  });

  it("keeps writing while a trial is still running", async () => {
    await restoreOrgB();
    const nadia = await clientFor("otherOrgOwner");
    const { data, error } = await nadia
      .from("shoots")
      .insert({ organization_id: ORG_B, title: `During trial ${Date.now()}`, created_by: NADIA })
      .select("id");
    expect(error).toBeNull();
    await serviceClient().from("shoots").delete().eq("id", data![0].id);
  });

  /**
   * A card that failed on Tuesday should not stop a photographer working a
   * story on Wednesday.
   */
  it("keeps a past-due workspace working", async () => {
    await setOrgB({ new_status: "past_due", new_past_due_since: new Date().toISOString() });
    const nadia = await clientFor("otherOrgOwner");

    const { data, error } = await nadia
      .from("shoots")
      .insert({ organization_id: ORG_B, title: `Past due ${Date.now()}`, created_by: NADIA })
      .select("id");
    expect(error).toBeNull();

    await serviceClient().from("shoots").delete().eq("id", data![0].id);
    await restoreOrgB();
  });

  it("refuses writes on a cancelled workspace", async () => {
    await setOrgB({ new_status: "cancelled" });
    const nadia = await clientFor("otherOrgOwner");

    const { error } = await nadia.from("shoots").insert({
      organization_id: ORG_B,
      title: "After cancelling",
      created_by: NADIA,
    });
    expect(error?.message).toMatch(/read-only/i);
    await restoreOrgB();
  });

  it("leaves a paying workspace entirely alone", async () => {
    const owner = await clientFor("owner");
    const { data, error } = await owner
      .from("shoots")
      .insert({ organization_id: ORG_A, title: `Paying ${Date.now()}`, created_by: OWNER })
      .select("id");
    expect(error).toBeNull();
    await serviceClient().from("shoots").delete().eq("id", data![0].id);
  });
});

describeIf("storage limits", () => {
  it("refuses an import that would exceed the cap", async () => {
    await setOrgB({ new_storage_limit_bytes: 1000 });
    const service = serviceClient();

    const { data: asset } = await service
      .from("assets")
      .select("id")
      .eq("organization_id", ORG_B)
      .limit(1)
      .single();

    const { error } = await service.from("asset_versions").insert({
      organization_id: ORG_B,
      asset_id: asset!.id,
      version_kind: "preview",
      storage_bucket: "derivatives",
      object_key: `${ORG_B}/over-limit-${Date.now()}.jpg`,
      sha256: "c".repeat(64),
      bytes: 2000,
      mime_type: "image/jpeg",
      created_by: NADIA,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/storage is full/i);
    // The promise made in the message has to be true.
    expect(error?.message).toMatch(/Nothing already stored is affected/i);
    await restoreOrgB();
  });

  it("does not touch anything already stored when the cap is exceeded", async () => {
    const service = serviceClient();
    const before = await service.from("asset_versions").select("id").eq("organization_id", ORG_B);

    await setOrgB({ new_storage_limit_bytes: 1 });
    const after = await service.from("asset_versions").select("id").eq("organization_id", ORG_B);

    expect(after.data).toHaveLength(before.data!.length);
    await restoreOrgB();
  });

  it("allows an import that fits exactly", async () => {
    const service = serviceClient();
    const { data: usage } = await service
      .from("organization_storage_usage")
      .select("bytes_used")
      .eq("organization_id", ORG_B)
      .single();

    const used = Number(usage!.bytes_used);
    await setOrgB({ new_storage_limit_bytes: used + 500 });

    // A throwaway asset, so purging it afterwards leaves the workspace's real
    // records untouched.
    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_B,
        status: "active",
        canonical_filename: `NL_FIT_${Date.now()}`,
        created_by: NADIA,
      })
      .select("id")
      .single();

    const { error } = await service.from("asset_versions").insert({
      organization_id: ORG_B,
      asset_id: asset!.id,
      version_kind: "thumbnail",
      storage_bucket: "derivatives",
      object_key: `${ORG_B}/exact-fit-${Date.now()}.jpg`,
      sha256: "d".repeat(64),
      bytes: 500,
      mime_type: "image/jpeg",
      created_by: NADIA,
    });

    expect(error).toBeNull();

    await service.rpc("purge_asset_admin", { target_asset: asset!.id });
    await restoreOrgB();
  });

  it("leaves a negotiated plan unconstrained", async () => {
    // Agency is negotiated: the plan alone is not enough, the recorded
    // allowance has to be cleared for there to be nothing to enforce.
    await setOrgB({
      new_plan: "agency",
      new_status: "active",
      clear_storage_limit: true,
    });
    const service = serviceClient();

    // A throwaway asset with a per-run digest, so repeated runs neither collide
    // on the (asset, kind, digest) key nor leave anything behind.
    const stamp = `${Date.now()}${Math.round(performance.now())}`;
    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_B,
        status: "active",
        canonical_filename: `NL_UNCONSTRAINED_${stamp}`,
        created_by: NADIA,
      })
      .select("id")
      .single();

    const digest = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`unconstrained-${stamp}`)),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const { error } = await service.from("asset_versions").insert({
      organization_id: ORG_B,
      asset_id: asset!.id,
      version_kind: "edit",
      storage_bucket: "derivatives",
      object_key: `${ORG_B}/unconstrained-${stamp}.jpg`,
      sha256: digest,
      bytes: 10 * 1024 ** 4,
      mime_type: "image/jpeg",
      created_by: NADIA,
    });

    expect(error).toBeNull();

    await service.rpc("purge_asset_admin", { target_asset: asset!.id });
    await restoreOrgB();
  });

  it("reports usage from the stored versions rather than a counter", async () => {
    const service = serviceClient();
    const { data: usage } = await service
      .from("organization_storage_usage")
      .select("bytes_used, object_count")
      .eq("organization_id", ORG_A)
      .single();

    const { data: versions } = await service
      .from("asset_versions")
      .select("bytes")
      .eq("organization_id", ORG_A);

    const summed = (versions ?? []).reduce((total, row) => total + Number(row.bytes), 0);
    expect(Number(usage!.bytes_used)).toBe(summed);
    expect(Number(usage!.object_count)).toBe((versions ?? []).length);
  });
});

describeIf("seat limits", () => {
  it("refuses a member beyond the plan's seats", async () => {
    const service = serviceClient();
    // Org B is on a one-seat trial and already has its owner.
    const { data: created } = await service.auth.admin.createUser({
      email: `seat-${Date.now()}@northline.test`,
      password: "mastline-dev-password",
      email_confirm: true,
    });
    const inviteeId = created.user!.id;

    const { error } = await service.from("memberships").insert({
      organization_id: ORG_B,
      user_id: inviteeId,
      role: "editor",
      status: "invited",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/includes 1 people|includes 1 person/i);

    await service.auth.admin.deleteUser(inviteeId);
  });

  it("allows a member when there is room", async () => {
    const service = serviceClient();
    const { data: created } = await service.auth.admin.createUser({
      email: `seat-ok-${Date.now()}@mastline.test`,
      password: "mastline-dev-password",
      email_confirm: true,
    });
    const inviteeId = created.user!.id;

    // Org A is on Studio with ten seats and six people.
    const { error } = await service.from("memberships").insert({
      organization_id: ORG_A,
      user_id: inviteeId,
      role: "viewer",
      status: "invited",
    });
    expect(error).toBeNull();

    await service.from("memberships").delete().eq("user_id", inviteeId);
    await service.auth.admin.deleteUser(inviteeId);
  });
});

describeIf("creating a workspace", () => {
  it("creates the organization, the founding owner, and the trial together", async () => {
    const service = serviceClient();
    const { data: created } = await service.auth.admin.createUser({
      email: `founder-${Date.now()}@example.test`,
      password: "mastline-dev-password",
      email_confirm: true,
    });
    const founderId = created.user!.id;

    const founder = (await import("@supabase/supabase-js")).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, storageKey: `founder-${founderId}` } },
    );
    await founder.auth.signInWithPassword({
      email: created.user!.email!,
      password: "mastline-dev-password",
    });

    const slug = `new-studio-${Date.now()}`;
    const { data: orgId, error } = await founder.rpc("create_workspace", {
      workspace_name: "A New Studio",
      workspace_slug: slug,
      workspace_timezone: "Europe/London",
    });

    expect(error).toBeNull();
    expect(orgId).toBeTruthy();
    createdOrgs.push(orgId as string);

    const { data: org } = await service
      .from("organizations")
      .select("name, plan, subscription_status, trial_ends_at, storage_limit_bytes, seat_limit")
      .eq("id", orgId)
      .single();

    expect(org!.name).toBe("A New Studio");
    expect(org!.plan).toBe("pro");
    expect(org!.subscription_status).toBe("trialing");
    expect(org!.trial_ends_at).toBeTruthy();
    expect(Number(org!.storage_limit_bytes)).toBe(25 * 1024 ** 3);
    expect(Number(org!.seat_limit)).toBe(1);

    // The founder can immediately reach it.
    const { data: membership } = await service
      .from("memberships")
      .select("role, status")
      .eq("organization_id", orgId)
      .eq("user_id", founderId)
      .single();
    expect(membership!.role).toBe("owner");
    expect(membership!.status).toBe("active");

    // And it is in the record.
    const { data: events } = await service
      .from("activity_events")
      .select("action")
      .eq("organization_id", orgId);
    expect((events ?? []).map((event) => event.action)).toContain("workspace.created");

    await service.auth.admin.deleteUser(founderId);
  });

  it("refuses an anonymous caller", async () => {
    const anon = (await import("@supabase/supabase-js")).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, storageKey: "anon-create" } },
    );
    const { error } = await anon.rpc("create_workspace", {
      workspace_name: "Anonymous Studio",
      workspace_slug: `anon-${Date.now()}`,
    });
    expect(error).not.toBeNull();
  });

  it("refuses a workspace with no name", async () => {
    const owner = await clientFor("owner");
    const { error } = await owner.rpc("create_workspace", {
      workspace_name: "   ",
      workspace_slug: `blank-${Date.now()}`,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/needs a name/i);
  });
});
