import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id, Shoot, ShootStatus } from "../domain";
import type { ShootBriefInput } from "../validation";
import { createClient } from "../supabase/server";
import { isRecordId } from "../validation";
import { recordEvent, recordEventWith } from "./activity";

/**
 * Shoots, read and written against the database.
 *
 * Queries are filtered by organization_id in addition to relying on row level
 * security. The filter is not the protection; it keeps the intent legible and
 * lets the planner use the composite indexes.
 */

const SHOOT_COLUMNS =
  "id, organization_id, opportunity_id, title, story_angle, status, priority, starts_at, ends_at, timezone, location_name, assignment_label, target_buyers, exclusivity, embargo_until, sensitive_content, notes, created_at, updated_at";

interface ShootRow {
  id: string;
  organization_id: string;
  title: string;
  story_angle: string | null;
  status: string;
  priority: string;
  starts_at: string | null;
  ends_at: string | null;
  location_name: string | null;
  assignment_label: string | null;
  target_buyers: unknown;
  exclusivity: string | null;
  embargo_until: string | null;
  sensitive_content: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toShoot(row: ShootRow, hasSensitiveNote: boolean): Shoot {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    storyAngle: row.story_angle ?? undefined,
    status: row.status as ShootStatus,
    priority: row.priority as Shoot["priority"],
    startsAt: row.starts_at ?? undefined,
    locationName: row.location_name ?? undefined,
    assignmentLabel: row.assignment_label ?? undefined,
    targetBuyerIds: Array.isArray(row.target_buyers) ? (row.target_buyers as string[]) : [],
    exclusivity: row.exclusivity ?? undefined,
    embargoUntil: row.embargo_until ?? undefined,
    sensitiveContent: row.sensitive_content,
    hasSensitiveNote,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Which shoots carry a confidential note.
 *
 * Only owners and editors can read the notes table, so for everyone else this
 * returns an empty set and the interface simply does not mention that a note
 * exists. Absence of the flag is not evidence of absence of a note.
 */
async function sensitiveNoteShootIds(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<Set<string>> {
  const supabase = client ?? (await createClient());
  const { data } = await supabase
    .from("shoot_sensitive_notes")
    .select("shoot_id")
    .eq("organization_id", organizationId);
  return new Set((data ?? []).map((row) => row.shoot_id as string));
}

export async function listShoots(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<readonly Shoot[]> {
  const supabase = client ?? (await createClient());
  const [{ data, error }, noteIds] = await Promise.all([
    supabase
      .from("shoots")
      .select(SHOOT_COLUMNS)
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false }),
    sensitiveNoteShootIds(organizationId, supabase),
  ]);

  if (error) throw new Error(`Could not load shoots: ${error.message}`);
  return (data ?? []).map((row) => toShoot(row as unknown as ShootRow, noteIds.has(row.id)));
}

export async function getShoot(
  organizationId: Id,
  shootId: Id,
  // The metadata worker runs with no cookies to build a client from, so it
  // hands its own in. Everything else omits this and gets the caller-scoped
  // client it always got.
  client?: SupabaseClient,
): Promise<Shoot | null> {
  // A malformed id is "no such record", not a database error.
  if (!isRecordId(shootId)) return null;

  const supabase = client ?? (await createClient());
  const [{ data, error }, noteIds] = await Promise.all([
    supabase
      .from("shoots")
      .select(SHOOT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", shootId)
      .maybeSingle(),
    sensitiveNoteShootIds(organizationId, supabase),
  ]);

  if (error) throw new Error(`Could not load shoot: ${error.message}`);
  if (!data) return null;
  return toShoot(data as unknown as ShootRow, noteIds.has(data.id));
}

export interface SensitiveNote {
  readonly sourceNote?: string;
  readonly confidentialLocation?: string;
  readonly confidentialIdentity?: string;
}

/** Returns null when the caller's role cannot read source material. */
export async function getSensitiveNote(
  organizationId: Id,
  shootId: Id,
): Promise<SensitiveNote | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shoot_sensitive_notes")
    .select("source_note, confidential_location, confidential_identity")
    .eq("organization_id", organizationId)
    .eq("shoot_id", shootId)
    .maybeSingle();

  if (!data) return null;
  return {
    sourceNote: (data.source_note as string | null) ?? undefined,
    confidentialLocation: (data.confidential_location as string | null) ?? undefined,
    confidentialIdentity: (data.confidential_identity as string | null) ?? undefined,
  };
}

/**
 * A shoot this actor already created with this form token, if there is one.
 *
 * The creation page mints one token per form and sends it with every attempt,
 * so a double click, a retried request, or a back-button re-post finds the
 * shoot the first attempt made instead of making a second one. There is no
 * table for this: `shoot.created` is already written to the append-only
 * activity record, so the token rides in its event data and this reads it back.
 *
 * Scoped to the actor as well as the organization, because two people briefing
 * two shoots is not a repeat submission however the tokens happen to fall.
 *
 * This is a check before an insert, so two genuinely simultaneous submissions
 * could still both miss. The disabled button is what makes that vanishingly
 * unlikely; this covers everything slower than a race.
 *
 * `client_token` is this screen's namespace alone. The News Radar shoot
 * handoff also writes a `shoot.created` event, but records its idempotency
 * key as `request_key` (see handoff_shoot_draft in the news_radar_handoffs
 * migration) precisely so it can never satisfy this lookup.
 */
export async function shootCreatedWithToken(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  clientToken: string;
}): Promise<Id | null> {
  const { organizationId, actorId, clientToken } = input;
  if (!clientToken) return null;

  const supabase = input.client ?? (await createClient());
  const { data } = await supabase
    .from("activity_events")
    .select("entity_id")
    .eq("organization_id", organizationId)
    .eq("actor_id", actorId)
    .eq("action", "shoot.created")
    .eq("event_data->>client_token", clientToken)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.entity_id as string | undefined) ?? null;
}

