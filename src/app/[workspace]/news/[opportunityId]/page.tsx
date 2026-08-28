import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel } from "@/components/primitives";
import { listActivity } from "@/lib/data/activity";
import {
  DISMISSAL_REASON_MAX,
  allowedOpportunityDecisions,
  getOpportunity,
} from "@/lib/data/opportunities";
import { listWorkspaceMembers } from "@/lib/data/workspace";
import { formatConfidence, formatDateTime, humanizeStatus } from "@/lib/format";
import {
  KIND_LABELS,
  MODE_FOR_KIND,
  SIGNAL_TONES,
  STATUS_TONES,
  usefulWindow,
} from "@/lib/news-radar";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { DecisionNotice, OpportunityDecisions } from "../_components/story-actions";

/**
 * One opportunity, in full.
 *
 * Three registers, kept visibly apart: the story's source facts, which
 * somebody typed; the suggestion -- signal, confidence, basis -- which is a
 * claim with a stated reason; and the workspace's own decisions, which are the
 * only thing this screen can change. The regions each mode will grow into
 * later (matched photographs, a shoot brief) are drawn honestly as not yet
 * built, with no invented records inside them.
 */
export default async function OpportunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; opportunityId: string }>;
  searchParams: Promise<{ done?: string; created?: string }>;
}) {
  const { workspace: requestedWorkspace, opportunityId } = await params;
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
  const { done: doneParam, created } = await searchParams;

  // A malformed id, an id from another workspace, and an id that never existed
  // all answer the same way: not found.
  const opportunity = await getOpportunity(organizationId, opportunityId);
  if (!opportunity) notFound();

  const mode = MODE_FOR_KIND[opportunity.kind];
  const mayReview = can(role, "opportunity.review");
  const decisions = mayReview ? allowedOpportunityDecisions(opportunity.status) : [];
  const now = new Date();
  const window = usefulWindow(opportunity.windowClosesAt, now);

  const [activity, members] = await Promise.all([
    listActivity(organizationId, { entityType: "opportunity", entityId: opportunity.id }),
    listWorkspaceMembers(organizationId),
  ]);
  const enteredBy = opportunity.createdBy
    ? (members.find((member) => member.userId === opportunity.createdBy)?.displayName ??
      opportunity.createdBy.slice(0, 8))
    : undefined;

  return (
    <AppShell active="News radar" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          action="Back to News Radar"
          description={`${KIND_LABELS[opportunity.kind]} · entered by hand`}
          eyebrow={`News Radar · ${mode === "archive" ? "Archive Matches" : "Shoot Opportunities"}`}
          href={routes.news({ query: { mode } })}
          title={opportunity.title}
        />

        {created === "1" && (
          <p className="inspector-saved" role="status">
            Story added to the radar. It is a private record — nobody was contacted and nothing was
            created or sent.
          </p>
        )}
        {doneParam && <DecisionNotice done={doneParam} />}

        <div className="panel-grid">
          <Panel title="The story">
            <div className="side-card">
              <dl className="confirm-list">
                <div>
                  <dt>Headline</dt>
                  <dd>{opportunity.title}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{opportunity.sourceName ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Source link</dt>
                  <dd>
                    {opportunity.sourceUrl ? (
                      <a
                        className="text-link"
                        href={opportunity.sourceUrl}
                        rel="noreferrer nofollow"
                        target="_blank"
                      >
                        {opportunity.sourceUrl}
                      </a>
                    ) : (
                      "Not recorded"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Published</dt>
                  <dd>
                    {opportunity.sourcePublishedAt
                      ? formatDateTime(opportunity.sourcePublishedAt)
                      : "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt>Entered by</dt>
                  <dd>
                    {enteredBy ?? "Not recorded"} · {formatDateTime(opportunity.createdAt)}
                  </dd>
                </div>
              </dl>
              {opportunity.summary && <p>{opportunity.summary}</p>}
            </div>

            <div className="side-card">
              <h3>Why it matters — a suggestion, not a fact</h3>
              <dl className="confirm-list">
                <div>
                  <dt>Signal</dt>
                  <dd>
                    <Badge tone={SIGNAL_TONES[opportunity.signal]}>
                      {humanizeStatus(opportunity.signal)}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>
                    {opportunity.confidence !== undefined
                      ? `${formatConfidence(opportunity.confidence)} · suggested`
                      : "None claimed"}
                  </dd>
                </div>
                <div>
                  <dt>Basis</dt>
                  <dd>{opportunity.suggestionBasis ?? "No basis recorded"}</dd>
                </div>
              </dl>
              <p className="section-note">
                In this release the signal, confidence, and basis were typed by the person who
                entered the story. When live matching exists its suggestions will appear the same
                way: labelled, with a stated basis, and editable by a person.
              </p>
            </div>

            {opportunity.kind === "archive_match" ? (
              <div className="side-card future-region">
                <h3>Matched photographs</h3>
                <p className="section-note">
                  Archive matching is not built yet. When it is, the photographs this story could
                  reactivate will appear here, each as a labelled suggestion with its own basis and
                  confidence — never as an assertion.
                </p>
                <div className="actions">
                  <button className="button" disabled type="button">
                    Build package
                  </button>
                </div>
                <p className="section-note">
                  Building a package from archive matches stays unavailable until matched
                  photographs exist to build it from.
                </p>
              </div>
            ) : (
              <div className="side-card future-region">
                <h3>Shoot brief</h3>
                <p className="section-note">
                  The handoff from this story to a new shoot is not built yet. When it is, reviewing
                  this opportunity will offer a pre-filled shoot brief — using only the facts
                  recorded here, never invented event details — and creating the shoot will remain a
                  deliberate action on the Create Shoot screen.
                </p>
                <div className="actions">
                  <button className="button" disabled type="button">
                    Create shoot from this story
                  </button>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Where this stands">
            <div className="side-card">
              <Badge tone={STATUS_TONES[opportunity.status]}>
                {humanizeStatus(opportunity.status)}
              </Badge>
              <dl className="confirm-list">
                <div>
                  <dt>Useful window</dt>
                  <dd className={window.urgent ? "text-link" : undefined}>
                    {window.text}
                    {opportunity.windowClosesAt &&
                      !window.closed &&
                      ` · until ${formatDateTime(opportunity.windowClosesAt)}`}
                  </dd>
                </div>
                {opportunity.status === "dismissed" && (
                  <div>
                    <dt>Why it was set aside</dt>
                    <dd>{opportunity.dismissalReason ?? "No reason recorded"}</dd>
                  </div>
                )}
                {opportunity.actedAt && (
                  <div>
                    <dt>Acted</dt>
                    <dd>{formatDateTime(opportunity.actedAt)}</dd>
                  </div>
                )}
                <div>
                  <dt>Last change</dt>
                  <dd>{formatDateTime(opportunity.updatedAt)}</dd>
                </div>
              </dl>
            </div>

            {decisions.length > 0 ? (
              <OpportunityDecisions
                canDismiss={decisions.includes("dismissed")}
                canWatch={decisions.includes("watching")}
                mode={mode}
                opportunityId={opportunity.id}
                reasonMax={DISMISSAL_REASON_MAX}
                returnTo="detail"
                workspaceSlug={workspaceSlug}
              />
            ) : mayReview ? (
              <div className="side-card">
                <h3>This decision is recorded</h3>
                <p className="section-note">
                  An opportunity that was acted on, dismissed, or expired is not reopened in place.
                  Revisiting the story is a fresh entry, made deliberately.
                </p>
              </div>
            ) : (
              <div className="side-card">
                <h3>Read-only for your role</h3>
                <p className="section-note">
                  You can read every story and its history. Recording a decision needs an owner or
                  editor.
                </p>
              </div>
            )}

            <div className="side-card">
              <h3>History</h3>
              {activity.length === 0 ? (
                <p className="section-note">No recorded activity yet.</p>
              ) : (
                <ul className="history-list">
                  {activity.map((event) => (
                    <li key={event.id}>
                      <strong>{event.summary}</strong>
                      <small>{formatDateTime(event.createdAt)}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="side-card">
              <p className="section-note">
                Mastline records stories and routes decisions. Nothing on this screen contacts a
                buyer, creates a shoot or package, or sends anything anywhere.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
