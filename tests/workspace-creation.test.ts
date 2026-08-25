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

  // ---------------------------------------------------------------------
  // The onboarding profile
  //
  // Each of these signs in as somebody who owns no workspace, because the
  // idempotency guard hands an existing owner their existing workspace back.
  // Slugs keep the `idempotency-check` prefix so the teardown above sweeps them.
  // ---------------------------------------------------------------------

  it("stores the onboarding answers in typed columns", async () => {
    const finance = await clientFor("finance");
    const { data, error } = await finance.rpc("create_workspace", {
      workspace_name: "Felix Field Studio",
      workspace_slug: `idempotency-check-profile-${Date.now()}`,
      onboarding_profile: {
        work_style: "agency",
        base_city: "Los Angeles, CA",
        specialties: ["celebrity", "events"],
        goals: ["dispatch", "rights"],
        sales_engine_enabled: false,
        onboarding_version: 1,
      },
    });

    expect(error).toBeNull();
    if (typeof data === "string") created.add(data);

    const { data: org } = await serviceClient()
      .from("organizations")
      .select(
        "work_style, base_city, specialties, onboarding_goals, sales_engine_enabled, onboarding_version, onboarding_completed_at",
      )
      .eq("id", data as string)
      .single();

    expect(org?.work_style).toBe("agency");
    expect(org?.base_city).toBe("Los Angeles, CA");
    expect((org?.specialties as string[]).sort()).toEqual(["celebrity", "events"]);
    expect((org?.onboarding_goals as string[]).sort()).toEqual(["dispatch", "rights"]);
    // Off unless asked for, whatever else the profile said.
    expect(org?.sales_engine_enabled).toBe(false);
    expect(org?.onboarding_version).toBe(1);
    expect(org?.onboarding_completed_at).not.toBeNull();
  });

  it("records Sales Engine consent with its terms, and again where it cannot be edited", async () => {
    const rights = await clientFor("rights");
    const { data, error } = await rights.rpc("create_workspace", {
      workspace_name: "Rhea Rights Studio",
      workspace_slug: `idempotency-check-consent-${Date.now()}`,
      onboarding_profile: {
        work_style: "independent",
        specialties: ["news"],
        goals: ["archive"],
        sales_engine_enabled: true,
        sales_engine_terms_version: "2026-08-25",
        onboarding_version: 1,
      },
    });

    expect(error).toBeNull();
    if (typeof data === "string") created.add(data);

    const service = serviceClient();
    const { data: org } = await service
      .from("organizations")
      .select("sales_engine_enabled, sales_engine_enabled_at, sales_engine_terms_version")
      .eq("id", data as string)
      .single();

    expect(org?.sales_engine_enabled).toBe(true);
    expect(org?.sales_engine_terms_version).toBe("2026-08-25");
    expect(org?.sales_engine_enabled_at).not.toBeNull();

    // A column can be updated. The activity event cannot -- that table is
    // append-only -- so this is what still answers "agreed to what, and when".
    const { data: events } = await service
      .from("activity_events")
      .select("action, event_data")
      .eq("organization_id", data as string)
      .eq("action", "organization.sales_engine.enabled");

    expect(events).toHaveLength(1);
    expect((events?.[0]?.event_data as Record<string, unknown>).terms_version).toBe("2026-08-25");
    expect((events?.[0]?.event_data as Record<string, unknown>).source).toBe("onboarding");
  });

  it("refuses Sales Engine consent that does not say what was agreed to", async () => {
    const viewer = await clientFor("viewer");
    const { error } = await viewer.rpc("create_workspace", {
      workspace_name: "Vera Viewer Studio",
      workspace_slug: `idempotency-check-noterms-${Date.now()}`,
      onboarding_profile: { sales_engine_enabled: true, onboarding_version: 1 },
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/terms version/i);
  });

  it("refuses a specialty that is not in the vocabulary", async () => {
    const viewer = await clientFor("viewer");
    const { error } = await viewer.rpc("create_workspace", {
      workspace_name: "Vera Viewer Studio",
      workspace_slug: `idempotency-check-badset-${Date.now()}`,
      onboarding_profile: {
        specialties: ["underwater_basket_weaving"],
        onboarding_version: 1,
      },
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/organizations_specialties_check|violates check/i);
  });

  it("leaves an existing workspace's profile alone when the form is submitted twice", async () => {
    // A double click must not overwrite settings the photographer may since
    // have changed. The repeat returns the same workspace and writes nothing.
    const dispatcher = await clientFor("dispatcher");
    const slug = `idempotency-check-twice-${Date.now()}`;

    const first = await dispatcher.rpc("create_workspace", {
      workspace_name: "Dana Dispatch Studio",
      workspace_slug: slug,
      onboarding_profile: {
        work_style: "team",
        specialties: ["portraits"],
        goals: ["organize"],
        onboarding_version: 1,
      },
    });
    expect(first.error).toBeNull();
    if (typeof first.data === "string") created.add(first.data);

    const second = await dispatcher.rpc("create_workspace", {
      workspace_name: "Something Else Entirely",
      workspace_slug: `${slug}-b`,
      onboarding_profile: {
        work_style: "contributor",
        specialties: ["news"],
        goals: ["rights"],
        sales_engine_enabled: true,
        sales_engine_terms_version: "2026-08-25",
        onboarding_version: 1,
      },
    });

    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);

    const { data: org } = await serviceClient()
      .from("organizations")
      .select("name, work_style, specialties, sales_engine_enabled")
      .eq("id", first.data as string)
      .single();

    expect(org?.name).toBe("Dana Dispatch Studio");
    expect(org?.work_style).toBe("team");
    expect(org?.specialties).toEqual(["portraits"]);
    expect(org?.sales_engine_enabled).toBe(false);
  });
});
