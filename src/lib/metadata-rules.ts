/**
 * What "complete enough" means for an asset.
 *
 * These rules drive three things that must not drift apart: the warning badges
 * on the contact sheet, the completeness figure on the shoot header, and the
 * dispatch approval gate. Defining them once is why the gate can be trusted.
 *
 * A buyer profile may demand more than the baseline. That is additive: a
 * requirement is never dropped because a buyer did not ask for it.
 */

import { type PhotographMetadata, blockingMetadataReasons } from "./asset-metadata";
import type { Asset } from "./domain";

export type MetadataSeverity = "required" | "recommended";

export interface MetadataRule {
  readonly field: string;
  readonly label: string;
  readonly severity: MetadataSeverity;
  readonly describe: string;
  /**
   * The photograph's structured metadata record, where it has one.
   *
   * Optional because most rules read the asset alone, and because a shoot
   * imported before the metadata record existed has none. A rule that needs it
   * must treat `null` as "nothing to object to" rather than as a failure --
   * captioning by hand has always been a complete workflow.
   */
  readonly isSatisfied: (asset: Asset, metadata?: PhotographMetadata | null) => boolean;
}

const nonEmpty = (value: string | undefined | null): boolean =>
  typeof value === "string" && value.trim().length > 0;

/**
 * The baseline every asset must carry before it can be sent to anyone.
 *
 * Caption, credit, and copyright are required because a picture desk will
 * reject or mis-attribute work without them. A subject is recommended rather
 * than required: not every frame has a named person, and forcing one invites
 * a guess being recorded as fact.
 */
export const BASELINE_RULES: readonly MetadataRule[] = [
  {
    field: "caption",
    label: "Caption",
    severity: "required",
    describe: "What is happening, who is in frame, where, and when.",
    isSatisfied: (asset) => nonEmpty(asset.caption),
  },
  {
    field: "headline",
    label: "Headline",
    severity: "recommended",
    describe: "A short line a desk can scan.",
    isSatisfied: (asset) => nonEmpty(asset.headline),
  },
  {
    field: "creditLine",
    label: "Credit",
    severity: "required",
    describe: "How the photographer must be credited on publication.",
    isSatisfied: (asset) => nonEmpty(asset.creditLine),
  },
  {
    field: "copyrightNotice",
    label: "Copyright",
    severity: "required",
    describe: "Who owns the copyright.",
    isSatisfied: (asset) => nonEmpty(asset.copyrightNotice),
  },
  {
    field: "capturedAt",
    label: "Capture time",
    severity: "required",
    describe: "When the frame was taken. Read from the file where present.",
    isSatisfied: (asset) => nonEmpty(asset.capturedAt),
  },
  {
    field: "locationName",
    label: "Location",
    severity: "recommended",
    describe: "Where the frame was taken.",
    isSatisfied: (asset) => nonEmpty(asset.locationName),
  },
  {
    field: "subjects",
    label: "People",
    severity: "recommended",
    describe: "Named people in frame. Leave empty rather than guessing.",
    isSatisfied: (asset) => asset.subjects.length > 0,
  },
  {
    field: "usageRestrictions",
    label: "Usage restrictions",
    severity: "recommended",
    describe: "Any limit on how the image may be used.",
    isSatisfied: (asset) => nonEmpty(asset.usageRestrictions),
  },
  /*
   * The one rule that is about who wrote the words rather than whether they
   * exist.
   *
   * A machine may propose a caption, a scene, a city, a list of brands. None of
   * that may reach a picture desk unread, because a desk will treat it as the
   * photographer's own account of what they saw. So a photograph carrying
   * generated metadata that nobody has confirmed is not dispatch-ready, however
   * complete it looks.
   *
   * A photograph with no metadata record, or one whose record was never
   * generated, passes: there is nothing inferred in play, and the caption,
   * credit and copyright rules above already apply.
   */
  {
    field: "metadataConfirmed",
    label: "Metadata review",
    severity: "required",
    describe:
      "Generated metadata has to be confirmed, and a hold has to have expired, before a frame is sent.",
    isSatisfied: (_asset, metadata) => blockingMetadataReasons(metadata ?? null).length === 0,
  },
];

export interface MetadataReport {
  readonly assetId: string;
  readonly missingRequired: readonly MetadataRule[];
  readonly missingRecommended: readonly MetadataRule[];
  /** True when nothing required is missing. Gates dispatch approval. */
  readonly isDispatchReady: boolean;
  /** 0-100 across required rules only, so a recommendation cannot mask a gap. */
  readonly requiredCompletionPercent: number;
}

export function reviewAsset(
  asset: Asset,
  rules: readonly MetadataRule[] = BASELINE_RULES,
  metadata: PhotographMetadata | null = null,
): MetadataReport {
  const missingRequired = rules.filter(
    (rule) => rule.severity === "required" && !rule.isSatisfied(asset, metadata),
  );
  const missingRecommended = rules.filter(
    (rule) => rule.severity === "recommended" && !rule.isSatisfied(asset, metadata),
  );
  const requiredCount = rules.filter((rule) => rule.severity === "required").length;

  return {
    assetId: asset.id,
    missingRequired,
    missingRecommended,
    isDispatchReady: missingRequired.length === 0,
    requiredCompletionPercent:
      requiredCount === 0
        ? 100
        : Math.round(((requiredCount - missingRequired.length) / requiredCount) * 100),
  };
}

export interface SelectionReport {
  readonly total: number;
  readonly ready: number;
  readonly blocked: number;
  readonly completionPercent: number;
  readonly reports: readonly MetadataReport[];
}

/**
 * Roll the per-asset reports up for a selection, a shoot, or a package.
 *
 * `metadata` is keyed by asset id and may be partial or absent entirely. A
 * caller that has not loaded the records gets the same answer it always got,
 * which keeps the screens that do not need them from having to fetch them.
 */
export function reviewSelection(
  assets: readonly Asset[],
  rules: readonly MetadataRule[] = BASELINE_RULES,
  metadata?: ReadonlyMap<string, PhotographMetadata>,
): SelectionReport {
  const reports = assets.map((asset) =>
    reviewAsset(asset, rules, metadata?.get(asset.id) ?? null),
  );
  const ready = reports.filter((report) => report.isDispatchReady).length;

  return {
    total: assets.length,
    ready,
    blocked: assets.length - ready,
    completionPercent: assets.length === 0 ? 0 : Math.round((ready / assets.length) * 100),
    reports,
  };
}
