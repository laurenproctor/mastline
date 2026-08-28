/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { getWorkQueueDashboard } from "../src/lib/data/work-queue";
import { workspaceRoutes } from "../src/lib/workspace-routes";
import { ORG_A, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * The work queue is the page an operator opens every morning, so its cost has
 * to be independent of how much work the workspace holds.
 *
 * This measures the shape rather than the wall clock: with N shoots the number
 * of round trips must not grow. The original queue was roughly 3 + 4N; the
 * dashboard now reads everything -- queue, recipient evidence, active shoots,
 * money -- in a fixed set of collection queries.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";

describeIf("work queue dashboard cost", () => {
  it("does not issue more queries as shoots are added", async () => {
    const service = serviceClient();
    const created: string[] = [];

    // Count PostgREST calls by wrapping fetch.
    const countQueries = async (run: () => Promise<unknown>): Promise<number> => {
      const original = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/rest/v1/")) calls += 1;
        return original(input, init);
      }) as typeof fetch;
      try {
        await run();
      } finally {
        globalThis.fetch = original;
      }
      return calls;
    };

    // The queue returns fully scoped destinations, so it is handed the
    // route builder for the workspace being read.
    const routes = workspaceRoutes("marcus-hale-studio");
    const buildDashboard = () => getWorkQueueDashboard(ORG_A, routes, service);

    /*
     * Both measurements are taken with at least one active shoot on the
     * board. The loader legitimately skips the two active-shoot lookups when
     * nothing is in progress -- that is a two-state step, not growth -- and
     * this test is about growth: N more shoots must cost nothing more.
     */
    const seedShoot = async () => {
      const { data } = await service
        .from("shoots")
        .insert({
          organization_id: ORG_A,
          title: `Cost test seed ${Date.now()}`,
          status: "preparing",
          created_by: OWNER,
        })
        .select("id")
        .single();
      created.push(data!.id as string);
    };

    await seedShoot();
    const baseline = await countQueries(buildDashboard);

    for (let index = 0; index < 5; index += 1) await seedShoot();

    const withMoreShoots = await countQueries(buildDashboard);

    // Five more shoots must not mean twenty more queries.
    expect(withMoreShoots).toBe(baseline);
    // Eight collections for the queue facts, plus recorded access events and
    // the two active-shoot preview lookups.
    expect(baseline).toBeLessThanOrEqual(12);

    for (const shootId of created) await purgeShoot(shootId);
  });
});
