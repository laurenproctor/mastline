"use client";

import { useActionState } from "react";
import { Badge, Field } from "@/components/primitives";
import { type MetadataState, saveAssetMetadataAction } from "@/app/shoots/actions";

const INITIAL: MetadataState = {};

export interface InspectorAsset {
  readonly id: string;
  readonly filename: string;
  readonly headline?: string;
  readonly caption?: string;
  readonly subjects: readonly string[];
  readonly locationName?: string;
  readonly keywords: readonly string[];
  readonly creditLine?: string;
  readonly copyrightNotice?: string;
  readonly usageRestrictions?: string;
  readonly capturedAt?: string;
  readonly missingRequired: readonly string[];
  readonly missingRecommended: readonly string[];
  readonly revisionCount: number;
}

/**
 * Edit one asset's metadata.
 *
 * Saving preserves the previous values in the caption history rather than
 * overwriting them, which is why the form says so beneath the button. The key
 * on the form resets its fields when the focused frame changes.
 */
export function AssetInspector({ asset, shootId }: { asset: InspectorAsset; shootId: string }) {
  const [state, formAction, pending] = useActionState(saveAssetMetadataAction, INITIAL);

  return (
    <form action={formAction} className="inspector" key={asset.id}>
      <input name="assetId" type="hidden" value={asset.id} />
      <input name="shootId" type="hidden" value={shootId} />

      <div className="inspector-head">
        <p className="section-note">{asset.filename}</p>
        {asset.missingRequired.length > 0 ? (
          <Badge tone="warn">{asset.missingRequired.length} required missing</Badge>
        ) : (
          <Badge tone="good">Dispatch ready</Badge>
        )}
      </div>

      {asset.missingRequired.length > 0 && (
        <p className="inspector-missing">Needs: {asset.missingRequired.join(", ")}</p>
      )}

      <Field defaultValue={asset.headline ?? ""} label="Headline" name="headline" />
      <Field
        control="textarea"
        defaultValue={asset.caption ?? ""}
        hint="What is happening, who is in frame, where, and when."
        label="Caption"
        name="caption"
      />
      <Field
        defaultValue={asset.subjects.join(", ")}
        hint="Comma separated. Leave empty rather than guessing a name."
        label="People"
        name="subjects"
      />
      <Field defaultValue={asset.locationName ?? ""} label="Location" name="locationName" />
      <Field
        defaultValue={asset.keywords.join(", ")}
        hint="Comma separated."
        label="Keywords"
        name="keywords"
      />
      <Field defaultValue={asset.creditLine ?? ""} label="Credit" name="creditLine" />
      <Field defaultValue={asset.copyrightNotice ?? ""} label="Copyright" name="copyrightNotice" />
      <Field
        control="textarea"
        defaultValue={asset.usageRestrictions ?? ""}
        label="Usage restrictions"
        name="usageRestrictions"
      />

      {state.errors?._form && (
        <p className="auth-error" role="alert">
          {state.errors._form}
        </p>
      )}
      {state.ok && state.message && (
        <p className="inspector-saved" role="status">
          {state.message}
        </p>
      )}

      <div className="inspector-actions">
        <button className="button blue" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save metadata"}
        </button>
      </div>

      <p className="section-note">
        {asset.revisionCount > 0
          ? `${asset.revisionCount} earlier ${asset.revisionCount === 1 ? "version" : "versions"} kept.`
          : "Earlier versions are kept when you edit."}{" "}
        Editing never destroys what was there before.
      </p>
    </form>
  );
}
