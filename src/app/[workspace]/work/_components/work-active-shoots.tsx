import { Badge } from "@/components/badge";
import { ActionLink } from "@/components/button";
import {
  Card,
  EmptyState,
  Panel,
  PanelBody,
  PanelHeader,
  Progress,
} from "@/components/dashboard-surfaces";
import type { ActiveShootSummary } from "@/lib/data/work-queue";
import { humanizeStatus } from "@/lib/format";
import type { WorkspaceRoutes } from "@/lib/workspace-routes";

/**
 * The two most recently active shoots still ahead of dispatch: how much is
 * selected, how much of the selection the metadata rules would let through,
 * and the one recorded step that comes next. A reader who cannot write is
 * offered the shoot, never a task they cannot do.
 */
export function WorkActiveShoots({
  routes,
  shoots,
  writable,
}: {
  routes: WorkspaceRoutes;
  shoots: readonly ActiveShootSummary[];
  writable: boolean;
}) {
  return (
    <Panel aria-labelledby="work-active-shoots">
      <PanelHeader
        id="work-active-shoots"
        meta={shoots.length > 0 ? String(shoots.length) : undefined}
        title="Active shoots"
      />
      <PanelBody>
        {shoots.length === 0 ? (
          <EmptyState
            compact
            description="Create a shoot from a brief, before there are any files."
            level={3}
            primaryAction={
              writable ? { label: "Create shoot", href: routes.newShoot() } : undefined
            }
            title="No shoot is in progress"
          />
        ) : (
          <div className="ml-stack">
            {shoots.map((shoot) => {
              const facts = [
                `${shoot.totalAssets} ${shoot.totalAssets === 1 ? "file" : "files"}`,
                `${shoot.selectedCount} selected`,
                shoot.locationName,
                shoot.packageLabel,
                shoot.linkLabel,
              ].filter((fact): fact is string => Boolean(fact));
              return (
                <Card className="ml-stack ml-work-queue-shoot" key={shoot.id}>
                  <div>
                    <Badge tone="warn">{humanizeStatus(shoot.status)}</Badge>
                  </div>
                  <h3 className="ml-subtitle">{shoot.title}</h3>
                  <p className="ml-meta">{facts.join(" · ")}</p>
                  <Progress
                    label="Ready to dispatch"
                    max={100}
                    value={shoot.metadataPercent}
                    valueText={`${shoot.metadataPercent}%`}
                  />
                  {shoot.blockedCount > 0 && (
                    <p className="ml-caption">
                      {shoot.blockedCount} selected{" "}
                      {shoot.blockedCount === 1 ? "photo is" : "photos are"} missing required
                      metadata.
                    </p>
                  )}
                  <div className="ml-cluster">
                    <ActionLink
                      href={writable ? shoot.actionHref : routes.shoot(shoot.id)}
                      size="sm"
                      variant="secondary"
                    >
                      {writable ? shoot.actionLabel : "Open shoot"}
                    </ActionLink>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
