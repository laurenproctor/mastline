import "server-only";

import type { AppRole, Buyer, Id } from "../domain";
import { createClient } from "../supabase/server";

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

  // auth.users is not exposed through the Data API, so identities are resolved
  // from the membership rows we can see. A later phase adds a profiles table;
  // until then the id is the stable handle and the label is derived.
  return (data ?? []).map((row) => {
    const userId = row.user_id as string;
    const handle = userId.slice(0, 8);
    return {
      userId,
      displayName: handle,
      email: "",
      initials: handle.slice(0, 2).toUpperCase(),
      role: row.role as AppRole,
      status: row.status as WorkspaceMember["status"],
    };
  });
}

export async function listWorkspaceBuyers(organizationId: Id): Promise<readonly Buyer[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("buyers")
    .select("id, organization_id, name, buyer_type, contact_name, default_terms, delivery_profile")
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
      ((row.delivery_profile as Record<string, unknown> | null)?.profile as string | undefined) ??
      ((row.delivery_profile as Record<string, unknown> | null)?.method as string | undefined),
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
