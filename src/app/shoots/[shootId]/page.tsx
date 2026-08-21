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
import { listPackages } from "@/lib/data/packages";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { signedUrlsFor } from "@/lib/data/imports";
import { getSensitiveNote, getShoot } from "@/lib/data/shoots";
import { formatDate, formatDateTime, humanizeStatus } from "@/lib/format";
import { reviewAsset, reviewSelection } from "@/lib/metadata-rules";
import { can } from "@/lib/permissions";
import { currentContext } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/server";

export default async function ShootWorkspacePage({
  params,
}: {
  params: Promise<{ shootId: string }>;
}) {
  const { shootId } = await params;
  const { session, organizationId } = await currentContext();
  const role = session.activeWorkspace.role;

  const shoot = await getShoot(organizationId, shootId);
  if (!shoot) notFound();

  const assets = await listAssets(organizationId, { shootId });
  const selected = assets.filter((asset) => asset.selected);
  const selectionReport = reviewSelection(selected);

  // Preview objects for the contact sheet, signed briefly. Nothing is public.
  const previewKeys = assets
    .map((asset) => asset.versions.find((version) => version.versionKind === "preview")?.objectKey)
    .filter((key): key is string => Boolean(key));
  const previewUrls = await signedUrlsFor(await createClient(), "derivatives", previewKeys, 600);

  const sheetAssets: SheetAsset[] = assets.map((asset) => {
    const report = reviewAsset(asset);
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
    };
  });

  const histories = await Promise.all(
    assets.map((asset) => listCaptionHistory(organizationId, asset.id)),
  );

  const inspectorAssets: InspectorAsset[] = assets.map((asset, index) => {
    const report = reviewAsset(asset);
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
    };
  });

  const sensitiveNote = shoot.hasSensitiveNote
    ? await getSensitiveNote(organizationId, shootId)
    : null;

  const [packages, buyers] = await Promise.all([
    listPackages(organizationId, { shootId }),
    listWorkspaceBuyers(organizationId),
  ]);

  const mayEdit = can(role, "asset.write");

  return (
    <AppShell active="Shoots">
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
            <span>Completeness</span>
            <strong>{selectionReport.completionPercent}%</strong>
            <small>Across the selection</small>
          </div>
        </div>

        {assets.length === 0 ? (
          mayEdit ? (
            <ImportDropzone shootId={shootId} />
          ) : (
            <Panel title="No files yet">
              <div className="panel-body">
                <p className="section-note">
                  This shoot has no files. Your role can view the record but not import.
                </p>
              </div>
            </Panel>
          )
        ) : (
          <>
            <div className="sheet-header">
              <Progress label="Selection ready" value={selectionReport.completionPercent} />
              {mayEdit && (
                <Link className="button small" href={`/shoots/${shootId}#import`}>
                  Import more
                </Link>
              )}
            </div>
            <ShootWorkspace
              inspectorAssets={inspectorAssets}
              sheetAssets={sheetAssets}
              shootId={shootId}
            />
          </>
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
                        <Link className="text-link" href={`/dispatch/${shootId}?package=${pkg.id}`}>
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
