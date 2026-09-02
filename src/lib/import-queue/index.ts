/**
 * The durable import queue.
 *
 * Composition happens in create.ts, the state machine in state.ts, and the
 * boundaries in types.ts. Nothing in here depends on React, and nothing outside
 * reaches past this barrel for the browser storage classes.
 */
export { assessCapacity, BrowserStorageCapacity, marginFor } from "./capacity";
export type { CapacityAssessment } from "./capacity";
export { backoffDelay, DEFAULT_BACKOFF, isDue, nextAttemptAt } from "./backoff";
export type { BackoffOptions } from "./backoff";
export { BrowserQueueCoordinator, LEASE_RENEW_MS, LEASE_TTL_MS } from "./coordination";
export { IMPORT_ERROR_CODES, isImportErrorCode, sanitizeErrorMessage } from "./errors";
export type { ImportErrorCode } from "./errors";
export { IndexedDbQueueStore } from "./indexeddb-store";
export { MemoryQueueStore } from "./memory-store";
export { OpfsStagingArea } from "./opfs";
export {
  importStoragePath,
  isClientFileId,
  newClientFileId,
  opfsPathFor,
  opfsPathString,
  OPFS_ROOT,
} from "./paths";
export { classifyUploadFailure, isRetryable, messageFor, UPLOAD_FAILURE_CODES } from "./failure";
export type { UploadFailure, UploadFailureCode } from "./failure";
export { ImportQueue, UPLOAD_SESSION_LIFETIME_MS } from "./queue";
export {
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_ATTEMPTS,
  ImportQueueRunner,
  needsPerson,
} from "./runner";
export type { ItemProgress, QueueRunnerOptions, QueueSnapshot } from "./runner";
export { endImportSessions, importSession } from "./session";
export type { ImportSession } from "./session";
export {
  loadTusFactory,
  SUPABASE_TUS_CHUNK_SIZE,
  terminateTusUpload,
  TusUploadTransport,
} from "./tus-transport";
export type { TusTransportOptions, TusUploadFactory } from "./tus-transport";
export type { CleanupReport, EnqueueResult, ImportQueueOptions, RestoreReport } from "./queue";
export { fromStored, RECORD_VERSION, toStored } from "./serialization";
export { ServerActionImportTransport } from "./server-transport";
export {
  canTransition,
  InvalidTransitionError,
  isOutstanding,
  isServerHeld,
  OUTSTANDING_STATUSES,
  resumeActionFor,
  TERMINAL_STATUSES,
  transition,
} from "./state";
export type { ResumeAction } from "./state";
export type {
  FinalizeOutcome,
  QueueBroadcast,
  QueueCoordinator,
  QueueLock,
  StagedUpload,
  UploadRequest,
  UploadResult,
  UploadTransport,
  ImportBatchState,
  ImportConfirmation,
  ImportFileState,
  ImportServerAdapter,
  QueueItemRecord,
  QueueItemView,
  QueueStore,
  RegisteredFile,
  RegisterFileInput,
  StagedPath,
  StagingArea,
  StagingState,
  StorageCapacity,
} from "./types";
