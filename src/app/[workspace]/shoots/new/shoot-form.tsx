"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BuyerCheckboxes } from "@/components/buyer-select";
import { Badge, Field } from "@/components/primitives";
import { formatCoordinates, toDatetimeLocalValue } from "@/lib/geo";
import { type DraftReview, reviewDraft, stagedPhotographs } from "@/lib/shoot-draft";
import { formatBytes } from "@/lib/upload";
import { type ActionState, createShootAction } from "../actions";
import { type Photograph, PhotographPicker } from "./photograph-picker";

const INITIAL: ActionState = {};

type LocationState = "idle" | "asking" | "filled" | "refused" | "unavailable";

const LOCATION_NOTE: Record<LocationState, string> = {
  idle: "",
  asking: "Reading this device's location…",
  filled: "From this device's location. Overwrite it with the place name.",
  refused: "Location permission was declined. Type the place instead.",
  unavailable: "This device could not report a location. Type the place instead.",
};

/**
 * The order the page reads in, and the order the section nav lists.
 *
 * These are sections of one document, not steps of a wizard. Every field is
 * mounted the whole time, so moving between them is a scroll: nothing is
 * unmounted, nothing is remembered and restored, and there is no state in which
 * some of the form exists and the rest does not.
 */
const SECTIONS = [
  { id: "details", label: "Shoot details" },
  { id: "photographs", label: "Photographs" },
  { id: "metadata", label: "Metadata" },
  { id: "rights", label: "Rights and usage" },
  { id: "review", label: "Final review" },
] as const;

/** The field each error belongs to, in the order the page presents them. */
const ERROR_ORDER = ["title", "startsAt", "priority", "embargoUntil", "photographs"] as const;

/**
 * Create a shoot, on one page.
 *
 * This screen used to hand off: a brief here, then "Create shoot and review",
 * then the photographs and their metadata somewhere else. Creating a shoot is
 * private, reversible workspace activity -- nothing leaves the workspace, no
 * buyer hears about it, nothing is billed -- so it did not deserve a handoff,
 * and a confirmation step spent on a draft is a step not spent on the dispatch
 * that actually matters.
 *
 * So the whole thing is here: the brief, the frames, the metadata they share,
 * the rights facts that travel with them, and a review that names what will and
 * will not happen. The one button at the bottom writes a draft.
 *
 * What this form deliberately CANNOT do: send anything. There is no code path
 * from here to approveAndSendAction, and the copy never borrows its verbs.
 */
