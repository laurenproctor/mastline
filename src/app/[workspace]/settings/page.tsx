import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel, PendingButton } from "@/components/primitives";
import { requireWorkspace } from "@/lib/auth";
import { humanizeStatus } from "@/lib/format";
import { can } from "@/lib/permissions";
import { mfaStanding } from "@/lib/mfa";
import { remainingLabel } from "@/lib/recovery-codes";
import { countRecoveryCodes } from "@/lib/data/recovery-codes";
import {
  getWorkspaceCounts,
  listWorkspaceBuyers,
  listWorkspaceMembers,
} from "@/lib/data/workspace";
import { getWorkspaceStatus } from "@/lib/data/subscription";
import { formatBytes, trialDaysRemaining } from "@/lib/subscription";
import { findPlan, type PlanId } from "@/lib/pricing";
import { Progress } from "@/components/primitives";
import { BuyerTemplate } from "./_components/buyer-template";
import { EditWorkspace } from "./_components/edit-workspace";
import { WorkspaceAddress } from "./_components/workspace-address";
import { MfaPolicy, TwoFactor } from "./_components/two-factor";
import { CaptionDrafting } from "./_components/caption-drafting";
import { ProfilePhoto } from "./_components/profile-photo";
import { Avatar } from "@/components/avatar";
import { getProfile, signAvatarUrl } from "@/lib/data/profiles";
import { InviteMember } from "./_components/invite-member";
import { BillingPanel, type PlanOption } from "./_components/billing-panel";
import { billingSummary, type BillingState } from "@/lib/billing";
import { createStripeProvider } from "@/lib/billing/stripe";
import { PLANS, annualSavingsClaim, formatPlanPrice, isCustomPriced } from "@/lib/pricing";
import { formatBytes as formatPlanBytes } from "@/lib/subscription";
import { PLAN_SEATS, PLAN_STORAGE_BYTES } from "@/lib/pricing";

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: "All workspace control",
  editor: "Shoots, assets, captions, dispatch preparation",
  dispatcher: "Package delivery and status",
  finance: "Revenue, payments, statements, exports",
  rights_reviewer: "Evidence, license checks, case routing",
  viewer: "Read-only, no sensitive access",
};

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { workspace: requestedWorkspace } = await params;
  // Set by the redirect each successful save performs, so the confirmation
  // survives the fresh request that makes the new state visible.
  const saved = (await searchParams).saved;
  const savedWorkspace = saved === "workspace";
  const savedAddress = saved === "address";
  const session = await requireWorkspace(requestedWorkspace);
  const workspace = session.activeWorkspace;
  /*
   * The address the workspace holds now. Everything rendered below -- links,
   * the export href, and the slug bound into each client component's actions --
   * uses this rather than the one the request arrived on.
   */
  const workspaceSlug = workspace.slug;

  const [members, buyers, counts, status] = await Promise.all([
    listWorkspaceMembers(workspace.id),
    listWorkspaceBuyers(workspace.id),
    getWorkspaceCounts(workspace.id),
    getWorkspaceStatus(workspace),
  ]);

  const plan = findPlan(workspace.plan as PlanId);
  const daysLeft = trialDaysRemaining(workspace.trialEndsAt, new Date());
  const activeMembers = members.filter((person) => person.status !== "suspended").length;
  const seatsLeft = workspace.seatLimit === undefined ? null : workspace.seatLimit - activeMembers;

  const billingState: BillingState = {
    plan: workspace.plan as PlanId,
    status: workspace.subscriptionStatus,
    billingPeriod: workspace.billingPeriod ?? "annual",
    trialEndsAt: workspace.trialEndsAt,
    paymentMethodAttachedAt: workspace.paymentMethodAttachedAt,
    pastDueSince: workspace.pastDueSince,
    currentPeriodEnd: workspace.currentPeriodEnd,
    cancelAtPeriodEnd: workspace.cancelAtPeriodEnd,
  };
  const billing = billingSummary(billingState, new Date());

  const planOptions: readonly PlanOption[] = PLANS.filter(
    (candidate) => !isCustomPriced(candidate),
  ).map((candidate) => {
    const storage = PLAN_STORAGE_BYTES[candidate.id];
    const seats = PLAN_SEATS[candidate.id];
    return {
      id: candidate.id,
      name: candidate.name,
      annualPrice: formatPlanPrice(candidate, "annual"),
      monthlyPrice: formatPlanPrice(candidate, "monthly"),
      storage: storage === null ? "Negotiated storage" : formatPlanBytes(storage),
      seats: seats === null ? "Custom team" : `${seats} ${seats === 1 ? "person" : "people"}`,
      isCurrent: candidate.id === workspace.plan,
    };
  });

  const mayInvite = can(workspace.role, "member.invite");

  return (
    <AppShell active="Settings" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          description="People, roles, delivery profiles, buyers, storage, exports, and security."
          eyebrow="Workspace control"
          title="Settings"
        />

        <div className="settings-grid">
          <Panel title="Your photo">
            <ProfilePhoto
              workspaceSlug={workspaceSlug}
              displayName={session.displayName}
              initials={session.initials}
              url={await signAvatarUrl((await getProfile(session.userId))?.avatarPath)}
            />
          </Panel>

          <Panel title="Workspace">
            <div className="panel-body">
              <h3>{workspace.name}</h3>
              <p className="section-note">
                {workspace.timezone} · {workspace.currency} · signed in as{" "}
                {humanizeStatus(workspace.role)}
              </p>
              <p className="section-note">
                <strong>{plan.name}</strong> · {humanizeStatus(workspace.subscriptionStatus)}
                {daysLeft !== null && daysLeft > 0
                  ? ` · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} of trial left`
                  : ""}
                {workspace.seatLimit !== undefined
                  ? ` · ${activeMembers} of ${workspace.seatLimit} ${workspace.seatLimit === 1 ? "seat" : "seats"} used`
                  : ""}
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
                <EditWorkspace
                  workspaceSlug={workspaceSlug}
                  name={workspace.name}
                  timezone={workspace.timezone}
                />
              )}
              <div className="spacer" />
              {workspace.role === "owner" ? (
                <WorkspaceAddress workspaceSlug={workspaceSlug} slug={workspace.slug} />
              ) : (
                <p className="section-note">
                  Workspace address <strong>mastline.co/{workspace.slug}</strong> · only an owner
                  can change it.
                </p>
              )}
              {savedWorkspace && (
                <p className="inspector-saved" role="status">
                  Workspace saved.
                </p>
              )}
              {savedAddress && (
                <p className="inspector-saved" role="status">
                  Workspace address changed. Your old address still works.
                </p>
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
                  <Avatar
                    initials={person.initials}
                    name={person.displayName}
                    url={person.avatarUrl}
                  />
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
                <InviteMember workspaceSlug={workspaceSlug} seatsLeft={seatsLeft} />
              ) : (
                <p className="section-note">Only an owner can invite people to this workspace.</p>
              )}
              {saved === "invite" && (
                <p className="inspector-saved" role="status">
                  Invitation sent.
                </p>
              )}
              {saved === "removed" && (
                <p className="inspector-saved" role="status">
                  Removed from the workspace.
                </p>
              )}
            </div>
          </Panel>

          {can(workspace.role, "workspace.settings") && (
            <Panel title="Billing">
              <BillingPanel
                workspaceSlug={workspaceSlug}
                billingAvailable={createStripeProvider().isConfigured()}
                detail={billing.detail}
                needsCard={billing.needsCard}
                plans={planOptions}
                portalAvailable={Boolean(workspace.stripeCustomerId)}
                savingsClaim={annualSavingsClaim()}
                summary={billing.headline}
                tone={billing.tone}
              />
            </Panel>
          )}

          <Panel title="Storage">
            <div className="panel-body">
              {status.storage.limitBytes === null ? (
                <>
                  <h3>{formatBytes(status.storage.usedBytes)}</h3>
                  <p className="section-note">
                    {status.objectCount} stored files. This plan has a negotiated allowance.
                  </p>
                </>
              ) : (
                <>
                  <h3>
                    {formatBytes(status.storage.usedBytes)} of{" "}
                    {formatBytes(status.storage.limitBytes)}
                  </h3>
                  <Progress label="Used" value={status.storage.percentUsed} />
                  <p className="section-note">
                    {status.objectCount} stored files ·{" "}
                    {formatBytes(status.storage.remainingBytes ?? 0)} left.
                  </p>
                  {status.storage.isOverLimit && (
                    <p className="section-note danger-text">
                      New imports are paused. Nothing already stored is affected.
                    </p>
                  )}
                </>
              )}
              <p className="section-note">
                Counted across originals and derivatives, derived from the stored files rather than
                a running total.
              </p>
            </div>
          </Panel>

          <Panel title="Two-factor authentication">
            {saved === "mfa-on" && (
              <p className="inspector-saved" role="status">
                Two-factor authentication is on.
              </p>
            )}
            {saved === "mfa-off" && (
              <p className="inspector-saved" role="status">
                Two-factor authentication is off.
              </p>
            )}
            {saved === "mfa-required" && (
              <p className="inspector-saved" role="status">
                Two-factor is now required for owners and finance.
              </p>
            )}
            {saved === "mfa-optional" && (
              <p className="inspector-saved" role="status">
                Two-factor is no longer required.
              </p>
            )}
            <TwoFactor
              workspaceSlug={workspaceSlug}
              email={session.email}
              remainingCodes={remainingLabel(await countRecoveryCodes())}
              standing={mfaStanding({
                role: workspace.role,
                hasVerifiedFactor: session.hasVerifiedFactor,
                enforced: workspace.requireMfa,
              })}
            />
            <MfaPolicy
              workspaceSlug={workspaceSlug}
              canEnforce={can(workspace.role, "workspace.settings")}
              required={workspace.requireMfa}
            />
          </Panel>

          <Panel title="Captions at import">
            {saved === "captions-on" && (
              <p className="inspector-saved" role="status">
                Captions will be drafted as frames are imported.
              </p>
            )}
            {saved === "captions-off" && (
              <p className="inspector-saved" role="status">
                Captions are no longer drafted automatically.
              </p>
            )}
            <CaptionDrafting
              workspaceSlug={workspaceSlug}
              canChange={can(workspace.role, "workspace.settings")}
              enabled={workspace.autoCaptionOnImport}
            />
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
            {saved === "buyer" && (
              <p className="inspector-saved" role="status">
                Buyer template saved.
              </p>
            )}
            {buyers.length === 0 && (
              <div className="side-card">
                <p>No buyers recorded yet.</p>
              </div>
            )}
            {buyers.map((buyer) =>
              can(workspace.role, "workspace.settings") ? (
                <BuyerTemplate
                  workspaceSlug={workspaceSlug}
                  buyer={{
                    id: buyer.id,
                    name: buyer.name,
                    buyerType: buyer.buyerType,
                    contactName: buyer.contactName,
                    defaultDeliveryMethod: buyer.deliveryProfile,
                    defaultTerms: buyer.defaultTerms,
                    defaultRestrictions: buyer.defaultRestrictions,
                    paymentTermsDays: buyer.paymentTermsDays,
                  }}
                  key={buyer.id}
                />
              ) : (
                <div className="side-card" key={buyer.id}>
                  <h3>{buyer.name}</h3>
                  <p>
                    {humanizeStatus(buyer.buyerType)}
                    {buyer.deliveryProfile ? ` · ${buyer.deliveryProfile}` : ""}
                    {buyer.contactName ? ` · ${buyer.contactName}` : ""}
                  </p>
                </div>
              ),
            )}
          </Panel>

          <Panel title="Data control">
            <div className="panel-body">
              <div className="actions">
                {can(workspace.role, "export.workspace") ? (
                  <a className="button" download href={`/api/workspaces/${workspaceSlug}/export`}>
                    Export workspace
                  </a>
                ) : (
                  <PendingButton>Export workspace</PendingButton>
                )}
                <PendingButton>Retention controls</PendingButton>
              </div>
              <p className="section-note">
                No vendor lock-in. The export contains every asset record, its file hashes and
                object keys, caption history, shoots, submissions, licenses, payments, allocations,
                and the full activity record, as CSV that opens anywhere.
              </p>
              <p className="section-note">
                Confidential source notes are deliberately excluded from a bulk export. Retention
                requirements for originals and evidence are still an open product decision.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
