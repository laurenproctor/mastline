import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel } from "@/components/primitives";
import { formatDateTime, humanizeStatus } from "@/lib/format";
import { getBuyer, listSubmissions } from "@/lib/mock/queries";

const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "danger" | "blue"> = {
  queued: "neutral",
  sent: "blue",
  delivered: "good",
  failed: "danger",
  acknowledged: "good",
  sold: "good",
  no_sale: "neutral",
  recalled: "warn",
};

export default async function SubmissionsPage() {
  const submissions = await listSubmissions();
  const buyers = await Promise.all(submissions.map((submission) => getBuyer(submission.buyerId)));

  return (
    <AppShell active="Submissions">
      <div className="page">
        <PageHeader
          description="What was sent, to whom, under which terms, and what happened next."
          eyebrow="System of record"
          title="Submissions"
        />
        <Panel action={<span className="muted">{submissions.length} submissions</span>}>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Buyer</th>
                  <th scope="col">Status</th>
                  <th scope="col">Assets</th>
                  <th scope="col">Sent</th>
                  <th scope="col">Open</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission, index) => (
                  <tr key={submission.id}>
                    <td>
                      <strong>{submission.reference}</strong>
                      <small>{submission.deliveryMethod}</small>
                    </td>
                    <td>{buyers[index]?.name ?? "—"}</td>
                    <td>
                      <Badge tone={STATUS_TONE[submission.status] ?? "neutral"}>
                        {humanizeStatus(submission.status)}
                      </Badge>
                    </td>
                    <td>{submission.manifest.length}</td>
                    <td>{submission.sentAt ? formatDateTime(submission.sentAt) : "Not sent"}</td>
                    <td>
                      <Link className="text-link" href={`/submissions/${submission.id}`}>
                        Open <span aria-hidden="true">→</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
