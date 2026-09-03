import Link from "next/link";
import type { HandoffResult } from "@/lib/data/news-radar-handoffs";
import { HANDOFF_OUTCOME_LABELS, SELECTION_REASON_LABELS } from "@/lib/news-radar-handoff";
import styles from "../handoff.module.css";

/**
 * One classified handoff outcome, said plainly.
 *
 * A success names what was made and that it is still a draft; a refusal
 * names why in the words the rules use; a stale evaluation asks the person
 * to look again rather than confirming what is no longer there. No outcome
 * uses celebratory language: nothing was sold, assigned, or confirmed.
 */
export function HandoffResultNotice({
  result,
  kind,
  continueHref,
  continueLabel,
  storyHref,
}: {
  readonly result: HandoffResult;
  readonly kind: "package" | "shoot";
  readonly continueHref?: string;
  readonly continueLabel?: string;
  readonly storyHref: string;
}) {
  if (result.outcome === "created" || result.outcome === "existing") {
    const created = result.outcome === "created";
    const what = kind === "package" ? "draft package" : "draft shoot";
    return (
      <div>
        <p>
          {created
            ? kind === "package"
              ? result.frameCount === undefined
                ? // A count the answer does not carry is not said, rather than said as zero.
                  `A ${what} was created from this evaluation.`
                : `A ${what} with ${result.frameCount} ${result.frameCount === 1 ? "photograph" : "photographs"} was created from this evaluation.`
              : `A ${what} was created from the confirmed facts of this brief.`
            : HANDOFF_OUTCOME_LABELS.existing}{" "}
          It is <strong>still a draft</strong>: nothing was approved, sent, priced or scheduled, and
          nobody was contacted.
          {kind === "package"
            ? " Metadata, rights, terms and the recipient are reviewed in the package review."
            : " Anything left unconfirmed is still unconfirmed on the shoot."}
        </p>
        <div className={styles.actions}>
          {continueHref && (
            <Link className="button blue" href={continueHref}>
              {continueLabel ?? "Continue"}
            </Link>
          )}
          <Link className="button" href={storyHref}>
            Back to the News Radar story
          </Link>
        </div>
      </div>
    );
  }

  if (result.outcome === "invalid_selection") {
    return (
      <p className={`section-note ${styles.warn}`} role="alert">
        <strong>{HANDOFF_OUTCOME_LABELS.invalid_selection}</strong>{" "}
        {result.reason
          ? SELECTION_REASON_LABELS[result.reason]
          : "Check the selection and try again."}
      </p>
    );
  }

  if (result.outcome === "stale_evaluation") {
    return (
      <p className={`section-note ${styles.warn}`} role="alert">
        <strong>Re-evaluated since you loaded this page.</strong>{" "}
        {HANDOFF_OUTCOME_LABELS.stale_evaluation}{" "}
        <Link className="text-link" href={storyHref}>
          Reload the current result
        </Link>
      </p>
    );
  }

  return (
    <p className={`section-note ${styles.warn}`} role="alert">
      {HANDOFF_OUTCOME_LABELS[result.outcome]}
    </p>
  );
}
