import { Badge } from "@/components/badge";
import { TextLink } from "@/components/button";
import {
  EmptyState,
  OperationalList,
  OperationalListRow,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/dashboard-surfaces";
import type { ActivityEvent } from "@/lib/domain";
import { formatElapsed } from "@/lib/format";
import type { WorkspaceRoutes } from "@/lib/workspace-routes";

/** The append-only record, newest first, exactly as the screen has shown it. */
export function WorkRecentActivity({
  events,
  now,
  routes,
}: {
  events: readonly ActivityEvent[];
  now: Date;
  routes: WorkspaceRoutes;
}) {
  return (
    <Panel aria-labelledby="work-recent-activity">
      <PanelHeader
        actions={<TextLink href={routes.archive()}>View archive</TextLink>}
        id="work-recent-activity"
        title="Recent activity"
      />
      <PanelBody flush>
        {events.length === 0 ? (
          <EmptyState compact level={3} title="Nothing recorded yet." />
        ) : (
          <OperationalList compact label="Recorded events">
            {events.map((event) => (
              <OperationalListRow
                date={formatElapsed(event.createdAt, now)}
                key={event.id}
                level={3}
                status={<Badge tone="neutral">{event.entityType}</Badge>}
                title={event.summary}
              />
            ))}
          </OperationalList>
        )}
      </PanelBody>
    </Panel>
  );
}
