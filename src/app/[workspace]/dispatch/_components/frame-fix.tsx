"use client";

import { useActionState } from "react";
import { type MetadataState, saveAssetMetadataAction } from "../../shoots/actions";
import styles from "./dispatch-review.module.css";

const INITIAL: MetadataState = {};

/**
 * Fixing a frame without leaving the review.
 *
 * A blocked package used to be a dead end: the screen said which frames were
 * missing a caption and then offered nowhere to write one, so the operator left
 * for the shoot, edited, and came back to find out whether it was enough.
 *
 * This is the same server action the asset inspector uses -- same parsing, same
 * `asset.write` check, same append-only caption history, same
 * `captionReviewed: true`, which is the honest reading: the caption was on
 * screen in an editable field and a person saved it.
 *
 * Only the fields that are actually missing are shown. A form asking for eight
 * things when two are wrong buries the two.
 */
export function FrameFix({
  workspaceSlug,
  assetId,
  shootId,
  filename,
  missing,
  values,
  onDone,
}: {
  workspaceSlug: string;
  assetId: string;
  shootId: string;
  filename: string;
  missing: readonly string[];
  values: {
    caption?: string;
    headline?: string;
    creditLine?: string;
    copyrightNotice?: string;
    subjects?: readonly string[];
    locationName?: string;
    usageRestrictions?: string;
  };
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    saveAssetMetadataAction.bind(null, workspaceSlug),
    INITIAL,
  );

  const needs = (label: string) => missing.includes(label);

  /*
   * Capture time is required and is not editable here. It comes off the camera
   * at import, and a field that let somebody type one would be inviting them to
   * invent when a photograph was taken. Said plainly rather than left as a
   * blocker with no control beside it.
   */
  const captureTimeMissing = needs("Capture time");

  return (
    <form action={formAction} className={styles.fixForm}>
      <input name="assetId" type="hidden" value={assetId} />
      <input name="shootId" type="hidden" value={shootId} />

      {/* Every field the action accepts is posted, so saving one does not
          silently clear the others. */}
      {!needs("Headline") && <input name="headline" type="hidden" value={values.headline ?? ""} />}
      {!needs("Caption") && <input name="caption" type="hidden" value={values.caption ?? ""} />}
      {!needs("Credit") && (
        <input name="creditLine" type="hidden" value={values.creditLine ?? ""} />
      )}
      {!needs("Copyright") && (
        <input name="copyrightNotice" type="hidden" value={values.copyrightNotice ?? ""} />
      )}
      {!needs("People") && (
        <input name="subjects" type="hidden" value={(values.subjects ?? []).join(", ")} />
      )}
      {!needs("Location") && (
        <input name="locationName" type="hidden" value={values.locationName ?? ""} />
      )}
      {!needs("Usage restrictions") && (
        <input name="usageRestrictions" type="hidden" value={values.usageRestrictions ?? ""} />
      )}

      <p className={styles.fixLead}>
        Missing on {filename}: <strong>{missing.join(", ")}</strong>
      </p>

      {needs("Headline") && (
        <label className={styles.fixField} htmlFor={`fix-headline-${assetId}`}>
          Headline
          <input
            defaultValue={values.headline ?? ""}
            id={`fix-headline-${assetId}`}
            name="headline"
            placeholder="What the picture shows"
          />
        </label>
      )}

      {needs("Caption") && (
        <label className={styles.fixField} htmlFor={`fix-caption-${assetId}`}>
          Caption
          <textarea
            defaultValue={values.caption ?? ""}
            id={`fix-caption-${assetId}`}
            name="caption"
            placeholder="Who, what, where, when — as a desk would print it."
            rows={3}
          />
        </label>
      )}

      {needs("Credit") && (
        <label className={styles.fixField} htmlFor={`fix-credit-${assetId}`}>
          Credit
          <input
            defaultValue={values.creditLine ?? ""}
            id={`fix-credit-${assetId}`}
            name="creditLine"
            placeholder="Photographer / Agency"
          />
        </label>
      )}

      {needs("Copyright") && (
        <label className={styles.fixField} htmlFor={`fix-copyright-${assetId}`}>
          Copyright
          <input
            defaultValue={values.copyrightNotice ?? ""}
            id={`fix-copyright-${assetId}`}
            name="copyrightNotice"
            placeholder="© 2026 Name"
          />
        </label>
      )}

      {needs("People") && (
        <label className={styles.fixField} htmlFor={`fix-people-${assetId}`}>
          People
          <input
            defaultValue={(values.subjects ?? []).join(", ")}
            id={`fix-people-${assetId}`}
            name="subjects"
            placeholder="Separate names with commas"
          />
        </label>
      )}

      {needs("Location") && (
        <label className={styles.fixField} htmlFor={`fix-location-${assetId}`}>
          Location
          <input
            defaultValue={values.locationName ?? ""}
            id={`fix-location-${assetId}`}
            name="locationName"
            placeholder="Where it was taken"
          />
        </label>
      )}

      {needs("Usage restrictions") && (
        <label className={styles.fixField} htmlFor={`fix-restrictions-${assetId}`}>
          Usage restrictions
          <input
            defaultValue={values.usageRestrictions ?? ""}
            id={`fix-restrictions-${assetId}`}
            name="usageRestrictions"
            placeholder="Editorial use only…"
          />
        </label>
      )}

      {captureTimeMissing && (
        <p className={styles.fixNote} role="note">
          <strong>Capture time is missing and cannot be set here.</strong> It is read from the file
          at import, and typing one would be inventing when the photograph was taken. Re-import the
          frame with its original metadata intact.
        </p>
      )}

      {state.errors?._form && (
        <p className="auth-error" role="alert">
          {state.errors._form}
        </p>
      )}
      {state.ok && (
        <p className={styles.fixOk} role="status">
          {state.message ?? "Saved."}
        </p>
      )}

      <div className={styles.fixActions}>
        <button className="button blue small" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save frame"}
        </button>
        {onDone && (
          <button className="button small" disabled={pending} onClick={onDone} type="button">
            Close
          </button>
        )}
      </div>

      <p className={styles.fixNote}>
        Saving edits this frame everywhere it appears and keeps the previous caption in its history.
        It sends nothing.
      </p>
    </form>
  );
}
