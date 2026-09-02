"use client";

import {
  cancelImportsAction,
  confirmImportAction,
  finalizeImportAction,
  importBatchStateAction,
  markImportUploadedAction,
  noteImportRetryAction,
  openImportBatchAction,
  registerImportFilesAction,
  reportImportFailureAction,
  verifyImportUploadAction,
} from "@/app/[workspace]/shoots/import-actions";
import type { Id, ImportFileStatus } from "@/lib/domain";
import type {
  FinalizeOutcome,
  ImportBatchState,
  ImportConfirmation,
  ImportServerAdapter,
  RegisteredFile,
  RegisterFileInput,
  StagedUpload,
} from "./types";

/**
 * The queue's server, over Server Actions.
 *
 * This is the whole of the adapter boundary on the client side: everything the
 * queue knows about the network is this class, and everything this class does
 * is forward calls to actions that were written to be safe to repeat. Swapping
 * the byte transport for a resumable one changes nothing here, because the
 * bytes do not travel through it.
 *
 * The workspace slug is bound once. It comes from the URL, which is the only
 * thing entitled to say which workspace a request is about -- a queue that read
 * a cookie instead would send a second tab's card dump to the wrong studio.
 *
 * The batch id doubles as the idempotency key. They are the same uuid because
 * the storage path is derived from the batch id and the queue must be able to
 * stage files before it has spoken to the server at all; a separately generated
 * key would mean a batch registered under one id and staged under another.
 */
export class ServerActionImportTransport implements ImportServerAdapter {
  constructor(private readonly workspaceSlug: string) {}

  async registerBatch(input: { shootId: Id; idempotencyKey: string }): Promise<{
    batchId: Id;
    organizationId: Id;
  }> {
    const result = await openImportBatchAction(this.workspaceSlug, {
      shootId: input.shootId,
      batchId: input.idempotencyKey,
      idempotencyKey: input.idempotencyKey,
    });
    return { batchId: result.batchId, organizationId: result.organizationId };
  }

  async registerFiles(input: {
    batchId: Id;
    files: readonly RegisterFileInput[];
  }): Promise<readonly RegisteredFile[]> {
    return registerImportFilesAction(this.workspaceSlug, input);
  }

  async markUploaded(input: {
    importFileId: Id;
    sha256: string;
    attemptCount?: number;
  }): Promise<{ status: ImportFileStatus }> {
    const result = await markImportUploadedAction(this.workspaceSlug, input);
    return { status: result.status as ImportFileStatus };
  }

  async finalize(input: {
    importFileId: Id;
    sha256: string;
    width?: number;
    height?: number;
    capturedAt?: string;
  }): Promise<FinalizeOutcome> {
    return finalizeImportAction(this.workspaceSlug, input);
  }

  async verifyUpload(input: { importFileId: Id }): Promise<StagedUpload> {
    return verifyImportUploadAction(this.workspaceSlug, input);
  }

  async confirm(input: { importFileId: Id }): Promise<ImportConfirmation> {
    return confirmImportAction(this.workspaceSlug, input);
  }

  async cancel(input: { importFileIds: readonly Id[] }): Promise<void> {
    await cancelImportsAction(this.workspaceSlug, input);
  }

  async batchState(input: { batchId: Id }): Promise<ImportBatchState | null> {
    return importBatchStateAction(this.workspaceSlug, input);
  }

  async noteRetry(input: {
    importFileId: Id;
    attemptCount: number;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    await noteImportRetryAction(this.workspaceSlug, input);
  }

  async reportFailure(input: {
    importFileId: Id;
    errorCode: string;
    errorMessage: string;
    attemptCount?: number;
  }): Promise<void> {
    await reportImportFailureAction(this.workspaceSlug, input);
  }
}
