import { IMPORT_FILE_STATUSES, type ImportFileStatus } from "@/lib/domain";

/**
 * The transitions a queued import is allowed to make.
 *
 * This is a table rather than a set of `if` statements because the interesting
 * failures in an upload queue are the transitions nobody thought about: a
 * finalize arriving after a cancel, a pause landing on an item that has already
 * completed, a retry restarting a file whose bytes are gone. Written out, each
 * of those is a lookup that returns false rather than a bug that shows an
 * operator a file as "Imported" when it is not.
 *
 * Three rules shape it:
 *
 *   1. `complete` is terminal. It means an asset exists, and an asset existing
 *      is not something a client can take back. The database enforces this too.
 *   2. `canceled` and `failed` are not terminal, because both are recoverable
 *      by a person: a failed file is retried, a canceled one can be started
 *      again from its local copy. They lead back through `retrying` or
 *      `pending`, never sideways into the middle of a run.
 *   3. `finalizing` cannot be paused. The server is creating an asset; there is
 *      nothing local to suspend, and pretending otherwise would leave the queue
 *      believing it owned a decision the server had already made.
 */
const TRANSITIONS: Record<ImportFileStatus, readonly ImportFileStatus[]> = {
  // Registered locally, bytes not yet held anywhere durable.
  pending: ["staged", "uploading", "paused", "failed", "canceled"],
  // Bytes copied into the origin private file system: a reload can find them.
  staged: ["uploading", "paused", "failed", "canceled"],
  uploading: ["uploaded", "paused", "retrying", "failed", "canceled"],
  uploaded: ["finalizing", "paused", "retrying", "failed", "canceled"],
  finalizing: ["complete", "retrying", "failed", "canceled"],
  complete: [],
  // Resuming goes through `retrying`, which is what decides where to pick up.
  paused: ["retrying", "failed", "canceled"],
  retrying: ["staged", "uploading", "uploaded", "finalizing", "paused", "failed", "canceled"],
  failed: ["retrying", "pending", "canceled"],
  canceled: ["pending", "retrying"],
};

/** Statuses from which no further work will be attempted without a person. */
export const TERMINAL_STATUSES: readonly ImportFileStatus[] = ["complete"];

/** Statuses that still owe the workspace a file. */
export const OUTSTANDING_STATUSES: readonly ImportFileStatus[] = IMPORT_FILE_STATUSES.filter(
  (status) => status !== "complete" && status !== "canceled",
);

export function canTransition(from: ImportFileStatus, to: ImportFileStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isOutstanding(status: ImportFileStatus): boolean {
  return OUTSTANDING_STATUSES.includes(status);
}

/** True once the bytes are the server's problem rather than this machine's. */
export function isServerHeld(status: ImportFileStatus): boolean {
  return status === "uploaded" || status === "finalizing" || status === "complete";
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: ImportFileStatus,
    readonly to: ImportFileStatus,
    readonly itemId?: string,
  ) {
    super(
      `An import cannot go from ${from} to ${to}${itemId ? ` (item ${itemId})` : ""}. ` +
        `Allowed from ${from}: ${TRANSITIONS[from].join(", ") || "nothing"}.`,
    );
    this.name = "InvalidTransitionError";
  }
}

/**
 * Move a status, or refuse loudly.
 *
 * Refusing loudly rather than clamping: a queue that silently ignores an
 * impossible transition carries on displaying a state that stopped being true,
 * and the whole point of this module is that the displayed state is the truth.
 */
export function transition(
  from: ImportFileStatus,
  to: ImportFileStatus,
  itemId?: string,
): ImportFileStatus {
  if (from === to) return to;
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to, itemId);
  return to;
}

/**
 * Where a resumed item picks up, given what the server last knew.
 *
 * Resumption is a decision about evidence, not about optimism. A file the
 * server has already accepted bytes for is finalized rather than uploaded
 * again; a file it has not is uploaded again only if this machine still holds
 * the bytes; and anything else is waiting on the operator to hand it the file.
 */
export type ResumeAction = "upload" | "finalize" | "needs_file" | "done" | "wait";

export function resumeActionFor(input: {
  serverStatus: ImportFileStatus | "unknown";
  bytesAvailableLocally: boolean;
}): ResumeAction {
  switch (input.serverStatus) {
    case "complete":
      return "done";
    case "uploaded":
    case "finalizing":
      // The bytes are in storage. Finalization is idempotent, so asking again
      // costs a round trip and can never make a second asset.
      return "finalize";
    case "canceled":
      return "wait";
    default:
      return input.bytesAvailableLocally ? "upload" : "needs_file";
  }
}
