import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { AppRole } from "./domain";
import { type Capability, assertCan } from "./permissions";
import { createClient } from "./supabase/server";

/**
 * Session and workspace resolution.
 *
 * Role truth is read from memberships on every request, never from a JWT claim
 * or user metadata, both of which a user can influence. `cache` deduplicates
 * the lookup within a single render pass.
 */

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly currency: string;
  readonly role: AppRole;
}

export interface Session {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly initials: string;
  readonly workspaces: readonly Workspace[];
  readonly activeWorkspace: Workspace;
}

export const ACTIVE_WORKSPACE_COOKIE = "mastline-workspace";

function initialsFrom(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0] ?? "");
  return (letters.join("") || source.slice(0, 2)).toUpperCase();
}

/** The signed-in user's workspaces, or null when not signed in. */
export const getSession = cache(async (activeWorkspaceId?: string): Promise<Session | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Filter to THIS user's rows. Row level security lets a member see every
  // membership in their workspace, so without this the query returns all of
  // them and the role is read from whichever row happens to come back first.
  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, status, user_id, organizations(id, name, slug, timezone, currency)")
    .eq("user_id", user.id)
    .eq("status", "active");

  const workspaces: Workspace[] = (memberships ?? [])
    .map((row) => {
      const org = row.organizations as unknown as {
        id: string;
        name: string;
        slug: string;
        timezone: string;
        currency: string;
      } | null;
      if (!org) return null;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        timezone: org.timezone,
        currency: org.currency,
        role: row.role as AppRole,
      };
    })
    .filter((workspace): workspace is Workspace => workspace !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (workspaces.length === 0) return null;

  const active =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email?.split("@")[0] ?? "Member";

  return {
    userId: user.id,
    email: user.email ?? "",
    displayName,
    initials: initialsFrom(displayName, user.email ?? ""),
    workspaces,
    activeWorkspace: active,
  };
});

/**
 * The session, or a redirect to sign in.
 *
 * Middleware already guards these routes; this is the second gate, because a
 * route that forgets to be listed in the matcher must still fail closed.
 */
export async function requireSession(activeWorkspaceId?: string): Promise<Session> {
  const session = await getSession(activeWorkspaceId);
  if (!session) redirect("/login");
  return session;
}

/** The session, plus a check that the active role holds a capability. */
export async function requireCapability(
  capability: Capability,
  activeWorkspaceId?: string,
): Promise<Session> {
  const session = await requireSession(activeWorkspaceId);
  assertCan(session.activeWorkspace.role, capability);
  return session;
}
