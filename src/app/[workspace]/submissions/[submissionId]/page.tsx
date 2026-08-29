import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, Metric, PageHeader, Panel, TableScroll } from "@/components/primitives";
import { listActivity } from "@/lib/data/activity";
import { listDeliveryAttempts } from "@/lib/data/delivery";
import { listAssets } from "@/lib/data/assets";
import { listLicenses, listPayments } from "@/lib/data/money";
import { getPackage } from "@/lib/data/packages";
import { getShoot } from "@/lib/data/shoots";
import { getSubmission, listSubmissionAssets } from "@/lib/data/submissions";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { formatDate, formatDateTime, humanizeStatus } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { DeliveryPanel } from "../_components/delivery-panel";
import {
  DeliveryLinks,
  type DeliveryLinkView,
  type LinkStage,
} from "../_components/delivery-links-panel";
import { RecipientAnalytics, type RecipientAnalyticsRow } from "../_components/recipient-analytics";
import { listAcceptances, listAccessEvents, listDeliveries } from "@/lib/data/delivery-links";
import { listDeliveryEngagement } from "@/lib/data/delivery-analytics";
import { deliveryStanding } from "@/lib/delivery";
import { deliveryUrlWithParameters } from "@/lib/delivery-parameters";
import { headers } from "next/headers";
import { OutcomePanel } from "../_components/outcome-panel";

