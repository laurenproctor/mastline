import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, Field, PendingButton, PhotoTile, Progress } from "@/components/primitives";
import { formatDate, formatDateTime, humanizeStatus } from "@/lib/format";
import { getReviewablePackageForShoot, getShootProgress, listAssets } from "@/lib/mock/queries";

export default async function ShootWorkspacePage({
  params,
}: {
  params: Promise<{ shootId: string }>;
}) {
  const { shootId } = await params;
  const progress = await getShootProgress(shootId);
  if (!progress) notFound();

  const [assets, pkg] = await Promise.all([
    listAssets({ shootId }),
    getReviewablePackageForShoot(shootId),
  ]);
  const { shoot } = progress;
  const focused = assets.find((asset) => !asset.caption) ?? assets[0];

  return (
    <AppShell active="Shoots">
      <div className="page">
        <div className="workspace-header">
          <div className="workspace-title">
            <Badge tone="warn">{humanizeStatus(shoot.status)}</Badge>
            <h1>{shoot.title}</h1>
            <p>
              {shoot.startsAt ? formatDate(shoot.startsAt, { withYear: true }) : "No date set"} ·{" "}
              {shoot.locationName} · {progress.importedFileCount} files imported
            </p>
          </div>
          <div className="actions">
            <PendingButton>Share with editor</PendingButton>
            {pkg && (
              <Link className="button blue" href={`/dispatch/${shoot.id}`}>
                Review dispatch
              </Link>
            )}
          </div>
        </div>

        <div className="metrics">
          <div className="metric">
            <span>Imported</span>
            <strong>{progress.importedFileCount}</strong>
            <small>Originals preserved</small>
          </div>
          <div className="metric">
            <span>Selected</span>
            <strong>{progress.selectedCount}</strong>
            <small>Target: 15–24</small>
          </div>
          <div className="metric">
            <span>Captioned</span>
            <strong>{progress.captionedCount}</strong>
            <small className={progress.warningCount > 0 ? "danger" : "good"}>
              {progress.warningCount > 0 ? `${progress.warningCount} incomplete` : "All complete"}
            </small>
          </div>
          <div className="metric">
            <span>Package</span>
            <strong>
              {progress.packageStatus ? humanizeStatus(progress.packageStatus) : "None"}
            </strong>
            <small>{pkg?.assets.length ?? 0} assets</small>
          </div>
        </div>

        <div className="shoot-layout">
          <div>
            <div className="dark-toolbar">
              <div className="actions">
                <PendingButton small>All files</PendingButton>
                <PendingButton small>Selected {progress.selectedCount}</PendingButton>
                <PendingButton small>Warnings {progress.warningCount}</PendingButton>
              </div>
              <Progress label="Caption progress" value={progress.captionCompletionPercent} />
            </div>

            <ul className="photo-grid">
              {assets.slice(0, 15).map((asset, index) => (
                <li key={asset.id}>
                  <Link
                    aria-label={`${asset.canonicalFilename}${asset.caption ? "" : " — caption needed"}`}
                    className="photo-link"
                    href={`/assets/${asset.id}`}
                  >
                    <PhotoTile
                      index={index + 1}
                      selected={asset.selected}
                      warning={!asset.caption}
                    />
                  </Link>
                </li>
              ))}
            </ul>

            <div className="dark-toolbar">
              <span className="muted">Shift-click to compare · Space to toggle select</span>
              <div className="actions">
                <PendingButton small>Reject</PendingButton>
                <PendingButton small>Compare</PendingButton>
                <PendingButton small>Apply metadata</PendingButton>
                <PendingButton className="acid" small>
                  Add to package
                </PendingButton>
              </div>
            </div>
          </div>

          <aside className="panel">
            <div className="panel-head">
              <h2>Asset inspector</h2>
              {focused?.caption ? (
                <Badge tone="good">Captioned</Badge>
              ) : (
                <Badge tone="warn">Caption needed</Badge>
              )}
            </div>
            {focused && (
              <div className="inspector">
                <p className="section-note">{focused.canonicalFilename}</p>
                <Field defaultValue={focused.headline ?? ""} label="Headline" name="headline" />
                <Field
                  control="textarea"
                  defaultValue={focused.caption ?? ""}
                  label="Caption"
                  name="caption"
                />
                <Field defaultValue={focused.subjects.join(", ")} label="People" name="subjects" />
                <Field
                  defaultValue={focused.locationName ?? ""}
                  label="Location"
                  name="locationName"
                />
                <Field
                  defaultValue={focused.keywords.join(", ")}
                  label="Keywords"
                  name="keywords"
                />
                <Field
                  defaultValue={focused.creditLine ?? ""}
                  label="Credit / copyright"
                  name="creditLine"
                />
                <Field
                  control="textarea"
                  defaultValue={focused.usageRestrictions ?? ""}
                  label="Usage restrictions"
                  name="usageRestrictions"
                />
                <p className="section-note">
                  Captured {focused.capturedAt ? formatDateTime(focused.capturedAt) : "unknown"} ·{" "}
                  {focused.versions.length} versions · original preserved.
                </p>
                <Link className="text-link" href={`/assets/${focused.id}`}>
                  Open full record <span aria-hidden="true">→</span>
                </Link>
              </div>
            )}
          </aside>
        </div>

        <p className="section-note">
          Brief: {shoot.storyAngle ?? "No story angle recorded."}
          {shoot.hasSensitiveNote &&
            " A confidential source note exists and is visible only to roles with source access."}
          {` Last updated ${formatDateTime(shoot.updatedAt)}.`}
        </p>
      </div>
    </AppShell>
  );
}
