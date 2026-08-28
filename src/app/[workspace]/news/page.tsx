import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader, Panel, TableScroll } from "@/components/primitives";
import {
  DISMISSAL_REASON_MAX,
  allowedOpportunityDecisions,
  listOpportunities,
} from "@/lib/data/opportunities";
import { formatConfidence, formatDateTime, formatElapsed, humanizeStatus } from "@/lib/format";
import {
  KIND_FOR_MODE,
  MODE_DESCRIPTIONS,
  type NewsMode,
  SIGNAL_TONES,
  STATUS_TONES,
  parseNewsMode,
  usefulWindow,
} from "@/lib/news-radar";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { isRecordId } from "@/lib/validation";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { DecisionNotice, OpportunityDecisions } from "./_components/story-actions";

/**
 * News Radar: two modes of one radar.
 *
 * Archive Matches connects current stories to photographs the workspace
 * already owns; Shoot Opportunities surfaces stories and scheduled events that
 * may justify a new shoot. The selected mode lives in the URL (?mode=archive,
 * ?mode=shoot) so it can be linked and bookmarked, and the mode control is the
 * first thing on the screen because choosing between those two jobs IS the
 * screen.
 *
 * Every story here was entered by hand -- there is no live feed yet -- and
 * every signal and confidence is a labelled suggestion with a stated basis.
 * Nothing on this screen contacts a buyer or creates anything by itself.
 */
