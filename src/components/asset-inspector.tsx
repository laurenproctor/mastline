"use client";

import { useActionState, useState, useTransition } from "react";
import { Badge, Field } from "@/components/primitives";
import {
  type MetadataState,
  saveAssetMetadataAction,
  suggestAssetMetadataAction,
} from "@/app/[workspace]/shoots/actions";
import type { MetadataSuggestion } from "@/lib/metadata-suggestions";
import { formatConfidence } from "@/lib/format";

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
  /** True when the file is a clip rather than a still. */
  readonly isVideo?: boolean;
}

/**
 * Edit one asset's metadata.
 *
 * Saving preserves the previous values in the caption history rather than
 * overwriting them, which is why the form says so beneath the button. Remounted
 * per asset so the fields, and any suggestion sitting in them, belong to the
 * frame currently in view.
 */
export function AssetInspector({
  workspaceSlug,
  asset,
  shootId,
  shootLocationName,
  suggestionsAvailable = false,
}: {
  workspaceSlug: string;
  asset: InspectorAsset;
  shootId: string;
  /** Inherited into the Location field when this frame has none of its own. */
  shootLocationName?: string;
  suggestionsAvailable?: boolean;
}) {
  return (
    <InspectorForm
      asset={asset}
      key={asset.id}
      shootId={shootId}
      workspaceSlug={workspaceSlug}
      shootLocationName={shootLocationName}
      suggestionsAvailable={suggestionsAvailable}
    />
  );
}

function InspectorForm({
  workspaceSlug,
  asset,
  shootId,
  shootLocationName,
  suggestionsAvailable,
}: {
  workspaceSlug: string;
  asset: InspectorAsset;
  shootId: string;
  shootLocationName?: string;
  suggestionsAvailable: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveAssetMetadataAction.bind(null, workspaceSlug), INITIAL);

  // One fact entered once: a frame with no location of its own starts at the
  // shoot's, and the operator can overwrite it like any other field. This is a
  // form default, not a stored value -- nothing is written until Save.
  const [headline, setHeadline] = useState(asset.headline ?? "");
  const [caption, setCaption] = useState(asset.caption ?? "");
  const [keywords, setKeywords] = useState(asset.keywords.join(", "));
  const [locationName, setLocationName] = useState(asset.locationName ?? shootLocationName ?? "");

  const [suggestion, setSuggestion] = useState<MetadataSuggestion | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggesting, startSuggesting] = useTransition();

  const inheritedLocation =
    !asset.locationName && Boolean(shootLocationName) && locationName === shootLocationName;

  const requestSuggestion = () => {
    setSuggestError(null);
    startSuggesting(async () => {
      const result = await suggestAssetMetadataAction(workspaceSlug, asset.id);
      if (!result.ok || !result.suggestion) {
        setSuggestError(result.error ?? "The suggestion could not be made.");
        return;
      }
      const drafted = result.suggestion;
      setSuggestion(drafted);
      // Applied straight into the fields, because a suggestion nobody can edit
      // in place is a suggestion nobody uses. Nothing is saved by this.
      if (drafted.headline) setHeadline(drafted.headline);
      if (drafted.caption) setCaption(drafted.caption);
      if (drafted.keywords.length > 0) setKeywords(drafted.keywords.join(", "));
    });
  };

  return (
    <form action={formAction} className="inspector">
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

      {suggestionsAvailable && (
        <div className="suggest-bar">
          <button
            className="button small"
            disabled={suggesting || pending}
            onClick={requestSuggestion}
            type="button"
          >
            {suggesting
              ? "Reading the frame…"
              : suggestion
                ? "Suggest again"
                : `Suggest from the ${asset.isVideo ? "clip" : "image"}`}
          </button>
          <span className="section-note">
            Drafts a headline, caption, and keywords. Never suggests who is in frame.
          </span>
        </div>
      )}

      {suggestError && (
        <p className="auth-error" role="alert">
          {suggestError}
        </p>
      )}

      {suggestion && (
        <div className="suggestion-note" role="status">
          <Badge tone="blue">Suggested</Badge>
          <p>
            {suggestion.basis} Confidence {formatConfidence(suggestion.confidence)}. Read it,
            correct it, then save — nothing below is recorded until you do.
          </p>
        </div>
      )}

      <Field
        label="Headline"
        name="headline"
        onChange={(event) => setHeadline(event.target.value)}
        value={headline}
      />
      <Field
        control="textarea"
        hint="What is happening, who is in frame, where, and when."
        label="Caption"
        name="caption"
        onChange={(event) => setCaption(event.target.value)}
        value={caption}
      />
      <Field
        defaultValue={asset.subjects.join(", ")}
        hint="Comma separated. Leave empty rather than guessing a name. Never suggested."
        label="People"
        name="subjects"
      />
      <Field
        hint={inheritedLocation ? "Inherited from the shoot. Change it for this frame." : undefined}
        label="Location"
        name="locationName"
        onChange={(event) => setLocationName(event.target.value)}
        value={locationName}
      />
      <Field
        hint="Comma separated."
        label="Keywords"
        name="keywords"
        onChange={(event) => setKeywords(event.target.value)}
        value={keywords}
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
          : "Earlier versions are kept on every edit."}{" "}
        Editing never destroys what was there before.
      </p>
    </form>
  );
}
