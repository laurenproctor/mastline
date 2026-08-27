/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { anonClient, clientFor, hasLocalSupabase, serviceClient } from "./helpers/supabase";
import { RESERVED_SLUGS } from "../src/lib/slug";

/**
 * The slug registry.
 *
 * A workspace address is about to become the thing people paste to each other,
 * so what is worth testing is what makes a link durable: an address is never
 * released, never reassigned, and never changed by anything except the one
 * function that records the change.
 *
 * Every case works on a workspace of its own. Renames are rate limited and
 * recorded in an append-only log, so a shared fixture would spend its allowance
 * on the first run and fail on the second.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const created = new Set<string>();

/** A throwaway workspace, made through the real creation path. */
async function newWorkspace(prefix: string): Promise<{ id: string; slug: string }> {
  const owner = await clientFor("owner");
  const slug = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const { data, error } = await owner.rpc("create_workspace", {
    workspace_name: `Slug Test ${prefix}`,
    workspace_slug: slug,
    // Otherwise the idempotency guard hands back the workspace this user
    // already owns, and every case would share one address.
    allow_additional: true,
  });
  if (error) throw new Error(`could not create ${slug}: ${error.message}`);
  created.add(data as string);
  return { id: data as string, slug };
}

async function currentSlug(org: string): Promise<string | null> {
  const { data } = await serviceClient()
    .from("workspace_slugs")
    .select("slug")
    .eq("organization_id", org)
    .eq("is_current", true)
    .maybeSingle();
  return (data?.slug as string | undefined) ?? null;
}

async function rename(user: Parameters<typeof clientFor>[0], org: string, slug: string) {
  const client = await clientFor(user);
  return client.rpc("rename_workspace_slug", { target_org: org, new_slug: slug });
}

