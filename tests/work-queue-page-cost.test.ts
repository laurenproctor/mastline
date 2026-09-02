/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { getWorkQueueDashboard } from "../src/lib/data/work-queue";
import { loadWorkQueuePage } from "../src/lib/data/work-queue-page";
import { workspaceRoutes } from "../src/lib/workspace-routes";
import { ORG_A, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * The whole Work Queue page costs ten round trips: the nine-call dashboard,
 * which this must not widen, plus one for the recent activity feed. The
 * number is the same however many shoots the workspace holds, and there is
 * no storage call because the page does not ask for previews.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
// Nine since buyer requests joined the queue facts: inbound demand is one
// more collection on the same load, never a query per request.
const DASHBOARD_BUDGET = 9;
const PAGE_BUDGET = DASHBOARD_BUDGET + 1;

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

describeIf("work queue page cost", () => {
  it("is ten round trips -- the nine-call dashboard plus recent activity -- however many shoots exist", async () => {
    const service = serviceClient();
    const routes = workspaceRoutes("marcus-hale-studio");
    const created: string[] = [];

    const seedShoot = async () => {
      const { data } = await service
        .from("shoots")
        .insert({
          organization_id: ORG_A,
          title: `Page cost seed ${Date.now()}`,
          status: "preparing",
          created_by: OWNER,
        })
        .select("id")
        .single();
      created.push(data!.id as string);
    };

    try {
      await seedShoot();
      const dashboardBefore = await countCalls(() => getWorkQueueDashboard(ORG_A, routes, service));
      const pageBefore = await countCalls(() => loadWorkQueuePage(ORG_A, routes, service));

      for (let index = 0; index < 5; index += 1) await seedShoot();

      const dashboardAfter = await countCalls(() => getWorkQueueDashboard(ORG_A, routes, service));
      const pageAfter = await countCalls(() => loadWorkQueuePage(ORG_A, routes, service));

      process.stdout.write(
        `work queue page cost: dashboard ${dashboardBefore.rest} -> ${dashboardAfter.rest}; ` +
          `page ${pageBefore.rest}+${pageBefore.storage}s -> ${pageAfter.rest}+${pageAfter.storage}s\n`,
      );

      expect(dashboardAfter).toEqual(dashboardBefore);
      expect(pageAfter).toEqual(pageBefore);
      expect(dashboardBefore.rest).toBeLessThanOrEqual(DASHBOARD_BUDGET);
      // Exactly one more than the dashboard, and never more than ten.
      expect(pageBefore.rest).toBe(dashboardBefore.rest + 1);
      expect(pageBefore.rest).toBeLessThanOrEqual(PAGE_BUDGET);
      expect(pageBefore.storage).toBe(0);
    } finally {
      for (const shootId of created) await purgeShoot(shootId);
    }
  });
});