export default async function NewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ mode?: string; done?: string; story?: string }>;
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
  const role = session.activeWorkspace.role;
  const { mode: modeParam, done: doneParam, story: storyParam } = await searchParams;

  const mode: NewsMode = parseNewsMode(modeParam);
  const mayWrite = can(role, "opportunity.write");
  const mayReview = can(role, "opportunity.review");

  const all = await listOpportunities(organizationId);
  const visible = all.filter((opportunity) => opportunity.kind === KIND_FOR_MODE[mode]);
  const counts = {
    archive: all.filter((opportunity) => opportunity.kind === "archive_match").length,
    shoot: all.filter((opportunity) => opportunity.kind === "shoot_opportunity").length,
  };

  const now = new Date();
  const lastTouched = all.reduce<string | undefined>(
    (latest, opportunity) =>
      !latest || opportunity.updatedAt > latest ? opportunity.updatedAt : latest,
    undefined,
  );

  // The confirmation is only shown for the story the address actually names.
  const done =
    doneParam && storyParam && isRecordId(storyParam)
      ? visible.some((opportunity) => opportunity.id === storyParam)
        ? doneParam
        : undefined
      : undefined;

  const modeTabs: readonly {
    readonly mode: NewsMode;
    readonly label: string;
    readonly count: number;
  }[] = [
    { mode: "archive", label: "Archive Matches", count: counts.archive },
    { mode: "shoot", label: "Shoot Opportunities", count: counts.shoot },
  ];

  return (
    <AppShell active="News radar" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          action={mayWrite ? "Add story" : undefined}
          description="Turn current events into photographs worth selling or shooting."
          eyebrow={
            lastTouched
              ? `Manual story entry · last update ${formatDateTime(lastTouched)}`
              : "Manual story entry · live feeds not yet connected"
          }
          href={mayWrite ? routes.newNewsStory() : undefined}
          title="News Radar"
        />

        <nav aria-label="Radar mode" className="news-mode-switch">
          {modeTabs.map((tab) => (
            <Link
              aria-current={mode === tab.mode ? "page" : undefined}
              className={mode === tab.mode ? "news-mode selected" : "news-mode"}
              href={routes.news({ query: { mode: tab.mode } })}
              key={tab.mode}
            >
              <strong>
                {tab.label}
                <span className="news-mode-count">{tab.count}</span>
              </strong>
              <small>{MODE_DESCRIPTIONS[tab.mode]}</small>
            </Link>
          ))}
        </nav>

        {done && <DecisionNotice done={done} />}

        <Panel>
          {all.length === 0 ? (
            <div className="panel-body">
              <h3 className="empty-title">Nothing on the radar yet</h3>
              <p className="section-note">
                Stories are entered by hand in this release — live monitoring is not connected yet.
                Add a story you are following and record whether it can sell work you already own or
                justifies a new shoot.
              </p>
              {mayWrite ? (
                <div className="actions">
                  <Link className="button blue" href={routes.newNewsStory()}>
                    Add the first story
                  </Link>
                </div>
              ) : (
                <p className="section-note">
                  Your role can read the radar. Adding stories and recording decisions needs an
                  owner or editor.
                </p>
              )}
            </div>
          ) : visible.length === 0 ? (
            <div className="panel-body">
              <h3 className="empty-title">
                {mode === "archive" ? "No archive matches" : "No shoot opportunities"}
              </h3>
              <p className="section-note">
                {mode === "archive"
                  ? "No story here has been connected to work you already own."
                  : "No story here has been marked as worth a new shoot."}{" "}
                <Link
                  className="text-link"
                  href={routes.news({ query: { mode: mode === "archive" ? "shoot" : "archive" } })}
                >
                  {mode === "archive"
                    ? `See the ${counts.shoot} shoot ${counts.shoot === 1 ? "opportunity" : "opportunities"}`
                    : `See the ${counts.archive} archive ${counts.archive === 1 ? "match" : "matches"}`}
                </Link>
                {mayWrite ? " or add a story." : "."}
              </p>
            </div>
          ) : (
            <TableScroll label={mode === "archive" ? "Archive matches" : "Shoot opportunities"}>
              <table className="data-table news-table">
                <thead>
                  <tr>
                    <th scope="col">Signal</th>
                    <th scope="col">Story</th>
                    <th scope="col">Why it matters</th>
                    <th scope="col">Window</th>
                    <th scope="col">Status</th>
                    <th scope="col">Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((opportunity) => {
                    const window = usefulWindow(opportunity.windowClosesAt, now);
                    const decisions = mayReview
                      ? allowedOpportunityDecisions(opportunity.status)
                      : [];
                    return (
                      <tr key={opportunity.id}>
                        <td>
                          <Badge tone={SIGNAL_TONES[opportunity.signal]}>
                            {humanizeStatus(opportunity.signal)}
                          </Badge>
                        </td>
                        <td>
                          <strong>
                            <Link
                              className="story-link"
                              href={routes.newsOpportunity(opportunity.id)}
                            >
                              {opportunity.title}
                            </Link>
                          </strong>
                          <small>
                            {opportunity.sourceName ?? "Source not recorded"}
                            {opportunity.sourcePublishedAt
                              ? ` · ${formatElapsed(opportunity.sourcePublishedAt, now)}`
                              : ""}
                          </small>
                        </td>
                        <td className="news-basis">
                          {opportunity.suggestionBasis ?? (
                            <span className="muted">No basis recorded</span>
                          )}
                          {opportunity.confidence !== undefined && (
                            <small>
                              {formatConfidence(opportunity.confidence)} confidence · suggested
                            </small>
                          )}
                        </td>
                        <td
                          className={
                            window.urgent ? "text-link" : window.closed ? "muted" : undefined
                          }
                        >
                          {window.text}
                        </td>
                        <td>
                          <Badge tone={STATUS_TONES[opportunity.status]}>
                            {humanizeStatus(opportunity.status)}
                          </Badge>
                        </td>
                        <td className="news-row-actions">
                          <Link
                            className="button small blue"
                            href={routes.newsOpportunity(opportunity.id)}
                          >
                            {mode === "archive" ? "Review opportunity" : "Review shoot opportunity"}
                          </Link>
                          {decisions.length > 0 && (
                            <OpportunityDecisions
                              canDismiss={decisions.includes("dismissed")}
                              canWatch={decisions.includes("watching")}
                              compact
                              mode={mode}
                              opportunityId={opportunity.id}
                              reasonMax={DISMISSAL_REASON_MAX}
                              returnTo="list"
                              workspaceSlug={workspaceSlug}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}
          {all.length > 0 && (
            <p className="section-note panel-body">
              Signals and confidence are suggestions with a stated basis, not facts about a story.
              Stories are entered by hand in this release; nothing here contacts a buyer, creates a
              shoot, or sends anything on its own.
              {!mayReview && " Your role can read the radar; decisions need an owner or editor."}
            </p>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
