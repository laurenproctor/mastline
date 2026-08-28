import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel } from "@/components/primitives";
import { listActivity } from "@/lib/data/activity";
import { getRequest, getRequestSensitiveNote } from "@/lib/data/requests";
import { listWorkspaceBuyers, listWorkspaceMembers } from "@/lib/data/workspace";
import { formatDateTime, formatElapsed } from "@/lib/format";
import { can } from "@/lib/permissions";
import {
  NOT_PROVIDED,
  describeBudget,
  describeQuantity,
  isClosed,
  isPastDeadline,
  isPastExpiry,
  nextAction,
  orNotProvided,
  statusLabel,
  statusTone,
} from "@/lib/requests";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { AssignPanel } from "../_components/assign-panel";
import { LifecyclePanel } from "../_components/lifecycle-panel";
import { RequestForm } from "../_components/request-form";

/**
 * One request, and everything recorded about it.
 *
 * The layout follows the questions in the order somebody asks them: what did
 * they want, on what terms, who is answering it, where has it got to, and what
 * has happened so far. Anything the buyer did not say is rendered as "Not
 * provided" -- never as a default term, because a term nobody negotiated must
 * not turn up later looking like one that was.
 */

/** One row of a definition list, with silence rendered as silence. */
function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="detail-block">
      <h3>{label}</h3>
      <p className={value ? undefined : "muted"}>{value ?? NOT_PROVIDED}</p>
    </div>
  );
}

