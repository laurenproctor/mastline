"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  COMMERCIAL_USE_STATES,
  CONTENT_CATEGORIES,
  FIELD_LABELS,
  type FieldProvenance,
  QUALITY_ESTIMATES,
  RELEASE_STATES,
  SENSITIVITIES,
} from "@/lib/asset-metadata";
import {
  type MetadataFormState,
  confirmMetadataAction,
  generateMetadataAction,
  metadataStatusAction,
  saveMetadataAction,
} from "@/app/[workspace]/shoots/metadata-actions";
import { Badge, Field } from "@/components/primitives";
import { formatConfidence, formatDateTime, humanizeStatus } from "@/lib/format";

/**
 * One photograph's metadata, read and confirmed.
 *
 * The panel has one job that everything else serves: make it obvious, without
 * reading a manual, which of these words a machine wrote and which a person
 * did. That is why every field carries a provenance chip, why the generated
 * ones are the only fields with a tint, and why the confirm control is a
 * separate act with its own sentence rather than a second effect of Save.
 *
 * Speed matters as much as care. A photographer reviews a whole card, not one
 * frame, so Save and next exists, the panel is remounted per photograph rather
 * than reconciled, and the keyboard reaches everything. Nothing here is modal.
 */

const INITIAL: MetadataFormState = {};

/** A value as the server resolved it, with where it came from. */
export interface PanelField {
  readonly value: string | readonly string[] | boolean | undefined;
  readonly provenance: FieldProvenance;
  readonly confidence?: number;
}

export interface PanelTechnical {
  readonly label: string;
  readonly value: string;
}

export interface PanelPhotograph {
  readonly id: string;
  readonly filename: string;
  readonly previewUrl?: string;
  readonly isVideo?: boolean;
}

export interface PanelStatus {
  readonly status: string;
  readonly label: string;
  readonly tone: "neutral" | "good" | "warn" | "danger" | "blue";
  readonly detail: string;
  readonly inFlight: boolean;
}

/**
 * Everything about one photograph the panel renders.
 *
 * Assembled on the server, where the shoot is in hand and inheritance can be
 * resolved, and handed over whole. The client never recomputes provenance: two
 * implementations of "where did this value come from" would eventually
 * disagree, and the one on screen is the one that matters.
 */
export interface MetadataPanelData {
  readonly photograph: PanelPhotograph;
  readonly fields: Readonly<Record<string, PanelField>>;
  readonly status: PanelStatus;
  readonly technical: readonly PanelTechnical[];
  readonly version: number;
  readonly generatedAt?: string;
  readonly aiModel?: string;
  readonly overallConfidence?: number;
  readonly uncertaintyNote?: string;
  readonly failureDetail?: string;
  readonly confirmedAt?: string;
}

export interface MetadataPanelProps extends MetadataPanelData {
  readonly workspaceSlug: string;
  readonly shootId?: string;
  /** False when this deployment has no generation service configured. */
  readonly generationAvailable: boolean;
  readonly canEdit: boolean;
  /** Present on the shoot screen, absent on a single photograph's record. */
  readonly navigation?: {
    readonly position: number;
    readonly total: number;
    readonly reviewed: number;
    readonly onPrevious?: () => void;
    readonly onNext?: () => void;
  };
}

/** The chip beside a field. Text as well as tint: colour never carries alone. */
const PROVENANCE_CHIP: Record<FieldProvenance, { label: string; hint: string } | null> = {
  generated: {
    label: "AI — review",
    hint: "Suggested by Mastline from the image. Read it before you confirm.",
  },
  inherited: {
    label: "From the shoot",
    hint: "Inherited from the shoot brief. Change it here for this frame.",
  },
  entered: {
    label: "You entered this",
    hint: "Typed on this photograph. Regeneration will not touch it.",
  },
  confirmed: { label: "Confirmed", hint: "You confirmed this describes the photograph." },
  file: { label: "From the file", hint: "Read from the file's own metadata." },
  empty: null,
};

