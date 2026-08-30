import type { EvaluationRecord, ShootBriefView } from "@/lib/data/news-radar-evaluations";
import { formatDateTime } from "@/lib/format";
import { WINDOW_STATE_LABELS, windowState } from "@/lib/news-radar-evaluation";
import styles from "../evaluation.module.css";
import { EvaluationNotices, EvaluationState } from "./archive-matches";
import { EvaluateControl } from "./evaluate-control";

const BREAKDOWN_LABELS: Record<string, string> = {
  eventTime: "Event time recorded",
  upcoming: "Event still ahead",
  location: "Location recorded",
  people: "People recorded",
  source: "Source recorded",
  summary: "Summary recorded",
  baseCity: "Within base city",
  specialty: "Specialty overlap",
};

/**
 * The shoot path: a typed brief built only from recorded facts. Every angle
 * and shot is marked as a suggestion; every gap is listed as something a
 * person confirms, never something the system assumed.
 */
export function ShootBriefPanel({
  workspaceSlug,
  opportunityId,
  evaluation,
  brief,
  canEvaluate,
  now,
}: {
  readonly workspaceSlug: string;
  readonly opportunityId: string;
  readonly evaluation: EvaluationRecord;
  readonly brief: ShootBriefView | null;
  readonly canEvaluate: boolean;
  readonly now: Date;
}) {
  const hasRun = evaluation.state !== "not_evaluated";
  const liveWindow = brief
    ? windowState(now, brief.windowClosesAt, brief.eventStartsAt, brief.eventEndsAt)
    : undefined;

  return (
    <div className="side-card">
      <h3>Shoot brief</h3>
      <EvaluationState evaluation={evaluation} />
      <EvaluationNotices evaluation={evaluation} />

      {!hasRun && (
        <p className="section-note">
          The evaluator reads the story&rsquo;s recorded people, location and event time, the
          path&rsquo;s useful window, and the workspace&rsquo;s own base city and specialties. It
          has not run for this path.
        </p>
      )}

      {canEvaluate ? (
        <EvaluateControl
          label={hasRun ? "Re-evaluate" : "Evaluate"}
          opportunityId={opportunityId}
          workspaceSlug={workspaceSlug}
        />
      ) : (
        <p className="section-note">Running the evaluator needs an owner or editor.</p>
      )}

      {brief && (
        <>
          <p className={styles.meta}>
            <strong>Readiness {brief.readinessScore} / 100</strong> ·{" "}
            {brief.readiness === "ready"
              ? "where and when are recorded"
              : "needs context before it can be briefed"}{" "}
            · evaluated {formatDateTime(brief.evaluatedAt)} · evaluator {brief.evaluatorVersion}
          </p>

          <div className={styles.briefGrid}>
            <section className={styles.briefBlock}>
              <h4>Why now</h4>
              <ul className={styles.list}>
                {brief.whyNow.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>

            <section className={styles.briefBlock}>
              <h4>What is known</h4>
              <ul className={styles.plain}>
                <li>
                  People:{" "}
                  {brief.knownPeople.length > 0 ? brief.knownPeople.join(", ") : "none recorded"}
                </li>
                <li>
                  Organizations:{" "}
                  {brief.knownOrganizations.length > 0
                    ? brief.knownOrganizations.join(", ")
                    : "none recorded"}
                </li>
                <li>Location: {brief.knownLocation ?? "none recorded"}</li>
                <li>
                  Event:{" "}
                  {brief.eventStartsAt ? formatDateTime(brief.eventStartsAt) : "no time recorded"}
                  {brief.eventEndsAt ? ` → ${formatDateTime(brief.eventEndsAt)}` : ""}
                </li>
                <li>
                  Window: {WINDOW_STATE_LABELS[liveWindow ?? brief.windowState]}
                  {brief.windowClosesAt ? ` · closes ${formatDateTime(brief.windowClosesAt)}` : ""}
                  {liveWindow && liveWindow !== brief.windowState
                    ? ` (was ${WINDOW_STATE_LABELS[brief.windowState].toLowerCase()} when evaluated)`
                    : ""}
                </li>
              </ul>
            </section>

            <section className={styles.briefBlock}>
              <h4>Suggested coverage</h4>
              {brief.suggestedAngle || brief.suggestedShots.length > 0 ? (
                <ul className={styles.plain}>
                  {brief.suggestedAngle && (
                    <li>
                      <span className={styles.suggested}>Suggested angle</span>
                      {brief.suggestedAngle}
                    </li>
                  )}
                  {brief.suggestedShots.map((shot) => (
                    <li key={shot}>
                      <span className={styles.suggested}>Suggested shot</span>
                      {shot}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.meta}>
                  Nothing to suggest: no people or location are recorded.
                </p>
              )}
            </section>

            <section className={styles.briefBlock}>
              <h4>Still to confirm</h4>
              <ul className={styles.missing}>
                {brief.missingConfirmations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className={styles.briefBlock}>
              <h4>Relevance</h4>
              <ul className={styles.plain}>
                <li>{brief.geographicRelevance}</li>
                <li>
                  {brief.specialtyRelevance ??
                    "The workspace has recorded no specialties, so specialty relevance is not assessed."}
                </li>
              </ul>
            </section>

            <section className={styles.briefBlock}>
              <h4>Score explanation</h4>
              <dl className={`${styles.breakdown} ${styles.plain}`}>
                {Object.entries(brief.breakdown).map(([key, value]) => (
                  <div key={key}>
                    <dt>{BREAKDOWN_LABELS[key] ?? key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </>
      )}

      <p className="section-note">
        Turning this brief into a draft shoot happens below: the facts are confirmed one by one,
        suggestions stay labelled as suggestions, and creating the shoot stays a deliberate action.
      </p>
    </div>
  );
}