export default async function RequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; requestId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace: requestedWorkspace, requestId } = await params;
  const query = await searchParams;
  const { session, organizationId, canonicalSlug } = await workspaceContext(requestedWorkspace);
  const routes = workspaceRoutes(canonicalSlug);
  const role = session.activeWorkspace.role;

  const request = await getRequest(organizationId, requestId);
  // The same answer for a request in another workspace, one that was purged,
  // and one that never existed. Anything more specific would confirm to an
  // outsider that a particular studio holds a particular record.
  if (!request) notFound();

  const canWrite = can(role, "request.write");
  const canSeeSourceNote = can(role, "sensitive_note.read");

  const [buyers, members, activity, sensitiveNote] = await Promise.all([
    listWorkspaceBuyers(organizationId),
    listWorkspaceMembers(organizationId),
    listActivity(organizationId, { entityId: request.id, limit: 40 }),
    canSeeSourceNote ? getRequestSensitiveNote(organizationId, request.id) : Promise.resolve(null),
  ]);

  const now = new Date();
  const late = isPastDeadline(request, now);
  const lapsed = isPastExpiry(request, now);
  const closed = isClosed(request.status);
  const editable = canWrite && !closed;

  const assignable = members
    .filter((member) => member.status === "active")
    .map((member) => ({
      userId: member.userId,
      displayName: member.displayName,
      role: member.role,
    }));

  const confirmation =
    query.recorded === "1"
      ? "Request recorded. Nothing was sent to the buyer."
      : query.recorded === "again"
        ? "That request was already recorded, so this is the one it made."
        : query.saved === "1"
          ? "Changes saved."
          : query.assigned === "1"
            ? "Owner saved. Nobody was notified."
            : query.assigned === "released"
              ? "Released back to the inbox."
              : typeof query.moved === "string"
                ? `Recorded as ${query.moved.replace(/_/g, " ")}.`
                : null;

  return (
    <AppShell active="Requests" workspace={canonicalSlug}>
      <div className="page">
        <PageHeader
          description={request.title}
          eyebrow={`Request · ${request.reference}`}
          title={statusLabel(request.status)}
        />

        {confirmation && (
          <p className="inspector-saved" role="status">
            {confirmation}
          </p>
        )}

        <div className="metrics">
          <div className="metric">
            <span>Status</span>
            <strong>
              <Badge tone={statusTone(request.status)}>{statusLabel(request.status)}</Badge>
            </strong>
            <small>{nextAction(request, now)}</small>
          </div>
          <div className="metric">
            <span>Deadline</span>
            <strong>
              {request.responseDeadline ? formatDateTime(request.responseDeadline) : NOT_PROVIDED}
            </strong>
            {/*
              Past deadline is derived here, against the current instant, and
              never written back: there is no scheduler in this system, and a
              status that changes while nobody is watching is one nobody can
              trust. The word carries the state, so colour is a second signal.
            */}
            {late && <small className="danger">Past deadline</small>}
            {lapsed && !late && <small className="warn">Past its expiry date</small>}
          </div>
          <div className="metric">
            <span>Budget</span>
            <strong>{describeBudget(request)}</strong>
            <small>
              {request.budgetDisclosed ? "Stated by the buyer" : "The buyer did not say"}
            </small>
          </div>
          <div className="metric">
            <span>Buyer</span>
            <strong>{request.buyerName ?? "Not identified"}</strong>
            <small>{orNotProvided(request.receivedVia?.replace(/_/g, " "))}</small>
          </div>
        </div>

        <div className="panel-grid">
          <div className="stack">
            <Panel title="Brief">
              <div className="panel-body">
                <p>{orNotProvided(request.brief)}</p>
                <div className="three-col">
                  <Fact label="Subject or event" value={request.subjectOrEvent} />
                  <Fact
                    label="People named"
                    value={
                      request.subjectNames.length > 0 ? request.subjectNames.join(", ") : undefined
                    }
                  />
                  <Fact
                    label="Topics"
                    value={request.topics.length > 0 ? request.topics.join(", ") : undefined}
                  />
                  <Fact
                    label="Event"
                    value={request.eventAt ? formatDateTime(request.eventAt) : undefined}
                  />
                  <Fact label="Location" value={request.locationName} />
                  <Fact
                    label="Expires"
                    value={request.expiresAt ? formatDateTime(request.expiresAt) : undefined}
                  />
                </div>
              </div>
            </Panel>

            {canSeeSourceNote && sensitiveNote && (
              <Panel title="Confidential">
                <div className="panel-body">
                  <p className="section-note">
                    Owners and editors only. This is never copied into the request, the activity
                    log, or an export run by another role.
                  </p>
                  <div className="three-col">
                    <Fact label="Source note" value={sensitiveNote.sourceNote} />
                    <Fact label="Confidential location" value={sensitiveNote.confidentialLocation} />
                    <Fact label="Confidential identity" value={sensitiveNote.confidentialIdentity} />
                  </div>
                </div>
              </Panel>
            )}

            <Panel title="Deliverables">
              <div className="panel-body">
                <div className="three-col">
                  <Fact label="What they want" value={request.deliverables} />
                  <Fact
                    label="Formats"
                    value={
                      request.requestedFormats.length > 0
                        ? request.requestedFormats.join(", ")
                        : undefined
                    }
                  />
                  <Fact label="Orientation" value={request.orientation} />
                  <Fact
                    label="Approximate quantity"
                    value={describeQuantity(request.approximateQuantity)}
                  />
                  <Fact label="Delivery requirements" value={request.deliveryRequirements} />
                  <Fact label="Usage restrictions" value={request.usageRestrictions} />
                </div>
              </div>
            </Panel>

            <Panel title="Commercial terms">
              <div className="panel-body">
                <p className="section-note">
                  Only what the buyer stated. A blank term has not been agreed, and is not a
                  worldwide, perpetual, or unrestricted one.
                </p>
                <div className="three-col">
                  <Fact label="Usage and media" value={request.usageMedia} />
                  <Fact label="Territory" value={request.territory} />
                  <Fact label="Duration" value={request.usageDuration} />
                  <Fact label="Exclusivity" value={request.exclusivity} />
                  <Fact label="Budget" value={describeBudget(request)} />
                  <Fact
                    label="Embargo"
                    value={request.embargoUntil ? formatDateTime(request.embargoUntil) : undefined}
                  />
                </div>
              </div>
            </Panel>

            {editable && (
              <Panel title="Edit this request">
                <div className="panel-body">
                  <RequestForm
                    buyers={buyers.map((buyer) => ({ id: buyer.id, name: buyer.name }))}
                    canCreateBuyer={can(role, "buyer.write")}
                    canSeeSourceNote={canSeeSourceNote}
                    request={request}
                    sensitiveNote={sensitiveNote}
                    workspaceSlug={canonicalSlug}
                  />
                </div>
              </Panel>
            )}

            {!editable && canWrite && closed && (
              <Panel title="Edit this request">
                <div className="panel-body">
                  <p className="section-note">
                    This request is closed. Its record is kept exactly as it was, because rewriting
                    the terms of a request that was already lost would change what was lost.
                  </p>
                </div>
              </Panel>
            )}
          </div>

          <div className="stack">
            <Panel title="Where it has got to">
              <LifecyclePanel
                canWrite={canWrite}
                request={request}
                workspaceSlug={canonicalSlug}
              />
            </Panel>

            <Panel title="Who is answering it">
              <AssignPanel
                canWrite={canWrite}
                members={assignable}
                request={request}
                workspaceSlug={canonicalSlug}
              />
            </Panel>

            <Panel title="History">
              {activity.length === 0 ? (
                <div className="panel-body">
                  <p className="section-note">Nothing recorded against this request yet.</p>
                </div>
              ) : (
                <ul className="list activity">
                  {activity.map((event) => (
                    <li className="list-row" key={event.id}>
                      <div>
                        <h3>{event.summary}</h3>
                        <p className="muted">{formatElapsed(event.createdAt, now)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Reference">
              <div className="panel-body">
                <p>
                  Quote <strong>{request.reference}</strong> when you speak to the desk.
                </p>
                <p className="section-note">
                  Recorded {formatDateTime(request.createdAt)}
                  {request.qualifiedAt && ` · qualified ${formatDateTime(request.qualifiedAt)}`}
                  {request.closedAt && ` · closed ${formatDateTime(request.closedAt)}`}
                </p>
                <p className="section-note">
                  <a className="text-link" href={routes.requests()}>
                    Back to the inbox <span aria-hidden="true">→</span>
                  </a>
                </p>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