describeIf("workspace slug registry", () => {
  afterAll(async () => {
    const service = serviceClient();
    for (const id of created) {
      await service.rpc("purge_organization_admin", { target_org: id });
    }
  });

  // -- the backfill and the creation path ---------------------------------

  it("gives every organization exactly one current slug, matching the mirror", async () => {
    const service = serviceClient();
    const { data: orgs } = await service.from("organizations").select("id, slug");
    expect((orgs ?? []).length).toBeGreaterThan(0);

    for (const org of orgs ?? []) {
      const { data: rows } = await service
        .from("workspace_slugs")
        .select("slug")
        .eq("organization_id", org.id as string)
        .eq("is_current", true);
      expect(rows?.length, `${org.slug} should have exactly one current slug`).toBe(1);
      expect(rows?.[0]?.slug).toBe(org.slug);
    }
  });

  it("registers the slug when a workspace is created", async () => {
    const made = await newWorkspace("created");
    expect(await currentSlug(made.id)).toBe(made.slug);
  });

  it("refuses to create a workspace on a slug already held", async () => {
    const first = await newWorkspace("dupe");
    const owner = await clientFor("owner");
    const { error } = await owner.rpc("create_workspace", {
      workspace_name: "Second",
      workspace_slug: first.slug,
      allow_additional: true,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505");
  });

  it("refuses to create a workspace on a reserved word", async () => {
    const owner = await clientFor("owner");
    const { error } = await owner.rpc("create_workspace", {
      workspace_name: "Pricing Studio",
      workspace_slug: "pricing",
      allow_additional: true,
    });
    // Raised as a duplicate so the onboarding retry appends a suffix rather
    // than showing a failure on somebody's first screen.
    expect(error?.code).toBe("23505");
  });

  // -- who may rename -----------------------------------------------------

  it("lets an owner rename, moves the mirror, and keeps the old address", async () => {
    const made = await newWorkspace("owner-rename");
    const target = `renamed-${Date.now()}`;

    const { data, error } = await rename("owner", made.id, target);
    expect(error).toBeNull();
    expect(data).toBe("renamed");
    expect(await currentSlug(made.id)).toBe(target);

    const service = serviceClient();
    const { data: org } = await service
      .from("organizations")
      .select("slug")
      .eq("id", made.id)
      .single();
    expect(org?.slug, "the mirror follows the registry").toBe(target);

    const { data: old } = await service
      .from("workspace_slugs")
      .select("is_current, retired_at, organization_id")
      .eq("slug", made.slug)
      .single();
    expect(old?.is_current).toBe(false);
    expect(old?.retired_at).not.toBeNull();
    expect(old?.organization_id, "a retired address stays with its workspace").toBe(made.id);

    const { data: events } = await service
      .from("activity_events")
      .select("event_data")
      .eq("organization_id", made.id)
      .eq("action", "workspace.slug.renamed")
      .limit(1);
    expect(events?.[0]?.event_data).toMatchObject({ from: made.slug, to: target });
  });

  it("refuses a rename by a member who is not an owner", async () => {
    const made = await newWorkspace("non-owner");
    const service = serviceClient();
    const { data: ownerRow } = await service
      .from("memberships")
      .select("user_id")
      .eq("organization_id", made.id)
      .single();
    expect(ownerRow).toBeTruthy();

    // Put the editor in this workspace as an editor, not an owner.
    const { data: editorRow } = await service
      .from("memberships")
      .select("user_id")
      .eq("role", "editor")
      .limit(1)
      .single();
    await service.from("memberships").insert({
      organization_id: made.id,
      user_id: editorRow?.user_id as string,
      role: "editor",
      status: "active",
    });

    const { error } = await rename("editor", made.id, `editor-tried-${Date.now()}`);
    expect(error, "only an owner may move the address").not.toBeNull();
    expect(await currentSlug(made.id)).toBe(made.slug);
  });

  it("refuses a rename of a workspace the caller is not in", async () => {
    const made = await newWorkspace("outsider");
    const { error } = await rename("otherOrgOwner", made.id, `outsider-${Date.now()}`);
    expect(error).not.toBeNull();
    expect(await currentSlug(made.id)).toBe(made.slug);
  });

  it("refuses an anonymous caller", async () => {
    const made = await newWorkspace("anon");
    const { error } = await anonClient().rpc("rename_workspace_slug", {
      target_org: made.id,
      new_slug: `anon-${Date.now()}`,
    });
    expect(error).not.toBeNull();
  });

  // -- what may be claimed ------------------------------------------------

  it("refuses a reserved word", async () => {
    const made = await newWorkspace("reserved");
    for (const slug of ["pricing", "commercial", "settings", "api", "sign-in"]) {
      const { data } = await rename("owner", made.id, slug);
      expect(data, `${slug} should be reserved`).toBe("reserved");
    }
    expect(await currentSlug(made.id)).toBe(made.slug);
  });

  it("refuses a malformed slug", async () => {
    const made = await newWorkspace("malformed");
    for (const slug of ["Not Kebab", "trailing-", "-leading", "under_score", "", "a".repeat(41)]) {
      const { data } = await rename("owner", made.id, slug);
      expect(data, `${JSON.stringify(slug)} should be invalid`).toBe("invalid");
    }
    expect(await currentSlug(made.id)).toBe(made.slug);
  });

  it("says nothing changed when the slug is the one already held", async () => {
    const made = await newWorkspace("unchanged");
    const { data } = await rename("owner", made.id, made.slug);
    expect(data).toBe("unchanged");
  });

  it("refuses a slug another workspace currently holds", async () => {
    const mine = await newWorkspace("mine");
    const theirs = await newWorkspace("theirs");
    const { data } = await rename("owner", mine.id, theirs.slug);
    expect(data).toBe("taken");
    expect(await currentSlug(mine.id)).toBe(mine.slug);
  });

  it("refuses a slug another workspace held in the past", async () => {
    const theirs = await newWorkspace("formerly");
    const released = theirs.slug;
    expect((await rename("owner", theirs.id, `moved-on-${Date.now()}`)).data).toBe("renamed");

    const mine = await newWorkspace("hopeful");
    const { data } = await rename("owner", mine.id, released);
    expect(data, "a released address is never claimable by another workspace").toBe("taken");
  });

  it("lets a workspace return to an address it held before", async () => {
    const made = await newWorkspace("returning");
    const away = `away-${Date.now()}`;

    expect((await rename("owner", made.id, away)).data).toBe("renamed");
    expect((await rename("owner", made.id, made.slug)).data).toBe("renamed");
    expect(await currentSlug(made.id)).toBe(made.slug);

    // The address it left is still reserved to it rather than gone.
    const { data } = await serviceClient()
      .from("workspace_slugs")
      .select("organization_id, is_current")
      .eq("slug", away)
      .single();
    expect(data?.organization_id).toBe(made.id);
    expect(data?.is_current).toBe(false);
  });

  // -- the rolling limit --------------------------------------------------

  it("allows three renames in a year and refuses the fourth", async () => {
    const made = await newWorkspace("limit");
    const stamp = Date.now();

    for (let n = 1; n <= 3; n += 1) {
      const { data } = await rename("owner", made.id, `limit-${stamp}-${n}`);
      expect(data, `rename ${n} should be allowed`).toBe("renamed");
    }

    const { data } = await rename("owner", made.id, `limit-${stamp}-4`);
    expect(data).toBe("rate_limited");
    expect(await currentSlug(made.id)).toBe(`limit-${stamp}-3`);
  });

  it("does not spend an allowance on a refused attempt", async () => {
    const made = await newWorkspace("no-spend");
    // Three refusals of three different kinds.
    await rename("owner", made.id, "pricing");
    await rename("owner", made.id, "Not Kebab");
    await rename("owner", made.id, made.slug);

    const { data } = await rename("owner", made.id, `still-allowed-${Date.now()}`);
    expect(data, "only successful renames count against the limit").toBe("renamed");
  });

  // -- the mirror ---------------------------------------------------------

  it("refuses a direct update of organizations.slug by an owner", async () => {
    const made = await newWorkspace("direct");
    const owner = await clientFor("owner");
    const { error } = await owner
      .from("organizations")
      .update({ slug: `direct-${Date.now()}` })
      .eq("id", made.id);

    expect(error, "the mirror must not be writable around the registry").not.toBeNull();
    expect(await currentSlug(made.id)).toBe(made.slug);
  });

  it("refuses a direct update even with the service role", async () => {
    // A trigger binds every role, which is why it is used here rather than a
    // grant: a grant would only have stopped `authenticated`.
    const made = await newWorkspace("direct-service");
    const { error } = await serviceClient()
      .from("organizations")
      .update({ slug: `service-${Date.now()}` })
      .eq("id", made.id);
    expect(error).not.toBeNull();
  });

  // -- visibility ---------------------------------------------------------

  it("shows a member their own addresses and nobody else's", async () => {
    const made = await newWorkspace("visible");
    const owner = await clientFor("owner");
    const { data } = await owner.from("workspace_slugs").select("slug, organization_id");

    expect(data?.some((row) => row.slug === made.slug)).toBe(true);
    const outsiderRows = (data ?? []).filter((row) => row.organization_id === null);
    expect(outsiderRows).toHaveLength(0);
  });

  it("shows an outsider nothing of another workspace", async () => {
    const made = await newWorkspace("hidden");
    const outsider = await clientFor("otherOrgOwner");
    const { data } = await outsider
      .from("workspace_slugs")
      .select("slug")
      .eq("organization_id", made.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("shows anonymous nothing at all", async () => {
    const { data } = await anonClient().from("workspace_slugs").select("slug");
    expect(data ?? []).toHaveLength(0);
  });

  it("refuses a write from a member", async () => {
    const made = await newWorkspace("no-write");
    const owner = await clientFor("owner");
    const { error } = await owner
      .from("workspace_slugs")
      .insert({ slug: `smuggled-${Date.now()}`, organization_id: made.id });
    expect(error, "writes go through the RPC only").not.toBeNull();
  });

  // -- purge --------------------------------------------------------------

  it("keeps a purged workspace's addresses reserved", async () => {
    const doomed = await newWorkspace("purged");
    const service = serviceClient();
    await service.rpc("purge_organization_admin", { target_org: doomed.id });
    created.delete(doomed.id);

    const { data: row } = await service
      .from("workspace_slugs")
      .select("organization_id, is_current, retired_at")
      .eq("slug", doomed.slug)
      .single();
    expect(row, "the address outlives the workspace").toBeTruthy();
    expect(row?.organization_id).toBeNull();
    expect(row?.is_current).toBe(false);

    // And nobody can pick it up.
    const mine = await newWorkspace("scavenger");
    const { data } = await rename("owner", mine.id, doomed.slug);
    expect(data).toBe("taken");
  });

  // -- the two reserved lists cannot drift --------------------------------

  it("agrees with the TypeScript reserved list", async () => {
    const { data } = await serviceClient().rpc("reserved_slugs_admin");
    expect([...((data as string[]) ?? [])].sort()).toEqual([...RESERVED_SLUGS].sort());
  });
});
