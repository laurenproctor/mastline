/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { getWorkQueue, getWorkQueueDashboard } from "../src/lib/data/work-queue";
import { workspaceRoutes } from "../src/lib/workspace-routes";
import { ORG_A, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * The work queue is the page an operator opens every morning, so its cost has
 * to be independent of how much work the workspace holds.
 *
 * This measures the shape rather than the wall clock: with N shoots the number
 * of round trips must not grow, and it must not exceed the budget the queue
 * has always kept -- eight collection queries. The dashboard, which now
 * carries the header figures, the money strip, the active shoots, and the
 * recipient evidence as well, is held to the same eight. It used to be
 * roughly 3 + 4N.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";

/** The budget every loader on this screen is held to. */
const QUERY_BUDGET = 8;

/** Count PostgREST and storage calls by wrapping fetch. */
async function countCalls(run: () => Promise<unknown>): Promise<{ rest: number; storage: number }> {
  const original = globalThis.fetch;
  let rest = 0;
  let storage = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/rest/v1/")) rest += 1;
    if (url.includes("/storage/v1/")) storage += 1;
    return original(input, init);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return { rest, storage };
}

describeIf("work queue cost", () => {
  it("does not issue more queries as shoots are added, and stays within budget", async () => {
    const service = serviceClient();
    const created: string[] = [];

    // The queue returns fully scoped destinations, so it is handed the
    // route builder for the workspace being read.
    const routes = workspaceRoutes("marcus-hale-studio");
    const buildQueue = () => getWorkQueue(ORG_A, routes, service);
    const buildDashboard = () => getWorkQueueDashboard(ORG_A, routes, service);
    const buildDashboardWithPreviews = () =>
      getWorkQueueDashboard(ORG_A, routes, service, { previewsPerShoot: 4 });

    /*
     * Both measurements are taken with at least one open shoot on the board.
     * The loader legitimately skips the asset query when nothing is open --
     * that is a two-state step, never growth -- and this test is about
     * growth: N more shoots must cost nothing more.
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

    try {
      await seedShoot();
      const queueBefore = await countCalls(buildQueue);
      const dashboardBefore = await countCalls(buildDashboard);
      const previewsBefore = await countCalls(buildDashboardWithPreviews);

      for (let index = 0; index < 5; index += 1) await seedShoot();

      const queueAfter = await countCalls(buildQueue);
      const dashboardAfter = await countCalls(buildDashboard);
      const previewsAfter = await countCalls(buildDashboardWithPreviews);

      process.stdout.write(
        `work queue cost: queue ${queueBefore.rest} -> ${queueAfter.rest} rest; ` +
          `dashboard ${dashboardBefore.rest} -> ${dashboardAfter.rest} rest; ` +
          `dashboard+previews ${previewsBefore.rest}+${previewsBefore.storage}s -> ` +
          `${previewsAfter.rest}+${previewsAfter.storage}s\n`,
      );

      // Five more shoots must not mean twenty more queries.
      expect(queueAfter).toEqual(queueBefore);
      expect(dashboardAfter).toEqual(dashboardBefore);
      expect(previewsAfter).toEqual(previewsBefore);

      // The queue alone: seven collections. The dashboard: those plus the
      // recorded access events. Neither may exceed the budget.
      expect(queueBefore.rest).toBeLessThanOrEqual(QUERY_BUDGET);
      expect(dashboardBefore.rest).toBeLessThanOrEqual(QUERY_BUDGET);
      expect(queueBefore.storage).toBe(0);
      expect(dashboardBefore.storage).toBe(0);

      // Previews are the one thing that costs more, and they are opt-in:
      // exactly one more collection query and one storage signing call.
      expect(previewsBefore.rest).toBe(dashboardBefore.rest + 1);
      expect(previewsBefore.storage).toBeLessThanOrEqual(1);
    } finally {
      for (const shootId of created) await purgeShoot(shootId);
    }
  });
});
