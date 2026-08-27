import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { mfaBlocksAccess, mfaStanding } from "./mfa";
import { displayNameFrom, initialsFrom } from "./person-name";
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
  /** Whether this workspace insists on a second factor for owners and finance. */
  readonly requireMfa: boolean;
  /**
   * Whether the caption writer drafts a caption for each frame as it is
   * imported. On by default; the draft always arrives marked unreviewed.
   */
  readonly autoCaptionOnImport: boolean;
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
  /** Whether this account holds a verified second factor. Read from the user
   *  the auth server already returned, so it costs no extra call. */
  readonly hasVerifiedFactor: boolean;
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

/** The signed-in user's workspaces, or null when not signed in. */
export const getSession = cache(async (activeWorkspaceId?: string): Promise<Session | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const hasVerifiedFactor = (user.factors ?? []).some((factor) => factor.status === "verified");

  // Filter to THIS user's rows. Row level security lets a member see every
  // membership in their workspace, so without this the query returns all of
  // them and the role is read from whichever row happens to come back first.
  const { data: memberships } = await supabase
    .from("memberships")
    .select(
      "role, status, user_id, organizations(id, name, slug, timezone, currency, plan, subscription_status, trial_ends_at, storage_limit_bytes, seat_limit, billing_period, payment_method_attached_at, past_due_since, current_period_end, cancel_at_period_end, stripe_customer_id, require_mfa, auto_caption_on_import)",
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
        require_mfa: boolean | null;
        auto_caption_on_import: boolean | null;
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
        requireMfa: org.require_mfa ?? false,
        // Defaulting to true mirrors the column: a workspace that has never
        // been asked gets the captions.
        autoCaptionOnImport: org.auto_caption_on_import ?? true,
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

  // The name is collected as two fields, so the parts are read rather than
  // guessed at. full_name is still honoured for accounts created before that.
  const metadata = user.user_metadata ?? {};
  const nameSource = {
    firstName: metadata.first_name as string | undefined,
    lastName: metadata.last_name as string | undefined,
    fullName: metadata.full_name as string | undefined,
    email: user.email,
  };
  const displayName = displayNameFrom(nameSource);

  return {
    userId: user.id,
    email: user.email ?? "",
    hasVerifiedFactor,
    displayName,
    initials: initialsFrom(nameSource),
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
  if (!session) redirect("/sign-in");
  if (!session.activeWorkspace) redirect("/onboarding");

  // A workspace that requires a second factor requires it to be there before
  // the work is, not as a suggestion on a settings screen. The enrolment page
  // deliberately does not call this, or it would send itself in a circle.
  const standing = mfaStanding({
    role: session.activeWorkspace.role,
    hasVerifiedFactor: session.hasVerifiedFactor,
    enforced: session.activeWorkspace.requireMfa,
  });
  if (mfaBlocksAccess(standing)) redirect("/secure-your-account");

  return session as WorkspaceSession;
}

/**
 * The signed-in person, and nothing about a workspace.
 *
 * Authentication and workspace selection used to be one step, which is how the
 * cookie ended up deciding both. They are separate questions: who is asking is
 * a property of the session, and which workspace they are asking about is a
 * property of the URL. Keeping them apart is what stops a cookie pointing at
 * one workspace from having any say over a request addressed to another.
 *
 * Notably this applies no two-factor gate. A workspace's MFA policy belongs to
 * that workspace, so it is evaluated by requireWorkspace once the workspace is
 * known -- never against whichever one a cookie happened to name.
 */
export async function requireUserSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

/**
 * The workspace named in the URL, or nothing at all.
 *
 * This is the complete gate for a workspace-scoped request, and the only thing
 * entitled to answer "which organization is this". It never falls back to the
 * cookie and never falls back to the first workspace in the list: a slug was
 * supplied, so either it names a workspace this person is an active member of
 * or the request has no business proceeding.
 *
 * A non-member gets 404 rather than 403. Whether a particular studio exists on
 * Mastline is not something to confirm to somebody who is not in it -- these
 * are people who are followed for a living, and their working relationships are
 * inferable from the fact of a workspace existing at all.
 *
 * The membership query is the one getSession already ran: it is filtered to the
 * caller's own active memberships, so resolving a slug costs no extra round
 * trip and cannot see past what row level security would have allowed anyway.
 */
export async function requireWorkspace(slug: string): Promise<WorkspaceSession> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.workspaces.length === 0) redirect("/onboarding");

  const workspace = session.workspaces.find((candidate) => candidate.slug === slug);
  if (!workspace) notFound();

  // Evaluated against the workspace the URL named, which is the whole point.
  // A cookie pointing at a workspace with optional two-factor must not weaken
  // a workspace that insists on it.
  const standing = mfaStanding({
    role: workspace.role,
    hasVerifiedFactor: session.hasVerifiedFactor,
    enforced: workspace.requireMfa,
  });
  if (mfaBlocksAccess(standing)) redirect("/secure-your-account");

  return { ...session, activeWorkspace: workspace };
}

/**
 * The session and its workspace, without the two-factor gate.
 *
 * Only for the enrolment path itself. `requireSession` sends anyone who owes a
 * factor to /secure-your-account, and that page is where enrolment happens, so
 * the actions it offers would each redirect themselves back to it: the screen
 * would be a dead end rather than the way out of one.
 *
 * It is not a hole in the gate. Everything reached through it acts on the
 * caller's own account and can only add a factor, never read the workspace.
 */
export async function requireSessionForEnrollment(): Promise<WorkspaceSession> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!session.activeWorkspace) redirect("/onboarding");
  return session as WorkspaceSession;
}

/** The session without requiring a workspace. For the onboarding flow itself. */
export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
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
