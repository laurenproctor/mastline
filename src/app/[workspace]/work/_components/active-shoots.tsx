import Link from "next/link";
import type { ActiveShootSummary } from "@/lib/data/work-queue";
import type { WorkspaceRoutes } from "@/lib/workspace-routes";
import { elapsedLabel } from "./next-up";

/**
 * The two most recently touched shoots that still have work ahead of
 * dispatch. Previews are short-lived signed derivative URLs; when none exist
 * or signing failed, the card is its text summary and nothing pretends to be
 * a photograph.
 */
export function ActiveShoots({
  shoots,
  routes,
  now,
  writable,
}: {
  shoots: readonly ActiveShootSummary[];
  routes: WorkspaceRoutes;
  now: Date;
  /** Viewers get a neutral "Open shoot" rather than a task they cannot do. */
  writable: boolean;
}) {
  return (
    <section aria-labelledby="active-shoots-heading" className="panel work-active-shoots">
      <div className="panel-head">
        <h2 id="active-shoots-heading">Active shoots</h2>
        <Link className="text-link" href={routes.shoots()}>
          View all shoots <span aria-hidden="true">→</span>
        </Link>
      </div>

      {shoots.length === 0 ? (
        <div className="panel-body">
          <p className="section-note">
            No shoot is in progress. A shoot appears here from the moment it is drafted until it is
            dispatched.
          </p>
        </div>
      ) : (
        shoots.map((shoot) => {
          const metadataDone = shoot.selectedCount > 0 && shoot.blockedCount === 0;
          return (
            <article aria-label={shoot.title} className="work-active-shoot" key={shoot.id}>
              <h3>{shoot.title}</h3>

              {shoot.previewUrls.length > 0 && (
                <ul aria-hidden="true" className="work-shoot-thumbs">
                  {shoot.previewUrls.map((url) => (
                    <li key={url}>
                      {/* Decorative: the shoot title above carries the information.
                          A plain img, as on the contact sheet: the src is a short-lived
                          signed URL that next/image would route through the optimizer. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="" loading="lazy" src={url} />
                    </li>
                  ))}
                </ul>
              )}

              <dl className="work-shoot-facts">
                <div>
                  <dt>Photos</dt>
                  <dd>{shoot.totalAssets}</dd>
                </div>
                <div>
                  <dt>Metadata</dt>
                  <dd className={metadataDone ? "good" : undefined}>
                    {shoot.selectedCount === 0
                      ? "—"
                      : metadataDone
                        ? "Complete"
                        : `${shoot.metadataPercent}%`}
                  </dd>
                </div>
                <div>
                  <dt>Package</dt>
                  <dd>{shoot.packageLabel ?? "Not created"}</dd>
                </div>
                {shoot.linkLabel !== null && (
                  <div>
                    <dt>Recipient link</dt>
                    <dd>{shoot.linkLabel}</dd>
                  </div>
                )}
                <div>
                  <dt>Last activity</dt>
                  <dd>{elapsedLabel(shoot.lastActivityAt, now)}</dd>
                </div>
              </dl>

              <Link
                className="text-link work-shoot-action"
                href={writable ? shoot.actionHref : routes.shoot(shoot.id)}
              >
                {writable ? shoot.actionLabel : "Open shoot"} <span aria-hidden="true">→</span>
              </Link>
            </article>
          );
        })
      )}
    </section>
  );
}
