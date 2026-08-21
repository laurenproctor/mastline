import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, Metric, PageHeader, Panel, PendingButton } from "@/components/primitives";
import { formatConfidence, formatDate, formatDateTime, humanizeStatus } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import {
  getAsset,
  getAssetLifetimeEarnings,
  getShoot,
  listLicenses,
  listPayments,
  listRightsMatches,
  listSubmissions,
} from "@/lib/mock/queries";

export default async function AssetPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const asset = await getAsset(assetId);
  if (!asset) notFound();

  const [earnings, shoot, submissions, licenses, matches, payments] = await Promise.all([
    getAssetLifetimeEarnings(asset.id),
    asset.shootId ? getShoot(asset.shootId) : Promise.resolve(null),
    listSubmissions(),
    listLicenses(),
    listRightsMatches(),
    listPayments(),
  ]);

  const assetSubmissions = submissions.filter((submission) =>
    submission.manifest.some((entry) => entry.assetId === asset.id),
  );
  const assetLicenses = licenses.filter((license) => license.assetIds.includes(asset.id));
  const assetMatches = matches.filter((match) => match.assetId === asset.id);
  const allocations = payments
    .flatMap((payment) => payment.allocations.map((allocation) => ({ payment, allocation })))
    .filter(({ allocation }) => allocation.assetId === asset.id);

  const original = asset.versions.find((version) => version.versionKind === "original");

  return (
    <AppShell active="Archive">
      <div className="page">
        <PageHeader
          description={`Canonical commercial record · Captured ${
            asset.capturedAt ? formatDate(asset.capturedAt, { withYear: true }) : "unknown"
          }`}
          eyebrow={`Asset ${asset.canonicalFilename}`}
          title={asset.headline ?? asset.canonicalFilename}
        />

        <div className="panel-grid">
          <div className="stack">
            <div aria-hidden="true" className="hero-photo" />

            <div className="metrics">
              <Metric
                detail={`${assetLicenses.length} licenses`}
                label="Lifetime earnings"
                tone={earnings.minor > 0 ? "good" : undefined}
                value={formatMoney(earnings)}
              />
              <Metric
                detail={`${new Set(assetSubmissions.map((s) => s.buyerId)).size} buyers`}
                label="Submissions"
                value={String(assetSubmissions.length)}
              />
              <Metric
                detail={
                  assetMatches.filter((match) => match.status === "new").length > 0
                    ? "Needs review"
                    : "None open"
                }
                label="Rights matches"
                tone={
                  assetMatches.filter((match) => match.status === "new").length > 0
                    ? "danger"
                    : undefined
                }
                value={String(assetMatches.length)}
              />
              <Metric
                detail="Original preserved"
                label="Versions"
                value={String(asset.versions.length)}
              />
            </div>

            <Panel title="Commercial history">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Event</th>
                      <th scope="col">Counterparty</th>
                      <th scope="col">Terms / outcome</th>
                      <th scope="col">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assetSubmissions.map((submission) => (
                      <tr key={submission.id}>
                        <td>{submission.sentAt ? formatDate(submission.sentAt) : "—"}</td>
                        <td>
                          <strong>Submission</strong>
                        </td>
                        <td>{submission.reference}</td>
                        <td>{humanizeStatus(submission.status)}</td>
                        <td>—</td>
                      </tr>
                    ))}
                    {assetLicenses.map((license) => (
                      <tr key={license.id}>
                        <td>{license.startsAt ? formatDate(license.startsAt) : "—"}</td>
                        <td>
                          <strong>
                            {license.origin === "mastline_sales_engine"
                              ? "Direct license"
                              : "Agency license"}
                          </strong>
                        </td>
                        <td>{license.licenseeName}</td>
                        <td>
                          {license.media} · {license.territory}
                        </td>
                        <td>{formatMoney(license.saleBase)}</td>
                      </tr>
                    ))}
                    {allocations.map(({ payment, allocation }) => (
                      <tr key={allocation.id}>
                        <td>{payment.receivedAt ? formatDate(payment.receivedAt) : "—"}</td>
                        <td>
                          <strong>Payment</strong>
                        </td>
                        <td>{payment.reference ?? payment.source}</td>
                        <td>{humanizeStatus(payment.status)}</td>
                        <td>{formatMoney(allocation.allocated)}</td>
                      </tr>
                    ))}
                    {assetMatches.map((match) => (
                      <tr key={match.id}>
                        <td>{formatDate(match.firstObservedAt)}</td>
                        <td>
                          <strong>Rights match</strong>
                        </td>
                        <td>{match.publisherName}</td>
                        <td>{humanizeStatus(match.licenseCheck)}</td>
                        <td>{formatConfidence(match.confidence)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Caption history">
              <div className="panel-body">
                {asset.captionHistory.length === 0 ? (
                  <p className="section-note">No caption edits recorded.</p>
                ) : (
                  <ol className="timeline">
                    {asset.captionHistory.map((revision) => (
                      <li className="timeline-item" key={revision.id}>
                        <h3>{revision.headline ?? "Caption updated"}</h3>
                        <p>
                          {revision.caption} — {formatDateTime(revision.editedAt)}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="section-note">
                  Editing the current caption never destroys a prior version.
                </p>
              </div>
            </Panel>
          </div>

          <div className="stack">
            <Panel title="Metadata">
              <dl>
                <div className="key-value">
                  <dt>Creator</dt>
                  <dd>{asset.creatorName ?? "—"}</dd>
                </div>
                <div className="key-value">
                  <dt>Copyright</dt>
                  <dd>{asset.copyrightNotice ?? "—"}</dd>
                </div>
                <div className="key-value">
                  <dt>Captured</dt>
                  <dd>{asset.capturedAt ? formatDateTime(asset.capturedAt) : "—"}</dd>
                </div>
                <div className="key-value">
                  <dt>Location</dt>
                  <dd>{asset.locationName ?? "—"}</dd>
                </div>
                <div className="key-value">
                  <dt>Subjects</dt>
                  <dd>{asset.subjects.join(", ") || "—"}</dd>
                </div>
                <div className="key-value">
                  <dt>Usage</dt>
                  <dd>{asset.usageRestrictions ?? "—"}</dd>
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
              </dl>
            </Panel>

            <Panel title="Provenance">
              <div className="panel-body">
                <Badge tone="good">Original preserved</Badge>
                <div className="spacer" />
                <dl>
                  {asset.versions.map((version) => (
                    <div className="key-value" key={version.id}>
                      <dt>{humanizeStatus(version.versionKind)}</dt>
                      <dd>
                        {version.mimeType} · {(version.bytes / 1_048_576).toFixed(1)} MB
                        <br />
                        <span className="muted">SHA-256 {version.sha256.slice(0, 12)}…</span>
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="section-note">
                  {original
                    ? `The original is stored in the private originals bucket and is never overwritten by a derivative.`
                    : "No original recorded."}
                </p>
                <PendingButton small>View audit history</PendingButton>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
