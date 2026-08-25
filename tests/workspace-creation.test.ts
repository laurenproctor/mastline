/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { anonClient, clientFor, hasLocalSupabase, serviceClient } from "./helpers/supabase";

/**
 * Creating a workspace, twice.
 *
 * The onboarding page redirects anyone who already has a workspace, which
 * covers the ordinary path and loses to a race: a double click, a slow network,
 * a back button re-post. Before this was guarded in the database, two calls made
 * two workspaces and two 30-day trials.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

/** Anything this test creates, removed however it ends. */
const created = new Set<string>();

describeIf("create_workspace", () => {
  afterAll(async () => {
    // Leaving a workspace behind would give the next run a different starting
    // point, and these tests assert on counts.
    // A plain delete is refused: activity events are append-only, and removing
    // a workspace cascades into them. purge_organization_admin is the audited
    // way through, and it already exists for account closure.
    const service = serviceClient();
    const { data: strays } = await service
      .from("organizations")
      .select("id")
      .like("slug", "idempotency-check%");
    for (const id of [...created, ...(strays ?? []).map((row) => row.id as string)]) {
      await service.rpc("purge_organization_admin", { target_org: id });
    }
  });

  it("returns the workspace the caller already owns rather than making another", async () => {
    const owner = await clientFor("owner");
    const service = serviceClient();

    const { count: before } = await service
      .from("organizations")
      .select("id", { count: "exact", head: true });

    const first = await owner.rpc("create_workspace", {
      workspace_name: "Idempotency Check",
      workspace_slug: "idempotency-check-a",
    });
    const second = await owner.rpc("create_workspace", {
      workspace_name: "Idempotency Check",
      workspace_slug: "idempotency-check-b",
    });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);

    const { count: after } = await service
      .from("organizations")
      .select("id", { count: "exact", head: true });
    expect(after).toBe(before);
  });

  it("does not mint a second trial", async () => {
    // The reason the guard exists: every extra workspace was another 30 days of
    // Pro, which is the abuse docs/DECISIONS.md item 1 is still open about.
    // Counted around the calls rather than globally, because the seed has a
    // workspace on trial of its own.
    const owner = await clientFor("owner");
    const service = serviceClient();
    const trialing = async () =>
      (
        await service
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .eq("subscription_status", "trialing")
      ).count ?? 0;

    const before = await trialing();
    await owner.rpc("create_workspace", {
      workspace_name: "Idempotency Check",
      workspace_slug: "idempotency-check-trial",
    });
    expect(await trialing()).toBe(before);
  });

  it("still lets somebody with no workspace of their own create one", async () => {
    // An editor invited into another photographer's studio has a membership but
    // not a workspace. Handing them their employer's would be wrong.
    const editor = await clientFor("editor");
    const { data, error } = await editor.rpc("create_workspace", {
      workspace_name: "Editor Own Studio",
      workspace_slug: `idempotency-check-editor-${Date.now()}`,
    });

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    if (typeof data === "string") created.add(data);

    const service = serviceClient();
    const { data: org } = await service
      .from("organizations")
      .select("name")
      .eq("id", data as string)
      .single();
    expect(org?.name).toBe("Editor Own Studio");
  });

  it("refuses an empty name", async () => {
    const owner = await clientFor("owner");
    const { error } = await owner.rpc("create_workspace", {
      workspace_name: "   ",
      workspace_slug: "idempotency-check-blank",
    });
    expect(error?.message ?? "").toMatch(/needs a name/i);
  });

  it("refuses a caller with no session", async () => {
    const { error } = await anonClient().rpc("create_workspace", {
      workspace_name: "Anonymous Studio",
      workspace_slug: "idempotency-check-anon",
    });
    expect(error).not.toBeNull();
  });
});
