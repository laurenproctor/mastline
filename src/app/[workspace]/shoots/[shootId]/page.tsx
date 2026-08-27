import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BuildPackage } from "@/components/build-package";
import { BulkMetadata } from "@/components/bulk-metadata";
import { ImportDropzone } from "@/components/import-dropzone";
import { Badge, PageHeader, Panel, Progress } from "@/components/primitives";
import { ShootWorkspace } from "@/components/shoot-workspace";
import type { InspectorAsset } from "@/components/asset-inspector";
import type { SheetAsset } from "@/components/contact-sheet";
import { listAssets, listCaptionHistory } from "@/lib/data/assets";
import { listMetadata } from "@/lib/data/asset-metadata";
import { countPendingJobs, generationIsAvailable } from "@/lib/data/metadata-jobs";
import { describeStatus, resolveMetadata, reviewProgress, technicalRows } from "@/lib/asset-metadata";
import type { MetadataPanelData } from "@/components/metadata-panel";
import { listPackages } from "@/lib/data/packages";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { signedUrlsFor } from "@/lib/data/imports";
import { getSensitiveNote, getShoot } from "@/lib/data/shoots";
import { formatDate, formatDateTime, humanizeStatus } from "@/lib/format";
import { reviewAsset, reviewSelection } from "@/lib/metadata-rules";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { createClient } from "@/lib/supabase/server";

