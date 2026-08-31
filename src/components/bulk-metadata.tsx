"use client";

import { useActionState, useState } from "react";
import { Badge, Field } from "@/components/primitives";
import { type MetadataState, applyMetadataToManyAction } from "@/app/[workspace]/shoots/actions";

const INITIAL: MetadataState = {};

/**
 * Apply one set of metadata across the selection.
 *
 * A whole card of frames usually shares a credit, a copyright, a location, and
 * often a caption. Typing that once instead of eighteen times is most of the
 * speed of the culling stage.
 *
 * Only the fields you fill in are written. An empty field is left alone rather
 * than blanking what is already there, because a bulk action that silently
 * erases work is worse than no bulk action.
 */
export function BulkMetadata({
  workspaceSlug,
  shootId,
  selectedIds,
  defaults,
}: {
  workspaceSlug: string;
  shootId: string;
  selectedIds: readonly string[];
  defaults: {
    creditLine?: string;
    copyrightNotice?: string;
    locationName?: string;
    usageRestrictions?: string;
  };
}) {
  const [state, formAction, pending] = useActionState(
    applyMetadataToManyAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [open, setOpen] = useState(false);

  if (selectedIds.length === 0) {
    return (
      <div className="side-card">
        <h3>Apply to many</h3>
        <p>Select frames first, then apply a shared caption, credit, or location to all of them.</p>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="side-card">
        <h3>Apply to many</h3>
        <p>
          Write a shared caption, credit, copyright, or location once and apply it to all{" "}
          {selectedIds.length} selected {selectedIds.length === 1 ? "frame" : "frames"}.
        </p>
        <button className="button" onClick={() => setOpen(true)} type="button">
          Apply to {selectedIds.length} selected
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="side-card">
      <input name="shootId" type="hidden" value={shootId} />
      {selectedIds.map((id) => (
        <input key={id} name="assetIds" type="hidden" value={id} />
      ))}

      <div className="inspector-head">
        <h3>Apply to {selectedIds.length}</h3>
        <Badge tone="warn">Overwrites</Badge>
      </div>

      <Field control="textarea" label="Caption" name="caption" />
      <div className="spacer" />
      <Field label="People" name="subjects" placeholder="Comma separated" />
      <div className="spacer" />
      <Field defaultValue={defaults.locationName ?? ""} label="Location" name="locationName" />
      <div className="spacer" />
      <Field label="Keywords" name="keywords" placeholder="Comma separated" />
      <div className="spacer" />
      <Field defaultValue={defaults.creditLine ?? ""} label="Credit" name="creditLine" />
      <div className="spacer" />
      <Field
        defaultValue={defaults.copyrightNotice ?? ""}
        label="Copyright"
        name="copyrightNotice"
      />
      <div className="spacer" />
      <Field
        control="textarea"
        defaultValue={defaults.usageRestrictions ?? ""}
        label="Usage restrictions"
        name="usageRestrictions"
      />

      {state.errors?._form && (
        <p className="auth-error" role="alert">
          {state.errors._form}
        </p>
      )}
      {state.ok && (
        <p className="inspector-saved" role="status">
          {state.message}
        </p>
      )}

      <div className="spacer" />
      <div className="actions">
        <button className="button blue" disabled={pending} type="submit">
          {pending ? "Applying…" : `Apply to ${selectedIds.length}`}
        </button>
        <button className="button" onClick={() => setOpen(false)} type="button">
          Cancel
        </button>
      </div>
      <p className="section-note">
        Every frame keeps its previous version in the caption history. A field left empty is not
        applied.
      </p>
    </form>
  );
}
