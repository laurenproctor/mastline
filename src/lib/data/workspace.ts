import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole, Buyer, Id } from "../domain";
import { displayNameFrom, initialsFrom } from "../person-name";
import { createClient } from "../supabase/server";
import { getProfiles, signAvatarUrls } from "./profiles";

/**
 * Real, database-backed workspace queries.
 *
 * These replace the equivalents in src/lib/mock/queries.ts. Business records
 * (shoots, assets, submissions, money) stay on the mock layer until Phase 2, so
 * this file only covers what tenancy and auth own.
 *
 * Every query is organization-scoped in SQL as well as by row level security.
 * The explicit filter is not the protection; it keeps the intent visible and
 * the query planner honest.
 */

export interface WorkspaceMember {
  readonly userId: Id;
  readonly displayName: string;
  readonly email: string;
  readonly initials: string;
  /** A short-lived signed URL, when this person has set a photo. */
  readonly avatarUrl?: string;
  readonly role: AppRole;
  readonly status: "invited" | "active" | "suspended";
}

export async function listWorkspaceMembers(
  organizationId: Id,
): Promise<readonly WorkspaceMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, status")
    .eq("organization_id", organizationId)
    .order("role");

  if (error) throw new Error(`Could not load workspace members: ${error.message}`);

  const rows = data ?? [];
  const userIds = rows.map((row) => row.user_id as string);

  // Identities come from public.profiles, which row level security limits to
  // people the caller shares a workspace with. Both lookups are batched: one
  // select for every profile and one signing call for every face.
  const profiles = await getProfiles(userIds, supabase);
  const avatars = await signAvatarUrls(
    [...profiles.values()].flatMap((profile) => (profile.avatarPath ? [profile.avatarPath] : [])),
    supabase,
  );

  return rows.map((row) => {
    const userId = row.user_id as string;
    const profile = profiles.get(userId);
    const nameSource = {
      firstName: profile?.firstName,
      lastName: profile?.lastName,
      email: profile?.email,
    };

    return {
      userId,
      // A profile row that is somehow missing leaves the id as the handle it
      // always was, rather than an empty cell where a colleague should be.
      displayName: profile ? displayNameFrom(nameSource) : userId.slice(0, 8),
      email: profile?.email ?? "",
      initials: profile ? initialsFrom(nameSource) : userId.slice(0, 2).toUpperCase(),
      avatarUrl: profile?.avatarPath ? avatars.get(profile.avatarPath) : undefined,
      role: row.role as AppRole,
      status: row.status as WorkspaceMember["status"],
    };
  });
}

export interface WorkspaceBuyer extends Buyer {
  readonly defaultRestrictions?: string;
  readonly paymentTermsDays?: number;
}

export async function listWorkspaceBuyers(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<readonly WorkspaceBuyer[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("buyers")
    .select(
      "id, organization_id, name, buyer_type, contact_name, default_terms, delivery_profile, default_delivery_method, default_restrictions, payment_terms_days",
    )
    .eq("organization_id", organizationId)
    .order("name");

  if (error) throw new Error(`Could not load buyers: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    organizationId: row.organization_id as string,
    name: row.name as string,
    buyerType: row.buyer_type as Buyer["buyerType"],
    contactName: (row.contact_name as string | null) ?? undefined,
    defaultTerms: (row.default_terms as string | null) ?? undefined,
    deliveryProfile:
      (row.default_delivery_method as string | null) ??
      ((row.delivery_profile as Record<string, unknown> | null)?.profile as string | undefined) ??
      ((row.delivery_profile as Record<string, unknown> | null)?.method as string | undefined),
    defaultRestrictions: (row.default_restrictions as string | null) ?? undefined,
    paymentTermsDays: (row.payment_terms_days as number | null) ?? undefined,
  }));
}

/** Counts used by the settings screen to describe the workspace at a glance. */
export async function getWorkspaceCounts(organizationId: Id): Promise<{
  shoots: number;
  assets: number;
  submissions: number;
}> {
  const supabase = await createClient();

  const [shoots, assets, submissions] = await Promise.all([
    supabase
      .from("shoots")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabase
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
  ]);

  return {
    shoots: shoots.count ?? 0,
    assets: assets.count ?? 0,
    submissions: submissions.count ?? 0,
  };
}