function Provenance({ field }: { field: PanelField | undefined }) {
  if (!field) return null;
  const chip = PROVENANCE_CHIP[field.provenance];
  if (!chip) return null;

  return (
    <span className={`prov prov-${field.provenance}`} title={chip.hint}>
      {chip.label}
      {field.confidence !== undefined ? ` · ${formatConfidence(field.confidence)}` : ""}
    </span>
  );
}

const asText = (field: PanelField | undefined): string => {
  const value = field?.value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return "";
};

const asBool = (field: PanelField | undefined): boolean => field?.value === true;

export function MetadataPanel(props: MetadataPanelProps) {
  // Remounted per photograph, so the form, its pending state, and any
  // suggestion sitting in it belong to the frame currently on screen.
  return <Panel key={`${props.photograph.id}:${props.version}`} {...props} />;
}

function Panel({
  workspaceSlug,
  shootId,
  photograph,
  fields,
  status,
  technical,
  version,
  generatedAt,
  aiModel,
  overallConfidence,
  uncertaintyNote,
  failureDetail,
  confirmedAt,
  generationAvailable,
  canEdit,
  navigation,
}: MetadataPanelProps) {
  const [saveState, saveAction, saving] = useActionState(
    saveMetadataAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [confirmState, confirmAction, confirming] = useActionState(
    confirmMetadataAction.bind(null, workspaceSlug),
    INITIAL,
  );

  const router = useRouter();
  const [generating, startGenerating] = useTransition();
  const [generateNote, setGenerateNote] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showRegenerate, setShowRegenerate] = useState(false);
  const headingId = useId();
  const headlineRef = useRef<HTMLInputElement>(null);

  const isConfirmed = status.status === "confirmed";
  const hasGenerated = Boolean(generatedAt);

  /*
   * While a job is in flight, ask the server what happened.
   *
   * The status lives in a column, so this is only ever reading the truth rather
   * than simulating it -- which is what makes the panel correct after a
   * refresh, in a second tab, and on a different device. Polling stops the
   * moment the status settles, and the interval is slow enough that a shoot
   * left open overnight is not a load-bearing cost.
   */
  useEffect(() => {
    if (!status.inFlight) return;
    let cancelled = false;

    const timer = setInterval(async () => {
      try {
        const snapshots = await metadataStatusAction(workspaceSlug, [photograph.id]);
        const mine = snapshots.find((entry) => entry.assetId === photograph.id);
        if (cancelled || !mine) return;
        if (!mine.inFlight || mine.version !== version) router.refresh();
      } catch {
        // A failed poll is not worth telling anybody about; the next one runs.
      }
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [photograph.id, router, status.inFlight, version, workspaceSlug]);

  const requestGeneration = useCallback(() => {
    setGenerateNote(null);
    setShowRegenerate(false);
    startGenerating(async () => {
      const result = await generateMetadataAction(workspaceSlug, {
        assetId: photograph.id,
        shootId,
      });
      setGenerateNote(result.message);
      router.refresh();
    });
  }, [photograph.id, router, shootId, workspaceSlug]);

  const state = saveState.ok || saveState.errors ? saveState : confirmState;

  return (
    <section aria-labelledby={headingId} className="metadata-panel">
      <div className="meta-head">
        <div>
          <h2 id={headingId}>Photograph metadata</h2>
          <p className="section-note">{photograph.filename}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {navigation && (
        <div className="meta-nav">
          <button
            className="button small"
            disabled={!navigation.onPrevious}
            onClick={navigation.onPrevious}
            type="button"
          >
            ← Previous
          </button>
          <span aria-live="polite" className="muted">
            {navigation.position} of {navigation.total} · {navigation.reviewed} reviewed
          </span>
          <button
            className="button small"
            disabled={!navigation.onNext}
            onClick={navigation.onNext}
            type="button"
          >
            Next →
          </button>
        </div>
      )}

      {photograph.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={asText(fields.altText) || `Preview of ${photograph.filename}`}
          className="meta-preview"
          src={photograph.previewUrl}
        />
      ) : (
        <div className="meta-preview empty">
          <span aria-hidden="true">▨</span>
          <small>{photograph.isVideo ? "No poster frame" : "No preview for this format"}</small>
        </div>
      )}

      <p className="meta-status" role="status">
        {status.detail}
      </p>

      {status.status === "failed" && failureDetail && (
        <p className="auth-error" role="alert">
          {failureDetail}
        </p>
      )}

      {uncertaintyNote && (
        <p className="meta-uncertainty">Mastline was unsure: {uncertaintyNote}</p>
      )}

      {hasGenerated && (
        <p className="section-note">
          Suggested {generatedAt ? formatDateTime(generatedAt) : ""}
          {aiModel ? ` by ${aiModel}` : ""}
          {overallConfidence !== undefined
            ? ` · overall confidence ${formatConfidence(overallConfidence)}`
            : ""}
          . Mastline can suggest visible details, but you are responsible for confirming identities,
          context, and rights.
        </p>
      )}

      {canEdit && generationAvailable && (
        <div className="meta-generate">
          {!hasGenerated ? (
            <button
              className="button small"
              disabled={generating || status.inFlight}
              onClick={requestGeneration}
              type="button"
            >
              {status.inFlight ? "Reading the frame…" : "Generate metadata"}
            </button>
          ) : status.status === "failed" ? (
            <button
              className="button small"
              disabled={generating}
              onClick={requestGeneration}
              type="button"
            >
              Retry
            </button>
          ) : showRegenerate ? (
            <div className="meta-warning" role="alert">
              <p>
                Regenerating replaces any suggestion you have not edited or confirmed. Anything you
                typed, and anything already confirmed, is kept.
              </p>
              <div className="actions">
                <button
                  className="button small blue"
                  disabled={generating}
                  onClick={requestGeneration}
                  type="button"
                >
                  Regenerate anyway
                </button>
                <button
                  className="button small"
                  onClick={() => setShowRegenerate(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="button small"
              disabled={generating || status.inFlight}
              onClick={() => setShowRegenerate(true)}
              type="button"
            >
              Regenerate
            </button>
          )}
          {generateNote && (
            <span className="muted" role="status">
              {generateNote}
            </span>
          )}
        </div>
      )}

      {canEdit && !generationAvailable && (
        <p className="section-note">
          Metadata generation is not configured for this deployment. Everything below can still be
          entered and confirmed by hand.
        </p>
      )}

      <form action={saveAction} className="meta-form">
        <input name="assetId" type="hidden" value={photograph.id} />
        <input name="shootId" type="hidden" value={shootId ?? ""} />
        <input name="expectedVersion" type="hidden" value={version} />

        <fieldset className="meta-group" disabled={!canEdit}>
          <legend>Description</legend>

          <div className="meta-field">
            <Provenance field={fields.headline} />
            <Field
              defaultValue={asText(fields.headline)}
              label={FIELD_LABELS.headline}
              name="headline"
              ref={headlineRef}
              error={saveState.errors?.headline}
            />
          </div>

          <div className="meta-field">
            <Provenance field={fields.editorialCaption} />
            <Field
              control="textarea"
              defaultValue={asText(fields.editorialCaption)}
              error={saveState.errors?.editorialCaption}
              hint="What is happening, who is in frame, where, and when."
              label={FIELD_LABELS.editorialCaption}
              name="editorialCaption"
            />
          </div>

          <div className="meta-field">
            <Provenance field={fields.altText} />
            <Field
              control="textarea"
              defaultValue={asText(fields.altText)}
              error={saveState.errors?.altText}
              hint="One literal sentence for a reader who cannot see the image."
              label={FIELD_LABELS.altText}
              name="altText"
            />
          </div>

          <div className="meta-field">
            <Provenance field={fields.subjects} />
            <Field
              defaultValue={asText(fields.subjects)}
              hint="Comma separated. Never suggested by Mastline — leave it empty rather than guessing a name."
              label={FIELD_LABELS.subjects}
              name="subjects"
            />
          </div>
        </fieldset>

        <fieldset className="meta-group" disabled={!canEdit}>
          <legend>Place and context</legend>

          {(
            [
              ["eventName", undefined],
              ["venue", undefined],
              ["city", undefined],
              ["region", undefined],
              ["country", undefined],
              ["scene", "The activity, in a few words."],
            ] as const
          ).map(([name, hint]) => (
            <div className="meta-field" key={name}>
              <Provenance field={fields[name]} />
              <Field
                defaultValue={asText(fields[name])}
                error={saveState.errors?.[name]}
                hint={hint}
                label={FIELD_LABELS[name]}
                name={name}
              />
            </div>
          ))}
        </fieldset>

        <fieldset className="meta-group" disabled={!canEdit}>
          <legend>What is visible</legend>

          {(["objects", "clothing", "brands", "keywords"] as const).map((name) => (
            <div className="meta-field" key={name}>
              <Provenance field={fields[name]} />
              <Field
                defaultValue={asText(fields[name])}
                hint="Comma separated."
                label={FIELD_LABELS[name]}
                name={name}
              />
            </div>
          ))}

          <div className="meta-field">
            <Provenance field={fields.contentCategory} />
            <Field
              control="select"
              defaultValue={asText(fields.contentCategory)}
              label={FIELD_LABELS.contentCategory}
              name="contentCategory"
            >
              <option value="">Not set</option>
              {CONTENT_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {humanizeStatus(value)}
                </option>
              ))}
            </Field>
          </div>

          <div className="meta-field">
            <Provenance field={fields.qualityEstimate} />
            <Field
              control="select"
              defaultValue={asText(fields.qualityEstimate)}
              label={FIELD_LABELS.qualityEstimate}
              name="qualityEstimate"
            >
              <option value="">Not set</option>
              {QUALITY_ESTIMATES.map((value) => (
                <option key={value} value={value}>
                  {humanizeStatus(value)}
                </option>
              ))}
            </Field>
          </div>
        </fieldset>

        {/*
          Rights are the photographer's own. Mastline never proposes anything in
          this group, and the database refuses a generation write that touches
          it, so the absence of a provenance chip here is a fact rather than an
          omission -- it says the same thing the note below says.
        */}
        <fieldset className="meta-group rights" disabled={!canEdit}>
          <legend>Rights and handling</legend>
          <p className="section-note">
            Mastline never fills these in. Whether a release exists, and how a frame may be used, is
            yours to record.
          </p>

          <div className="meta-check">
            <input
              defaultChecked={asBool(fields.editorialUseOnly)}
              id="field-editorialUseOnly"
              name="editorialUseOnly"
              type="checkbox"
            />
            <label htmlFor="field-editorialUseOnly">{FIELD_LABELS.editorialUseOnly}</label>
          </div>

          <Field
            control="select"
            defaultValue={asText(fields.commercialUseEligible)}
            hint="Only you can decide this. It is never inferred from the image."
            label={FIELD_LABELS.commercialUseEligible}
            name="commercialUseEligible"
          >
            {COMMERCIAL_USE_STATES.map((value) => (
              <option key={value} value={value}>
                {humanizeStatus(value)}
              </option>
            ))}
          </Field>

          {(["modelReleaseStatus", "propertyReleaseStatus"] as const).map((name) => (
            <Field
              control="select"
              defaultValue={asText(fields[name])}
              key={name}
              label={FIELD_LABELS[name]}
              name={name}
            >
              {RELEASE_STATES.map((value) => (
                <option key={value} value={value}>
                  {humanizeStatus(value)}
                </option>
              ))}
            </Field>
          ))}

          <div className="meta-field">
            <Provenance field={fields.embargoUntil} />
            <Field
              defaultValue={
                asText(fields.embargoUntil) ? asText(fields.embargoUntil).slice(0, 16) : ""
              }
              error={saveState.errors?.embargoUntil}
              hint="Nothing is dispatched before this passes."
              label={FIELD_LABELS.embargoUntil}
              name="embargoUntil"
              type="datetime-local"
            />
          </div>

          <Field
            control="select"
            defaultValue={asText(fields.sensitivity) || "none"}
            hint="Mastline may raise this. It can never lower one you set."
            label={FIELD_LABELS.sensitivity}
            name="sensitivity"
          >
            {SENSITIVITIES.map((value) => (
              <option key={value} value={value}>
                {humanizeStatus(value)}
              </option>
            ))}
          </Field>

          <div className="meta-check">
            <input
              defaultChecked={asBool(fields.sensitiveOrMinor)}
              id="field-sensitiveOrMinor"
              name="sensitiveOrMinor"
              type="checkbox"
            />
            <label htmlFor="field-sensitiveOrMinor">{FIELD_LABELS.sensitiveOrMinor}</label>
          </div>
        </fieldset>

        <fieldset className="meta-group" disabled={!canEdit}>
          {/* "Internal" rather than "Your notes", which would repeat the field's
              own label immediately beneath it. */}
          <legend>Internal</legend>
          <Field
            control="textarea"
            defaultValue={asText(fields.photographerNotes)}
            error={saveState.errors?.photographerNotes}
            hint="Internal. Never suggested, never sent to a buyer."
            label={FIELD_LABELS.photographerNotes}
            name="photographerNotes"
          />
        </fieldset>

        {state.errors?._form && (
          <p className="auth-error" role="alert">
            {state.errors._form}
            {state.stale && (
              <>
                {" "}
                <button className="text-link" onClick={() => router.refresh()} type="button">
                  Reload the photograph
                </button>
              </>
            )}
          </p>
        )}

        {state.ok && state.message && (
          <p className="inspector-saved" role="status">
            {state.message}
          </p>
        )}

        {canEdit && (
          <div className="meta-actions">
            <button className="button blue" disabled={saving || confirming} type="submit">
              {saving ? "Saving…" : "Save"}
            </button>
            {navigation?.onNext && (
              <button
                className="button"
                disabled={saving || confirming}
                name="andNext"
                onClick={() => {
                  // The save is a form submit; moving on is a separate act that
                  // happens once it has been sent. React runs this before the
                  // action, so the move is deferred to the microtask after it.
                  queueMicrotask(() => navigation.onNext?.());
                }}
                type="submit"
              >
                Save and next
              </button>
            )}
          </div>
        )}
      </form>

      {canEdit && !isConfirmed && (
        <form action={confirmAction} className="confirm-gate">
          <input name="assetId" type="hidden" value={photograph.id} />
          <input name="shootId" type="hidden" value={shootId ?? ""} />
          <input name="expectedVersion" type="hidden" value={version} />

          {!showConfirm ? (
            <button className="button" onClick={() => setShowConfirm(true)} type="button">
              Confirm metadata
            </button>
          ) : (
            <div className="meta-warning">
              <h3>Confirm this metadata</h3>
              <p>
                Confirm that this information accurately describes the photograph. Confirmed
                metadata may be included in buyer submissions and licensing records, and its
                headline, caption, people, and keywords become the ones a dispatch sends.
              </p>
              <div className="meta-check">
                <input
                  id={`ack-${photograph.id}`}
                  name="acknowledged"
                  type="checkbox"
                  value="yes"
                />
                <label htmlFor={`ack-${photograph.id}`}>
                  I have read this and it describes the photograph.
                </label>
              </div>
              <div className="actions">
                <button className="button blue" disabled={confirming} type="submit">
                  {confirming ? "Confirming…" : "Confirm"}
                </button>
                <button className="button" onClick={() => setShowConfirm(false)} type="button">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      {isConfirmed && confirmedAt && (
        <p className="section-note">
          Confirmed {formatDateTime(confirmedAt)}. Editing a confirmed photograph keeps it
          confirmed, because the value is then yours.
        </p>
      )}

      {technical.length > 0 && (
        <details className="meta-technical">
          <summary>Read from the file</summary>
          <dl>
            {technical.map((entry) => (
              <div className="key-value" key={entry.label}>
                <dt>{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
          <p className="section-note">
            These come from the file itself and are never written by Mastline&rsquo;s suggestions.
          </p>
        </details>
      )}
    </section>
  );
}
