import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, Metric, PageHeader, Panel, PendingButton } from "@/components/primitives";
import { formatDate, formatDateTime, humanizeStatus } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import {
  getBuyer,
  getPackage,
  getShoot,
  getSubmission,
  listActivity,
  listLicenses,
} from "@/lib/mock/queries";

export default async function SubmissionPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  const submission = await getSubmission(submissionId);
  if (!submission) notFound();

  const [buyer, pkg, activity, licenses] = await Promise.all([
    getBuyer(submission.buyerId),
    getPackage(submission.packageId),
    listActivity({ entityId: submission.id }),
    listLicenses(),
  ]);
  const shoot = pkg ? await getShoot(pkg.shootId) : null;
  const license = licenses.find((candidate) => candidate.submissionId === submission.id);

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
            detail={submission.deliveredAt ? "Receipt confirmed" : "Awaiting receipt"}
            label="Status"
            tone={submission.deliveredAt ? "good" : undefined}
            value={humanizeStatus(submission.status)}
          />
          <Metric
            detail="Exact versions sent"
            label="Assets"
            value={String(submission.manifest.length)}
          />
          <Metric
            detail={submission.restrictionsSnapshot ?? "No restrictions recorded"}
            label="Terms"
            value={submission.termsSnapshot ? "Recorded" : "None"}
          />
          <Metric
            detail={license ? formatMoney(license.saleBase) : "No sale recorded yet"}
            label="Outcome"
            value={license ? "Sold" : "Pending"}
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

          <Panel title="Submission record">
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
                <dt>Proposed terms</dt>
                <dd>{submission.termsSnapshot ?? "—"}</dd>
              </div>
              <div className="key-value">
                <dt>Restrictions</dt>
                <dd>{submission.restrictionsSnapshot ?? "—"}</dd>
              </div>
              <div className="key-value">
                <dt>Related shoot</dt>
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
                <dt>Sale outcome</dt>
                <dd>
                  {license ? (
                    <Badge tone="good">Sold · {formatMoney(license.saleBase)}</Badge>
                  ) : (
                    <Badge tone="neutral">Pending</Badge>
                  )}
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Next action">
            <div className="side-card">
              <Badge tone="blue">Suggested</Badge>
              <h3>
                Follow up if there is no outcome by{" "}
                {submission.followUpAt ? formatDate(submission.followUpAt) : "the agreed date"}
              </h3>
              <p>
                Basis: this buyer has responded within two days on the last three submissions.
                Mastline can prepare the message, but it will not send without approval.
              </p>
              <PendingButton className="blue">Draft follow-up</PendingButton>
            </div>
            <div className="side-card">
              <h3>Record an outcome</h3>
              <p>
                Recording a sale links a license and expected revenue. It never rewrites what was
                sent.
              </p>
              <div className="actions">
                <PendingButton small>Sold</PendingButton>
                <PendingButton small>No sale</PendingButton>
                <PendingButton small>Recalled</PendingButton>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
