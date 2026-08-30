"use client";

/* eslint-disable @next/next/no-img-element -- signed, short-lived private URLs; the image optimizer would re-fetch them unsigned */
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { ArchiveMatchView, EvaluationRecord } from "@/lib/data/news-radar-evaluations";
import type { HandoffRecord, MatchPlacement } from "@/lib/data/news-radar-handoffs";
import { formatDateTime } from "@/lib/format";
import { RIGHTS_FACT_LABELS } from "@/lib/news-radar-evaluation";
import {
  INELIGIBLE_LABELS,
  type SelectableMatch,
  groupMatchesByShoot,
  ineligibleReason,
  reviewSelection,
} from "@/lib/news-radar-handoff";
import { type HandoffState, createArchivePackageAction } from "../handoff-actions";
import evaluation from "../evaluation.module.css";
import styles from "../handoff.module.css";
import { HandoffResultNotice } from "./handoff-result";

const INITIAL: HandoffState = {};

/**
 * The archive handoff: select matched photographs, review the selection,
 * confirm what will be created, create one draft package, continue.
 *
 * Every selection is explicit. Nothing is pre-ticked, a frame that cannot
 * proceed says why in place and cannot be ticked, and the confirmation step
 * repeats every warning before the one button that writes. The result is a
 * draft that lands in the existing package review; approval, terms, and the
 * recipient stay where they have always been.
 */