/**
 * Create a shoot from a brief.
 *
 * A shoot starts in `draft` and needs no files: the brief often exists before
 * anyone has left the house. It also STAYS in `draft` when files arrive with
 * it, because a draft is what the creation page promises -- private, editable,
 * and sent nowhere. `preparing` is what importing into an existing shoot moves
 * it to, and dispatch is a separate gate again.
 *
 * The confidential note is written to its own table so that finance and
 * dispatch roles never see it.
 */
export async function createShoot(input: {
  /** The caller's client, when they already hold one. See createPackageFromSelection. */
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  brief: ShootBriefInput;
  /** Idempotency key from the creation form. See shootCreatedWithToken. */
  clientToken?: string;
}): Promise<{ id: Id }> {
  const { organizationId, actorId, brief, clientToken } = input;
  const supabase = input.client ?? (await createClient());

  const { data, error } = await supabase
    .from("shoots")
    .insert({
      organization_id: organizationId,
      title: brief.title,
      story_angle: brief.storyAngle ?? null,
      status: "draft",
      priority: brief.priority,
      starts_at: brief.startsAt ?? null,
      ends_at: brief.endsAt ?? null,
      location_name: brief.locationName ?? null,
      assignment_label: brief.assignmentLabel ?? null,
      target_buyers: brief.targetBuyerIds,
      exclusivity: brief.exclusivity ?? null,
      embargo_until: brief.embargoUntil ?? null,
      sensitive_content: brief.sensitiveContent,
      notes: brief.notes ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Could not create the shoot: ${error?.message}`);
  const shootId = data.id as string;

  if (brief.sourceNote || brief.confidentialLocation) {
    const { error: noteError } = await supabase.from("shoot_sensitive_notes").insert({
      shoot_id: shootId,
      organization_id: organizationId,
      source_note: brief.sourceNote ?? null,
      confidential_location: brief.confidentialLocation ?? null,
      created_by: actorId,
    });
    if (noteError) {
      throw new Error(`The shoot was created but the source note was not: ${noteError.message}`);
    }
  }

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "shoot",
    entityId: shootId,
    action: "shoot.created",
    data: {
      summary: `Shoot created: ${brief.title}`,
      ...(clientToken ? { client_token: clientToken } : {}),
    },
  });

  return { id: shootId };
}

export async function updateShootBrief(input: {
  organizationId: Id;
  actorId: Id;
  shootId: Id;
  brief: ShootBriefInput;
}): Promise<void> {
  const { organizationId, actorId, shootId, brief } = input;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("shoots")
    .update({
      title: brief.title,
      story_angle: brief.storyAngle ?? null,
      priority: brief.priority,
      starts_at: brief.startsAt ?? null,
      ends_at: brief.endsAt ?? null,
      location_name: brief.locationName ?? null,
      assignment_label: brief.assignmentLabel ?? null,
      target_buyers: brief.targetBuyerIds,
      exclusivity: brief.exclusivity ?? null,
      embargo_until: brief.embargoUntil ?? null,
      sensitive_content: brief.sensitiveContent,
      notes: brief.notes ?? null,
    })
    .eq("organization_id", organizationId)
    .eq("id", shootId)
    .select("id");

  if (error) throw new Error(`Could not update the shoot: ${error.message}`);
  if (!data || data.length === 0) throw new Error("That shoot could not be updated.");

  await recordEvent({
    organizationId,
    actorId,
    entityType: "shoot",
    entityId: shootId,
    action: "shoot.brief_updated",
    data: { summary: "Shoot brief updated" },
  });
}

export async function setShootStatus(input: {
  organizationId: Id;
  actorId: Id;
  shootId: Id;
  status: ShootStatus;
}): Promise<void> {
  const { organizationId, actorId, shootId, status } = input;
  const supabase = await createClient();

  const { error } = await supabase
    .from("shoots")
    .update({ status })
    .eq("organization_id", organizationId)
    .eq("id", shootId);

  if (error) throw new Error(`Could not change the shoot status: ${error.message}`);

  await recordEvent({
    organizationId,
    actorId,
    entityType: "shoot",
    entityId: shootId,
    action: "shoot.status_changed",
    data: { summary: `Shoot moved to ${status.replace(/_/g, " ")}`, status },
  });
}
