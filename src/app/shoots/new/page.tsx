import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel } from "@/components/primitives";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { can } from "@/lib/permissions";
import { currentContext } from "@/lib/session-context";
import { CreateShootForm } from "./shoot-form";

export default async function CreateShootPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const { session, organizationId } = await currentContext();
  const role = session.activeWorkspace.role;

  // Onboarding ends here rather than at a simulation of here, so somebody
  // arriving for the first time gets an introduction to the real screen. The
  // import system is not duplicated -- this is a sentence, not a second path.
  const fromOnboarding = (await searchParams).source === "onboarding";

  // A role that cannot create a shoot is told so, rather than being shown a
  // form whose submit will be refused.
  if (!can(role, "shoot.write")) {
    return (
      <AppShell active="Shoots">
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
              <Link className="button" href="/shoots">
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
    <AppShell active="Shoots">
      <div className="page">
        <PageHeader
          description="Start with a brief. Facts entered here are inherited by every asset, package, and submission that follows."
          eyebrow={fromOnboarding ? "Your workspace is ready" : "New record"}
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

        <div className="panel-grid">
          <Panel action={<Badge tone="neutral">Draft</Badge>} title="Shoot brief">
            <div className="panel-body">
              <CreateShootForm
                buyers={buyers.map((buyer) => ({ id: buyer.id, name: buyer.name }))}
                canSeeSourceNote={can(role, "sensitive_note.read")}
              />
            </div>
          </Panel>

          <div className="stack">
            <Panel title="What happens next">
              <div className="panel-body">
                <ol className="next-steps">
                  <li>The shoot is created as a draft.</li>
                  <li>Import files. Each is hashed before it leaves this machine.</li>
                  <li>Originals are stored untouched; previews are separate files.</li>
                  <li>Select frames and complete captions.</li>
                  <li>Build a package for a buyer and review it before sending.</li>
                </ol>
                <p className="section-note">
                  Nothing is sent to a buyer without an explicit human confirmation.
                </p>
              </div>
            </Panel>
            <Panel title="Storage">
              <div className="panel-body">
                <Badge tone="good">Private by default</Badge>
                <p className="section-note">
                  Files go to a private bucket scoped to this workspace. Nothing is publicly
                  readable, and delivery uses short-lived signed links.
                </p>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