export default async function SubmissionPage({
  params,
}: {
  params: Promise<{ workspace: string; submissionId: string }>;
}) {
  const { workspace: requestedWorkspace, submissionId } = await params;
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

  const submission = await getSubmission(organizationId, submissionId);
  if (!submission) notFound();

  const [pkg, buyers, activity, licenses, payments, attempts, frames] = await Promise.all([
    getPackage(organizationId, submission.packageId),
    listWorkspaceBuyers(organizationId),
    listActivity(organizationId, { entityId: submissionId }),
    listLicenses(organizationId),
    listPayments(organizationId),
    listDeliveryAttempts(organizationId, submissionId),
    // What a recipient link renders and downloads: the approved frames, not
    // the live assets.
    listSubmissionAssets(organizationId, submissionId),
  ]);
  const frameByAsset = new Map(frames.map((frame) => [frame.assetId, frame] as const));
  const backfilled = frames.some((frame) => frame.origin === "legacy_backfill");

  // The link a picture desk opens, and what they did with it.
  const deliveries = await listDeliveries(organizationId, submissionId);
  const accessEvents = await listAccessEvents(
    organizationId,
    deliveries.map((delivery) => delivery.id),
  );
  const acceptances = await listAcceptances(organizationId, submissionId);
  const engagement = await listDeliveryEngagement(
    organizationId,
    deliveries.map((delivery) => delivery.id),
  );
  // Built from the request so a link copied from a preview deployment points at
  // that deployment rather than at production.
  const requestHeaders = await headers();
  const origin = `https://${requestHeaders.get("host") ?? "mastline.co"}`;

  const shoot = pkg ? await getShoot(organizationId, pkg.shootId) : null;
  const assets = shoot ? await listAssets(organizationId, { shootId: shoot.id }) : [];
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const buyer = buyers.find((candidate) => candidate.id === submission.buyerId) ?? null;

  /*
   * One view model per recipient link.
   *
   * The stage is worked out from evidence rather than from a single status
   * column, because the states genuinely are independent: a link can be opened
   * without ever having been marked shared (the photographer sent it and forgot
   * to say so), and a link can be shared and never opened. Collapsing them into
   * one "delivered" is precisely what this whole screen exists to stop.
   */
  const acceptanceByDelivery = new Map(
    acceptances.map((acceptance) => [acceptance.deliveryId, acceptance] as const),
  );
  const now = new Date();

  const linkViews: DeliveryLinkView[] = deliveries.map((link) => {
    const standing = deliveryStanding({
      expiresAt: link.expiresAt,
      revokedAt: link.revokedAt,
      now,
    });
    const measured = engagement.get(link.id);
    const acceptance = acceptanceByDelivery.get(link.id);

    const stage: LinkStage =
      standing === "withdrawn"
        ? "withdrawn"
        : standing === "expired"
          ? "expired"
          : (measured?.downloadCount ?? 0) > 0
            ? "downloaded"
            : acceptance
              ? "accepted"
              : (measured?.openCount ?? 0) > 0
                ? "opened"
                : link.sharedAt
                  ? "shared"
                  : "created";

    return {
      id: link.id,
      recipientLabel: link.recipientLabel,
      contactReference: link.contactReference,
      // The stored snapshot, not anything read back off a visitor's URL.
      parameters: Object.entries(link.customParameters).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
      url: deliveryUrlWithParameters(origin, link.token, link.customParameters),
      stage,
      isLive: standing === "live",
      createdAt: link.createdAt,
      sharedAt: link.sharedAt,
      expiresAt: link.expiresAt,
    };
  });

  const STAGE_TEXT: Record<LinkStage, string> = {
    created: "Link created",
    shared: "Shared",
    opened: "Opened",
    accepted: "Accepted",
    downloaded: "Downloaded",
    withdrawn: "Withdrawn",
    expired: "Expired",
  };

  const analyticsRows: RecipientAnalyticsRow[] = linkViews.map((view) => {
    const measured = engagement.get(view.id);
    const acceptance = acceptanceByDelivery.get(view.id);
    const perAsset = new Map((measured?.assets ?? []).map((entry) => [entry.assetId, entry]));

    return {
      deliveryId: view.id,
      recipientLabel: view.recipientLabel,
      parameters: view.parameters,
      stageLabel: STAGE_TEXT[view.stage],
      createdAt: view.createdAt,
      sharedAt: view.sharedAt,
      acceptedBy: acceptance?.acceptedBy,
      acceptedAt: acceptance?.acceptedAt,
      acceptedIpAddress: acceptance?.ipAddress,
      acceptedTerms: acceptance?.termsSnapshot,
      engagement: measured ?? {
        deliveryId: view.id,
        state: "never-opened" as const,
        sessionCount: 0,
        visitorCount: 0,
        activeVisibleMs: 0,
        averageSessionMs: 0,
        openCount: 0,
        downloadCount: 0,
        downloadedAssetIds: [],
        assets: [],
      },
      assets: submission.manifest.map((entry) => {
        const seen = perAsset.get(entry.assetId);
        return {
          assetId: entry.assetId,
          filename:
            frameByAsset.get(entry.assetId)?.filename ??
            byId.get(entry.assetId)?.canonicalFilename ??
            entry.assetId.slice(0, 8),
          viewed: Boolean(seen && seen.activeVisibleMs > 0),
          viewCount: seen?.viewCount ?? 0,
          activeVisibleMs: seen?.activeVisibleMs ?? 0,
          downloaded: (measured?.downloadedAssetIds ?? []).includes(entry.assetId),
        };
      }),
    };
  });

  /*
   * The header used to read "Sent to <buyer>" the moment a submission existed,
   * which was the moment a package was approved -- before a link existed and
   * before anything had left. It now describes where the submission actually
   * is.
   */
  const sharedLink = linkViews.find((view) => view.sharedAt);
  const openedLink = linkViews.find((view) => (engagement.get(view.id)?.openCount ?? 0) > 0);
  const headerDescription = openedLink
    ? `Opened through the link created for ${openedLink.recipientLabel ?? "a recipient"}${
        submission.deliveredAt ? ` · ${formatDateTime(submission.deliveredAt)}` : ""
      }`
    : sharedLink
      ? `Link for ${sharedLink.recipientLabel ?? "a recipient"} marked as shared${
          submission.sentAt ? ` · ${formatDateTime(submission.sentAt)}` : ""
        }`
      : linkViews.length > 0
        ? `Approved for ${buyer?.name ?? "an unrecorded buyer"} · link created, not yet shared`
        : `Approved for ${buyer?.name ?? "an unrecorded buyer"} · nothing sent yet`;

  const license = licenses.find((candidate) => candidate.submissionId === submissionId);
  const relatedPayments = payments.filter((payment) =>
    payment.allocations.some(
      (allocation) =>
        allocation.submissionId === submissionId ||
        (license && allocation.licenseId === license.id),
    ),
  );
  const received = relatedPayments.reduce(
    (total, payment) =>
      total +
      payment.allocations
        .filter(
          (allocation) =>
            allocation.submissionId === submissionId ||
            (license && allocation.licenseId === license.id),
        )
        .reduce((sum, allocation) => sum + allocation.allocated.minor, 0),
    0,
  );

  return (
    <AppShell active="Submissions" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          description={headerDescription}
          eyebrow={`Submission ${submission.reference}`}
          title={shoot?.title ?? "Submission"}
        />

        <div className="metrics">
          <Metric
            detail={
              submission.deliveredAt
                ? "A recipient opened a link"
                : submission.sentAt
                  ? "A link was shared, not yet opened"
                  : "Approved; nothing sent yet"
            }
            label="Status"
            tone={submission.status === "sold" ? "good" : undefined}
            value={humanizeStatus(submission.status)}
          />
          <Metric
            detail="Exact versions sent"
            label="Assets"
            value={String(submission.manifest.length)}
          />
          <Metric
            detail={license ? humanizeStatus(license.origin) : "No sale recorded"}
            label="Sale"
            value={license ? formatMoney(license.saleBase) : "—"}
          />
          <Metric
            detail={received > 0 ? "Attributed to this submission" : "Nothing received yet"}
            label="Received"
            tone={received > 0 ? "good" : undefined}
            value={formatMoney({ minor: received, currency: "USD" })}
          />
        </div>

        <div className="three-col">
          <Panel title="Activity">
            <div className="panel-body timeline">
              {activity.length === 0 && <p className="section-note">No recorded events yet.</p>}
              {activity.map((event) => (
                <div className="timeline-item" key={event.id}>
                  <h3>{event.summary}</h3>
                  <p>{formatDateTime(event.createdAt)}</p>
                </div>
              ))}
            </div>
          </Panel>

          <div className="stack">
            <Panel action={<Badge tone="neutral">Immutable</Badge>} title="What was sent">
              <dl>
                <div className="key-value">
                  <dt>Buyer</dt>
                  <dd>{buyer?.name ?? "—"}</dd>
                </div>
                <div className="key-value">
                  <dt>Recipient</dt>
                  <dd>{submission.recipientLabel ?? "—"}</dd>
                </div>
                <div className="key-value">
                  <dt>Method</dt>
                  <dd>
                    {submission.deliveryMethod} · {submission.reference}
                  </dd>
                </div>
                <div className="key-value">
                  <dt>Terms</dt>
                  <dd>{submission.termsSnapshot ?? "—"}</dd>
                </div>
                <div className="key-value">
                  <dt>Restrictions</dt>
                  <dd>{submission.restrictionsSnapshot ?? "—"}</dd>
                </div>
                <div className="key-value">
                  <dt>Shoot</dt>
                  <dd>
                    {shoot ? (
                      <Link className="text-link" href={routes.shoot(shoot.id)}>
                        {shoot.title}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className="key-value">
                  <dt>Follow-up</dt>
                  <dd>{submission.followUpAt ? formatDate(submission.followUpAt) : "None set"}</dd>
                </div>
                <div className="key-value">
                  <dt>Outcome note</dt>
                  <dd>{submission.outcomeNote ?? "—"}</dd>
                </div>
              </dl>
            </Panel>

            <Panel
              action={
                <span className="muted">
                  {frames.length > 0 ? frames.length : submission.manifest.length}{" "}
                  {(frames.length > 0 ? frames.length : submission.manifest.length) === 1
                    ? "frame"
                    : "frames"}
                </span>
              }
              title="Approved frames"
            >
              {/*
               * The approved record, not the live asset. What is listed here is
               * what a recipient link shows and downloads: the exact version,
               * and the caption as it stood at approval. A caption edited on
               * the asset afterwards does not appear here and does not reach
               * the recipient.
               */}
              {frames.length === 0 ? (
                <p className="panel-body section-note" role="status">
                  No approved-frame record exists for this submission, so a recipient link on it
                  shows no frames and downloads nothing. It was approved before the record existed
                  and its manifest could not be resolved to stored versions. Prepare and approve a
                  new package to deliver these frames.
                </p>
              ) : (
                <TableScroll label="Approved frames">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">Frame</th>
                        <th scope="col">Approved caption</th>
                        <th scope="col">Version</th>
                      </tr>
                    </thead>
                    <tbody>
                      {frames.map((frame) => (
                        <tr data-approved-frame={frame.assetId} key={frame.assetId}>
                          <td>{frame.position + 1}</td>
                          <td>
                            <Link className="text-link" href={routes.asset(frame.assetId)}>
                              {frame.filename}
                            </Link>
                          </td>
                          <td>
                            {frame.headline && <strong>{frame.headline}</strong>}
                            {frame.caption ? (
                              <span className="approved-caption">{frame.caption}</span>
                            ) : (
                              <span className="muted">No caption at approval</span>
                            )}
                          </td>
                          <td>
                            <strong>{humanizeStatus(frame.storageBucket)}</strong>
                            <small>SHA-256 {frame.sha256.slice(0, 12)}…</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
              <p className="section-note panel-body">
                {backfilled
                  ? "This record was reconstructed when the approved-frame record was introduced: the versions are the ones frozen at approval, but the captions are as they stood at that migration, not provably as they were at approval. New approvals record both at the moment of approval."
                  : "Frozen at approval. Editing the asset afterwards changes neither this record nor what a recipient sees or downloads; to send something different, approve a new package."}
              </p>
            </Panel>
          </div>

          <Panel title="Delivery links">
            {/*
             * The order of this panel is the order of the real work: make a
             * link for one recipient, add any attribution, copy it, send it
             * yourself, tell Mastline you have, then read what came back.
             */}
            <ol className="section-note delivery-next-steps">
              <li>Create a recipient-specific delivery link.</li>
              <li>Add optional attribution parameters.</li>
              <li>Copy the delivery link.</li>
              <li>Share it through your own channel — Mastline sends nothing.</li>
              <li>Mark it as shared.</li>
              <li>Review recipient engagement below.</li>
            </ol>
            <DeliveryLinks
              workspaceSlug={workspaceSlug}
              canSend={can(role, "submission.send")}
              links={linkViews}
              submissionId={submissionId}
            />
          </Panel>

          <Panel title="Recipient analytics">
            <RecipientAnalytics rows={analyticsRows} />
          </Panel>

          <Panel title="Access record">
            {accessEvents.length === 0 ? (
              <p className="panel-body section-note">
                Nothing recorded yet. Opens, acceptances, downloads, and refusals appear here as
                they happen.
              </p>
            ) : (
              <TableScroll label="What the recipient did">
                <table className="data-table">
                  <caption className="visually-hidden">What the recipient did</caption>
                  <thead>
                    <tr>
                      <th scope="col">What</th>
                      <th scope="col">When</th>
                      <th scope="col">From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accessEvents.map((event, index) => (
                      <tr key={`${event.occurredAt}-${index}`}>
                        <td>
                          {event.kind === "opened" && "A link was opened"}
                          {event.kind === "accepted" &&
                            `Terms accepted — ${event.detail ?? "name recorded"}`}
                          {event.kind === "downloaded" && "A frame was downloaded"}
                          {event.kind === "refused" && `Refused — ${event.detail ?? "closed link"}`}
                        </td>
                        <td>{formatDateTime(event.occurredAt)}</td>
                        <td>{event.ipAddress ?? "unknown"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
            <p className="panel-body section-note">
              Append-only evidence, recorded whatever the visitor&rsquo;s analytics choice. The
              address is part of the record because /security promises it is: every download is
              logged with the time and where it came from. It appears here and nowhere in the
              engagement figures above.
            </p>
          </Panel>

          <Panel title="Outcome">
            <DeliveryPanel
              attempts={attempts.map((attempt) => ({
                id: attempt.id,
                attemptNumber: attempt.attemptNumber,
                status: attempt.status,
                errorCode: attempt.errorCode,
                errorDetail: attempt.errorDetail,
                attemptedAt: attempt.attemptedAt,
                byPerson: Boolean(attempt.attemptedBy),
              }))}
              status={submission.status}
            />

            {license && (
              <div className="side-card">
                <Badge tone="good">Sold</Badge>
                <h3>{license.licenseeName}</h3>
                <dl className="confirm-list">
                  <div>
                    <dt>Sale base</dt>
                    <dd>{formatMoney(license.saleBase)}</dd>
                  </div>
                  <div>
                    <dt>Photographer</dt>
                    <dd>{formatMoney(license.photographerShare)}</dd>
                  </div>
                  <div>
                    <dt>Mastline share</dt>
                    <dd>{formatMoney(license.salesEngineShare)}</dd>
                  </div>
                </dl>
                <p className="section-note">
                  {license.origin === "mastline_sales_engine"
                    ? "Generated inside Mastline, so the 70/30 share applies."
                    : "A direct relationship, so Mastline takes nothing."}
                </p>
                <Link className="text-link" href={routes.money()}>
                  Open money <span aria-hidden="true">→</span>
                </Link>
              </div>
            )}

            <OutcomePanel
              workspaceSlug={workspaceSlug}
              buyerName={buyer?.name ?? null}
              canRecordOutcome={can(role, "submission.send")}
              canRecordSale={can(role, "license.write") && !license}
              currentStatus={submission.status}
              submissionId={submissionId}
            />
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
