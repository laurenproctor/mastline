import { IMPORT_FILE_STATUSES, type ImportFileStatus } from "@/lib/domain";
import type { QueueItemRecord, StagingState } from "./types";

/**
 * Turning a queue item into something a browser database will hold, and back.
 *
 * Kept apart from the store so it can be tested without a database at all, and
 * because reading is the dangerous direction: what comes back was written by a
 * previous version of this application, possibly months ago, possibly by a
 * build with a different idea of what a record contains. Startup reads it while
 * an operator is standing at a kerb waiting to see their queue.
 *
 * So `fromStored` validates and returns null rather than throwing. One
 * unreadable row loses one row; an exception during restore loses the queue.
 */

/** Bump when the shape changes in a way an older record cannot satisfy. */
export const RECORD_VERSION = 1;

export interface StoredQueueItem extends QueueItemRecord {
  readonly v: number;
}

export function toStored(record: QueueItemRecord): StoredQueueItem {
  return { v: RECORD_VERSION, ...record };
}

const STAGING_STATES: readonly StagingState[] = ["none", "staged", "missing"];

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function fromStored(value: unknown): QueueItemRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;

  // A record from a newer build may carry fields this one cannot honour. It is
  // left where it is rather than being read half-correctly and written back
  // truncated: the other tab or the later version still understands it.
  if (typeof row.v === "number" && row.v > RECORD_VERSION) return null;

  const clientFileId = text(row.clientFileId, 64);
  const organizationId = text(row.organizationId, 64);
  const shootId = text(row.shootId, 64);
  const batchId = text(row.batchId, 64);
  const batchIdempotencyKey = text(row.batchIdempotencyKey, 128);
  const originalFilename = text(row.originalFilename, 255);
  const mimeType = text(row.mimeType, 255);
  const storagePath = text(row.storagePath, 512);
  const byteSize = positive(row.byteSize);
  const createdAt = text(row.createdAt, 40);
  const updatedAt = text(row.updatedAt, 40);

  if (
    !clientFileId ||
    !organizationId ||
    !shootId ||
    !batchId ||
    !batchIdempotencyKey ||
    !originalFilename ||
    !mimeType ||
    !storagePath ||
    !byteSize ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  const status = IMPORT_FILE_STATUSES.includes(row.status as ImportFileStatus)
    ? (row.status as ImportFileStatus)
    : null;
  if (!status) return null;

  const stagingState = STAGING_STATES.includes(row.stagingState as StagingState)
    ? (row.stagingState as StagingState)
    : "none";

  return {
    clientFileId,
    organizationId,
    shootId,
    batchId,
    batchIdempotencyKey,
    importFileId: text(row.importFileId, 64),
    originalFilename,
    byteSize,
    mimeType,
    lastModifiedAt: text(row.lastModifiedAt, 40),
    sha256: text(row.sha256, 64),
    width: positive(row.width),
    height: positive(row.height),
    capturedAt: text(row.capturedAt, 40),
    status,
    resumeFrom: IMPORT_FILE_STATUSES.includes(row.resumeFrom as ImportFileStatus)
      ? (row.resumeFrom as ImportFileStatus)
      : undefined,
    stagingState,
    storageBucket: "originals",
    storagePath,
    attemptCount:
      typeof row.attemptCount === "number" && row.attemptCount >= 0
        ? Math.floor(row.attemptCount)
        : 0,
    errorCode: text(row.errorCode, 64),
    errorMessage: text(row.errorMessage, 500),
    nextAttemptAt: text(row.nextAttemptAt, 40),
    uploadUrl: text(row.uploadUrl, 2048),
    uploadUrlCreatedAt: text(row.uploadUrlCreatedAt, 40),
    uploadedBytes:
      typeof row.uploadedBytes === "number" && row.uploadedBytes >= 0
        ? Math.floor(row.uploadedBytes)
        : undefined,
    assetId: text(row.assetId, 64),
    createdAt,
    updatedAt,
  };
}
