import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel, PhotoTile, TableScroll } from "@/components/primitives";
import { listAssets } from "@/lib/data/assets";
import { listPackages } from "@/lib/data/packages";
import { getShoot } from "@/lib/data/shoots";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { reviewDispatch } from "@/lib/dispatch-rules";
import { formatDateTime, humanizeStatus } from "@/lib/format";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { ApprovePanel } from "../_components/approve-panel";
import { PackageDetails } from "../_components/package-details";

const SETTLED = new Set(["delivered", "recalled"]);

export default async function DispatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; shootId: string }>;
  searchParams: Promise<{ package?: string }>;
}) {
  const { workspace: requestedWorkspace, shootId } = await params;
  const { package: requestedPackage } = await searchParams;
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

  const packages = await listPackages(organizationId, { shootId });
  if (packages.length === 0) notFound();

  // A shoot can carry several packages for different buyers. Default to one
  // that still needs work rather than one already dispatched.
  const pkg =
    packages.find((candidate) => candidate.id === requestedPackage) ??
    packages.find((candidate) => !SETTLED.has(candidate.status)) ??
    packages[0];

  const [assets, buyers] = await Promise.all([
    listAssets(organizationId, { shootId }),
    listWorkspaceBuyers(organizationId),
  ]);
  const buyer = buyers.find((candidate) => candidate.id === pkg.buyerId) ?? null;
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  const review = reviewDispatch({ pkg, assets, buyer });
  const dispatched = SETTLED.has(pkg.status);
  const maySend = can(role, "submission.send");

  return (
    <AppShell active="Submissions" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          description={`${shoot.title} · ${pkg.name} · ${pkg.assets.length} ${pkg.assets.length === 1 ? "asset" : "assets"}`}
          eyebrow="Final control point"
          title="Dispatch review"
        />

        {packages.length > 1 && (
          <nav aria-label="Packages on this shoot" className="package-tabs">
            {packages.map((candidate) => (
              <Link
                aria-current={candidate.id === pkg.id ? "page" : undefined}
                className={candidate.id === pkg.id ? "package-tab active" : "package-tab"}
                href={routes.dispatch({ shootId, packageId: candidate.id })}
                key={candidate.id}
              >
                {candidate.name}
                <small>{humanizeStatus(candidate.status)}</small>
              </Link>
            ))}
          </nav>
        )}

        <div className="panel-grid">
          <div className="stack">
            <Panel
              action={
                review.isApprovable ? (
                  <Badge tone="good">Ready</Badge>
                ) : (
                  <Badge tone="warn">
                    {review.blocking.length}{" "}
                    {review.blocking.length === 1 ? "check needs" : "checks need"} review
                  </Badge>
                )
              }
              title="Package checks"
            >
              <ul className="checklist">
                {review.checks.map((check) => (
                  <li
                    className={`check-row${check.status === "blocked" ? " blocked" : check.status === "advisory" ? " warn" : ""}`}
                    key={check.id}
                  >
                    <span aria-hidden="true" className="check-icon">
                      {check.status === "pass" ? "✓" : check.status === "advisory" ? "·" : "!"}
                    </span>
                    <div>
                      <h3>{check.title}</h3>
                      <p>{check.detail}</p>
                      {check.remedy && <p className="check-remedy">{check.remedy}</p>}
                    </div>
                    <strong>
                      {check.status === "pass"
                        ? "Pass"
                        : check.status === "advisory"
                          ? "Note"
                          : "Blocked"}
                    </strong>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel
              action={<span className="muted">{pkg.assets.length} in this package</span>}
              title="Exactly what will be sent"
            >
              <TableScroll label="Exactly what will be sent">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Frame</th>
                      <th scope="col">Version</th>
                      <th scope="col">Caption</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pkg.assets.map((entry) => {
                      const asset = byId.get(entry.assetId);
                      const version = asset?.versions.find(
                        (candidate) => candidate.id === entry.assetVersionId,
                      );
                      return (
                        <tr key={entry.assetId}>
                          <td>{entry.position + 1}</td>
                          <td>
                            <Link className="text-link" href={routes.asset(entry.assetId)}>
                              {asset?.canonicalFilename ?? "Unreadable asset"}
                            </Link>
                          </td>
                          <td>
                            {version ? (
                              <>
                                <strong>{humanizeStatus(version.versionKind)}</strong>
                                <small>{version.sha256.slice(0, 12)}…</small>
                              </>
                            ) : (
                              <span className="danger-text">Version missing</span>
                            )}
                          </td>
                          <td>
                            {asset?.caption ? (
                              asset.caption.slice(0, 80)
                            ) : (
                              <span className="danger-text">No caption</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
              <div className="thumb-strip panel-body">
                {pkg.assets.slice(0, 5).map((entry, index) => (
                  <PhotoTile index={index + 1} key={entry.assetId} selected />
                ))}
              </div>
            </Panel>
          </div>

          <div className="stack">
            <Panel title="Delivery">
              <PackageDetails
                workspaceSlug={workspaceSlug}
                buyerId={pkg.buyerId}
                buyers={buyers.map((candidate) => ({
                  id: candidate.id,
                  name: candidate.name,
                  deliveryProfile: candidate.deliveryProfile,
                }))}
                deliveryMethod={pkg.deliveryMethod}
                editable={!dispatched && can(role, "package.write")}
                packageId={pkg.id}
                packageNote={pkg.packageNote}
                proposedTerms={pkg.proposedTerms}
                restrictions={pkg.restrictions}
              />
            </Panel>

            <Panel title="Dispatch">
              {dispatched ? (
                <div className="side-card">
                  <Badge tone="good">Dispatched</Badge>
                  <h3>This package has been sent</h3>
                  <p>
                    Approved by an operator
                    {pkg.approvedAt ? ` on ${formatDateTime(pkg.approvedAt)}` : ""}. The submission
                    record holds exactly what went out.
                  </p>
                  <Link className="button small" href={routes.submissions()}>
                    Open submissions
                  </Link>
                </div>
              ) : maySend ? (
                <ApprovePanel
                  workspaceSlug={workspaceSlug}
                  assetCount={pkg.assets.length}
                  blockingTitles={review.blocking.map((check) => check.title)}
                  buyerName={buyer?.name ?? null}
                  defaultRecipient={buyer?.contactName ?? null}
                  isApprovable={review.isApprovable}
                  packageId={pkg.id}
                  restrictions={pkg.restrictions ?? null}
                  terms={pkg.proposedTerms ?? null}
                />
              ) : (
                <div className="side-card">
                  <Badge tone="neutral">Another role</Badge>
                  <h3>Dispatch needs a dispatcher</h3>
                  <p>
                    This role can prepare a package but not send it. An owner or dispatcher approves
                    the dispatch.
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
