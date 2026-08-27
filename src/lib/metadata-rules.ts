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

import type { Asset } from "./domain";
import { captionAwaitsReview } from "./metadata-suggestions";

export type MetadataSeverity = "required" | "recommended";

export interface MetadataRule {
  readonly field: string;
  readonly label: string;
  readonly severity: MetadataSeverity;
  readonly describe: string;
  readonly isSatisfied: (asset: Asset) => boolean;
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
    describe:
      "What is happening, who is in frame, where, and when. A caption drafted at import counts once someone has read it and saved it.",
    /*
     * Text alone is not enough, and this is the line that makes drafting a
     * caption at import safe to do at all.
     *
     * The caption writer fills this field for every frame as it lands, so from
     * here on "the field is not empty" says nothing about whether a person has
     * ever looked at the sentence. An unread draft failing the requirement is
     * what keeps a machine description out of a submission, an invoice, and a
     * newspaper.
     */
    isSatisfied: (asset) => nonEmpty(asset.caption) && !captionAwaitsReview(asset),
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
): MetadataReport {
  const missingRequired = rules.filter(
    (rule) => rule.severity === "required" && !rule.isSatisfied(asset),
  );
  const missingRecommended = rules.filter(
    (rule) => rule.severity === "recommended" && !rule.isSatisfied(asset),
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

/** Roll the per-asset reports up for a selection, a shoot, or a package. */
export function reviewSelection(
  assets: readonly Asset[],
  rules: readonly MetadataRule[] = BASELINE_RULES,
): SelectionReport {
  const reports = assets.map((asset) => reviewAsset(asset, rules));
  const ready = reports.filter((report) => report.isDispatchReady).length;

  return {
    total: assets.length,
    ready,
    blocked: assets.length - ready,
    completionPercent: assets.length === 0 ? 0 : Math.round((ready / assets.length) * 100),
    reports,
  };
}
