import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel, Progress } from "@/components/primitives";
import { formatDate, humanizeStatus } from "@/lib/format";
import { getShootProgress, listShoots } from "@/lib/mock/queries";

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

export default async function ShootsPage() {
  const shoots = await listShoots();
  const progress = await Promise.all(shoots.map((shoot) => getShootProgress(shoot.id)));

  return (
    <AppShell active="Shoots">
      <div className="page">
        <PageHeader
          action="Create shoot"
          description="Every job, from brief to dispatched package."
          eyebrow="Field operations"
          href="/shoots/new"
          title="Shoots"
        />
        <Panel action={<span className="muted">{shoots.length} shoots</span>}>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Shoot</th>
                  <th scope="col">Status</th>
                  <th scope="col">Date</th>
                  <th scope="col">Selected</th>
                  <th scope="col">Captions</th>
                  <th scope="col">Open</th>
                </tr>
              </thead>
              <tbody>
                {shoots.map((shoot, index) => {
                  const detail = progress[index];
                  return (
                    <tr key={shoot.id}>
                      <td>
                        <strong>{shoot.title}</strong>
                        <small>{shoot.locationName}</small>
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[shoot.status] ?? "neutral"}>
                          {humanizeStatus(shoot.status)}
                        </Badge>
                      </td>
                      <td>
                        {shoot.startsAt ? formatDate(shoot.startsAt, { withYear: true }) : "—"}
                      </td>
                      <td>{detail?.selectedCount ?? 0}</td>
                      <td style={{ minWidth: 140 }}>
                        <Progress value={detail?.captionCompletionPercent ?? 0} />
                      </td>
                      <td>
                        <Link className="text-link" href={`/shoots/${shoot.id}`}>
                          Open <span aria-hidden="true">→</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
