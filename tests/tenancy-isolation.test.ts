/**
 * @vitest-environment node
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  ORG_A,
  ORG_A_ASSET,
  ORG_A_SHOOT,
  ORG_B,
  ORG_B_ASSET,
  ORG_B_ORIGINAL_KEY,
  ORG_B_PAYMENT,
  ORG_B_SHOOT,
  anonClient,
  clientFor,
  hasLocalSupabase,
  serviceClient,
} from "./helpers/supabase";

/**
 * Cross-organization isolation.
 *
 * The question these answer is not "does the query filter by organization" but
 * "can a determined caller reach another workspace's rows at all". Every
 * subject here is a real authenticated user going through PostgREST, so the
 * only thing standing between them and the data is row level security.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

describeIf("anonymous callers", () => {
  it("cannot read organizations", async () => {
    const { data } = await anonClient().from("organizations").select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it.each([
    "shoots",
    "assets",
    "asset_versions",
    "packages",
    "submissions",
    "licenses",
    "payments",
    "rights_matches",
    "activity_events",
    "shoot_sensitive_notes",
  ])("cannot read %s", async (table) => {
    const { data } = await anonClient().from(table).select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("cannot insert a shoot", async () => {
    const { error } = await anonClient()
      .from("shoots")
      .insert({ organization_id: ORG_A, title: "anon", created_by: ORG_A });
    expect(error).not.toBeNull();
  });

  it("cannot sign a URL for a private original", async () => {
    const { data, error } = await anonClient()
      .storage.from("originals")
      .createSignedUrl(ORG_B_ORIGINAL_KEY, 60);
    expect(data?.signedUrl ?? null).toBeNull();
    expect(error).not.toBeNull();
  });
});

describeIf("Org A owner against Org B", () => {
  it("sees only their own organization", async () => {
    const client = await clientFor("owner");
    const { data } = await client.from("organizations").select("id");
    expect(data?.map((row) => row.id)).toEqual([ORG_A]);
  });

  it.each([
    ["shoots", ORG_B_SHOOT],
    ["assets", ORG_B_ASSET],
    ["payments", ORG_B_PAYMENT],
  ])("cannot read Org B %s by id", async (table, id) => {
    const client = await clientFor("owner");
    const { data } = await client.from(table).select("id").eq("id", id);
    expect(data ?? []).toHaveLength(0);
  });

  it("cannot list any Org B row when querying by organization_id", async () => {
    const client = await clientFor("owner");
    for (const table of ["shoots", "assets", "packages", "payments", "buyers"]) {
      const { data } = await client.from(table).select("id").eq("organization_id", ORG_B);
      expect(data ?? [], `${table} leaked`).toHaveLength(0);
    }
  });

  it("cannot read Org B confidential source notes", async () => {
    const client = await clientFor("owner");
    const { data } = await client.from("shoot_sensitive_notes").select("source_note");
    const notes = (data ?? []).map((row) => row.source_note as string);
    expect(notes.join(" ")).not.toMatch(/Northline/i);
  });

  it("cannot mutate an Org B shoot", async () => {
    const client = await clientFor("owner");
    const { data, error } = await client
      .from("shoots")
      .update({ title: "hijacked" })
      .eq("id", ORG_B_SHOOT)
      .select();
    expect(data ?? []).toHaveLength(0);
    expect(error).toBeNull(); // Zero rows matched rather than an error.

    const check = await serviceClient()
      .from("shoots")
      .select("title")
      .eq("id", ORG_B_SHOOT)
      .single();
    expect(check.data?.title).toBe("Northline exclusive");
  });

  it("cannot delete an Org B shoot", async () => {
    const client = await clientFor("owner");
    await client.from("shoots").delete().eq("id", ORG_B_SHOOT);
    const check = await serviceClient().from("shoots").select("id").eq("id", ORG_B_SHOOT);
    expect(check.data ?? []).toHaveLength(1);
  });

  it("cannot insert a row into Org B", async () => {
    const client = await clientFor("owner");
    const { error } = await client.from("buyers").insert({
      organization_id: ORG_B,
      name: "Planted by Org A",
      buyer_type: "agency",
    });
    expect(error).not.toBeNull();
  });

  it("cannot smuggle a row into Org B by updating organization_id", async () => {
    const client = await clientFor("owner");
    const { data } = await client
      .from("shoots")
      .update({ organization_id: ORG_B })
      .eq("id", ORG_A_SHOOT)
      .select();
    expect(data ?? []).toHaveLength(0);

    const check = await serviceClient()
      .from("shoots")
      .select("organization_id")
      .eq("id", ORG_A_SHOOT)
      .single();
    expect(check.data?.organization_id).toBe(ORG_A);
  });

  it("cannot join its way into Org B rows", async () => {
    const client = await clientFor("owner");
    const { data } = await client
      .from("assets")
      .select("id, organization_id, asset_versions(id, organization_id)");
    const orgs = new Set<string>();
    for (const asset of data ?? []) {
      orgs.add(asset.organization_id as string);
      for (const version of (asset.asset_versions ?? []) as { organization_id: string }[]) {
        orgs.add(version.organization_id);
      }
    }
    expect([...orgs]).toEqual([ORG_A]);
  });

  it("cannot read Org B rows through the derived earnings view", async () => {
    const client = await clientFor("owner");
    const { data } = await client
      .from("asset_lifetime_earnings")
      .select("asset_id, organization_id");
    const orgs = new Set((data ?? []).map((row) => row.organization_id as string));
    expect([...orgs]).toEqual([ORG_A]);
  });
});

describeIf("Org B owner against Org A", () => {
  it("is symmetric: sees only Org B", async () => {
    const client = await clientFor("otherOrgOwner");
    const { data } = await client.from("organizations").select("id");
    expect(data?.map((row) => row.id)).toEqual([ORG_B]);
  });

  it("cannot read the Org A asset", async () => {
    const client = await clientFor("otherOrgOwner");
    const { data } = await client.from("assets").select("id").eq("id", ORG_A_ASSET);
    expect(data ?? []).toHaveLength(0);
  });
});

describeIf("private storage", () => {
  beforeAll(async () => {
    // Put a real object in each bucket so signing has something to sign.
    const admin = serviceClient();
    await admin.storage
      .from("originals")
      .upload(ORG_B_ORIGINAL_KEY, new Blob(["org-b-original-bytes"]), { upsert: true });
  });

  it("does not expose the buckets publicly", async () => {
    const { data } = await serviceClient().storage.listBuckets();
    const relevant = (data ?? []).filter((bucket) =>
      ["originals", "derivatives", "evidence"].includes(bucket.id),
    );
    expect(relevant).toHaveLength(3);
    for (const bucket of relevant) {
      expect(bucket.public, `${bucket.id} is public`).toBe(false);
    }
  });

  it("does not let Org A list Org B objects", async () => {
    const client = await clientFor("owner");
    const { data } = await client.storage.from("originals").list(ORG_B);
    expect(data ?? []).toHaveLength(0);
  });

  it("does not let Org A sign a URL for an Org B original", async () => {
    const client = await clientFor("owner");
    const { data, error } = await client.storage
      .from("originals")
      .createSignedUrl(ORG_B_ORIGINAL_KEY, 60);
    expect(data?.signedUrl ?? null).toBeNull();
    expect(error).not.toBeNull();
  });

  it("does not let Org A download an Org B original", async () => {
    const client = await clientFor("owner");
    const { data, error } = await client.storage.from("originals").download(ORG_B_ORIGINAL_KEY);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("does not let Org A write into Org B's prefix", async () => {
    const client = await clientFor("owner");
    const { error } = await client.storage
      .from("originals")
      .upload(`${ORG_B}/planted.jpg`, new Blob(["x"]));
    expect(error).not.toBeNull();
  });

  it("rejects an object key that does not begin with an organization id", async () => {
    const client = await clientFor("editor");
    const { error } = await client.storage
      .from("originals")
      .upload("not-a-uuid/rogue.jpg", new Blob(["x"]));
    expect(error).not.toBeNull();
  });
});

describeIf("session role resolution", () => {
  /**
   * Regression: the session query originally selected every membership row the
   * caller could see. Row level security lets any member read all memberships
   * in their workspace, so the role was taken from whichever row came back
   * first and a viewer was presented as an owner. The database still refused
   * the writes, but the interface offered actions the person could not perform
   * and mislabelled their role.
   */
  it("a member can see every membership row in their workspace", async () => {
    const viewer = await clientFor("viewer");
    const { data } = await viewer.from("memberships").select("user_id, role");
    expect((data ?? []).length).toBeGreaterThan(1);
  });

  it.each([
    ["owner", "owner"],
    ["viewer", "viewer"],
    ["finance", "finance"],
    ["dispatcher", "dispatcher"],
    ["rights", "rights_reviewer"],
    ["editor", "editor"],
  ] as const)(
    "%s resolves exactly one role when filtered by user_id",
    async (user, expectedRole) => {
      const client = await clientFor(user);
      const {
        data: { user: authUser },
      } = await client.auth.getUser();

      const { data } = await client
        .from("memberships")
        .select("role, organizations(id)")
        .eq("user_id", authUser!.id)
        .eq("status", "active");

      expect(data ?? []).toHaveLength(1);
      expect(data![0].role).toBe(expectedRole);
    },
  );

  it("does not report a workspace more than once", async () => {
    const client = await clientFor("editor");
    const {
      data: { user: authUser },
    } = await client.auth.getUser();
    const { data } = await client
      .from("memberships")
      .select("organization_id")
      .eq("user_id", authUser!.id)
      .eq("status", "active");
    const ids = (data ?? []).map((row) => row.organization_id as string);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
