"use client";

import "@/styles/mastline-dashboard-screens.css";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionLink, Button } from "@/components/button";
import { type MetadataState, saveAssetMetadataAction } from "../../shoots/actions";

/**
 * Stage two: what a photo desk needs to understand and use each frame.
 *
 * Headline, Caption, and People lead, per the constitution's metadata order.
 * The save is the same server action the asset inspector uses — same parsing,
 * same asset.write check, same append-only caption history, and the same
 * `captionReviewed: true`, which is the honest reading: the caption was on
 * screen in an editable field and a person saved it. A caption the machine
 * drafted says so beside the field until that happens, and readiness below
 * repeats the metadata rules rather than inventing its own.
 *
 * Credit, copyright, location, keywords, and restrictions ride along as
 * hidden fields so saving a headline cannot blank them. Capture time is shown
 * but never editable here: it comes off the camera at import, and a field
 * that let somebody type one would invite inventing when a photograph was
 * taken.
 */

export interface DetailFrame {
  readonly assetId: string;
  readonly filename: string;
  readonly previewUrl?: string;
  readonly headline?: string;
  readonly caption?: string;
  readonly captionAwaitsReview: boolean;
  readonly captionBasis?: string;
  readonly people: readonly string[];
  readonly creditLine?: string;
  readonly copyrightNotice?: string;
  readonly locationName?: string;
  readonly usageRestrictions?: string;
  readonly keywords: readonly string[];
  readonly capturedAt?: string;
  readonly capturedLabel?: string;
  /** Labels of required rules this frame still fails. */
  readonly missingRequired: readonly string[];
}

const INITIAL: MetadataState = {};
const MAX_HEADLINE = 200;
const MAX_CAPTION = 2000;

