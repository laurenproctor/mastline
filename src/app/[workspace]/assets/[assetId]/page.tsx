import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, Metric, PageHeader, Panel, TableScroll } from "@/components/primitives";
import { MetadataPanel, type MetadataPanelData } from "@/components/metadata-panel";
import { describeStatus, resolveMetadata, technicalRows } from "@/lib/asset-metadata";
import { getAsset } from "@/lib/data/assets";
import { getMetadata } from "@/lib/data/asset-metadata";
import { generationIsAvailable } from "@/lib/data/metadata-jobs";
import { can } from "@/lib/permissions";
import { signedUrlsFor } from "@/lib/data/imports";
import { listLicenses, listPayments } from "@/lib/data/money";
import { getShoot } from "@/lib/data/shoots";
import { listSubmissions } from "@/lib/data/submissions";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { formatDate, formatDateTime, humanizeStatus } from "@/lib/format";
import { reviewAsset } from "@/lib/metadata-rules";
import { formatMoney, sum } from "@/lib/money";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { createClient } from "@/lib/supabase/server";

interface HistoryRow {
  date: string;
  event: string;
  counterparty: string;
  detail: string;
  value: string;
  href?: string;
}

export default async function AssetPage({ params }: { params: Promise<{ workspace: string; assetId: string }> }) {
  const { workspace: requestedWorkspace, assetId } = await params;
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

  const asset = await getAsset(organizationId, assetId);
  if (!asset) notFound();

  const metadata = await getMetadata(organizationId, assetId);

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

  const report = reviewAsset(asset, undefined, metadata);

  /*
   * The same panel the shoot screen shows, on the photograph's own record.
   *
   * One component rather than a read-only rendering beside it: the record
   * screen is where somebody lands from a dispatch warning or a search result,
   * and being able to fix what sent them there without navigating again is the
   * point. Provenance is resolved here, against this asset's shoot.
   */
  const generatedValues = (metadata?.generatedValues ?? {}) as { uncertaintyNote?: string };
  const panel: MetadataPanelData = {
    photograph: {
      id: asset.id,
      filename: asset.canonicalFilename,
      previewUrl,
      isVideo: asset.assetKind === "video",
    },
    fields: resolveMetadata(metadata, shoot).fields as MetadataPanelData["fields"],
    status: describeStatus(metadata),
    technical: technicalRows(metadata?.technical ?? null, (iso) => formatDateTime(iso)),
    version: metadata?.version ?? 1,
    generatedAt: metadata?.generatedAt,
    aiModel: metadata?.aiModel,
    overallConfidence: metadata?.overallConfidence,
    uncertaintyNote: generatedValues.uncertaintyNote,
    failureDetail: metadata?.failureDetail,
    confirmedAt: metadata?.confirmedAt,
  };

  const history: HistoryRow[] = [
    ...assetSubmissions.map((submission) => ({
      date: submission.sentAt ?? "",
      event: "Submission",
      counterparty: buyerNames.get(submission.buyerId ?? "") ?? submission.reference,
      detail: humanizeStatus(submission.status),
      value: "—",
      href: routes.submission(submission.id),
    })),
    ...assetLicenses.map((license) => ({
      date: license.startsAt ?? "",
      event: license.origin === "mastline_sales_engine" ? "Direct license" : "Agency license",
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
    <AppShell active="Archive" workspace={workspaceSlug}>
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
                detail={`${assetLicenses.length} ${assetLicenses.length === 1 ? "license" : "licenses"}`}
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
                <TableScroll label="Commercial history">
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
                </TableScroll>
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
                      <Link className="text-link" href={routes.shoot(shoot.id)}>
                        {shoot.title}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
            </Panel>

            {metadata ? (
              <MetadataPanel
                {...panel}
                canEdit={can(session.activeWorkspace.role, "asset.write")}
                generationAvailable={generationIsAvailable()}
                shootId={asset.shootId}
                workspaceSlug={workspaceSlug}
              />
            ) : (
              <Panel title="Photograph metadata">
                <div className="panel-body">
                  <p className="section-note">
                    This photograph was imported before structured metadata existed, so it has no
                    record yet. Generating one creates it.
                  </p>
                </div>
              </Panel>
            )}

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
