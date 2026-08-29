import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel } from "@/components/primitives";
import { listActivity } from "@/lib/data/activity";
import {
  getEvaluation,
  getShootBrief,
  getSignalContext,
  listArchiveMatches,
  unevaluated,
} from "@/lib/data/news-radar-evaluations";
import {
  DISMISSAL_REASON_MAX,
  allowedOpportunityDecisions,
  getOpportunity,
  getSiblingPath,
} from "@/lib/data/opportunities";
import { listWorkspaceMembers } from "@/lib/data/workspace";
import { formatConfidence, formatDateTime, humanizeStatus } from "@/lib/format";
import { MODE_FOR_KIND, SIGNAL_TONES, STATUS_TONES, usefulWindow } from "@/lib/news-radar";
import { suggestContext } from "@/lib/news-radar-context";
import { FAILURE_LABELS, type EvaluationFailureCode } from "@/lib/news-radar-evaluation";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { DecisionNotice, OpportunityDecisions } from "../_components/story-actions";
import { ArchiveMatches } from "./_components/archive-matches";
import { ContextPanel } from "./_components/context-panel";
import { ShootBriefPanel } from "./_components/shoot-brief";

const EVALUATED_MESSAGES: Record<string, string> = {
  recorded: "Evaluated. The result below was computed from the recorded facts and written once.",
  unchanged:
    "Nothing to recompute: the same evaluator has already run over exactly these inputs. Nothing was written.",
};

const CONTEXT_MESSAGES: Record<string, string> = {
  saved: "Context saved. Both paths read it; re-evaluate either to apply it.",
  accepted: "Suggestion recorded as a fact, with its basis kept beside it.",
};

const PATH_LABELS = {
  archive_match: "Archive match path",
  shoot_opportunity: "Shoot opportunity path",
} as const;

/**
 * One evaluation path of one story, in full.
 *
 * Three registers, kept visibly apart: the story's canonical facts, shared
 * with the other path and owned by the news signal; this path's suggestion --
 * signal, confidence, basis -- which is a claim with a stated reason; and
 * this path's own lifecycle, which is the only thing the screen can change.
 * The header says WHICH path is being reviewed, and the other evaluation of
 * the same story is one link away.
 *
 * Each mode's region holds the deterministic evaluation of this path: ranked
 * real photographs with their reasons on the archive path, a typed brief on
 * the shoot path -- both computed only from recorded facts, only when asked,
 * and both drawn with their state, their evaluator, and what is missing said
 * out loud. The story's structured context, which both evaluations read, is
 * recorded here too, in registers that keep source facts, a person's entries,
 * and the system's suggestions visibly apart.
 */
