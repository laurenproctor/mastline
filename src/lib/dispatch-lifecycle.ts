import type { PackageStatus, SubmissionStatus } from "./domain";

/**
 * Where a package is in its life, read from what has been recorded.
 *
 * The dispatch screen used to draw a three-stage strip with the middle stage
 * hard-coded as current, so an approved -- or opened, or sold -- package still
 * sat under "Review & approve". The stage is a fact about the record and is
 * derived from it here, from the package status and the submission it opened.
 *
 * The words are careful because the states are:
 *
 *   - Approval is not a send. An approved package with no link is at
 *     "Create recipient link".
 *   - Creating a link is not sharing it. A link that exists and was never
 *     marked shared leaves the package at "Create recipient link"; the next
 *     act is still on that link, and the screen says so beside the stage.
 *   - Sharing, or a recipient opening the link, is what moves it on. Both are
 *     recorded on the submission as `sent_at`, by the thing that evidenced it.
 *   - An outcome is one the operator recorded, or a provider reported.
 */
export const DISPATCH_STAGES = [
  "Preparing",
  "Review & approve",
  "Create recipient link",
  "Shared / awaiting outcome",
  "Outcome recorded",
] as const;

export type DispatchStage = (typeof DISPATCH_STAGES)[number];

export interface DispatchLifecycleInput {
  readonly packageStatus: PackageStatus;
  /** The submission approval opened, if any. */
  readonly submission?: {
    readonly status: SubmissionStatus;
    readonly sentAt?: string;
  } | null;
}

const OUTCOME_RECORDED: ReadonlySet<SubmissionStatus> = new Set([
  "sold",
  "no_sale",
  "recalled",
  "failed",
]);

const LEFT_MASTLINE: ReadonlySet<SubmissionStatus> = new Set(["sent", "delivered", "acknowledged"]);

const APPROVED: ReadonlySet<PackageStatus> = new Set(["approved", "sending", "delivered"]);

export function dispatchStage(input: DispatchLifecycleInput): {
  readonly stage: DispatchStage;
  readonly index: number;
} {
  const { packageStatus, submission } = input;

  const index = (() => {
    if (submission && OUTCOME_RECORDED.has(submission.status)) return 4;
    if (packageStatus === "recalled" || packageStatus === "failed") return 4;
    if (submission && (Boolean(submission.sentAt) || LEFT_MASTLINE.has(submission.status))) {
      return 3;
    }
    if (packageStatus === "sending" || packageStatus === "delivered") return 3;
    if (APPROVED.has(packageStatus) || submission) return 2;
    if (packageStatus === "needs_review" || packageStatus === "ready") return 1;
    return 0;
  })();

  return { stage: DISPATCH_STAGES[index], index };
}
