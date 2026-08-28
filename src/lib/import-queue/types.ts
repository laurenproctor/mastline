import type { Id, ImportFileStatus } from "@/lib/domain";
import type { UploadFailure } from "./failure";

/**
 * The shapes the queue is built out of, and the four boundaries it talks
 * through.
 *
 * Nothing here imports React, Next, or Supabase. The queue is a service that
 * happens to run in a browser tab; it is not a component, and a card dump that
 * survives a reload cannot be owned by something that unmounts. Every capability
 * it needs -- durable metadata, durable bytes, a storage quota, a server --
 * arrives as an interface, which is also what lets the tests run without a
 * browser filesystem.
 */

/** Whether this machine still holds the bytes for an item. */
export type StagingState =
  /** Never staged: OPFS was unavailable, or staging failed. */
  | "none"
  /** Copied into the origin private file system and found there since. */
  | "staged"
  /** Staged once, and the copy is gone. The operator must select it again. */
  | "missing";

/**
 * One file in the queue, as persisted.
 *
 * Plain JSON: no File, no Blob, no handle. Metadata goes to IndexedDB and bytes
 * go to the origin private file system, and the two are kept apart deliberately
 * -- a structured-clone of a 60 MB File into a metadata store is a copy nobody
 * asked for and cannot be read back incrementally.
 */
export interface QueueItemRecord {
  /** The client's id for this file. Primary key here, and in the storage path. */
  readonly clientFileId: string;
  readonly organizationId: Id;
  readonly shootId: Id;
  readonly batchId: Id;
  /** The batch's idempotency key, kept so a batch can be re-registered after a reload. */
  readonly batchIdempotencyKey: string;
  /** The server's row id, once registration has happened. */
  readonly importFileId?: Id;

  /** Exactly as the camera wrote it. Never used to build a path. */
  readonly originalFilename: string;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly lastModifiedAt?: string;

  /** Facts read from the bytes on this machine, carried to finalization. */
  readonly sha256?: string;
  readonly width?: number;
  readonly height?: number;
  readonly capturedAt?: string;

  readonly status: ImportFileStatus;
  /**
   * The status this item was in when it was paused.
   *
   * Pausing throws away where the run had got to unless somewhere remembers,
   * and "resume" has to mean resume rather than start again: a file whose bytes
   * are already in the bucket must go on to finalization, not upload itself a
   * second time.
   */
  readonly resumeFrom?: ImportFileStatus;
  readonly stagingState: StagingState;
  readonly storageBucket: "originals";
  readonly storagePath: string;

  readonly attemptCount: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  /**
   * When the runner may try this item again.
   *
   * Persisted rather than held in a timer, so a reload does not reset a backoff
   * that was deliberately long -- and so a tab that opens during an outage does
   * not immediately hammer a server the last tab had already backed off from.
   */
  readonly nextAttemptAt?: string;

  /**
   * The resumable upload session for this file.
   *
   * Kept here rather than only in the TUS client's own storage because this is
   * the record that survives: the queue can resume a file whose fingerprint
   * entry a browser cleared, and reconciliation can see that a session exists
   * without starting one.
   */
  readonly uploadUrl?: string;
  /** When that session was created. Supabase expires them after ~24 hours. */
  readonly uploadUrlCreatedAt?: string;
  /**
   * How far the server had got, last time this file was uploading.
   *
   * Written at chunk boundaries rather than per byte: it exists so a reloaded
   * page can show a bar in roughly the right place, not so anything can be
   * decided from it. The offset that is actually resumed from is the one the
   * server states when the upload is picked up again.
   */
  readonly uploadedBytes?: number;