export function ArchiveHandoff({
  workspaceSlug,
  opportunityId,
  storyTitle,
  evaluationRecord,
  matches,
  placements,
  existing,
  continueHref,
  canAct,
  timeZone,
  storyHref,
}: {
  readonly workspaceSlug: string;
  readonly opportunityId: string;
  readonly storyTitle: string;
  readonly evaluationRecord: EvaluationRecord;
  readonly matches: readonly ArchiveMatchView[];
  readonly placements: ReadonlyMap<string, MatchPlacement>;
  /** The handoff already on record for this path, if any. */
  readonly existing: HandoffRecord | null;
  /** Where the existing draft is continued. */
  readonly continueHref?: string;
  readonly canAct: boolean;
  readonly timeZone: string;
  readonly storyHref: string;
}) {
  const [state, formAction, pending] = useActionState(
    createArchivePackageAction.bind(null, workspaceSlug, opportunityId),
    INITIAL,
  );
  // One key per rendered form. A double click, a retry, or a re-posted form
  // carries the same one, and the database answers with what the first made.
  const [requestKey] = useState(() => crypto.randomUUID());
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [step, setStep] = useState<"select" | "confirm">("select");

  const selectable = useMemo<readonly SelectableMatch[]>(
    () =>
      matches.map((match) => {
        const placement = placements.get(match.assetId);
        return {
          assetId: match.assetId,
          rank: match.rank,
          shootId: placement?.shootId,
          shootTitle: placement?.shootTitle,
          restricted: match.asset?.restricted ?? true,
          metadataComplete: match.asset?.metadataComplete ?? false,
          rights: match.asset?.rights ?? ["rights_incomplete"],
          hasFile: placement?.hasFile ?? false,
        };
      }),
    [matches, placements],
  );
  const byId = useMemo(() => new Map(matches.map((match) => [match.assetId, match])), [matches]);
  const groups = useMemo(() => groupMatchesByShoot(selectable), [selectable]);
  const review = useMemo(() => reviewSelection(selectable, selected), [selectable, selected]);
  const selectedShoot = review.shootIds[0];

  const result = state.result;
  const hasResult = evaluationRecord.resultAt !== undefined;
  function toggle(assetId: string, on: boolean) {
    setSelected((current) =>
      on ? [...new Set([...current, assetId])] : current.filter((id) => id !== assetId),
    );
  }

  // ---- Already handed off, or just handed off ------------------------------

  if (result && (result.outcome === "created" || result.outcome === "existing")) {
    return (
      <section aria-labelledby="archive-handoff-heading" className={styles.result} role="status">
        <h4 id="archive-handoff-heading">
          {result.outcome === "created"
            ? "Draft package created"
            : "This path was already handed off"}
        </h4>
        <HandoffResultNotice
          continueHref={state.continueHref}
          continueLabel={state.continueLabel}
          kind="package"
          result={result}
          storyHref={storyHref}
        />
      </section>
    );
  }

  if (existing) {
    return (
      <section aria-labelledby="archive-handoff-heading" className={styles.result}>
        <h4 id="archive-handoff-heading">Handed off to a draft package</h4>
        <p>
          A draft package was created from this evaluation on{" "}
          {formatDateTime(existing.createdAt, timeZone)} (evaluator {existing.evaluatorVersion} ·
          input {existing.inputHash.slice(0, 12)}). It is still a draft: nothing was approved and
          nobody was contacted. The package review is where it continues.
        </p>
        <div className={styles.actions}>
          {continueHref && (
            <Link className="button blue" href={continueHref}>
              Continue in the package review
            </Link>
          )}
        </div>
      </section>
    );
  }

  // ---- Nothing to select from ---------------------------------------------

  if (!hasResult || evaluationRecord.resultState === "needs_context") {
    return (
      <section aria-labelledby="archive-handoff-heading" className={styles.result}>
        <h4 id="archive-handoff-heading">Build a draft package from the matches</h4>
        <p className="section-note">
          {!hasResult
            ? "Nothing to select from until the archive evaluation has run. Evaluate the path above; nothing runs on its own."
            : "The last evaluation needed more context and returned no matches. Record people, keywords or a location above and re-evaluate."}
        </p>
      </section>
    );
  }

  if (matches.length === 0) {
    return (
      <section aria-labelledby="archive-handoff-heading" className={styles.result}>
        <h4 id="archive-handoff-heading">Build a draft package from the matches</h4>
        <p className="section-note">
          The evaluation found no photograph above the threshold, so there is nothing to hand off.
          Re-evaluate after recording more context, or after new photographs are imported.
        </p>
      </section>
    );
  }

  if (!canAct) {
    return (
      <section aria-labelledby="archive-handoff-heading" className={styles.result}>
        <h4 id="archive-handoff-heading">Build a draft package from the matches</h4>
        <p className="section-note">
          Creating a draft package from these matches needs an owner or editor. You can read every
          match and its reasons.
        </p>
      </section>
    );
  }

  // ---- Selecting and confirming --------------------------------------------

  const count = review.eligible.length;
  const canReview = count > 0 && review.refusal === undefined;

  return (
    <form
      action={formAction}
      aria-labelledby="archive-handoff-heading"
      className={styles.layout}
      onSubmit={(event) => {
        // The one button that writes lives on the confirmation step; the
        // Enter key on a checkbox must not reach it.
        if (step !== "confirm") event.preventDefault();
      }}
    >
      <input name="requestKey" type="hidden" value={requestKey} />
      <input
        name="evaluatorVersion"
        type="hidden"
        value={evaluationRecord.resultEvaluatorVersion ?? ""}
      />
      <input name="inputHash" type="hidden" value={evaluationRecord.resultInputHash ?? ""} />
      {review.eligible.map((assetId) => (
        <input key={assetId} name="assetIds" type="hidden" value={assetId} />
      ))}

      <div className={styles.main}>
        <h4 className="visually-hidden" id="archive-handoff-heading">
          Build a draft package from the matches
        </h4>

        {result && result.outcome !== "created" && result.outcome !== "existing" && (
          <HandoffResultNotice kind="package" result={result} storyHref={storyHref} />
        )}

        {step === "confirm" ? (
          <ConfirmArchive
            byId={byId}
            review={review}
            selectable={selectable}
            storyTitle={storyTitle}
            timeZone={timeZone}
          />
        ) : (
          <ol aria-label="Matched photographs by shoot" className={styles.groups}>
            {groups.map((group) => {
              const locked =
                selectedShoot !== undefined &&
                group.shootId !== undefined &&
                group.shootId !== selectedShoot;
              return (
                <li className={styles.group} key={group.shootId ?? "none"}>
                  <div className={styles.groupHead}>
                    <h4>{group.shootTitle}</h4>
                    <small>
                      {group.matches.length} {group.matches.length === 1 ? "match" : "matches"} ·{" "}
                      {group.eligibleCount} selectable
                      {locked
                        ? " · a package holds one shoot; unselect the other shoot to choose here"
                        : ""}
                    </small>
                  </div>
                  <ul className={styles.cards}>
                    {group.matches.map((entry) => {
                      const match = byId.get(entry.assetId);
                      if (!match) return null;
                      const reason = ineligibleReason(entry);
                      const disabled = reason !== undefined || locked;
                      const inputId = `select-${entry.assetId}`;
                      const title =
                        match.asset?.headline ??
                        match.asset?.canonicalFilename ??
                        "Photograph no longer readable";
                      return (
                        <li
                          className={`${styles.card} ${disabled ? styles.cardIneligible : ""}`}
                          key={entry.assetId}
                        >
                          <div className={styles.check}>
                            <input
                              aria-describedby={`why-${entry.assetId}`}
                              checked={selected.includes(entry.assetId)}
                              disabled={disabled}
                              id={inputId}
                              onChange={(event) => toggle(entry.assetId, event.target.checked)}
                              type="checkbox"
                            />
                          </div>
                          <div
                            aria-hidden={match.previewUrl ? undefined : "true"}
                            className={styles.thumb}
                          >
                            {match.previewUrl ? (
                              <img alt={title} src={match.previewUrl} />
                            ) : (
                              <span>Preview unavailable</span>
                            )}
                          </div>
                          <div className={styles.body}>
                            <div className={styles.cardHead}>
                              <span className={evaluation.rank}>#{match.rank}</span>
                              <label htmlFor={inputId}>{title}</label>
                              <span className={styles.score}>{match.score} / 100</span>
                            </div>
                            {match.asset?.caption && (
                              <p className={evaluation.caption}>{match.asset.caption}</p>
                            )}
                            {match.asset && (
                              <dl className={evaluation.facts}>
                                <dt>People</dt>
                                <dd>
                                  {match.asset.subjects.length > 0
                                    ? match.asset.subjects.join(", ")
                                    : "None recorded"}
                                </dd>
                                <dt>Captured</dt>
                                <dd>
                                  {match.asset.capturedAt
                                    ? formatDateTime(match.asset.capturedAt, timeZone)
                                    : "Not recorded"}
                                </dd>
                              </dl>
                            )}
                            <ul className={evaluation.reasons}>
                              {match.reasons.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                            {match.asset && (
                              <ul aria-label="Readiness" className={evaluation.flags}>
                                <li
                                  className={`${evaluation.flag} ${match.asset.metadataComplete ? evaluation.flagGood : evaluation.flagWarn}`}
                                >
                                  {match.asset.metadataComplete
                                    ? "Metadata complete"
                                    : "Metadata incomplete"}
                                </li>
                                {match.asset.rights.map((fact) => (
                                  <li
                                    className={`${evaluation.flag} ${fact === "rights_incomplete" || fact === "restriction_recorded" ? evaluation.flagWarn : ""}`}
                                    key={fact}
                                  >
                                    {RIGHTS_FACT_LABELS[fact]}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <p className={styles.why} id={`why-${entry.assetId}`}>
                              {reason
                                ? INELIGIBLE_LABELS[reason]
                                : locked
                                  ? "On a different shoot from your selection"
                                  : "Selectable"}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ol>
        )}

        {step === "select" && count > 0 && (
          <div className={styles.bar}>
            <strong>{count} selected</strong>
            <button
              className="button blue small"
              disabled={!canReview}
              onClick={() => setStep("confirm")}
              type="button"
            >
              Review selection
            </button>
          </div>
        )}
      </div>

      <aside aria-label="Selection summary" className={styles.rail}>
        <div className={styles.railCard}>
          <h4>{step === "confirm" ? "Confirm the handoff" : "Selection"}</h4>
          <p className={styles.count}>
            {count} {count === 1 ? "photograph" : "photographs"}
          </p>
          <p className="section-note">
            From <strong>{storyTitle}</strong>, archive path.
            {selectedShoot
              ? ` One shoot: ${groups.find((g) => g.shootId === selectedShoot)?.shootTitle ?? ""}.`
              : ""}
          </p>
          {review.refusal === "restricted" && (
            <p className={`section-note ${styles.warn}`}>
              A restricted photograph is selected. It cannot enter a package until its status is
              reviewed. Unselect it to continue; nothing is removed for you.
            </p>
          )}
          {review.refusal === "mixed_shoots" && (
            <p className={`section-note ${styles.warn}`}>
              The selection spans more than one shoot. A package belongs to one shoot.
            </p>
          )}
          {review.incompleteMetadata.length > 0 && (
            <p className={`section-note ${styles.warn}`}>
              {review.incompleteMetadata.length}{" "}
              {review.incompleteMetadata.length === 1 ? "photograph has" : "photographs have"}{" "}
              incomplete metadata. The package review will ask for it before approval.
            </p>
          )}
          {review.rightsAttention.length > 0 && (
            <p className={`section-note ${styles.warn}`}>
              {review.rightsAttention.length}{" "}
              {review.rightsAttention.length === 1 ? "photograph carries" : "photographs carry"} a
              recorded usage restriction or incomplete rights information. Review it before sending
              anything.
            </p>
          )}
          <p className="section-note">
            The result is a <strong>draft package</strong>. No recipient is contacted, no delivery
            link is created, nothing is approved or priced.
          </p>
          <div className={styles.actions}>
            {step === "select" ? (
              <button
                className="button blue"
                disabled={!canReview || pending}
                onClick={() => setStep("confirm")}
                type="button"
              >
                Review selection
              </button>
            ) : (
              <>
                <button className="button blue" disabled={pending || !canReview} type="submit">
                  {pending ? "Creating draft…" : "Create draft package"}
                </button>
                <button
                  className="button"
                  disabled={pending}
                  onClick={() => setStep("select")}
                  type="button"
                >
                  Back to selection
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    </form>
  );
}

function ConfirmArchive({
  review,
  selectable,
  byId,
  storyTitle,
  timeZone,
}: {
  readonly review: ReturnType<typeof reviewSelection>;
  readonly selectable: readonly SelectableMatch[];
  readonly byId: ReadonlyMap<string, ArchiveMatchView>;
  readonly storyTitle: string;
  readonly timeZone: string;
}) {
  const shootTitle = selectable.find((entry) => entry.shootId === review.shootIds[0])?.shootTitle;
  const labelFor = (assetId: string) => {
    const match = byId.get(assetId);
    return match?.asset?.headline ?? match?.asset?.canonicalFilename ?? assetId.slice(0, 8);
  };
  return (
    <div className={styles.result}>
      <h4>What will be created</h4>
      <ul className={styles.summaryList}>
        <li>
          <strong>{review.eligible.length}</strong>{" "}
          {review.eligible.length === 1 ? "photograph" : "photographs"} from the shoot{" "}
          <strong>{shootTitle ?? "—"}</strong>
        </li>
        <li>
          Source: News Radar story <strong>{storyTitle}</strong>, archive match path
        </li>
        <li>
          Result: one <strong>draft package</strong> on that shoot, named after the story
        </li>
        <li>No recipient will be contacted and no delivery link will be created</li>
        <li>Nothing is approved, priced, licensed or submitted</li>
        <li>
          Metadata, rights, pricing and the recipient must still be reviewed in the package review
        </li>
      </ul>
      <h4>Selected photographs</h4>
      <ul className={styles.summaryList}>
        {review.eligible.map((assetId) => {
          const match = byId.get(assetId);
          const flags: string[] = [];
          if (review.incompleteMetadata.includes(assetId)) flags.push("metadata incomplete");
          if (review.rightsAttention.includes(assetId)) {
            flags.push(
              match?.asset?.rights.includes("restriction_recorded")
                ? "usage restriction recorded"
                : "rights information incomplete",
            );
          }
          return (
            <li key={assetId}>
              {labelFor(assetId)}
              {match?.asset?.capturedAt
                ? ` · captured ${formatDateTime(match.asset.capturedAt, timeZone)}`
                : ""}
              {flags.length > 0 ? ` — ${flags.join(", ")}` : ""}
            </li>
          );
        })}
      </ul>
      {review.blocked.length > 0 && (
        <>
          <h4>Cannot proceed</h4>
          <ul className={`${styles.summaryList} ${styles.warn}`}>
            {review.blocked.map((entry) => (
              <li key={entry.assetId}>
                {labelFor(entry.assetId)} — {INELIGIBLE_LABELS[entry.reason]}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
