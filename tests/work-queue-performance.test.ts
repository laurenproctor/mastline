/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { getWorkQueue } from "../src/lib/data/work-queue";
import { workspaceRoutes } from "../src/lib/workspace-routes";
import { ORG_A, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * The work queue is the page an operator opens every morning, so its cost has
 * to be independent of how much work the workspace holds.
 *
 * This measures the shape rather than the wall clock: with N shoots the number
 * of round trips must not grow. It used to be roughly 3 + 4N.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";

describeIf("work queue cost", () => {
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

    // The queue now returns fully scoped destinations, so it is handed the
    // route builder for the workspace being read.
    const routes = workspaceRoutes("marcus-hale-studio");
    const buildQueue = () => getWorkQueue(ORG_A, routes, service);

    const baseline = await countQueries(buildQueue);

    for (let index = 0; index < 5; index += 1) {
      const { data } = await service
        .from("shoots")
        .insert({
          organization_id: ORG_A,
          title: `Cost test ${index} ${Date.now()}`,
          status: "preparing",
          created_by: OWNER,
        })
        .select("id")
        .single();
      created.push(data!.id as string);
    }

    const withMoreShoots = await countQueries(buildQueue);

    // Five more shoots must not mean twenty more queries.
    expect(withMoreShoots).toBe(baseline);
    // Five collections plus the package members lookup.
    expect(baseline).toBeLessThanOrEqual(8);

    for (const shootId of created) await purgeShoot(shootId);
  });
});
