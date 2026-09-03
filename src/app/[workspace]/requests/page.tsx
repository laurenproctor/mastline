import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel, TableScroll } from "@/components/primitives";
import { countRequestOutcomes, listRequests } from "@/lib/data/requests";
import { listWorkspaceBuyers, listWorkspaceMembers } from "@/lib/data/workspace";
import { REQUEST_STATUSES, type RequestStatus } from "@/lib/domain";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import {
  NOT_PROVIDED,
  describeBudget,
  isPastDeadline,
  nextAction,
  orNotProvided,
  statusLabel,
  statusTone,
} from "@/lib/requests";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";

/**
 * The requests inbox.
 *
 * A dense operational table, ordered the way the day is: what is late, then
 * what is nearly late, then what has just come in. The ordering happens in the
 * data layer so the work queue and this screen cannot form two different
 * opinions about which request matters most.
 *
 * Past deadline is a DERIVED state, computed against the current instant and
 * never written back. Nothing in Mastline moves a request to `expired` because
 * a clock went past a number: there is no scheduler to do it, and a status that
 * changes while nobody is watching is one nobody can rely on. The row says
 * "Past deadline" in words, next to a badge, so the fact survives greyscale,
 * sunlight, and anybody who does not separate red from amber.
 *
 * Filters are a plain GET form. That keeps every filtered view a real,
 * shareable, bookmarkable address, works with the browser's back button, and
 * needs no JavaScript at all -- which matters on the phone this is read on.
 */

const DEADLINE_FILTERS = [
  { value: "", label: "Any deadline" },
  { value: "past_deadline", label: "Past deadline" },
  { value: "next_24h", label: "Due within a day" },
  { value: "next_7d", label: "Due within a week" },
] as const;

/** The statuses the inbox shows when nobody has asked for anything else. */
const OPEN_STATUSES: readonly RequestStatus[] = [
  "draft",
  "new",
  "needs_clarification",
  "qualified",
  "matching",
  "coverage_planned",
  "preparing_response",
  "submitted",
  "negotiating",
];

function isRequestStatus(value: string): value is RequestStatus {
  return (REQUEST_STATUSES as readonly string[]).includes(value);
}

