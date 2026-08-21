import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { AppRole } from "./domain";
import { type Capability, assertCan } from "./permissions";
import type { SubscriptionStatus } from "./subscription";
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
  readonly plan: string;
  readonly subscriptionStatus: SubscriptionStatus;
  readonly trialEndsAt?: string;
  readonly storageLimitBytes?: number;
  readonly seatLimit?: number;
  readonly billingPeriod?: "annual" | "monthly";
  readonly paymentMethodAttachedAt?: string;
  readonly pastDueSince?: string;
  readonly currentPeriodEnd?: string;
  readonly cancelAtPeriodEnd?: boolean;
  /** Present once this workspace has a provider customer. */
  readonly stripeCustomerId?: string;
}

export interface Session {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly initials: string;
  readonly workspaces: readonly Workspace[];
  /** Undefined for a signed-in person who has not created a workspace yet. */
  readonly activeWorkspace?: Workspace;
}

/** A session that definitely has a workspace. What application pages get. */
export interface WorkspaceSession extends Session {
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
    .select(
      "role, status, user_id, organizations(id, name, slug, timezone, currency, plan, subscription_status, trial_ends_at, storage_limit_bytes, seat_limit, billing_period, payment_method_attached_at, past_due_since, current_period_end, cancel_at_period_end, stripe_customer_id)",
    )
    .eq("user_id", user.id)
    .eq("status", "active");

  const workspaces: Workspace[] = (memberships ?? [])
    .map((row): Workspace | null => {
      const org = row.organizations as unknown as {
        id: string;
        name: string;
        slug: string;
        timezone: string;
        currency: string;
        plan: string;
        subscription_status: SubscriptionStatus;
        trial_ends_at: string | null;
        storage_limit_bytes: number | null;
        seat_limit: number | null;
        billing_period: "annual" | "monthly" | null;
        payment_method_attached_at: string | null;
        past_due_since: string | null;
        current_period_end: string | null;
        cancel_at_period_end: boolean | null;
        stripe_customer_id: string | null;
      } | null;
      if (!org) return null;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        timezone: org.timezone,
        currency: org.currency,
        role: row.role as AppRole,
        plan: org.plan,
        subscriptionStatus: org.subscription_status,
        trialEndsAt: org.trial_ends_at ?? undefined,
        storageLimitBytes:
          org.storage_limit_bytes === null ? undefined : Number(org.storage_limit_bytes),
        seatLimit: org.seat_limit === null ? undefined : Number(org.seat_limit),
        billingPeriod: org.billing_period ?? undefined,
        paymentMethodAttachedAt: org.payment_method_attached_at ?? undefined,
        pastDueSince: org.past_due_since ?? undefined,
        currentPeriodEnd: org.current_period_end ?? undefined,
        cancelAtPeriodEnd: org.cancel_at_period_end ?? undefined,
        stripeCustomerId: org.stripe_customer_id ?? undefined,
      };
    })
    .filter((workspace): workspace is Workspace => workspace !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

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
 * The session and its workspace, or a redirect.
 *
 * Two different redirects, because these are two different situations: nobody
 * is signed in, or somebody is signed in and has not created a workspace yet.
 * Sending a brand new account to the login page would be a dead end.
 *
 * Middleware already guards these routes; this is the second gate, because a
 * route that forgets to be listed in the matcher must still fail closed.
 */
export async function requireSession(activeWorkspaceId?: string): Promise<WorkspaceSession> {
  const session = await getSession(activeWorkspaceId);
  if (!session) redirect("/login");
  if (!session.activeWorkspace) redirect("/onboarding");
  return session as WorkspaceSession;
}

/** The session without requiring a workspace. For the onboarding flow itself. */
export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** The session, plus a check that the active role holds a capability. */
export async function requireCapability(
  capability: Capability,
  activeWorkspaceId?: string,
): Promise<WorkspaceSession> {
  const session = await requireSession(activeWorkspaceId);
  assertCan(session.activeWorkspace.role, capability);
  return session;
}
