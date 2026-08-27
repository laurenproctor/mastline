import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel, Progress, TableScroll } from "@/components/primitives";
import { listAssets } from "@/lib/data/assets";
import { listShoots } from "@/lib/data/shoots";
import { formatDate, humanizeStatus } from "@/lib/format";
import { reviewSelection } from "@/lib/metadata-rules";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";

const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "blue"> = {
  draft: "neutral",
  scheduled: "neutral",
  active: "blue",
  ingesting: "blue",
  preparing: "warn",
  ready: "blue",
  dispatched: "good",
  completed: "good",
  archived: "neutral",
  cancelled: "neutral",
};

export default async function ShootsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: requestedWorkspace } = await params;
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
  const shoots = await listShoots(organizationId);
  const allAssets = await listAssets(organizationId);

  const byShoot = new Map<string, typeof allAssets>();
  for (const asset of allAssets) {
    if (!asset.shootId) continue;
    byShoot.set(asset.shootId, [...(byShoot.get(asset.shootId) ?? []), asset]);
  }

  return (
    <AppShell active="Shoots" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          action={can(session.activeWorkspace.role, "shoot.write") ? "Create shoot" : undefined}
          description="Every job, from brief to dispatched package."
          eyebrow="Field operations"
          href={routes.newShoot()}
          title="Shoots"
        />

        <Panel action={<span className="muted">{shoots.length} shoots</span>}>
          {shoots.length === 0 ? (
            <div className="panel-body">
              <p className="section-note">
                No shoots yet. A shoot can be created from a brief alone, before any files exist.
              </p>
            </div>
          ) : (
            <TableScroll label="Shoots">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Shoot</th>
                    <th scope="col">Status</th>
                    <th scope="col">Date</th>
                    <th scope="col">Files</th>
                    <th scope="col">Selected</th>
                    <th scope="col">Ready to dispatch</th>
                    <th scope="col">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {shoots.map((shoot) => {
                    const assets = byShoot.get(shoot.id) ?? [];
                    const selected = assets.filter((asset) => asset.selected);
                    const report = reviewSelection(selected);
                    return (
                      <tr key={shoot.id}>
                        <td>
                          <strong>{shoot.title}</strong>
                          <small>{shoot.locationName ?? "No location recorded"}</small>
                        </td>
                        <td>
                          <Badge tone={STATUS_TONE[shoot.status] ?? "neutral"}>
                            {humanizeStatus(shoot.status)}
                          </Badge>
                        </td>
                        <td>
                          {shoot.startsAt ? formatDate(shoot.startsAt, { withYear: true }) : "—"}
                        </td>
                        <td>{assets.length}</td>
                        <td>{selected.length}</td>
                        <td style={{ minWidth: 150 }}>
                          <Progress value={report.completionPercent} />
                        </td>
                        <td>
                          <Link className="text-link" href={routes.shoot(shoot.id)}>
                            Open <span aria-hidden="true">→</span>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
