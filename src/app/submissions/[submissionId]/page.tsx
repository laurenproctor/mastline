import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, Metric, PageHeader, Panel } from "@/components/primitives";
import { listActivity } from "@/lib/data/activity";
import { listDeliveryAttempts } from "@/lib/data/delivery";
import { listAssets } from "@/lib/data/assets";
import { listLicenses, listPayments } from "@/lib/data/money";
import { getPackage } from "@/lib/data/packages";
import { getShoot } from "@/lib/data/shoots";
import { getSubmission } from "@/lib/data/submissions";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { formatDate, formatDateTime, humanizeStatus } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { currentContext } from "@/lib/session-context";
import { DeliveryPanel } from "../_components/delivery-panel";
import { DeliveryLinks } from "../_components/delivery-links-panel";
import { listAcceptances, listAccessEvents, listDeliveries } from "@/lib/data/delivery-links";
import { headers } from "next/headers";
import { OutcomePanel } from "../_components/outcome-panel";

export default async function SubmissionPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  const { session, organizationId } = await currentContext();
  const role = session.activeWorkspace.role;

  const submission = await getSubmission(organizationId, submissionId);
  if (!submission) notFound();

  const [pkg, buyers, activity, licenses, payments, attempts] = await Promise.all([
    getPackage(organizationId, submission.packageId),
    listWorkspaceBuyers(organizationId),
    listActivity(organizationId, { entityId: submissionId }),
    listLicenses(organizationId),
    listPayments(organizationId),
    listDeliveryAttempts(organizationId, submissionId),
  ]);

  // The link a picture desk opens, and what they did with it.
  const deliveries = await listDeliveries(organizationId, submissionId);
  const accessEvents = await listAccessEvents(
    organizationId,
    deliveries.map((delivery) => delivery.id),
  );
  const acceptances = await listAcceptances(organizationId, submissionId);
  // Built from the request so a link copied from a preview deployment points at
  // that deployment rather than at production.
  const requestHeaders = await headers();
  const origin = `https://${requestHeaders.get("host") ?? "mastline.co"}`;

  const shoot = pkg ? await getShoot(organizationId, pkg.shootId) : null;
  const assets = shoot ? await listAssets(organizationId, { shootId: shoot.id }) : [];
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const buyer = buyers.find((candidate) => candidate.id === submission.buyerId) ?? null;

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
    <AppShell active="Submissions">
      <div className="page">
        <PageHeader
          description={`Sent to ${buyer?.name ?? "an unrecorded buyer"}${
            submission.sentAt ? ` · ${formatDateTime(submission.sentAt)}` : ""
          }`}
          eyebrow={`Submission ${submission.reference}`}
          title={shoot?.title ?? "Submission"}
        />

        <div className="metrics">
          <Metric
            detail={submission.deliveredAt ? "Receipt recorded" : "Awaiting outcome"}
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
                      <Link className="text-link" href={`/shoots/${shoot.id}`}>
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
              action={<span className="muted">{submission.manifest.length} versions</span>}
              title="Manifest"
            >
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Frame</th>
                      <th scope="col">Version sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submission.manifest.map((entry) => {
                      const asset = byId.get(entry.assetId);
                      const version = asset?.versions.find(
                        (candidate) => candidate.id === entry.assetVersionId,
                      );
                      return (
                        <tr key={entry.assetId}>
                          <td>{entry.position + 1}</td>
                          <td>
                            <Link className="text-link" href={`/assets/${entry.assetId}`}>
                              {asset?.canonicalFilename ?? entry.assetId.slice(0, 8)}
                            </Link>
                          </td>
                          <td>
                            {version ? (
                              <>
                                <strong>{humanizeStatus(version.versionKind)}</strong>
                                <small>SHA-256 {version.sha256.slice(0, 12)}…</small>
                              </>
                            ) : (
                              <span className="muted">Version record no longer readable</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="section-note panel-body">
                This manifest is frozen. Editing what was sent is refused by the database.
              </p>
            </Panel>
          </div>

          <Panel title="Delivery link">
            <DeliveryLinks
              acceptances={acceptances}
              canSend={can(role, "submission.send")}
              events={accessEvents}
              links={deliveries}
              origin={origin}
              submissionId={submissionId}
            />
          </Panel>

          <Panel title="Next action">
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
              canRetry={can(role, "submission.send")}
              status={submission.status}
              submissionId={submissionId}
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
                    <dt>You keep</dt>
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
                    : "Your own relationship, so Mastline takes nothing."}
                </p>
                <Link className="text-link" href="/money">
                  Open money <span aria-hidden="true">→</span>
                </Link>
              </div>
            )}

            <OutcomePanel
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
