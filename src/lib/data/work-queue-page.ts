import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityEvent, Id } from "../domain";
import { listActivity } from "./activity";
import { type WorkQueueDashboard, getWorkQueueDashboard } from "./work-queue";
import type { WorkspaceRoutes } from "../workspace-routes";

/** How many recorded events the Recent activity panel shows. */
export const RECENT_ACTIVITY_LIMIT = 6;

export interface WorkQueuePageData {
  readonly dashboard: WorkQueueDashboard;
  readonly activity: readonly ActivityEvent[];
}

/**
 * Everything the Work Queue page renders, in nine round trips whatever the
 * workspace holds: the eight of `getWorkQueueDashboard` -- which is not
 * widened for this -- plus one for the recent activity feed, which reads the
 * append-only event log the dashboard has no reason to carry. The two run
 * side by side. Previews are not requested: they would be a tenth call and a
 * storage signing, and the screen does not show them.
 */
export async function loadWorkQueuePage(
  organizationId: Id,
  routes: WorkspaceRoutes,
  client?: SupabaseClient,
): Promise<WorkQueuePageData> {
  const [dashboard, activity] = await Promise.all([
    getWorkQueueDashboard(organizationId, routes, client),
    listActivity(organizationId, { limit: RECENT_ACTIVITY_LIMIT }, client),
  ]);
  return { dashboard, activity };
}
