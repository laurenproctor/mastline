/* eslint-disable @next/next/no-img-element -- signed, short-lived private URLs; the image optimizer would re-fetch them unsigned */
import { Badge, type Tone } from "@/components/primitives";
import type { ArchiveMatchView, EvaluationRecord } from "@/lib/data/news-radar-evaluations";
import { formatDateTime, humanizeStatus } from "@/lib/format";
import {
  EVALUATION_STATE_LABELS,
  type EvaluationState,
  FAILURE_LABELS,
  RIGHTS_FACT_LABELS,
} from "@/lib/news-radar-evaluation";
import styles from "../evaluation.module.css";
import { EvaluateControl } from "./evaluate-control";

export const STATE_TONES: Record<EvaluationState, Tone> = {
  not_evaluated: "neutral",
  evaluating: "blue",
  ready: "good",
  needs_context: "warn",
  failed: "danger",
};

const BREAKDOWN_LABELS: Record<string, string> = {
  people: "People",
  organizations: "Organizations",
  keywords: "Keywords",
  location: "Location",
  terms: "Headline words",
  time: "Capture time",
  metadata: "Metadata complete",
  rights: "Rights recorded",
};

/** The run register, shared by both paths. */
export function EvaluationState({ evaluation }: { readonly evaluation: EvaluationRecord }) {
  return (
    <div className={styles.stateRow}>
      <Badge tone={STATE_TONES[evaluation.state]}>
        {EVALUATION_STATE_LABELS[evaluation.state]}
      </Badge>
      <p className={styles.meta}>
        {evaluation.evaluatedAt
          ? `Last run ${formatDateTime(evaluation.evaluatedAt)} · evaluator ${evaluation.evaluatorVersion} · input ${evaluation.inputHash?.slice(0, 12)}`
          : "Never run. Nothing runs on its own."}
      </p>
    </div>
  );
}

export function EvaluationNotices({ evaluation }: { readonly evaluation: EvaluationRecord }) {
  return (
    <>
      {evaluation.state === "failed" && (
        <p className={`${styles.notice} ${styles.noticeFailed}`} role="status">
          <strong>Evaluation failed.</strong>{" "}
          {evaluation.failureCode ? FAILURE_LABELS[evaluation.failureCode] : "Nothing was changed."}
          {evaluation.retainedPreviousResult && evaluation.resultAt
            ? ` The result below is from the last successful run, ${formatDateTime(evaluation.resultAt)} (evaluator ${evaluation.resultEvaluatorVersion}).`
            : " No earlier result is on the record."}
        </p>
      )}
      {evaluation.state !== "failed" && evaluation.resultFromOlderEvaluator && (
        <p className={styles.notice} role="status">
          This result came from evaluator {evaluation.resultEvaluatorVersion}; the current evaluator
          is newer. Re-evaluate to compare like with like.
        </p>
      )}
    </>
  );
}

/**
 * The archive path: ranked real photographs, each with its reasons, its
 * readiness stated precisely, and a private preview when one can be signed.
 */
export function ArchiveMatches({
  workspaceSlug,
  opportunityId,
  evaluation,
  matches,
  canEvaluate,
}: {
  readonly workspaceSlug: string;
  readonly opportunityId: string;
  readonly evaluation: EvaluationRecord;
  readonly matches: readonly ArchiveMatchView[];
  readonly canEvaluate: boolean;
}) {
  const hasRun = evaluation.state !== "not_evaluated";
  const hasResult = evaluation.resultAt !== undefined;

  return (
    <div className="side-card">
      <h3>Matched photographs</h3>
      <EvaluationState evaluation={evaluation} />
      <EvaluationNotices evaluation={evaluation} />

      {hasResult && evaluation.explanation && (
        <p className={styles.meta}>
          <strong>{matches.length}</strong> {matches.length === 1 ? "match" : "matches"} ·{" "}
          {evaluation.explanation}
        </p>
      )}
      {!hasRun && (
        <p className="section-note">
          The evaluator compares this story&rsquo;s recorded people, keywords, location and headline
          against every eligible photograph the workspace owns. It has not run for this path.
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

      {hasResult && matches.length === 0 && evaluation.state !== "failed" && (
        <p className="section-note">
          {evaluation.state === "needs_context"
            ? "Nothing to show until the story carries context to compare on. Record people, keywords or a location above, then re-evaluate."
            : "No photograph in the archive overlaps with this story above the threshold."}
        </p>
      )}

      {matches.length > 0 && (
        <ol className={styles.matchList}>
          {matches.map((match) => (
            <li className={styles.match} key={match.assetId}>
              <div aria-hidden={match.previewUrl ? undefined : "true"} className={styles.preview}>
                {match.previewUrl ? (
                  <img
                    alt={match.asset?.headline ?? match.asset?.canonicalFilename ?? "Preview"}
                    src={match.previewUrl}
                  />
                ) : (
                  <span>Preview unavailable</span>
                )}
              </div>
              <div>
                <div className={styles.matchHead}>
                  <span className={styles.rank}>#{match.rank}</span>
                  <p className={styles.headline}>
                    {match.asset?.headline ??
                      match.asset?.canonicalFilename ??
                      "Photograph no longer readable"}
                  </p>
                  <span className={styles.score}>{match.score} / 100</span>
                </div>
                {match.asset?.caption && <p className={styles.caption}>{match.asset.caption}</p>}
                {match.asset && (
                  <dl className={styles.facts}>
                    <dt>People</dt>
                    <dd>
                      {match.asset.subjects.length > 0
                        ? match.asset.subjects.join(", ")
                        : "None recorded"}
                    </dd>
                    <dt>Captured</dt>
                    <dd>
                      {match.asset.capturedAt
                        ? formatDateTime(match.asset.capturedAt)
                        : "Not recorded"}
                    </dd>
                    <dt>Location</dt>
                    <dd>{match.asset.locationName ?? "Not recorded"}</dd>
                    <dt>File</dt>
                    <dd>{match.asset.canonicalFilename}</dd>
                  </dl>
                )}
                <ul className={styles.reasons}>
                  {match.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {match.asset && (
                  <ul aria-label="Readiness" className={styles.flags}>
                    {match.asset.restricted && (
                      <li className={`${styles.flag} ${styles.flagWarn}`}>
                        Restricted: status is {humanizeStatus(match.asset.status)}; not ready to use
                      </li>
                    )}
                    <li
                      className={`${styles.flag} ${match.asset.metadataComplete ? styles.flagGood : styles.flagWarn}`}
                    >
                      {match.asset.metadataComplete ? "Metadata complete" : "Metadata incomplete"}
                    </li>
                    {match.asset.rights.map((fact) => (
                      <li
                        className={`${styles.flag} ${fact === "rights_incomplete" || fact === "restriction_recorded" ? styles.flagWarn : ""}`}
                        key={fact}
                      >
                        {RIGHTS_FACT_LABELS[fact]}
                      </li>
                    ))}
                  </ul>
                )}
                <details className={styles.breakdown}>
                  <summary>Score breakdown · evaluator {match.evaluatorVersion}</summary>
                  <dl>
                    {Object.entries(match.breakdown).map(([key, value]) => (
                      <div key={key}>
                        <dt>{BREAKDOWN_LABELS[key] ?? key}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="actions">
        <button className="button" disabled type="button">
          Build package
        </button>
      </div>
      <p className="section-note">
        Building a package from these matches is not wired in this phase: a match is a suggestion
        with a stated basis, and the package handoff will select from it deliberately, on the
        dispatch screen. Nothing here writes to a photograph or marks it selected.
      </p>
    </div>
  );
}