function FrameForm({
  workspaceSlug,
  shootId,
  frame,
}: {
  workspaceSlug: string;
  shootId: string;
  frame: DetailFrame;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [state, formAction, pending] = useActionState(
    async (previous: MetadataState, formData: FormData) => {
      const result = await saveAssetMetadataAction(workspaceSlug, previous, formData);
      if (result.ok) startTransition(() => router.refresh());
      return result;
    },
    INITIAL,
  );
  const [headline, setHeadline] = useState(frame.headline ?? "");
  const [caption, setCaption] = useState(frame.caption ?? "");

  return (
    <form action={formAction} className="ml-delivery-details__form">
      <input name="assetId" type="hidden" value={frame.assetId} />
      <input name="shootId" type="hidden" value={shootId} />
      {/* Fields not edited on this screen, posted back unchanged. */}
      <input name="creditLine" type="hidden" value={frame.creditLine ?? ""} />
      <input name="copyrightNotice" type="hidden" value={frame.copyrightNotice ?? ""} />
      <input name="locationName" type="hidden" value={frame.locationName ?? ""} />
      <input name="usageRestrictions" type="hidden" value={frame.usageRestrictions ?? ""} />
      <input name="keywords" type="hidden" value={frame.keywords.join(", ")} />

      <div className="ml-field">
        <label className="ml-label" htmlFor={`detail-headline-${frame.assetId}`}>
          Headline
        </label>
        <input
          className="ml-input"
          id={`detail-headline-${frame.assetId}`}
          maxLength={MAX_HEADLINE}
          name="headline"
          onChange={(event) => setHeadline(event.target.value)}
          placeholder="What the picture shows, in one line"
          value={headline}
        />
        <p aria-hidden="true" className="ml-delivery-details__count">
          {headline.length} / {MAX_HEADLINE}
        </p>
      </div>

      <div className="ml-field">
        <label className="ml-label" htmlFor={`detail-caption-${frame.assetId}`}>
          Caption
        </label>
        <textarea
          className="ml-textarea"
          id={`detail-caption-${frame.assetId}`}
          maxLength={MAX_CAPTION}
          name="caption"
          onChange={(event) => setCaption(event.target.value)}
          placeholder="Who, what, where, when — as a desk would print it."
          rows={5}
          value={caption}
        />
        <p aria-hidden="true" className="ml-delivery-details__count">
          {caption.length} / {MAX_CAPTION}
        </p>
        {frame.captionAwaitsReview && (
          <p className="ml-delivery-details__awaiting" role="note">
            Drafted at import{frame.captionBasis ? ` from ${frame.captionBasis}` : ""} and not yet
            reviewed. Read it; saving records that a person stands behind it.
          </p>
        )}
      </div>

      <div className="ml-field">
        <label className="ml-label" htmlFor={`detail-people-${frame.assetId}`}>
          People
        </label>
        <input
          className="ml-input"
          defaultValue={frame.people.join(", ")}
          id={`detail-people-${frame.assetId}`}
          name="subjects"
          placeholder="Named people in frame, comma-separated"
        />
        <p className="ml-help">Leave empty rather than guessing a name. Never suggested.</p>
      </div>

      <dl className="ml-delivery-details__facts">
        <div>
          <dt>Captured</dt>
          <dd>{frame.capturedLabel ?? "Not recorded — re-import with original metadata"}</dd>
        </div>
        <div>
          <dt>Credit</dt>
          <dd>{frame.creditLine ?? "—"}</dd>
        </div>
        <div>
          <dt>Copyright</dt>
          <dd>{frame.copyrightNotice ?? "—"}</dd>
        </div>
      </dl>

      {state.errors?._form && (
        <p className="ml-error" role="alert">
          {state.errors._form}
        </p>
      )}
      {state.errors?.caption && (
        <p className="ml-error" role="alert">
          {state.errors.caption}
        </p>
      )}
      {state.errors?.headline && (
        <p className="ml-error" role="alert">
          {state.errors.headline}
        </p>
      )}
      {state.ok && (
        <p className="ml-delivery-details__saved" role="status">
          Saved. The previous version is kept in the caption history.
        </p>
      )}

      <Button disabled={pending} type="submit" variant="secondary">
        {pending ? "Saving…" : "Save details"}
      </Button>
    </form>
  );
}

export function DetailsStage({
  workspaceSlug,
  shootId,
  frames,
  readyCount,
  editable,
  continueHref,
  backHref,
}: {
  workspaceSlug: string;
  shootId: string;
  frames: readonly DetailFrame[];
  readyCount: number;
  editable: boolean;
  continueHref: string;
  backHref: string;
}) {
  const firstIncomplete = frames.findIndex((frame) => frame.missingRequired.length > 0);
  const [index, setIndex] = useState(firstIncomplete === -1 ? 0 : firstIncomplete);
  const frame = frames[Math.min(index, frames.length - 1)];
  const allReady = readyCount === frames.length && frames.length > 0;

  if (!frame) {
    return (
      <p className="ml-delivery-empty">
        No photographs are in this delivery yet. Go back to Photos and choose at least one.
      </p>
    );
  }

  return (
    <div className="ml-delivery-details">
      <div className="ml-delivery-details__work">
        <div className="ml-delivery-details__media">
          {frame.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={frame.headline ?? frame.filename} src={frame.previewUrl} />
          ) : (
            <span className="ml-delivery-frame__blank">No preview · {frame.filename}</span>
          )}
          <div className="ml-delivery-details__pager">
            <span aria-live="polite">
              {index + 1} of {frames.length}
            </span>
            <ul aria-label="Photographs in this delivery" className="ml-delivery-thumbs">
              {frames.map((candidate, candidateIndex) => (
                <li key={candidate.assetId}>
                  <button
                    aria-current={candidateIndex === index ? "true" : undefined}
                    aria-label={`Photograph ${candidateIndex + 1}: ${candidate.filename}${
                      candidate.missingRequired.length > 0 ? ", details incomplete" : ", ready"
                    }`}
                    className="ml-delivery-thumbs__item"
                    data-incomplete={candidate.missingRequired.length > 0 || undefined}
                    onClick={() => setIndex(candidateIndex)}
                    type="button"
                  >
                    {candidate.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" src={candidate.previewUrl} />
                    ) : (
                      <span aria-hidden="true">{candidateIndex + 1}</span>
                    )}
                    <span aria-hidden="true" className="ml-delivery-thumbs__ordinal">
                      {candidateIndex + 1}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {editable ? (
          <FrameForm
            frame={frame}
            key={frame.assetId}
            shootId={shootId}
            workspaceSlug={workspaceSlug}
          />
        ) : (
          <div className="ml-delivery-details__form">
            <p className="ml-help">
              This role can read the details but not edit them. Editing needs the asset-write
              permission.
            </p>
            <dl className="ml-delivery-details__facts">
              <div>
                <dt>Headline</dt>
                <dd>{frame.headline ?? "—"}</dd>
              </div>
              <div>
                <dt>Caption</dt>
                <dd>{frame.caption ?? "—"}</dd>
              </div>
              <div>
                <dt>People</dt>
                <dd>
                  {frame.people.length > 0 ? frame.people.join(", ") : "No people identified"}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      <div className="ml-delivery-flow__actions">
        <div className="ml-delivery-flow__back">
          <ActionLink href={backHref} variant="quiet">
            Back to photos
          </ActionLink>
        </div>
        <p className="ml-delivery-flow__standing" role="status">
          {allReady
            ? `Ready for delivery · ${readyCount} of ${frames.length} photographs have required details`
            : `${readyCount} of ${frames.length} photographs have required details`}
          {frame.missingRequired.length > 0 &&
            ` · this frame still needs ${frame.missingRequired.join(", ").toLowerCase()}`}
        </p>
        <div className="ml-delivery-flow__advance">
          {allReady ? (
            <ActionLink href={continueHref}>Continue to recipient</ActionLink>
          ) : (
            <Button aria-disabled="true" disabled title="Complete the required details first">
              Continue to recipient
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
