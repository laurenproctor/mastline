import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel } from "@/components/primitives";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { CreateShootForm } from "./shoot-form";

/**
 * Create a shoot.
 *
 * One page, one action. The brief, the photographs, the metadata they share,
 * the rights facts, and a final review all live in the form below, because
 * creating a shoot is private workspace activity and does not warrant a
 * confirmation screen. The screen that does is the dispatch review, which is
 * where a fresh human confirmation is still required before anything leaves.
 */
export default async function CreateShootPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { workspace: requestedWorkspace } = await routeParams;
  const { session, organizationId, canonicalSlug } = await workspaceContext(requestedWorkspace);
  const routes = workspaceRoutes(canonicalSlug);
  /*
   * Everything below builds on the address the workspace holds NOW, not the one
   * the request arrived on. A request may land on a retired address, and a link
   * rendered from that would send the next click back through the rename
   * redirect; a slug that was never resolved at all would be a value the
   * browser supplied, sitting in a destination.
   */
  const workspaceSlug = canonicalSlug;
  const role = session.activeWorkspace.role;

  // Onboarding ends here rather than at a simulation of here, so somebody
  // arriving for the first time gets an introduction to the real screen. The
  // import system is not duplicated -- this is a sentence, not a second path.
  const fromOnboarding = (await searchParams).source === "onboarding";

  // A role that cannot create a shoot is told so, rather than being shown a
  // form whose submit will be refused.
  if (!can(role, "shoot.write")) {
    return (
      <AppShell active="Shoots" workspace={workspaceSlug}>
        <div className="page">
          <PageHeader
            description="This role can view shoots but not create them."
            eyebrow="Not available"
            title="Create shoot"
          />
          <Panel>
            <div className="panel-body">
              <p className="section-note">
                Creating a shoot needs an owner or editor role in this workspace. Ask an owner to
                change the role, or open an existing shoot.
              </p>
              <div className="spacer" />
              <Link className="button" href={routes.shoots()}>
                Back to shoots
              </Link>
            </div>
          </Panel>
        </div>
      </AppShell>
    );
  }

  const buyers = await listWorkspaceBuyers(organizationId);

  return (
    <AppShell active="Shoots" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          description="Everything for this shoot on one page. It saves as a private draft — nothing is sent, published, or offered to a buyer."
          eyebrow={fromOnboarding ? "Your workspace is ready" : "New draft"}
          title="Create shoot"
        />

        {fromOnboarding && (
          <Panel title="This is the real thing">
            <div className="panel-body">
              <p className="section-note">
                The sample set in setup was a demonstration. This screen writes real records. Start
                with whatever you know — only a subject or event is required, and a shoot can be
                created before any file exists.
              </p>
            </div>
          </Panel>
        )}

        <Panel action={<Badge tone="neutral">Draft</Badge>} title="New shoot">
          <div className="panel-body create-shoot">
            <CreateShootForm
              workspaceSlug={workspaceSlug}
              buyers={buyers.map((buyer) => ({ id: buyer.id, name: buyer.name }))}
              canSeeSourceNote={can(role, "sensitive_note.read")}
            />
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