  /** Set once the server has finalized this file into an asset. */
  readonly assetId?: Id;

  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * What the interface shows for one item.
 *
 * `recoverable` is the claim this whole feature is judged on, so it is computed
 * from evidence rather than assumed: either this machine holds the bytes, or
 * the server does. An item that is neither is shown as needing the file again,
 * and is never described as safe.
 */
export interface QueueItemView extends QueueItemRecord {
  readonly recoverable: boolean;
  readonly needsFile: boolean;
}

/** Durable metadata. Implemented over IndexedDB, and over a Map in tests. */
export interface QueueStore {
  put(record: QueueItemRecord): Promise<void>;
  get(clientFileId: string): Promise<QueueItemRecord | null>;
  all(): Promise<readonly QueueItemRecord[]>;
  byBatch(batchId: Id): Promise<readonly QueueItemRecord[]>;
  delete(clientFileId: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Durable bytes.
 *
 * `available` is a property rather than a thrown error because an unavailable
 * staging area is a normal condition -- a private window, an older browser, a
 * quota refusal -- and the queue has to keep working through it, honestly, by
 * telling the operator which files it cannot promise to recover.
 */
export interface StagingArea {
  readonly available: boolean;
  stage(path: StagedPath, blob: Blob): Promise<void>;
  read(path: StagedPath): Promise<Blob | null>;
  exists(path: StagedPath): Promise<boolean>;
  remove(path: StagedPath): Promise<void>;
  /** Everything staged for one batch, for cancellation and abandonment. */
  removeBatch(organizationId: Id, batchId: Id): Promise<void>;
}

/**
 * The thing that moves the bytes.
 *
 * Deliberately the smallest interface in this module: one method, one blob, one
 * classified outcome. Everything about how an upload is chunked, resumed, or
 * authorized is the transport's business, and everything about what an upload
 * means is the queue's. That line is what lets the queue be tested without a
 * network and the transport without a queue.
 */
export interface UploadTransport {
  upload(request: UploadRequest): Promise<UploadResult>;
  /**
   * Abandon a half-finished session, so a cancelled file does not leave a
   * partial object sitting in the bucket until the service expires it.
   */
  discard?(input: { uploadUrl: string }): Promise<void>;
}

export interface UploadRequest {
  readonly item: QueueItemRecord;
  readonly blob: Blob;
  /** An existing session to resume. The transport verifies it before using it. */
  readonly resumeUrl?: string;
  /** Live progress, for the screen only. Never persisted per call. */
  readonly onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  /** A chunk landed. This is the granularity progress is persisted at. */
  readonly onChunk?: (uploadedBytes: number) => void;
  /** A session was created. Persisted immediately so a crash can resume it. */
  readonly onUploadUrl?: (uploadUrl: string) => void;
  readonly signal?: AbortSignal;
}

export type UploadResult =
  | { readonly ok: true; readonly uploadUrl?: string; readonly bytesUploaded: number }
  | {
      readonly ok: false;
      readonly failure: UploadFailure;
      readonly uploadUrl?: string;
      readonly bytesUploaded: number;
    };

/**
 * Keeping two tabs from uploading the same file at once.
 *
 * Two tabs is not an edge case -- it is what happens when somebody opens a
 * shoot in a second tab to look at something while a card is uploading. Without
 * a lock both would upload the same bytes to the same session, and Supabase
 * answers the second with 409, so one of them would report a conflict for a
 * file that was uploading perfectly well.
 */
export interface QueueCoordinator {
  /** This tab's identity. Stable for the life of the page. */
  readonly ownerId: string;
  /** How the lock is held, for the interface to be honest about guarantees. */
  readonly kind: "web-locks" | "lease" | "none";
  /** Null when another tab holds this item. Never blocks waiting for it. */
  acquire(key: string): Promise<QueueLock | null>;
  publish(message: QueueBroadcast): void;
  subscribe(listener: (message: QueueBroadcast) => void): () => void;
  close(): void;
}

export interface QueueLock {
  readonly key: string;
  /** Extends a lease. Returns false if it was lost, which means: stop. */
  renew(): Promise<boolean>;
  release(): Promise<void>;
}

export interface QueueBroadcast {
  readonly kind: "changed" | "claimed" | "released";
  readonly ownerId: string;
  readonly clientFileId?: string;
  readonly batchId?: Id;
}

export interface StagedPath {
  readonly directories: readonly string[];
  readonly filename: string;
}

/** The parts of navigator.storage the queue uses, injectable for tests. */
export interface StorageCapacity {
  estimate(): Promise<{ quota?: number; usage?: number }>;
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

/**
 * The server, as the queue sees it.
 *
 * This is the adapter boundary the resumable transport will be added behind.
 * Every method is idempotent by contract: the queue calls them again after a
 * reload, after a network failure, and from a second tab, and none of those may
 * produce a second batch, a second import row, or a second asset.
 */
export interface ImportServerAdapter {
  registerBatch(input: {
    shootId: Id;
    idempotencyKey: string;
  }): Promise<{ batchId: Id; organizationId: Id }>;

  registerFiles(input: {
    batchId: Id;
    files: readonly RegisterFileInput[];
  }): Promise<readonly RegisteredFile[]>;

  markUploaded(input: { importFileId: Id; sha256: string }): Promise<{ status: ImportFileStatus }>;

  finalize(input: {
    importFileId: Id;
    sha256: string;
    width?: number;
    height?: number;
    capturedAt?: string;
  }): Promise<FinalizeOutcome>;

  /**
   * Whether the uploaded object is in the bucket, at the registered size.
   *
   * Asked before finalization, and again to reconcile a conflict.
   */
  verifyUpload(input: { importFileId: Id }): Promise<StagedUpload>;

  /** The three facts cleanup requires before deleting a local copy. */
  confirm(input: { importFileId: Id }): Promise<ImportConfirmation>;

  cancel(input: { importFileIds: readonly Id[] }): Promise<void>;

  /** Everything the server knows about a batch. The input to reconciliation. */
  batchState(input: { batchId: Id }): Promise<ImportBatchState | null>;

  /** Records a lifecycle failure. Never per-byte progress. */
  reportFailure(input: {
    importFileId: Id;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
}

export interface RegisterFileInput {
  readonly clientFileId: string;
  readonly originalFilename: string;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly lastModifiedAt?: string;
  readonly sha256?: string;
}

export interface RegisteredFile {
  readonly clientFileId: string;
  readonly importFileId: Id;
  readonly storageBucket: "originals";
  readonly storagePath: string;
  readonly status: ImportFileStatus;
  readonly assetId?: Id;
}

export interface FinalizeOutcome {
  readonly ok: boolean;
  readonly assetId?: Id;
  /** True when this call found the work already done rather than doing it. */
  readonly alreadyComplete?: boolean;
  /** True when another tab or request holds the finalization right now. */
  readonly inProgress?: boolean;
  readonly errorCode?: string;
  readonly error?: string;
}

export interface StagedUpload {
  readonly exists: boolean;
  readonly byteSize?: number;
  readonly expectedBytes: number;
  readonly matches: boolean;
  readonly alreadyFinalized: boolean;
  readonly assetId?: Id;
}

export interface ImportConfirmation {
  readonly complete: boolean;
  readonly assetExists: boolean;
  readonly objectExists: boolean;
  readonly assetId?: Id;
}

export interface ImportBatchState {
  readonly batchId: Id;
  readonly organizationId: Id;
  readonly shootId: Id;
  readonly status: string;
  readonly totalFiles: number;
  readonly completedFiles: number;
  readonly failedFiles: number;
  readonly files: readonly ImportFileState[];
}

export interface ImportFileState {
  readonly importFileId: Id;
  readonly clientFileId: string;
  readonly status: ImportFileStatus;
  readonly storagePath: string;
  readonly assetId?: Id;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}
