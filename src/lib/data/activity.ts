import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityEvent, Id } from "../domain";
import { createClient } from "../supabase/server";

/**
 * The append-only operational record.
 *
 * Every consequential change writes one of these. The insert policy requires
 * actor_id to equal the caller, so a member cannot log an action as someone
 * else, and the table has no update or delete grant.
 *
 * Recording an event must never break the mutation that caused it: the write
 * has already happened by the time we get here, so a logging failure is
 * surfaced as a warning rather than thrown.
 */
export async function recordEvent(input: {
  organizationId: Id;
  actorId: Id;
  entityType: string;
  entityId?: Id;
  action: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  return recordEventWith(await createClient(), input);
}

/** The same, against a client the caller already holds. */
export async function recordEventWith(
  supabase: SupabaseClient,
  input: {
    organizationId: Id;
    actorId: Id;
    entityType: string;
    entityId?: Id;
    action: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("activity_events").insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    action: input.action,
    event_data: input.data ?? {},
  });

  if (error) {
    console.warn(`Could not record ${input.action} on ${input.entityType}: ${error.message}`);
  }
}

export async function listActivity(
  organizationId: Id,
  filter: { entityId?: Id; entityType?: string; limit?: number } = {},
): Promise<readonly ActivityEvent[]> {
  const supabase = await createClient();
  let query = supabase
    .from("activity_events")
    .select("id, organization_id, actor_id, entity_type, entity_id, action, event_data, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 20);

  if (filter.entityId) query = query.eq("entity_id", filter.entityId);
  if (filter.entityType) query = query.eq("entity_type", filter.entityType);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load activity: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    organizationId: row.organization_id as string,
    actorId: (row.actor_id as string | null) ?? undefined,
    entityType: row.entity_type as string,
    entityId: (row.entity_id as string | null) ?? undefined,
    action: row.action as string,
    summary:
      ((row.event_data as Record<string, unknown> | null)?.summary as string | undefined) ??
      humanizeAction(row.action as string),
    createdAt: row.created_at as string,
  }));
}

/** Turn "submission.sent" into "Submission sent" for a timeline entry. */
function humanizeAction(action: string): string {
  const [entity, verb] = action.split(".");
  const words = `${entity} ${verb ?? ""}`.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
