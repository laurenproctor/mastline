/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  ORG_A,
  ORG_A_ASSET,
  ORG_A_PAYMENT,
  ORG_A_SHOOT,
  clientFor,
  hasLocalSupabase,
  serviceClient,
  type SeededUser,
} from "./helpers/supabase";

/**
 * The role matrix from docs/DATA_MODEL.md, exercised against real policies.
 *
 * owner            all workspace control
 * editor           shoot, asset, caption, package, dispatch preparation
 * dispatcher       package and submission delivery and status
 * finance          revenue, payments, statements, exports
 * rights_reviewer  evidence, license checks, case routing
 * viewer           read-only, no sensitive access
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

/** Attempt a write and report only whether the policy allowed it. */
async function canInsert(user: SeededUser, table: string, row: Record<string, unknown>) {
  const client = await clientFor(user);
  const { data, error } = await client.from(table).insert(row).select("id");
  if (data?.[0]?.id) {
    await serviceClient().from(table).delete().eq("id", data[0].id);
    return true;
  }
  return !error && (data?.length ?? 0) > 0;
}

async function canUpdate(
  user: SeededUser,
  table: string,
  id: string,
  patch: Record<string, unknown>,
) {
  const client = await clientFor(user);
  const { data } = await client.from(table).update(patch).eq("id", id).select("id");
  return (data?.length ?? 0) > 0;
}

async function canRead(user: SeededUser, table: string) {
  const client = await clientFor(user);
  const { data } = await client.from(table).select("*");
  return (data?.length ?? 0) > 0;
}

describeIf("every role can read the operational record", () => {
  it.each(["owner", "editor", "dispatcher", "finance", "rights", "viewer"] as const)(
    "%s can read shoots",
    async (user) => {
      expect(await canRead(user, "shoots")).toBe(true);
    },
  );

  it.each(["owner", "editor", "dispatcher", "finance", "rights", "viewer"] as const)(
    "%s can read assets",
    async (user) => {
      expect(await canRead(user, "assets")).toBe(true);
    },
  );
});

describeIf("viewer is read-only", () => {
  it("cannot create a shoot", async () => {
    expect(
      await canInsert("viewer", "shoots", {
        organization_id: ORG_A,
        title: "Viewer shoot",
        created_by: "66666666-6666-6666-6666-666666666666",
      }),
    ).toBe(false);
  });

  it("cannot edit an asset", async () => {
    expect(await canUpdate("viewer", "assets", ORG_A_ASSET, { headline: "edited by viewer" })).toBe(
      false,
    );
  });

  it("cannot edit a payment", async () => {
    expect(await canUpdate("viewer", "payments", ORG_A_PAYMENT, { status: "written_off" })).toBe(
      false,
    );
  });

  it("cannot delete a shoot", async () => {
    const client = await clientFor("viewer");
    await client.from("shoots").delete().eq("id", ORG_A_SHOOT);
    const check = await serviceClient().from("shoots").select("id").eq("id", ORG_A_SHOOT);
    expect(check.data ?? []).toHaveLength(1);
  });
});

describeIf("confidential source notes are narrower than the workspace", () => {
  it.each(["owner", "editor"] as const)("%s can read them", async (user) => {
    expect(await canRead(user, "shoot_sensitive_notes")).toBe(true);
  });

  // Finance access must not imply source access.
  it.each(["finance", "dispatcher", "rights", "viewer"] as const)(
    "%s cannot read them",
    async (user) => {
      expect(await canRead(user, "shoot_sensitive_notes")).toBe(false);
    },
  );

  it("does not leak the note through a shoot join", async () => {
    const client = await clientFor("finance");
    const { data } = await client.from("shoots").select("id, shoot_sensitive_notes(source_note)");
    const notes = (data ?? []).flatMap(
      (row) => (row.shoot_sensitive_notes ?? []) as { source_note: string }[],
    );
    expect(notes).toHaveLength(0);
  });
});

