import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel, TableScroll } from "@/components/primitives";
import { listLicenses } from "@/lib/data/money";
import { listSubmissions } from "@/lib/data/submissions";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { formatDateTime, humanizeStatus } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";

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

export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: requestedWorkspace } = await params;
  const { organizationId, canonicalSlug } = await workspaceContext(requestedWorkspace);
  const routes = workspaceRoutes(canonicalSlug);
  /*
   * Everything below builds on the address the workspace holds NOW, not the one
   * the request arrived on. A request may land on a retired address, and a link
   * rendered from that would send the next click back through the rename
   * redirect; a slug that was never resolved at all would be a value the
   * browser supplied, sitting in a destination.
   */
  const workspaceSlug = canonicalSlug;
  const [submissions, buyers, licenses] = await Promise.all([
    listSubmissions(organizationId),
    listWorkspaceBuyers(organizationId),
    listLicenses(organizationId),
  ]);

  const buyerNames = new Map(buyers.map((buyer) => [buyer.id, buyer.name]));
  const licenseBySubmission = new Map(
    licenses
      .filter((license) => license.submissionId)
      .map((license) => [license.submissionId, license]),
  );

  return (
    <AppShell active="Submissions" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          description="What was sent, to whom, under which terms, and what happened next."
          eyebrow="System of record"
          title="Submissions"
        />

        <Panel action={<span className="muted">{submissions.length} submissions</span>}>
          {submissions.length === 0 ? (
            <div className="panel-body">
              <p className="section-note">
                No submissions yet. A submission is created when a dispatch is approved.
              </p>
            </div>
          ) : (
            <TableScroll label="Submissions">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Buyer</th>
                    <th scope="col">Status</th>
                    <th scope="col">Assets</th>
                    <th scope="col">Sent</th>
                    <th scope="col">Sale</th>
                    <th scope="col">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((submission) => {
                    const license = licenseBySubmission.get(submission.id);
                    return (
                      <tr key={submission.id}>
                        <td>
                          <strong>{submission.reference}</strong>
                          <small>{submission.deliveryMethod}</small>
                        </td>
                        <td>{buyerNames.get(submission.buyerId ?? "") ?? "—"}</td>
                        <td>
                          <Badge tone={STATUS_TONE[submission.status] ?? "neutral"}>
                            {humanizeStatus(submission.status)}
                          </Badge>
                        </td>
                        <td>{submission.manifest.length}</td>
                        <td>
                          {submission.sentAt ? formatDateTime(submission.sentAt) : "Not sent"}
                        </td>
                        <td>
                          {license ? (
                            <>
                              <strong>{formatMoney(license.saleBase)}</strong>
                              <small>
                                {license.origin === "mastline_sales_engine"
                                  ? "via Mastline"
                                  : "own relationship"}
                              </small>
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <Link className="text-link" href={routes.submission(submission.id)}>
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