export default async function OpportunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; opportunityId: string }>;
  searchParams: Promise<{
    done?: string;
    created?: string;
    already?: string;
    context?: string;
    evaluated?: string;
    failure?: string;
  }>;
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
  const {
    done: doneParam,
    created,
    already,
    context: contextParam,
    evaluated: evaluatedParam,
    failure: failureParam,
  } = await searchParams;

  // A malformed id, an id from another workspace, and an id that never existed
  // all answer the same way: not found.
  const opportunity = await getOpportunity(organizationId, opportunityId);
  if (!opportunity) notFound();
  const story = opportunity.story;

  const mode = MODE_FOR_KIND[opportunity.kind];
  const mayReview = can(role, "opportunity.review");
  const mayWrite = can(role, "opportunity.write");
  const decisions = mayReview ? allowedOpportunityDecisions(opportunity.status) : [];
  const now = new Date();
  const window = usefulWindow(opportunity.windowClosesAt, now);

  const [sibling, pathActivity, signalActivity, members, stored, evaluationRow, matches, brief] =
    await Promise.all([
      getSiblingPath(organizationId, opportunity.newsSignalId, opportunity.id),
      listActivity(organizationId, { entityType: "opportunity", entityId: opportunity.id }),
      listActivity(organizationId, {
        entityType: "news_signal",
        entityId: opportunity.newsSignalId,
      }),
      listWorkspaceMembers(organizationId),
      getSignalContext(organizationId, opportunity.newsSignalId),
      getEvaluation(organizationId, opportunity.id),
      opportunity.kind === "archive_match"
        ? listArchiveMatches(organizationId, opportunity.id)
        : Promise.resolve([]),
      opportunity.kind === "shoot_opportunity"
        ? getShootBrief(organizationId, opportunity.id)
        : Promise.resolve(null),
    ]);
  const evaluation = evaluationRow ?? unevaluated(opportunity);
  const suggestions = suggestContext(story, stored);
  const evaluatedMessage =
    evaluatedParam === "failed"
      ? `Evaluation failed. ${FAILURE_LABELS[(failureParam ?? "write_failed") as EvaluationFailureCode] ?? FAILURE_LABELS.write_failed}`
      : evaluatedParam
        ? EVALUATED_MESSAGES[evaluatedParam]
        : undefined;
  const contextMessage = contextParam ? CONTEXT_MESSAGES[contextParam] : undefined;
  // One history: the canonical entry, then the decisions made on this path.
  // The other path's decisions live on its own screen.
  const activity = [...pathActivity, ...signalActivity].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const enteredBy = story.createdBy
    ? (members.find((member) => member.userId === story.createdBy)?.displayName ??
      story.createdBy.slice(0, 8))
    : undefined;

  return (
    <AppShell active="News radar" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          action="Back to News Radar"
          description={`${PATH_LABELS[opportunity.kind]} · one of two evaluations of this story`}
          eyebrow={`News Radar · ${mode === "archive" ? "Archive Matches" : "Shoot Opportunities"}`}
          href={routes.news({ query: { mode } })}
          title={story.title}
        />

        {created === "1" && (
          <p className="inspector-saved" role="status">
            Story added to the radar — once. It now has an archive evaluation and a shoot
            evaluation, each decided on its own. Nobody was contacted and nothing was created or
            sent.
          </p>
        )}
        {already === "1" && (
          <p className="inspector-saved" role="status">
            This story was already on the radar, so nothing new was created. You are looking at the
            record as it stands.
          </p>
        )}
        {doneParam && <DecisionNotice done={doneParam} />}
        {contextMessage && (
          <p className="inspector-saved" role="status">
            {contextMessage}
          </p>
        )}
        {evaluatedMessage && (
          <p className="inspector-saved" role="status">
            {evaluatedMessage}
          </p>
        )}

        <div className="panel-grid">
          <Panel title="The story — shared by both paths">
            <div className="side-card">
              <dl className="confirm-list">
                <div>
                  <dt>Headline</dt>
                  <dd>{story.title}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{story.sourceName ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Source link</dt>
                  <dd>
                    {story.sourceUrl ? (
                      <a
                        className="text-link"
                        href={story.sourceUrl}
                        rel="noreferrer nofollow"
                        target="_blank"
                      >
                        {story.sourceUrl}
                      </a>
                    ) : (
                      "Not recorded"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Published</dt>
                  <dd>
                    {story.sourcePublishedAt
                      ? formatDateTime(story.sourcePublishedAt)
                      : "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt>Entered by</dt>
                  <dd>
                    {enteredBy ?? "Not recorded"} · {formatDateTime(story.createdAt)}
                  </dd>
                </div>
              </dl>
              {story.summary && <p>{story.summary}</p>}
              <p className="section-note">
                These facts exist once. Both evaluations read them from the same record, so they
                cannot disagree between the Archive and Shoot views.
              </p>
            </div>

            <div className="side-card">
              <h3>Why it matters here — a suggestion, not a fact</h3>
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
                This suggestion belongs to the {PATH_LABELS[opportunity.kind].toLowerCase()}. In
                this release it was typed by the person who entered the story; when live matching
                exists its suggestions will appear the same way: labelled, with a stated basis, and
                editable by a person.
              </p>
            </div>

            <ContextPanel
              canEdit={mayWrite}
              opportunityId={opportunity.id}
              stored={stored}
              story={story}
              suggestions={suggestions}
              workspaceSlug={workspaceSlug}
            />

            {opportunity.kind === "archive_match" ? (
              <ArchiveMatches
                canEvaluate={mayWrite}
                evaluation={evaluation}
                matches={matches}
                opportunityId={opportunity.id}
                workspaceSlug={workspaceSlug}
              />
            ) : (
              <ShootBriefPanel
                brief={brief}
                canEvaluate={mayWrite}
                evaluation={evaluation}
                now={now}
                opportunityId={opportunity.id}
                workspaceSlug={workspaceSlug}
              />
            )}
          </Panel>

          <Panel title={`Where the ${mode === "archive" ? "archive" : "shoot"} path stands`}>
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

            <div className="side-card">
              <h3>The same story, on the other path</h3>
              {sibling ? (
                <>
                  <p>
                    {PATH_LABELS[sibling.kind]} · {humanizeStatus(sibling.status)}
                  </p>
                  <div className="actions">
                    <Link className="button small" href={routes.newsOpportunity(sibling.id)}>
                      {sibling.kind === "archive_match"
                        ? "View the archive evaluation"
                        : "View the shoot evaluation"}
                    </Link>
                  </div>
                  <p className="section-note">
                    Decided separately: what happens here does not move it, and what happens there
                    does not move this.
                  </p>
                </>
              ) : (
                <p className="section-note">
                  This story predates two-path evaluation and carries only this one. An evaluation
                  nobody made was not invented for it.
                </p>
              )}
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
                  A path that was acted on, dismissed, or expired is not reopened in place. The
                  story’s other path, if open, is still decided on its own screen.
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
              <p className="section-note">
                The story’s entry and this path’s decisions. The other path keeps its own history.
              </p>
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
