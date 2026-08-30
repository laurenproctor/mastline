import type { PackageStatus, SubmissionStatus } from "./domain";

/**
 * Where a package is in its life, read from what has been recorded.
 *
 * The dispatch screen used to draw a three-stage strip with the middle stage
 * hard-coded as current, so an approved -- or opened, or sold -- package still
 * sat under "Review & approve". The stage is a fact about the record and is
 * derived from it here: from the package status, the submission approval
 * opened, and the recipient links made for it.
 *
 * The words are careful because the states are:
 *
 *   - Approval is not a send. An approved package with no link is at
 *     "Create recipient link".
 *   - Creating a link is not sharing it. A link that exists and was never
 *     marked shared leaves the package at "Create recipient link"; the next
 *     act is still on that link, and the detail beside the stage says so.
 *   - Sharing, or a recipient opening the link, is what moves it on. Both are
 *     recorded on the submission as `sent_at`, by the thing that evidenced it.
 *   - An outcome is one the operator recorded, or a provider reported.
 *
 * Nothing here invents a send, a delivery, or a recipient action: every
 * boundary is a column somebody or something wrote.
 */
export const DISPATCH_STAGES = [
  "Build package",
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
  /** The recipient links made on that submission, if any. */
  readonly links?: readonly {
    readonly sharedAt?: string;
    readonly revokedAt?: string;
  }[];
}

export interface DispatchLifecycle {
  readonly stage: DispatchStage;
  readonly index: number;
  /**
   * The state within the stage, when the stage alone would understate it: a
   * link that exists but has not been marked shared is still at "Create
   * recipient link", and the screen should say a link exists.
   */
  readonly detail?: string;
}

const OUTCOME_RECORDED: ReadonlySet<SubmissionStatus> = new Set([
  "sold",
  "no_sale",
  "recalled",
  "failed",
]);

const LEFT_MASTLINE: ReadonlySet<SubmissionStatus> = new Set(["sent", "delivered", "acknowledged"]);

const APPROVED: ReadonlySet<PackageStatus> = new Set(["approved", "sending", "delivered"]);

export function dispatchStage(input: DispatchLifecycleInput): DispatchLifecycle {
  const { packageStatus, submission } = input;
  const links = input.links ?? [];
  const shared = links.some((link) => Boolean(link.sharedAt));
  const unshared = links.filter((link) => !link.sharedAt && !link.revokedAt).length;

  const index = (() => {
    if (submission && OUTCOME_RECORDED.has(submission.status)) return 4;
    if (packageStatus === "recalled" || packageStatus === "failed") return 4;
    if (submission && (Boolean(submission.sentAt) || LEFT_MASTLINE.has(submission.status))) {
      return 3;
    }
    if (shared || packageStatus === "sending" || packageStatus === "delivered") return 3;
    if (APPROVED.has(packageStatus) || submission) return 2;
    if (packageStatus === "needs_review" || packageStatus === "ready") return 1;
    return 0;
  })();

  const detail =
    index === 2 && unshared > 0
      ? `${unshared === 1 ? "A recipient link exists" : `${unshared} recipient links exist`} and ${
          unshared === 1 ? "has" : "have"
        } not been marked as shared. Nothing has left Mastline.`
      : index === 2
        ? "Approved and frozen. No recipient link has been created yet."
        : undefined;

  return { stage: DISPATCH_STAGES[index], index, detail };
}
