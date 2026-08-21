import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel, PendingButton } from "@/components/primitives";
import { humanizeStatus } from "@/lib/format";
import {
  getCurrentMember,
  getOrganization,
  listBuyers,
  listMembersWithRoles,
} from "@/lib/mock/queries";

export default async function SettingsPage() {
  const [organization, member, members, buyers] = await Promise.all([
    getOrganization(),
    getCurrentMember(),
    listMembersWithRoles(),
    listBuyers(),
  ]);

  return (
    <AppShell active="Settings">
      <div className="page">
        <PageHeader
          description="People, roles, delivery profiles, buyers, sources, storage, exports, and security."
          eyebrow="Workspace control"
          title="Settings"
        />

        <div className="three-col">
          <Panel title="Workspace">
            <div className="panel-body">
              <h3>{organization.name}</h3>
              <p className="section-note">
                {organization.timezone} · {organization.currency} · {humanizeStatus(member.role)}{" "}
                access
              </p>
              <PendingButton small>Edit workspace</PendingButton>
            </div>
          </Panel>

          <Panel title="People & permissions">
            <div className="panel-body">
              {members.map((person) => (
                <div className="profile" key={person.userId}>
                  <span aria-hidden="true" className="avatar">
                    {person.initials}
                  </span>
                  <span>
                    <strong>{person.displayName}</strong>
                    <small>{person.roleDescription}</small>
                  </span>
                </div>
              ))}
              <div className="spacer" />
              <PendingButton small>Invite person</PendingButton>
            </div>
          </Panel>

          <Panel title="Security">
            <div className="panel-body">
              <Badge tone="good">MFA enabled</Badge>
              <p className="section-note">
                Originals, derivatives, and rights evidence live in private buckets. Confidential
                source notes require explicit role access and are excluded from global search.
              </p>
              <PendingButton small>Review access</PendingButton>
            </div>
          </Panel>
        </div>

        <div className="spacer" />

        <div className="panel-grid">
          <Panel title="Buyers & delivery profiles">
            {buyers.map((buyer) => (
              <div className="side-card" key={buyer.id}>
                <h3>{buyer.name}</h3>
                <p>
                  {humanizeStatus(buyer.buyerType)}
                  {buyer.deliveryProfile ? ` · ${buyer.deliveryProfile}` : ""}
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
                exportable. Originals are never hard-deleted; an asset is tombstoned and the file is
                retained.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
