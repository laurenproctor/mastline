import "server-only";

import { cookies } from "next/headers";
import {
  ACTIVE_WORKSPACE_COOKIE,
  type Session,
  type Workspace,
  type WorkspaceSession,
  requireSession,
  requireUserSession,
  requireWorkspace,
} from "./auth";
import { type Capability, assertCan } from "./permissions";
import { chooseLandingWorkspace } from "./workspace-landing";

/**
 * Which workspace a page or Server Action is acting inside.
 *
 * This module answered that from a cookie, and a cookie is global to the
 * browser. Two workspaces open in two tabs therefore shared one answer:
 * whichever was switched to last won, and the other tab went on rendering one
 * workspace while its forms wrote to another. A cross-tenant write that nobody
 * watches happen is close to the worst thing this product could do, and it was
 * reachable by opening a second tab.
 *
 * The fix is to take the workspace from the URL, where it is per-request rather
 * than per-browser. That is what `workspaceContext` below does, and it is what
 * every page and action is being moved onto, one file at a time.
 *
 * Until that move is finished both APIs exist:
 *
 *   workspaceContext(slug) / requireWorkspaceContext(slug, capability)
 *     The destination. The slug is required, so a call site that has not been
 *     told which workspace it is in cannot compile.
 *
 *   currentContext() / requireContext(capability)
 *     What is there today, unchanged and cookie-derived. Every remaining use is
 *     a place where two tabs can still disagree, so `grep currentContext` and
 *     `grep requireContext` are the checklist for finishing the job. Nothing new
 *     should call them, and neither should outlive the migration.
 */

/**
 * The resolved workspace, and the values that are safe to build on.
 *
 * `canonicalSlug` is not necessarily the slug that was passed in. A request may
 * arrive on an address the workspace used to hold, and everything written back
 * -- redirects, links, revalidatePath -- has to use the address it holds now,
 * or the next click starts the redirect over again.
 */
export interface WorkspaceContext {
  readonly session: WorkspaceSession;
  readonly workspace: Workspace;
  readonly organizationId: string;
  readonly actorId: string;
  readonly canonicalSlug: string;
}

/**
 * The context for a workspace-scoped page or action.
 *
 * The slug is a hint until this returns. A Server Action receives it bound at
 * render time, where it may since have gone stale, and a request carries
 * whatever somebody typed -- so it is only ever used to look a workspace up.
 * Membership is what decides, and a slug naming a workspace the caller is not
 * an active member of is a 404.
 */
export async function workspaceContext(slug: string): Promise<WorkspaceContext> {
  const session = await requireWorkspace(slug);
  return {
    session,
    workspace: session.activeWorkspace,
    organizationId: session.activeWorkspace.id,
    actorId: session.userId,
    canonicalSlug: session.activeWorkspace.slug,
  };
}

/** The same, with a capability check against that workspace's role. */
export async function requireWorkspaceContext(
  slug: string,
  capability: Capability,
): Promise<WorkspaceContext> {
  const context = await workspaceContext(slug);
  assertCan(context.workspace.role, capability);
  return context;
}

/**
 * The workspace to send somebody to when the address did not name one.
 *
 * This is the only function permitted to read the active-workspace cookie for
 * routing, and it reads it as a preference rather than as an authorization
 * input: whatever it says is checked against live membership before it is used,
 * so a stale or forged value selects nothing rather than granting anything.
 *
 * The cookie holds a workspace id rather than a slug, so it survives a rename --
 * the address can change underneath it without the hint going stale.
 *
 * Outcomes, in the order they are tried:
 *
 *   - the cookie names a workspace they are still an active member of
 *   - no usable cookie and exactly one membership: that one, unambiguously
 *   - no usable cookie and several: nothing, because silently picking between
 *     somebody's studios is how the two-tab bug felt in the first place
 *   - no memberships at all: nothing, and the caller sends them to onboarding
 */
export interface LandingWorkspace {
  readonly outcome: "resolved" | "ambiguous" | "none";
  readonly slug?: string;
  readonly workspaces: readonly Workspace[];
}

export async function landingWorkspace(session?: Session): Promise<LandingWorkspace> {
  const resolved = session ?? (await requireUserSession());
  const { workspaces } = resolved;

  const cookieStore = await cookies();
  const choice = chooseLandingWorkspace(workspaces, cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value);

  return choice.outcome === "resolved"
    ? { outcome: "resolved", slug: choice.workspace.slug, workspaces }
    : { outcome: choice.outcome, workspaces };
}

/**
 * @deprecated Cookie-derived, and therefore shared between tabs. Move the call
 * site to `workspaceContext(slug)`, which takes its workspace from the URL.
 */
export async function currentContext(): Promise<{
  session: WorkspaceSession;
  organizationId: string;
  actorId: string;
}> {
  const cookieStore = await cookies();
  const session = await requireSession(cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value);
  return {
    session,
    organizationId: session.activeWorkspace.id,
    actorId: session.userId,
  };
}

/**
 * @deprecated Cookie-derived. Move the call site to
 * `requireWorkspaceContext(slug, capability)`.
 */
export async function requireContext(capability: Capability) {
  const context = await currentContext();
  assertCan(context.session.activeWorkspace.role, capability);
  return context;
}
