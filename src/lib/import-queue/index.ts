/**
 * The durable import queue.
 *
 * Composition happens in create.ts, the state machine in state.ts, and the
 * boundaries in types.ts. Nothing in here depends on React, and nothing outside
 * reaches past this barrel for the browser storage classes.
 */
export { assessCapacity, BrowserStorageCapacity, marginFor } from "./capacity";
export type { CapacityAssessment } from "./capacity";
export { createImportQueue } from "./create";
export type { CreatedImportQueue } from "./create";
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
export { ImportQueue } from "./queue";
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