export default async function ShootWorkspacePage({
  params,
}: {
  params: Promise<{ workspace: string; shootId: string }>;
}) {
  const { workspace: requestedWorkspace, shootId } = await params;
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

  const shoot = await getShoot(organizationId, shootId);
  if (!shoot) notFound();

  const assets = await listAssets(organizationId, { shootId });
  const metadata = await listMetadata(
    organizationId,
    assets.map((asset) => asset.id),
  );
  const selected = assets.filter((asset) => asset.selected);
  // The selection report now consults the metadata records, so "dispatch ready"
  // on this header means the same thing as the gate on the approve screen.
  const selectionReport = reviewSelection(selected, undefined, metadata);
  const progress = reviewProgress(assets.map((asset) => metadata.get(asset.id) ?? null));

  // Preview objects for the contact sheet, signed briefly. Nothing is public.
  const previewKeys = assets
    .map((asset) => asset.versions.find((version) => version.versionKind === "preview")?.objectKey)
    .filter((key): key is string => Boolean(key));
  const previewUrls = await signedUrlsFor(await createClient(), "derivatives", previewKeys, 600);

  const sheetAssets: SheetAsset[] = assets.map((asset) => {
    const report = reviewAsset(asset, undefined, metadata.get(asset.id) ?? null);
    const previewKey = asset.versions.find(
      (version) => version.versionKind === "preview",
    )?.objectKey;
    return {
      id: asset.id,
      filename: asset.canonicalFilename,
      selected: asset.selected,
      rating: asset.rating,
      previewUrl: previewKey ? previewUrls.get(previewKey) : undefined,
      missingRequired: report.missingRequired.map((rule) => rule.label),
      capturedAt: asset.capturedAt,
      metadataStatus: metadata.get(asset.id)?.generationStatus,
    };
  });

  const histories = await Promise.all(
    assets.map((asset) => listCaptionHistory(organizationId, asset.id)),
  );

  const inspectorAssets: InspectorAsset[] = assets.map((asset, index) => {
    const report = reviewAsset(asset, undefined, metadata.get(asset.id) ?? null);
    return {
      id: asset.id,
      filename: asset.canonicalFilename,
      headline: asset.headline,
      caption: asset.caption,
      subjects: asset.subjects,
      locationName: asset.locationName,
      keywords: asset.keywords,
      creditLine: asset.creditLine,
      copyrightNotice: asset.copyrightNotice,
      usageRestrictions: asset.usageRestrictions,
      capturedAt: asset.capturedAt,
      missingRequired: report.missingRequired.map((rule) => rule.label),
      missingRecommended: report.missingRecommended.map((rule) => rule.label),
      revisionCount: histories[index].length,
      isVideo: asset.assetKind === "video",
    };
  });

  /*
   * Everything the metadata panel renders, assembled here.
   *
   * Inheritance is resolved on the server because that is where the shoot is,
   * and because a second implementation of "where did this value come from" in
   * the browser would eventually disagree with this one. The client receives
   * values and provenance, never the rules.
   */
  const panels: Record<string, MetadataPanelData> = {};
  for (const asset of assets) {
    const record = metadata.get(asset.id) ?? null;
    const resolved = resolveMetadata(record, shoot);
    const previewKey = asset.versions.find(
      (version) => version.versionKind === "preview",
    )?.objectKey;
    const generated = (record?.generatedValues ?? {}) as { uncertaintyNote?: string };

    panels[asset.id] = {
      photograph: {
        id: asset.id,
        filename: asset.canonicalFilename,
        previewUrl: previewKey ? previewUrls.get(previewKey) : undefined,
        isVideo: asset.assetKind === "video",
      },
      fields: resolved.fields as MetadataPanelData["fields"],
      status: describeStatus(record),
      technical: technicalRows(record?.technical ?? null, (iso) => formatDateTime(iso)),
      version: record?.version ?? 1,
      generatedAt: record?.generatedAt,
      aiModel: record?.aiModel,
      overallConfidence: record?.overallConfidence,
      uncertaintyNote: generated.uncertaintyNote,
      failureDetail: record?.failureDetail,
      confirmedAt: record?.confirmedAt,
    };
  }

  const pendingCount = await countPendingJobs(
    organizationId,
    assets.map((asset) => asset.id),
    await createClient(),
  );
  const ungeneratedCount = assets.filter((asset) => {
    const status = metadata.get(asset.id)?.generationStatus;
    return status === undefined || status === "not_generated" || status === "failed";
  }).length;

  const sensitiveNote = shoot.hasSensitiveNote
    ? await getSensitiveNote(organizationId, shootId)
    : null;

  const [packages, buyers] = await Promise.all([
    listPackages(organizationId, { shootId }),
    listWorkspaceBuyers(organizationId),
  ]);

  const mayEdit = can(role, "asset.write");

  return (
    <AppShell active="Shoots" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          description={`${shoot.startsAt ? formatDate(shoot.startsAt, { withYear: true }) : "No date set"}${
            shoot.locationName ? ` · ${shoot.locationName}` : ""
          } · ${assets.length} ${assets.length === 1 ? "file" : "files"}`}
          eyebrow={humanizeStatus(shoot.status)}
          title={shoot.title}
        />

        <div className="metrics">
          <div className="metric">
            <span>Imported</span>
            <strong>{assets.length}</strong>
            <small>Originals preserved</small>
          </div>
          <div className="metric">
            <span>Selected</span>
            <strong>{selected.length}</strong>
            <small>{assets.length - selected.length} not selected</small>
          </div>
          <div className="metric">
            <span>Dispatch ready</span>
            <strong>{selectionReport.ready}</strong>
            <small className={selectionReport.blocked > 0 ? "danger" : "good"}>
              {selectionReport.blocked > 0
                ? `${selectionReport.blocked} need metadata`
                : "All selected frames complete"}
            </small>
          </div>
          <div className="metric">
            <span>Reviewed</span>
            <strong>
              {progress.confirmed} of {progress.total}
            </strong>
            <small className={progress.needsReview > 0 ? "danger" : "good"}>
              {progress.needsReview > 0
                ? `${progress.needsReview} waiting on you`
                : progress.inFlight > 0
                  ? `${progress.inFlight} being read`
                  : "Nothing waiting"}
            </small>
          </div>
        </div>

        {assets.length > 0 && (
          <>
            <div className="sheet-header">
              <Progress label="Selection ready" value={selectionReport.completionPercent} />
              {mayEdit && (
                <Link className="button small" href={routes.shoot(shootId, { hash: "import" })}>
                  Import more
                </Link>
              )}
            </div>
            <ShootWorkspace
              workspaceSlug={workspaceSlug}
              canEdit={mayEdit}
              generationAvailable={generationIsAvailable()}
              inspectorAssets={inspectorAssets}
              panels={panels}
              pendingCount={pendingCount}
              sheetAssets={sheetAssets}
              shootId={shootId}
              shootLocationName={shoot.locationName}
              ungeneratedCount={ungeneratedCount}
            />
          </>
        )}

        {/* The dropzone stays on the page once there are files, rather than
            being swapped out for a link to an anchor that no longer existed.
            Keeping it mounted is also what lets a running batch finish when the
            first file lands and the page re-renders underneath it. */}
        {mayEdit ? (
          <ImportDropzone workspaceSlug={workspaceSlug} compact={assets.length > 0} shootId={shootId} />
        ) : (
          assets.length === 0 && (
            <Panel title="No files yet">
              <div className="panel-body">
                <p className="section-note">
                  This shoot has no files. This role can view the record but not import.
                </p>
              </div>
            </Panel>
          )
        )}

        <div className="spacer" />

        <div className="panel-grid">
          <Panel title="Brief">
            <dl>
              <div className="key-value">
                <dt>Story angle</dt>
                <dd>{shoot.storyAngle ?? "—"}</dd>
              </div>
              <div className="key-value">
                <dt>Assignment</dt>
                <dd>{shoot.assignmentLabel ?? "Direct"}</dd>
              </div>
              <div className="key-value">
                <dt>Priority</dt>
                <dd>{humanizeStatus(shoot.priority)}</dd>
              </div>
              <div className="key-value">
                <dt>Exclusivity</dt>
                <dd>{shoot.exclusivity ?? "None"}</dd>
              </div>
              <div className="key-value">
                <dt>Embargo</dt>
                <dd>{shoot.embargoUntil ? formatDateTime(shoot.embargoUntil) : "None"}</dd>
              </div>
              <div className="key-value">
                <dt>Sensitive content</dt>
                <dd>{shoot.sensitiveContent ? "Yes" : "No"}</dd>
              </div>
              <div className="key-value">
                <dt>Notes</dt>
                <dd>{shoot.notes ?? "—"}</dd>
              </div>
            </dl>
          </Panel>

          <div className="stack">
            {sensitiveNote && (
              <Panel action={<Badge tone="warn">Restricted</Badge>} title="Confidential source">
                <div className="panel-body">
                  <p>{sensitiveNote.sourceNote ?? "—"}</p>
                  {sensitiveNote.confidentialLocation && (
                    <p className="section-note">{sensitiveNote.confidentialLocation}</p>
                  )}
                  <p className="section-note">
                    Visible to owners and editors only. Not exposed through search.
                  </p>
                </div>
              </Panel>
            )}

            <Panel title="Next action">
              {packages.length > 0 && (
                <div className="side-card">
                  <h3>
                    {packages.length === 1 ? "A package exists" : `${packages.length} packages`}
                  </h3>
                  <ul className="package-list">
                    {packages.map((pkg) => (
                      <li key={pkg.id}>
                        <Link
                          className="text-link"
                          href={routes.dispatch({ shootId, packageId: pkg.id })}
                        >
                          {pkg.name}
                        </Link>
                        <small>
                          {humanizeStatus(pkg.status)} · {pkg.assets.length} assets
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {can(role, "asset.write") && (
                <BulkMetadata
                  workspaceSlug={workspaceSlug}
                  defaults={{
                    creditLine: selected[0]?.creditLine,
                    copyrightNotice: selected[0]?.copyrightNotice,
                    locationName: shoot.locationName ?? selected[0]?.locationName,
                    usageRestrictions: selected[0]?.usageRestrictions,
                  }}
                  selectedIds={selected.map((asset) => asset.id)}
                  shootId={shootId}
                />
              )}

              {can(role, "package.write") ? (
                <BuildPackage
                  workspaceSlug={workspaceSlug}
                  blockedCount={selectionReport.blocked}
                  buyers={buyers.map((buyer) => ({
                    id: buyer.id,
                    name: buyer.name,
                    defaultTerms: buyer.defaultTerms,
                    deliveryProfile: buyer.deliveryProfile,
                    defaultRestrictions: buyer.defaultRestrictions,
                  }))}
                  readyCount={selectionReport.ready}
                  shootId={shootId}
                  shootTitle={shoot.title}
                  suggestedBuyerId={shoot.targetBuyerIds[0]}
                />
              ) : (
                <div className="side-card">
                  <h3>Selection</h3>
                  <p>
                    {selected.length} selected, {selectionReport.blocked} still missing required
                    metadata. Building a package needs an editor or dispatcher role.
                  </p>
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
