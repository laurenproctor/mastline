"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { EvaluationRecord, ShootBriefView } from "@/lib/data/news-radar-evaluations";
import type { HandoffRecord } from "@/lib/data/news-radar-handoffs";
import { formatDateTime } from "@/lib/format";
import {
  SHOOT_LOCATION_MAX,
  SHOOT_NOTES_MAX,
  SHOOT_PRIORITIES,
  SHOOT_TITLE_MAX,
  isPlausibleTimezone,
} from "@/lib/news-radar-handoff";
import { type HandoffState, createShootDraftAction } from "../handoff-actions";
import styles from "../handoff.module.css";
import { HandoffResultNotice } from "./handoff-result";

const INITIAL: HandoffState = {};

const PRIORITY_LABELS: Record<(typeof SHOOT_PRIORITIES)[number], string> = {
  watch: "Watch",
  standard: "Standard",
  high: "High",
  urgent: "Urgent",
};

/** An ISO instant as a datetime-local value, in the server's clock, matching how it is parsed back. */
function toDateTimeLocal(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The shoot handoff: four registers kept visibly apart -- recorded facts,
 * what needs confirmation, suggestions, and what will be added to the draft
 * -- then a confirmation step, then one button that creates a draft shoot.
 *
 * An authoritative field (location, event time, time zone) enters the draft
 * only when its box is ticked beside a value. A person is expected only when
 * their name is ticked. A suggestion is carried only when ticked, and then
 * into the notes, labelled as a suggestion; it never becomes the story angle
 * here. Anything not confirmed is listed as unconfirmed on the draft.
 */
export function ShootHandoff({
  workspaceSlug,
  opportunityId,
  storyTitle,
  evaluationRecord,
  brief,
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
  readonly brief: ShootBriefView | null;
  readonly existing: HandoffRecord | null;
  readonly continueHref?: string;
  readonly canAct: boolean;
  /** The workspace time zone: the default offered for confirmation. */
  readonly timeZone: string;
  readonly storyHref: string;
}) {
  const [state, formAction, pending] = useActionState(
    createShootDraftAction.bind(null, workspaceSlug, opportunityId),
    INITIAL,
  );
  const [requestKey] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState<"review" | "confirm">("review");

  const [title, setTitle] = useState(storyTitle.slice(0, SHOOT_TITLE_MAX));
  const [confirmLocation, setConfirmLocation] = useState(false);
  const [locationName, setLocationName] = useState(brief?.knownLocation ?? "");
  const [confirmTime, setConfirmTime] = useState(false);
  const [startsAt, setStartsAt] = useState(toDateTimeLocal(brief?.eventStartsAt));
  const [endsAt, setEndsAt] = useState(toDateTimeLocal(brief?.eventEndsAt));
  const [confirmTimezone, setConfirmTimezone] = useState(false);
  const [timezone, setTimezone] = useState(timeZone);
  const [priority, setPriority] = useState<(typeof SHOOT_PRIORITIES)[number]>("standard");
  const [people, setPeople] = useState<readonly string[]>([]);
  const [copied, setCopied] = useState<readonly string[]>([]);
  const [ownNotes, setOwnNotes] = useState("");

  const errors = state.errors ?? {};
  const result = state.result;

  const willAdd = useMemo(() => {
    const lines: string[] = [`Title: ${title.trim() || "—"}`];
    lines.push(
      confirmLocation && locationName.trim()
        ? `Location: ${locationName.trim()}`
        : "Location: not confirmed",
    );
    lines.push(
      confirmTime && startsAt
        ? `Event time: ${startsAt.replace("T", " ")}${endsAt ? ` → ${endsAt.replace("T", " ")}` : ""}`
        : "Event time: not confirmed",
    );
    lines.push(
      confirmTimezone && timezone.trim()
        ? `Time zone: ${timezone.trim()}`
        : "Time zone: not confirmed",
    );
    lines.push(`Priority: ${PRIORITY_LABELS[priority]}`);
    lines.push(
      people.length > 0
        ? `People expected (confirmed): ${people.join(", ")}`
        : "People expected: none confirmed",
    );
    if (copied.length > 0) {
      lines.push(
        `${copied.length} suggestion${copied.length === 1 ? "" : "s"} copied into the notes, labelled as suggestions`,
      );
    }
    if (ownNotes.trim()) lines.push("Your own notes");
    return lines;
  }, [
    title,
    confirmLocation,
    locationName,
    confirmTime,
    startsAt,
    endsAt,
    confirmTimezone,
    timezone,
    priority,
    people,
    copied,
    ownNotes,
  ]);

  const unconfirmed = useMemo(() => {
    const items: string[] = [];
    if (!(confirmLocation && locationName.trim()))
      items.push(
        brief?.knownLocation ? "Location (recorded, not confirmed)" : "Location (not recorded)",
      );
    if (!(confirmTime && startsAt))
      items.push(
        brief?.eventStartsAt ? "Event time (recorded, not confirmed)" : "Event time (not recorded)",
      );
    if (!(confirmTimezone && timezone.trim())) items.push("Time zone (not confirmed)");
    if (people.length === 0)
      items.push(
        (brief?.knownPeople.length ?? 0) > 0
          ? "People expected (recorded, none confirmed)"
          : "People expected (none recorded)",
      );
    return items;
  }, [
    confirmLocation,
    locationName,
    confirmTime,
    startsAt,
    confirmTimezone,
    timezone,
    people,
    brief,
  ]);

  const canReview =
    title.trim().length > 0 &&
    !(confirmLocation && !locationName.trim()) &&
    !(confirmTime && !startsAt) &&
    !(confirmTimezone && (!timezone.trim() || !isPlausibleTimezone(timezone.trim())));

  if (result && (result.outcome === "created" || result.outcome === "existing")) {
    return (
      <section aria-labelledby="shoot-handoff-heading" className={styles.result} role="status">
        <h4 id="shoot-handoff-heading">
          {result.outcome === "created"
            ? "Draft shoot created"
            : "This path was already handed off"}
        </h4>
        <HandoffResultNotice
          continueHref={state.continueHref}
          continueLabel={state.continueLabel}
          kind="shoot"
          result={result}
          storyHref={storyHref}
        />
        {result.outcome === "created" && unconfirmed.length > 0 && (
          <>
            <h4>Still unconfirmed on the draft</h4>
            <ul className={`${styles.summaryList} ${styles.warn}`}>
              {unconfirmed.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    );
  }

  if (existing) {
    return (
      <section aria-labelledby="shoot-handoff-heading" className={styles.result}>
        <h4 id="shoot-handoff-heading">Handed off to a draft shoot</h4>
        <p>
          A draft shoot was created from this brief on{" "}
          {formatDateTime(existing.createdAt, timeZone)} (evaluator {existing.evaluatorVersion} ·
          input {existing.inputHash.slice(0, 12)}). It is still a draft; the shoot is where it
          continues.
        </p>
        <div className={styles.actions}>
          {continueHref && (
            <Link className="button blue" href={continueHref}>
              Continue in the shoot
            </Link>
          )}
        </div>
      </section>
    );
  }

  if (!brief || evaluationRecord.resultAt === undefined) {
    return (
      <section aria-labelledby="shoot-handoff-heading" className={styles.result}>
        <h4 id="shoot-handoff-heading">Create a draft shoot from this brief</h4>
        <p className="section-note">
          Nothing to confirm until the shoot evaluation has run. Evaluate the path above; nothing
          runs on its own.
        </p>
      </section>
    );
  }

  if (!canAct) {
    return (
      <section aria-labelledby="shoot-handoff-heading" className={styles.result}>
        <h4 id="shoot-handoff-heading">Create a draft shoot from this brief</h4>
        <p className="section-note">
          Creating a draft shoot from this brief needs an owner or editor. You can read the brief
          and everything it still asks to confirm.
        </p>
      </section>
    );
  }

  const suggestionKeys = [
    ...(brief.suggestedAngle
      ? [
          {
            key: `angle:${brief.suggestedAngle}`,
            label: "Suggested angle",
            text: brief.suggestedAngle,
          },
        ]
      : []),
    ...brief.suggestedShots.map((shot) => ({
      key: `shot:${shot}`,
      label: "Suggested shot",
      text: shot,
    })),
  ];

  function togglePerson(name: string, on: boolean) {
    setPeople((current) =>
      on ? [...new Set([...current, name])] : current.filter((n) => n !== name),
    );
  }
  function toggleCopied(key: string, on: boolean) {
    setCopied((current) =>
      on ? [...new Set([...current, key])] : current.filter((k) => k !== key),
    );
  }

  return (
    <form
      action={formAction}
      aria-labelledby="shoot-handoff-heading"
      className={styles.layout}
      onSubmit={(event) => {
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

      <div className={styles.main}>
        <h4 className="visually-hidden" id="shoot-handoff-heading">
          Create a draft shoot from this brief
        </h4>

        {result && result.outcome !== "created" && result.outcome !== "existing" && (
          <HandoffResultNotice kind="shoot" result={result} storyHref={storyHref} />
        )}
        {errors._form && (
          <p className="auth-error" role="alert">
            {errors._form}
          </p>
        )}

        {step === "confirm" ? (
          <div className={styles.result}>
            <h4>What will be created</h4>
            <ul className={styles.summaryList}>
              <li>
                One <strong>draft shoot</strong> from News Radar story <strong>{storyTitle}</strong>
                , shoot opportunity path
              </li>
              {willAdd.map((line) => (
                <li key={line}>{line}</li>
              ))}
              <li>No package, recipient, submission, delivery link or buyer record is created</li>
              <li>
                Nothing is scheduled with anyone: no access, credential, appearance or demand is
                claimed
              </li>
            </ul>
            {unconfirmed.length > 0 && (
              <>
                <h4>Will remain unconfirmed on the draft</h4>
                <ul className={`${styles.summaryList} ${styles.warn}`}>
                  {unconfirmed.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          <div className={styles.registers}>
            <section
              aria-labelledby={`recorded-facts-${opportunityId}`}
              className={styles.register}
            >
              <h4 id={`recorded-facts-${opportunityId}`}>Recorded facts</h4>
              <ul>
                <li>Story: {storyTitle}</li>
                <li>Location: {brief.knownLocation ?? "none recorded"}</li>
                <li>
                  Event:{" "}
                  {brief.eventStartsAt
                    ? formatDateTime(brief.eventStartsAt, timeZone)
                    : "no time recorded"}
                  {brief.eventEndsAt ? ` → ${formatDateTime(brief.eventEndsAt, timeZone)}` : ""}
                </li>
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
                {brief.whyNow.map((line) => (
                  <li key={line}>Why now: {line}</li>
                ))}
              </ul>
            </section>

            <section
              aria-labelledby={`needs-confirmation-${opportunityId}`}
              className={styles.register}
            >
              <h4 id={`needs-confirmation-${opportunityId}`}>Needs confirmation</h4>
              <ul>
                <li>
                  <label htmlFor={`title-${opportunityId}`}>Shoot title</label>
                  <input
                    aria-describedby={errors.title ? `title-error-${opportunityId}` : undefined}
                    aria-invalid={errors.title ? true : undefined}
                    id={`title-${opportunityId}`}
                    maxLength={SHOOT_TITLE_MAX}
                    name="title"
                    onChange={(event) => setTitle(event.target.value)}
                    type="text"
                    value={title}
                  />
                  {errors.title && (
                    <small className="auth-error" id={`title-error-${opportunityId}`} role="alert">
                      {errors.title}
                    </small>
                  )}
                </li>
                <li className={styles.confirmRow}>
                  <input
                    checked={confirmLocation}
                    id={`confirm-location-${opportunityId}`}
                    name="confirmLocation"
                    onChange={(event) => setConfirmLocation(event.target.checked)}
                    type="checkbox"
                  />
                  <div>
                    <label htmlFor={`confirm-location-${opportunityId}`}>
                      Confirm the location
                    </label>
                    <small>
                      {brief.knownLocation
                        ? `Recorded: ${brief.knownLocation}`
                        : "Not recorded on the story."}
                    </small>
                    <input
                      aria-label="Location"
                      disabled={!confirmLocation}
                      maxLength={SHOOT_LOCATION_MAX}
                      name="locationName"
                      onChange={(event) => setLocationName(event.target.value)}
                      type="text"
                      value={locationName}
                    />
                    {errors.locationName && (
                      <small className="auth-error" role="alert">
                        {errors.locationName}
                      </small>
                    )}
                  </div>
                </li>
                <li className={styles.confirmRow}>
                  <input
                    checked={confirmTime}
                    id={`confirm-time-${opportunityId}`}
                    name="confirmTime"
                    onChange={(event) => setConfirmTime(event.target.checked)}
                    type="checkbox"
                  />
                  <div>
                    <label htmlFor={`confirm-time-${opportunityId}`}>
                      Confirm the event date and time
                    </label>
                    <small>
                      {brief.eventStartsAt
                        ? `Recorded: ${formatDateTime(brief.eventStartsAt, timeZone)}`
                        : "Not recorded on the story."}
                    </small>
                    <input
                      aria-label="Starts"
                      disabled={!confirmTime}
                      name="startsAt"
                      onChange={(event) => setStartsAt(event.target.value)}
                      type="datetime-local"
                      value={startsAt}
                    />
                    <input
                      aria-label="Ends"
                      disabled={!confirmTime}
                      name="endsAt"
                      onChange={(event) => setEndsAt(event.target.value)}
                      type="datetime-local"
                      value={endsAt}
                    />
                    {(errors.startsAt || errors.endsAt) && (
                      <small className="auth-error" role="alert">
                        {errors.startsAt ?? errors.endsAt}
                      </small>
                    )}
                  </div>
                </li>
                <li className={styles.confirmRow}>
                  <input
                    checked={confirmTimezone}
                    id={`confirm-timezone-${opportunityId}`}
                    name="confirmTimezone"
                    onChange={(event) => setConfirmTimezone(event.target.checked)}
                    type="checkbox"
                  />
                  <div>
                    <label htmlFor={`confirm-timezone-${opportunityId}`}>
                      Confirm the time zone
                    </label>
                    <small>Workspace default: {timeZone}</small>
                    <input
                      aria-label="Time zone"
                      disabled={!confirmTimezone}
                      name="timezone"
                      onChange={(event) => setTimezone(event.target.value)}
                      type="text"
                      value={timezone}
                    />
                    {errors.timezone && (
                      <small className="auth-error" role="alert">
                        {errors.timezone}
                      </small>
                    )}
                  </div>
                </li>
                <li>
                  <span id={`people-${opportunityId}`}>People expected to appear</span>
                  <small className="section-note">
                    {brief.knownPeople.length > 0
                      ? " Tick only those you have reason to expect. Nobody is confirmed to appear by the story alone."
                      : " None recorded on the story."}
                  </small>
                  <ul aria-labelledby={`people-${opportunityId}`}>
                    {brief.knownPeople.map((name) => (
                      <li className={styles.confirmRow} key={name}>
                        <input
                          checked={people.includes(name)}
                          id={`person-${opportunityId}-${name}`}
                          name="people"
                          onChange={(event) => togglePerson(name, event.target.checked)}
                          type="checkbox"
                          value={name}
                        />
                        <label htmlFor={`person-${opportunityId}-${name}`}>{name}</label>
                      </li>
                    ))}
                  </ul>
                  {errors.people && (
                    <small className="auth-error" role="alert">
                      {errors.people}
                    </small>
                  )}
                </li>
                <li>
                  <label htmlFor={`priority-${opportunityId}`}>Priority</label>
                  <select
                    id={`priority-${opportunityId}`}
                    name="priority"
                    onChange={(event) =>
                      setPriority(event.target.value as (typeof SHOOT_PRIORITIES)[number])
                    }
                    value={priority}
                  >
                    {SHOOT_PRIORITIES.map((value) => (
                      <option key={value} value={value}>
                        {PRIORITY_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </li>
                {brief.missingConfirmations.length > 0 && (
                  <li>
                    <span>The evaluator listed as missing:</span>
                    <ul className={styles.summaryList}>
                      {brief.missingConfirmations.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </li>
                )}
              </ul>
            </section>

            <section aria-labelledby={`suggestions-${opportunityId}`} className={styles.register}>
              <h4 id={`suggestions-${opportunityId}`}>Suggestions — not facts</h4>
              {suggestionKeys.length === 0 ? (
                <p className="section-note">
                  Nothing to suggest: no people or location are recorded.
                </p>
              ) : (
                <ul>
                  {suggestionKeys.map((suggestion) => (
                    <li className={styles.confirmRow} key={suggestion.key}>
                      <input
                        checked={copied.includes(suggestion.key)}
                        id={`copy-${opportunityId}-${suggestion.key}`}
                        name="copiedSuggestions"
                        onChange={(event) => toggleCopied(suggestion.key, event.target.checked)}
                        type="checkbox"
                        value={suggestion.key}
                      />
                      <div>
                        <label htmlFor={`copy-${opportunityId}-${suggestion.key}`}>
                          <span className={styles.suggested}>{suggestion.label}</span>
                          {suggestion.text}
                        </label>
                        <small>
                          Ticked: copied into the notes, labelled as a suggestion. It never becomes
                          the story angle here.
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div
                className={styles.confirmRow}
                style={{ gridTemplateColumns: "minmax(0, 1fr)", marginTop: 10 }}
              >
                <label htmlFor={`own-notes-${opportunityId}`}>Your own notes</label>
                <textarea
                  id={`own-notes-${opportunityId}`}
                  maxLength={SHOOT_NOTES_MAX}
                  name="ownNotes"
                  onChange={(event) => setOwnNotes(event.target.value)}
                  rows={3}
                  value={ownNotes}
                />
                {errors.ownNotes && (
                  <small className="auth-error" role="alert">
                    {errors.ownNotes}
                  </small>
                )}
              </div>
            </section>

            <section aria-labelledby={`will-add-${opportunityId}`} className={styles.register}>
              <h4 id={`will-add-${opportunityId}`}>Will be added to the draft</h4>
              <ul className={styles.summaryList}>
                {willAdd.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {unconfirmed.length > 0 && (
                <>
                  <h4>Still unconfirmed</h4>
                  <ul className={`${styles.summaryList} ${styles.warn}`}>
                    {unconfirmed.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        )}
      </div>

      <aside aria-label="Confirmation summary" className={styles.rail}>
        <div className={styles.railCard}>
          <h4>{step === "confirm" ? "Confirm the handoff" : "Draft shoot"}</h4>
          <p className={styles.count}>
            {unconfirmed.length === 0 ? "All confirmed" : `${unconfirmed.length} unconfirmed`}
          </p>
          <p className="section-note">
            From <strong>{storyTitle}</strong>, shoot opportunity path. The result is a{" "}
            <strong>draft shoot</strong>: private, editable, sent nowhere. An incomplete draft is
            allowed; what is unconfirmed stays unconfirmed on it.
          </p>
          <div className={styles.actions}>
            {step === "review" ? (
              <button
                className="button blue"
                disabled={!canReview || pending}
                onClick={() => setStep("confirm")}
                type="button"
              >
                Review the draft
              </button>
            ) : (
              <>
                <button className="button blue" disabled={pending || !canReview} type="submit">
                  {pending ? "Creating draft…" : "Create draft shoot"}
                </button>
                <button
                  className="button"
                  disabled={pending}
                  onClick={() => setStep("review")}
                  type="button"
                >
                  Back to the brief
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    </form>
  );
}
