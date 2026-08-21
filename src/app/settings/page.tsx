import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel, PendingButton } from "@/components/primitives";
import { ACTIVE_WORKSPACE_COOKIE, requireSession } from "@/lib/auth";
import { humanizeStatus } from "@/lib/format";
import { can } from "@/lib/permissions";
import {
  getWorkspaceCounts,
  listWorkspaceBuyers,
  listWorkspaceMembers,
} from "@/lib/data/workspace";

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: "All workspace control",
  editor: "Shoots, assets, captions, dispatch preparation",
  dispatcher: "Package delivery and status",
  finance: "Revenue, payments, statements, exports",
  rights_reviewer: "Evidence, license checks, case routing",
  viewer: "Read-only, no sensitive access",
};

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const session = await requireSession(cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value);
  const workspace = session.activeWorkspace;

  const [members, buyers, counts] = await Promise.all([
    listWorkspaceMembers(workspace.id),
    listWorkspaceBuyers(workspace.id),
    getWorkspaceCounts(workspace.id),
  ]);

  const mayInvite = can(workspace.role, "member.invite");

  return (
    <AppShell active="Settings">
      <div className="page">
        <PageHeader
          description="People, roles, delivery profiles, buyers, storage, exports, and security."
          eyebrow="Workspace control"
          title="Settings"
        />

        <div className="three-col">
          <Panel title="Workspace">
            <div className="panel-body">
              <h3>{workspace.name}</h3>
              <p className="section-note">
                {workspace.timezone} · {workspace.currency} · you are{" "}
                {humanizeStatus(workspace.role)}
              </p>
              <dl className="pulse-list">
                <div>
                  <dt>Shoots</dt>
                  <dd>{counts.shoots}</dd>
                </div>
                <div>
                  <dt>Assets</dt>
                  <dd>{counts.assets}</dd>
                </div>
                <div>
                  <dt>Submissions</dt>
                  <dd>{counts.submissions}</dd>
                </div>
              </dl>
              {can(workspace.role, "workspace.settings") && (
                <PendingButton small>Edit workspace</PendingButton>
              )}
            </div>
          </Panel>

          <Panel
            action={<span className="muted">{members.length} people</span>}
            title="People & permissions"
          >
            <div className="panel-body">
              {members.map((person) => (
                <div className="profile" key={person.userId}>
                  <span aria-hidden="true" className="avatar">
                    {person.initials}
                  </span>
                  <span>
                    <strong>
                      {person.userId === session.userId ? session.displayName : person.displayName}
                    </strong>
                    <small>
                      {humanizeStatus(person.role)} ·{" "}
                      {ROLE_DESCRIPTIONS[person.role] ?? "Custom role"}
                      {person.status !== "active" ? ` · ${humanizeStatus(person.status)}` : ""}
                    </small>
                  </span>
                </div>
              ))}
              <div className="spacer" />
              {mayInvite ? (
                <PendingButton small>Invite person</PendingButton>
              ) : (
                <p className="section-note">Only an owner can invite people to this workspace.</p>
              )}
            </div>
          </Panel>

          <Panel title="Security">
            <div className="panel-body">
              <Badge tone="good">Private storage</Badge>
              <p className="section-note">
                Originals, delivery derivatives, and rights evidence live in three private buckets
                keyed by workspace. Nothing is publicly readable; delivery uses short-lived signed
                URLs issued by the server.
              </p>
              <p className="section-note">
                Confidential source notes are stored separately and are visible only to owners and
                editors. Finance and dispatch access does not reach them.
              </p>
              <p className="section-note">
                Originals are never deleted. An asset is tombstoned and the file is retained.
              </p>
            </div>
          </Panel>
        </div>

        <div className="spacer" />

        <div className="panel-grid">
          <Panel
            action={<span className="muted">{buyers.length} buyers</span>}
            title="Buyers & delivery profiles"
          >
            {buyers.length === 0 && (
              <div className="side-card">
                <p>No buyers recorded yet.</p>
              </div>
            )}
            {buyers.map((buyer) => (
              <div className="side-card" key={buyer.id}>
                <h3>{buyer.name}</h3>
                <p>
                  {humanizeStatus(buyer.buyerType)}
                  {buyer.deliveryProfile ? ` · ${buyer.deliveryProfile}` : ""}
                  {buyer.contactName ? ` · ${buyer.contactName}` : ""}
                </p>
              </div>
            ))}
          </Panel>

          <Panel title="Data control">
            <div className="panel-body">
              <div className="actions">
                <PendingButton>Export workspace</PendingButton>
                <PendingButton>Retention controls</PendingButton>
              </div>
              <p className="section-note">
                No vendor lock-in: assets, metadata, financial records, and audit history are
                exportable. Retention requirements for originals and evidence are still an open
                product decision.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
