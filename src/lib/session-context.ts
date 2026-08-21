import "server-only";

import { cookies } from "next/headers";
import { ACTIVE_WORKSPACE_COOKIE, type WorkspaceSession, requireSession } from "./auth";
import { type Capability, assertCan } from "./permissions";

/**
 * The active session and workspace for a Server Action or page.
 *
 * Every action starts here so that the workspace comes from the session rather
 * than from a form field. A client cannot name the organization it is writing
 * to; it can only act inside the one it is currently in.
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

/** The same, with a capability check. Throws PermissionError when refused. */
export async function requireContext(capability: Capability) {
  const context = await currentContext();
  assertCan(context.session.activeWorkspace.role, capability);
  return context;
}