describeIf("money is finance and owner only", () => {
  it.each(["owner", "finance"] as const)("%s can record a payment", async (user) => {
    const uid =
      user === "owner"
        ? "11111111-1111-1111-1111-111111111111"
        : "44444444-4444-4444-4444-444444444444";
    expect(
      await canInsert("owner" === user ? "owner" : "finance", "payments", {
        organization_id: ORG_A,
        status: "expected",
        source: "manual",
        external_reference: `TEST-${user}-${Date.now()}`,
        gross_minor: 1000,
        net_minor: 1000,
        created_by: uid,
      }),
    ).toBe(true);
  });

  it.each(["editor", "dispatcher", "rights"] as const)(
    "%s cannot record a payment",
    async (user) => {
      expect(
        await canInsert(user, "payments", {
          organization_id: ORG_A,
          status: "expected",
          source: "manual",
          external_reference: `TEST-DENY-${user}-${Date.now()}`,
          gross_minor: 1000,
          net_minor: 1000,
          created_by: "11111111-1111-1111-1111-111111111111",
        }),
      ).toBe(false);
    },
  );

  it("editor cannot alter a license fee", async () => {
    expect(
      await canUpdate("editor", "licenses", "a0000000-0000-0000-0000-00000000b001", {
        sale_base_minor: 1,
      }),
    ).toBe(false);
  });
});

describeIf("dispatch separation", () => {
  it("dispatcher can move a package", async () => {
    expect(
      await canUpdate("dispatcher", "packages", "a0000000-0000-0000-0000-0000000000f2", {
        package_note: "Dispatcher touched this",
      }),
    ).toBe(true);
  });

  // A dispatcher moves packages, not briefs.
  it("dispatcher cannot rewrite the shoot brief", async () => {
    expect(
      await canUpdate("dispatcher", "shoots", ORG_A_SHOOT, { title: "Dispatcher rename" }),
    ).toBe(false);
  });

  it("editor cannot create a submission", async () => {
    expect(
      await canInsert("editor", "submissions", {
        organization_id: ORG_A,
        package_id: "a0000000-0000-0000-0000-0000000000f2",
        status: "queued",
        created_by: "22222222-2222-2222-2222-222222222222",
      }),
    ).toBe(false);
  });
});

describeIf("rights reviewer", () => {
  it("can triage a match", async () => {
    const client = await clientFor("rights");
    const { data } = await client
      .from("rights_matches")
      .update({ status: "reviewing", decision_note: "Checking the August statement." })
      .eq("organization_id", ORG_A)
      .select("id");
    expect((data ?? []).length).toBeGreaterThan(0);
    await serviceClient()
      .from("rights_matches")
      .update({ status: "new", decision_note: null })
      .eq("organization_id", ORG_A);
  });

  it("can read evidence but cannot record a license to clear it", async () => {
    expect(await canRead("rights", "rights_matches")).toBe(true);
    expect(
      await canInsert("rights", "licenses", {
        organization_id: ORG_A,
        status: "active",
        licensee_name: "Self-cleared by reviewer",
        origin: "external",
        sale_base_minor: 0,
        photographer_share_minor: 0,
        created_by: "55555555-5555-5555-5555-555555555555",
      }),
    ).toBe(false);
  });
});

describeIf("membership management", () => {
  it("an owner can invite a person", async () => {
    const service = serviceClient();
    const { data: created } = await service.auth.admin.createUser({
      email: `invitee-${Date.now()}@mastline.test`,
      password: "mastline-dev-password",
      email_confirm: true,
    });
    const inviteeId = created.user!.id;

    const owner = await clientFor("owner");
    const { error } = await owner
      .from("memberships")
      .insert({ organization_id: ORG_A, user_id: inviteeId, role: "editor", status: "invited" });
    expect(error).toBeNull();

    await service.from("memberships").delete().eq("user_id", inviteeId);
    await service.auth.admin.deleteUser(inviteeId);
  });

  it("a non-owner cannot invite a person", async () => {
    const editor = await clientFor("editor");
    const { error } = await editor.from("memberships").insert({
      organization_id: ORG_A,
      user_id: "99999999-9999-9999-9999-999999999999",
      role: "viewer",
      status: "invited",
    });
    expect(error).not.toBeNull();
  });

  it("an owner cannot mint a second owner through the invite path", async () => {
    const owner = await clientFor("owner");
    const { error } = await owner.from("memberships").insert({
      organization_id: ORG_A,
      user_id: "99999999-9999-9999-9999-999999999999",
      role: "owner",
      status: "invited",
    });
    expect(error).not.toBeNull();
  });

  it("a member cannot promote themselves", async () => {
    const viewer = await clientFor("viewer");
    const { data } = await viewer
      .from("memberships")
      .update({ role: "owner" })
      .eq("user_id", "66666666-6666-6666-6666-666666666666")
      .select();
    expect(data ?? []).toHaveLength(0);

    const check = await serviceClient()
      .from("memberships")
      .select("role")
      .eq("user_id", "66666666-6666-6666-6666-666666666666")
      .single();
    expect(check.data?.role).toBe("viewer");
  });
});