export default async function RequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace: requestedWorkspace } = await params;
  const query = await searchParams;
  const { session, organizationId, canonicalSlug } = await workspaceContext(requestedWorkspace);
  /*
   * Everything below builds on the address the workspace holds NOW, not the one
   * the request arrived on. A request may land on a retired address, and a link
   * rendered from that would send the next click back through the rename
   * redirect; a slug that was never resolved at all would be a value the
   * browser supplied, sitting in a destination.
   */
  const routes = workspaceRoutes(canonicalSlug);
  const role = session.activeWorkspace.role;
  const single = (key: string): string => {
    const value = query[key];
    return typeof value === "string" ? value : "";
  };

  const statusParam = single("status");
  const buyerParam = single("buyer");
  const assigneeParam = single("assignee");
  const deadlineParam = single("deadline");

  // "all" is how somebody asks to see closed requests too. Anything
  // unrecognised falls back to the open set rather than showing nothing.
  const status =
    statusParam === "all"
      ? undefined
      : isRequestStatus(statusParam)
        ? [statusParam]
        : OPEN_STATUSES;

  const assignedTo = assigneeParam === "me" ? session.userId : undefined;

  const [requests, buyers, members, outcomes] = await Promise.all([
    listRequests(organizationId, {
      status,
      buyerId: buyerParam || undefined,
      assignedTo,
      deadline:
        deadlineParam === "past_deadline" ||
        deadlineParam === "next_24h" ||
        deadlineParam === "next_7d"
          ? deadlineParam
          : undefined,
    }),
    listWorkspaceBuyers(organizationId),
    listWorkspaceMembers(organizationId),
    // Two HEAD counts, so "how often do we turn work down" is a number on the
    // screen rather than a query somebody would have to think to run.
    // DECISIONS.md keeps declined separate from cancelled exactly for this.
    countRequestOutcomes(organizationId),
  ]);

  const memberNames = new Map(members.map((member) => [member.userId, member.displayName]));
  const now = new Date();
  const filtered =
    statusParam !== "" || buyerParam !== "" || assigneeParam !== "" || deadlineParam !== "";

  return (
    <AppShell active="Requests" workspace={canonicalSlug}>
      <div className="page">
        <PageHeader
          action={can(role, "request.write") ? "Record a request" : undefined}
          description="What buyers have asked for, and what happened to it. Recording a request sends nothing to anybody."
          eyebrow="Inbound demand"
          href={routes.newRequest()}
          title="Requests"
        />

        <Panel title="Filter">
          <form action={routes.requests()} className="panel-body form-grid" method="get">
            <div className="field">
              <label htmlFor="filter-status">Status</label>
              <select defaultValue={statusParam} id="filter-status" name="status">
                <option value="">Open requests</option>
                <option value="all">Everything, including closed</option>
                {REQUEST_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="filter-buyer">Buyer</label>
              <select defaultValue={buyerParam} id="filter-buyer" name="buyer">
                <option value="">Any buyer</option>
                {buyers.map((buyer) => (
                  <option key={buyer.id} value={buyer.id}>
                    {buyer.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="filter-assignee">Owner</label>
              <select defaultValue={assigneeParam} id="filter-assignee" name="assignee">
                <option value="">Anyone</option>
                <option value="me">Assigned to me</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="filter-deadline">Deadline</label>
              <select defaultValue={deadlineParam} id="filter-deadline" name="deadline">
                {DEADLINE_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="actions">
              <button className="button small blue" type="submit">
                Apply
              </button>
              {filtered && (
                <Link className="button small" href={routes.requests()}>
                  Clear
                </Link>
              )}
            </div>
          </form>
        </Panel>

        <Panel
          action={
            <span className="muted">
              {requests.length} {requests.length === 1 ? "request" : "requests"}
              {/*
                Declined out of everything ever recorded, not out of the rows
                the current filter shows: the rate is about the workspace's
                history, and a filtered view must not change the answer.
              */}
              {outcomes.recorded > 0 &&
                ` · turned down ${outcomes.declined} of ${outcomes.recorded} recorded`}
            </span>
          }
        >
          {requests.length === 0 ? (
            <div className="panel-body">
              <p className="section-note">
                {filtered
                  ? "No requests match those filters. Clear them to see the whole inbox."
                  : "Nothing here yet. When a desk rings, texts, or emails asking for something, record it here so it stops living in your phone."}
              </p>
            </div>
          ) : (
            <TableScroll label="Requests">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col">Request</th>
                    <th scope="col">Buyer</th>
                    <th scope="col">Deliverables</th>
                    <th scope="col">Deadline</th>
                    <th scope="col">Budget</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Next action</th>
                    <th scope="col">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => {
                    const late = isPastDeadline(request, now);
                    return (
                      <tr key={request.id}>
                        <td>
                          <Badge tone={statusTone(request.status)}>
                            {statusLabel(request.status)}
                          </Badge>
                        </td>
                        <td>
                          <strong>{request.title}</strong>
                          <small>{request.reference}</small>
                        </td>
                        <td>{request.buyerName ?? "Not identified"}</td>
                        <td>{orNotProvided(request.deliverables)}</td>
                        <td>
                          {request.responseDeadline ? (
                            <>
                              {formatDateTime(request.responseDeadline)}
                              {/*
                                The state is carried by the word, not the colour.
                                A row read in greyscale, in sunlight, or by
                                somebody who does not separate red from amber
                                still says "Past deadline".
                              */}
                              {late && (
                                <small>
                                  <Badge tone="danger">Past deadline</Badge>
                                </small>
                              )}
                            </>
                          ) : (
                            NOT_PROVIDED
                          )}
                        </td>
                        <td>{describeBudget(request)}</td>
                        <td>
                          {request.assignedTo
                            ? (memberNames.get(request.assignedTo) ?? "A workspace member")
                            : "Unassigned"}
                        </td>
                        <td>{nextAction(request, now)}</td>
                        <td>
                          <Link className="text-link" href={routes.request(request.id)}>
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
