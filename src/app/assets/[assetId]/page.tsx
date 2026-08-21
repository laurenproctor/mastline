import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, Metric, PageHeader, Panel } from "@/components/primitives";
import { getAsset } from "@/lib/data/assets";
import { signedUrlsFor } from "@/lib/data/imports";
import { listLicenses, listPayments } from "@/lib/data/money";
import { getShoot } from "@/lib/data/shoots";
import { listSubmissions } from "@/lib/data/submissions";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { formatDate, formatDateTime, humanizeStatus } from "@/lib/format";
import { reviewAsset } from "@/lib/metadata-rules";
import { formatMoney, sum } from "@/lib/money";
import { currentContext } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/server";

interface HistoryRow {
  date: string;
  event: string;
  counterparty: string;
  detail: string;
  value: string;
  href?: string;
}

export default async function AssetPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const { organizationId } = await currentContext();

  const asset = await getAsset(organizationId, assetId);
  if (!asset) notFound();

  const [shoot, submissions, licenses, payments, buyers] = await Promise.all([
    asset.shootId ? getShoot(organizationId, asset.shootId) : Promise.resolve(null),
    listSubmissions(organizationId),
    listLicenses(organizationId),
    listPayments(organizationId),
    listWorkspaceBuyers(organizationId),
  ]);

  const buyerNames = new Map(buyers.map((buyer) => [buyer.id, buyer.name]));

  const assetSubmissions = submissions.filter((submission) =>
    submission.manifest.some((entry) => entry.assetId === assetId),
  );
  const assetLicenses = licenses.filter((license) => license.assetIds.includes(assetId));
  const allocations = payments.flatMap((payment) =>
    payment.allocations
      .filter((allocation) => allocation.assetId === assetId)
      .map((allocation) => ({ payment, allocation })),
  );

  const earnings = sum(
    allocations.map((entry) => entry.allocation.allocated),
    "USD",
  );

  const preview = asset.versions.find((version) => version.versionKind === "preview");
  const previewUrls = preview
    ? await signedUrlsFor(await createClient(), "derivatives", [preview.objectKey], 600)
    : new Map<string, string>();
  const previewUrl = preview ? previewUrls.get(preview.objectKey) : undefined;

  const report = reviewAsset(asset);

  const history: HistoryRow[] = [
    ...assetSubmissions.map((submission) => ({
      date: submission.sentAt ?? "",
      event: "Submission",
      counterparty: buyerNames.get(submission.buyerId ?? "") ?? submission.reference,
      detail: humanizeStatus(submission.status),
      value: "—",
      href: `/submissions/${submission.id}`,
    })),
    ...assetLicenses.map((license) => ({
      date: license.startsAt ?? "",
      event: license.origin === "mastline_sales_engine" ? "Direct licence" : "Agency licence",
      counterparty: license.licenseeName,
      detail: [license.media, license.territory].filter(Boolean).join(" · ") || "—",
      value: formatMoney(license.saleBase),
    })),
    ...allocations.map(({ payment, allocation }) => ({
      date: payment.receivedAt ?? payment.dueAt ?? "",
      event: "Payment",
      counterparty: payment.reference ?? humanizeStatus(payment.source),
      detail: humanizeStatus(payment.status),
      value: formatMoney(allocation.allocated),
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

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
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={asset.caption ?? asset.canonicalFilename}
                className="hero-image"
                src={previewUrl}
              />
            ) : (
              <div aria-hidden="true" className="hero-photo" />
            )}

            <div className="metrics">
              <Metric
                detail={`${assetLicenses.length} ${assetLicenses.length === 1 ? "licence" : "licences"}`}
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
                detail="Original preserved"
                label="Versions"
                value={String(asset.versions.length)}
              />
              <Metric
                detail={report.isDispatchReady ? "Complete" : "Needs metadata"}
                label="Dispatch ready"
                tone={report.isDispatchReady ? "good" : "danger"}
                value={report.isDispatchReady ? "Yes" : "No"}
              />
            </div>

            <Panel title="Commercial history">
              {history.length === 0 ? (
                <div className="panel-body">
                  <p className="section-note">This frame has not been sent or licensed yet.</p>
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Event</th>
                        <th scope="col">Counterparty</th>
                        <th scope="col">Detail</th>
                        <th scope="col">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row, index) => (
                        <tr key={`${row.event}-${index}`}>
                          <td>{row.date ? formatDate(row.date, { withYear: true }) : "—"}</td>
                          <td>
                            <strong>
                              {row.href ? (
                                <Link className="text-link" href={row.href}>
                                  {row.event}
                                </Link>
                              ) : (
                                row.event
                              )}
                            </strong>
                          </td>
                          <td>{row.counterparty}</td>
                          <td>{row.detail}</td>
                          <td>{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel
              action={<span className="muted">{asset.captionHistory.length} earlier</span>}
              title="Caption history"
            >
              <div className="panel-body">
                {asset.captionHistory.length === 0 ? (
                  <p className="section-note">No caption edits recorded.</p>
                ) : (
                  <ol className="timeline">
                    {asset.captionHistory.map((revision) => (
                      <li className="timeline-item" key={revision.id}>
                        <h3>{revision.headline ?? "Caption updated"}</h3>
                        <p>
                          {revision.caption ?? "(empty)"} — {formatDateTime(revision.editedAt)}
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
                  <dt>Caption</dt>
                  <dd>{asset.caption ?? "—"}</dd>
                </div>
                <div className="key-value">
                  <dt>Creator</dt>
                  <dd>{asset.creatorName ?? "—"}</dd>
                </div>
                <div className="key-value">
                  <dt>Copyright</dt>
                  <dd>{asset.copyrightNotice ?? "—"}</dd>
                </div>
                <div className="key-value">
                  <dt>Credit</dt>
                  <dd>{asset.creditLine ?? "—"}</dd>
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
                <Badge tone={asset.status === "tombstoned" ? "warn" : "good"}>
                  {asset.status === "tombstoned" ? "Tombstoned" : "Original preserved"}
                </Badge>
                <div className="spacer" />
                <dl>
                  {asset.versions.map((version) => (
                    <div className="key-value" key={version.id}>
                      <dt>{humanizeStatus(version.versionKind)}</dt>
                      <dd>
                        {version.mimeType} · {(version.bytes / 1_048_576).toFixed(1)} MB
                        {version.width ? ` · ${version.width}×${version.height}` : ""}
                        <br />
                        <span className="muted">SHA-256 {version.sha256.slice(0, 16)}…</span>
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="section-note">
                  The original lives in a private bucket and is never overwritten by a derivative.
                  Nothing here is publicly readable.
                </p>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
