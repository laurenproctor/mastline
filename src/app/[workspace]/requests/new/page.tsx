import { AppShell } from "@/components/app-shell";
import { PageHeader, Panel } from "@/components/primitives";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { can } from "@/lib/permissions";
import { requireWorkspaceContext } from "@/lib/session-context";
import { RequestForm } from "../_components/request-form";

/**
 * Record a request somebody made by phone, text, WhatsApp, email, or standing
 * arrangement.
 *
 * The capability is checked here as well as in the Server Action. The action is
 * the boundary -- a page is only a rendering -- but a role that cannot record a
 * request should be told so before typing one out, not after.
 */
export default async function NewRequestPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: requestedWorkspace } = await params;
  const { session, organizationId, canonicalSlug } = await requireWorkspaceContext(
    requestedWorkspace,
    "request.write",
  );
  const role = session.activeWorkspace.role;
  const buyers = await listWorkspaceBuyers(organizationId);

  return (
    <AppShell active="Requests" workspace={canonicalSlug}>
      <div className="page">
        <PageHeader
          description="Write down what a buyer asked for while it is still fresh. Nothing here is sent to them."
          eyebrow="Inbound demand"
          title="Record a request"
        />

        <Panel>
          <div className="panel-body">
            <RequestForm
              buyers={buyers.map((buyer) => ({ id: buyer.id, name: buyer.name }))}
              canCreateBuyer={can(role, "buyer.write")}
              canSeeSourceNote={can(role, "sensitive_note.read")}
              workspaceSlug={canonicalSlug}
            />
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