export function CreateShootForm({
  workspaceSlug,
  buyers,
  canSeeSourceNote,
}: {
  workspaceSlug: string;
  buyers: readonly { id: string; name: string }[];
  canSeeSourceNote: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    createShootAction.bind(null, workspaceSlug),
    INITIAL,
  );

  const formRef = useRef<HTMLFormElement>(null);
  const [photographs, setPhotographs] = useState<readonly Photograph[]>([]);

  // Both defaults are written into the controls after mount rather than
  // rendered. The server has no idea what time it is where the operator is
  // standing, or where that is, so rendering a guess would mismatch on
  // hydration. They stay uncontrolled: a default is a starting point, and the
  // field belongs to whoever is typing in it.
  const startsAtRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  const [locationState, setLocationState] = useState<LocationState>("idle");
  const [locationTouched, setLocationTouched] = useState(false);

  /**
   * One idempotency key for the life of this form.
   *
   * Sent with every attempt, so a double click or a re-posted request finds the
   * shoot the first attempt created instead of creating a second one.
   *
   * Written into the control after mount rather than rendered, for the same
   * reason the date default is: a value minted on the server would not be the
   * value the browser then holds, and the two would disagree at hydration. A
   * DOM write is not React state, so the token cannot cause a re-render either.
   */
  const clientTokenRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const control = clientTokenRef.current;
    if (control && control.value === "") control.value = crypto.randomUUID();
  }, []);

  useEffect(() => {
    const control = startsAtRef.current;
    if (control && control.value === "") {
      control.value = toDatetimeLocalValue(new Date());
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Geolocation is an external platform API, and the whole exchange lives in
    // its callbacks. Nothing here overwrites a field the operator has typed in.
    const ask = async () => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        if (!cancelled) setLocationState("unavailable");
        return;
      }

      setLocationState("asking");

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (cancelled) return;
          const value = formatCoordinates(position.coords.latitude, position.coords.longitude);
          const control = locationRef.current;
          if (!value || !control) {
            setLocationState("unavailable");
            return;
          }
          // A fix that arrives after the operator started typing is discarded.
          if (control.value !== "") {
            setLocationState("idle");
            return;
          }
          control.value = value;
          setLocationState("filled");
        },
        () => {
          if (!cancelled) setLocationState("refused");
        },
        { enableHighAccuracy: false, maximumAge: 120_000, timeout: 10_000 },
      );
    };

    void ask();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * The review reads the form rather than shadowing it.
   *
   * Mirroring every field into React state would mean two copies of the brief
   * that can disagree, and would take the fields away from the person typing in
   * them. `change` bubbles, so one handler on the form is enough to re-read the
   * few values the review reports on, and the inputs stay uncontrolled.
   */
  const [briefFacts, setBriefFacts] = useState({
    title: "",
    creditLine: "",
    copyrightNotice: "",
    locationName: "",
    embargoUntil: "",
    exclusivity: "",
    sensitiveContent: false,
  });

  const readForm = useCallback(() => {
    const element = formRef.current;
    if (!element) return;
    const data = new FormData(element);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    setBriefFacts({
      title: value("title"),
      creditLine: value("defaultCreditLine"),
      copyrightNotice: value("defaultCopyrightNotice"),
      locationName: value("locationName"),
      embargoUntil: value("embargoUntil"),
      exclusivity: value("exclusivity"),
      sensitiveContent: data.get("sensitiveContent") === "on",
    });
  }, []);

  const review: DraftReview = useMemo(
    () =>
      reviewDraft({
        title: briefFacts.title,
        creditLine: briefFacts.creditLine,
        copyrightNotice: briefFacts.copyrightNotice,
        locationName: briefFacts.locationName,
        embargoUntil: briefFacts.embargoUntil,
        exclusivity: briefFacts.exclusivity,
        sensitiveContent: briefFacts.sensitiveContent,
        photographs,
      }),
    [briefFacts, photographs],
  );

  /**
   * What the Server Action will register, as JSON in a hidden input.
   *
   * Only staged photographs are included. One still uploading has no digest to
   * send yet, and one that failed has no bytes in storage to point at; both are
   * named in the review instead of being quietly dropped.
   *
   * Everything in here is re-validated server-side. A hidden input is a hint
   * about what a browser sent, not a fact.
   */
  const payload = useMemo(
    () =>
      JSON.stringify(
        stagedPhotographs(photographs)
          .filter((photograph) => photograph.staged)
          .map((photograph) => ({
            ...photograph.staged,
            preview: photograph.stagedPreview,
            metadata: {
              headline: photograph.headline,
              caption: photograph.caption,
              subjects: photograph.subjects,
              keywords: photograph.keywords,
              locationName: photograph.locationName,
            },
          })),
      ),
    [photographs],
  );

  /*
   * After a refused submission, focus goes to the first thing that has to
   * change. A message rendered above the fold and never announced is a message
   * somebody scrolls past.
   */
  useEffect(() => {
    const errors = state.errors;
    if (!errors) return;

    const first = ERROR_ORDER.find((key) => errors[key]);
    const target =
      first === "photographs"
        ? document.getElementById("photographs")
        : first
          ? document.getElementById(`field-${first}`)
          : document.getElementById("create-shoot-errors");

    if (!(target instanceof HTMLElement)) return;
    // Guarded because scrollIntoView is not universal -- jsdom has no layout,
    // and moving focus is the part that must happen either way.
    target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    target.focus({ preventScroll: true });
  }, [state]);

  const locationHint = locationTouched ? undefined : LOCATION_NOTE[locationState] || undefined;
  const blocked = !review.canCreate;

  return (
    <form action={formAction} onChange={readForm} ref={formRef}>
      <input name="clientToken" ref={clientTokenRef} type="hidden" />
      <input name="photographs" type="hidden" value={payload} />

      <nav aria-label="Sections of this page" className="section-nav">
        <ol>
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.label}</a>
            </li>
          ))}
        </ol>
      </nav>

      <section aria-labelledby="details-heading" id="details" tabIndex={-1}>
        <h2 id="details-heading">Shoot details</h2>
        <p className="section-note">
          Only a subject or event is required. A shoot can exist before there are any files, and
          before the time and place are settled.
        </p>
        <p className="required-legend">
          <span aria-hidden="true" className="required-mark">
            *
          </span>{" "}
          marks a required field.
        </p>

        <div className="form-grid">
          <Field
            error={state.errors?.title}
            full
            label="Subject or event"
            name="title"
            placeholder="Hotel Chelsea departure"
            required
          />
          <Field
            error={state.errors?.startsAt}
            hint="Defaults to now. Change it if the shoot was earlier."
            label="Date and time"
            name="startsAt"
            ref={startsAtRef}
            type="datetime-local"
          />
          <Field control="select" defaultValue="standard" label="Priority" name="priority">
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="standard">Standard</option>
            <option value="watch">Watch</option>
          </Field>
          <Field
            full
            hint={locationHint}
            label="Location"
            name="locationName"
            onChange={() => setLocationTouched(true)}
            placeholder="Where the shoot happened"
            ref={locationRef}
          />
          <Field
            label="Assignment / agency"
            name="assignmentLabel"
            placeholder="Direct, Backgrid, Getty…"
          />
          <Field control="textarea" full label="Story angle" name="storyAngle" />

          <BuyerCheckboxes
            workspaceSlug={workspaceSlug}
            buyers={buyers}
            hint="Used to pre-fill the dispatch package later. Naming a buyer here sends them nothing."
            legend="Target buyers"
          />

          <Field control="textarea" full label="Notes" name="notes" />

          {canSeeSourceNote && (
            <Field
              control="textarea"
              full
              hint="Stored separately from the shoot and readable only by owners and editors. Never exposed through search."
              label="Confidential source note"
              name="sourceNote"
            />
          )}
        </div>
      </section>

      <section aria-labelledby="photographs-heading" id="photographs" tabIndex={-1}>
        <h2 id="photographs-heading">Photographs</h2>
        <p className="section-note">
          Files are hashed here and uploaded to this workspace&rsquo;s private staging area. They
          become assets when the shoot is created, and not before.
        </p>

        {state.errors?.photographs && (
          <p className="auth-error" role="alert">
            {state.errors.photographs}
          </p>
        )}

        <PhotographPicker
          workspaceSlug={workspaceSlug}
          disabled={pending}
          onChange={setPhotographs}
          photographs={photographs}
        />
      </section>

      <section aria-labelledby="metadata-heading" id="metadata" tabIndex={-1}>
        <h2 id="metadata-heading">Metadata</h2>
        <p className="section-note">
          Entered once here and inherited by every photograph in this shoot. Anything typed against
          an individual frame above wins over what is here.
        </p>

        <div className="form-grid">
          <Field
            hint="How you must be credited on publication. Required before dispatch."
            label="Credit line"
            name="defaultCreditLine"
            placeholder="Marcus Hale / Mastline"
          />
          <Field
            hint="Who owns the copyright. Required before dispatch."
            label="Copyright notice"
            name="defaultCopyrightNotice"
            placeholder="© 2026 Marcus Hale"
          />
          <Field
            full
            hint="Comma separated. Added to every photograph in this shoot."
            label="Shared keywords"
            name="defaultKeywords"
          />
        </div>
      </section>

      <section aria-labelledby="rights-heading" id="rights" tabIndex={-1}>
        <h2 id="rights-heading">Rights and usage</h2>
        <p className="section-note">
          Facts about how this material may be used, recorded so they travel with every frame. They
          are editable for as long as the shoot is a draft.
        </p>

        <div className="form-grid">
          <Field control="select" label="Exclusivity" name="exclusivity">
            <option value="">None</option>
            <option>Agency exclusive</option>
            <option>Buyer exclusive</option>
          </Field>
          <Field
            error={state.errors?.embargoUntil}
            hint="Nothing may be dispatched before this time."
            label="Embargo until"
            name="embargoUntil"
            type="datetime-local"
          />
          <Field
            control="textarea"
            full
            hint="Any limit on how these frames may be used. Inherited by every photograph."
            label="Usage restrictions"
            name="defaultUsageRestrictions"
          />

          <div className="field full">
            <label className="checkbox">
              <input name="sensitiveContent" type="checkbox" />
              <span>Sensitive content</span>
            </label>
          </div>
        </div>

        <div className="side-card">
          <h3>What Mastline does with this</h3>
          <p>
            These are your statements about the material, stored against the record and shown again
            at the dispatch review. Mastline records what you enter. It does not verify ownership,
            check whether a subject consented, or clear any use for you, and nothing here is legal
            advice.
          </p>
          <p className="section-note">
            Rules on copyright, privacy, and publicity differ by country and by use. Where a
            decision has consequences, get advice for the jurisdiction it lands in.
          </p>
        </div>
      </section>

      <section aria-labelledby="review-heading" id="review" tabIndex={-1}>
        <h2 id="review-heading">Final review</h2>

        <div aria-live="polite" className="draft-review">
          <p>
            <strong>{briefFacts.title || "Untitled shoot"}</strong> ·{" "}
            {review.readyCount === 0
              ? "no photographs"
              : `${review.readyCount} ${review.readyCount === 1 ? "photograph" : "photographs"} (${formatBytes(review.totalBytes)})`}
          </p>

          {review.blocking.length > 0 && (
            <div className="review-notes blocking" id="create-shoot-blocking">
              <Badge tone="danger">Not yet</Badge>
              <ul>
                {review.blocking.map((note) => (
                  <li key={note.id}>
                    {note.text} <a href={`#${note.section}`}>Fix it</a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review.warnings.length > 0 && (
            <div className="review-notes">
              <Badge tone="warn">Worth knowing</Badge>
              <ul>
                {review.warnings.map((note) => (
                  <li key={note.id}>
                    {note.text} <a href={`#${note.section}`}>Go there</a>
                  </li>
                ))}
              </ul>
              <p className="section-note">
                None of these stop the shoot being created. They are what the dispatch review will
                ask about, listed now while the frames are in front of you.
              </p>
            </div>
          )}

          {review.blocking.length === 0 && review.warnings.length === 0 && (
            <p className="section-note">Nothing outstanding.</p>
          )}
        </div>

        <div className="side-card">
          <h3>What creating this shoot does</h3>
          <ul className="next-steps">
            <li>Writes a private draft in this workspace.</li>
            <li>Stores each original untouched, with its checksum and import history.</li>
            <li>Opens the shoot so you can keep selecting and captioning.</li>
          </ul>
          <p className="section-note">
            It does not send, publish, submit, or offer anything to anyone, and it does not charge
            you. Dispatch is a separate screen with its own confirmation.
          </p>
        </div>

        {state.errors?._form && (
          <p className="auth-error" id="create-shoot-errors" role="alert" tabIndex={-1}>
            {state.errors._form}
          </p>
        )}

        <div className="spacer" />
        <div className="actions">
          <button
            aria-describedby={blocked ? "create-shoot-blocking" : undefined}
            className="button primary"
            disabled={pending || blocked}
            type="submit"
          >
            {pending ? "Creating shoot…" : "Create shoot"}
          </button>
          <p className="section-note">
            Your shoot will remain private until you choose to dispatch it.
          </p>
        </div>
      </section>
    </form>
  );
}
