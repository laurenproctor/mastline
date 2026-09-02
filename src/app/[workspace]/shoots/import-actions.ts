"use server";

import { revalidatePath } from "next/cache";
import {
  cancelImportFiles,
  confirmImportFile,
  createImportBatch,
  finalizeImportFile,
  getImportBatchState,
  markImportFileUploaded,
  outstandingImportBatches,
  noteImportRetry,
  recordImportFailure,
  registerImportFiles,
  verifyStagedUpload,
  type StagedObjectCheck,
} from "@/lib/data/import-queue";
import { getShoot } from "@/lib/data/shoots";
import type {
  FinalizeOutcome,
  ImportBatchState,
  ImportConfirmation,
  RegisteredFile,
  RegisterFileInput,
} from "@/lib/import-queue/types";
import { requireWorkspaceContext } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/server";
import { workspaceRoutes } from "@/lib/workspace-routes";

/**
 * The import queue's server surface.
 *
 * Separate from shoots/actions.ts because these are the actions of a queue
 * rather than of a screen: they are called by a service that retries, from a
 * tab that may have been reopened, possibly while the shoot page is not even
 * rendered. Keeping them apart makes it obvious that every one of them has to
 * be safe to call twice.
 *
 * Every action resolves the workspace from the slug in the URL and checks
 * asset.write against that workspace's role, exactly as the existing import
 * path does. Importing is an asset write; nothing here invents a new
 * permission, and nothing here uses the service role.
 */

/** Open, or reopen, a batch. Returns the batch this idempotency key owns. */
export async function openImportBatchAction(
  workspaceSlug: string,
  input: { shootId: string; batchId: string; idempotencyKey: string },
): Promise<{ batchId: string; organizationId: string; shootId: string }> {
  const { organizationId, actorId } = await requireWorkspaceContext(workspaceSlug, "asset.write");

  const shoot = await getShoot(organizationId, input.shootId);
  if (!shoot) throw new Error("That shoot no longer exists.");

  const batch = await createImportBatch({
    supabase: await createClient(),
    organizationId,
    actorId,
    shootId: input.shootId,
    batchId: input.batchId,
    idempotencyKey: input.idempotencyKey,
  });

  return { batchId: batch.batchId, organizationId, shootId: batch.shootId };
}

export async function registerImportFilesAction(
  workspaceSlug: string,
  input: { batchId: string; files: readonly RegisterFileInput[] },
): Promise<readonly RegisteredFile[]> {
  const { organizationId } = await requireWorkspaceContext(workspaceSlug, "asset.write");
  return registerImportFiles({
    supabase: await createClient(),
    organizationId,
    batchId: input.batchId,
    files: input.files,
  });
}

export async function markImportUploadedAction(
  workspaceSlug: string,
  input: { importFileId: string; sha256: string; attemptCount?: number },
): Promise<{ status: string }> {
  const { organizationId } = await requireWorkspaceContext(workspaceSlug, "asset.write");
  return markImportFileUploaded({
    supabase: await createClient(),
    organizationId,
    importFileId: input.importFileId,
    sha256: input.sha256,
    attemptCount: input.attemptCount,
  });
}

/**
 * Finalize one uploaded file into an asset.
 *
 * The defaults are the same ones the dropzone has always inherited -- one fact
 * entered once -- so a file that arrives through the queue is indistinguishable
 * from one that arrived through the old path. Repeating this call returns the
 * asset it already made.
 */
export async function finalizeImportAction(
  workspaceSlug: string,
  input: {
    importFileId: string;
    sha256: string;
    width?: number;
    height?: number;
    capturedAt?: string;
  },
): Promise<FinalizeOutcome> {
  const { organizationId, actorId, session, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "asset.write",
  );

  const supabase = await createClient();

  const state = await supabase
    .from("import_files")
    .select("import_batch_id")
    .eq("organization_id", organizationId)
    .eq("id", input.importFileId)
    .maybeSingle();

  let shootId: string | undefined;
  let locationName: string | undefined;
  if (state.data) {
    const { data: batch } = await supabase
      .from("import_batches")
      .select("shoot_id")
      .eq("organization_id", organizationId)
      .eq("id", state.data.import_batch_id as string)
      .maybeSingle();
    shootId = (batch?.shoot_id as string | undefined) ?? undefined;
    if (shootId) locationName = (await getShoot(organizationId, shootId))?.locationName;
  }

  const outcome = await finalizeImportFile({
    supabase,
    organizationId,
    actorId,
    importFileId: input.importFileId,
    sha256: input.sha256,
    width: input.width,
    height: input.height,
    capturedAt: input.capturedAt,
    defaults: {
      creatorName: session.displayName,
      creditLine: `${session.displayName} / ${session.activeWorkspace.name}`,
      copyrightNotice: `© ${new Date().getFullYear()} ${session.displayName}`,
      locationName,
    },
  });

  if (outcome.ok && shootId) {
    revalidatePath(workspaceRoutes(canonicalSlug).shoot(shootId));
  }

  return outcome;
}

/**
 * Did the bytes land?
 *
 * Called between the transport reporting success and finalization, so an asset
 * is never created for an object that is not there -- and so a 409 from a
 * resumable upload can be reconciled against what storage actually holds
 * instead of being reported as a failed file.
 */
export async function verifyImportUploadAction(
  workspaceSlug: string,
  input: { importFileId: string },
): Promise<StagedObjectCheck> {
  const { organizationId } = await requireWorkspaceContext(workspaceSlug, "asset.write");
  return verifyStagedUpload({
    supabase: await createClient(),
    organizationId,
    importFileId: input.importFileId,
  });
}

/** The three facts the client needs before deleting its local copy. */
export async function confirmImportAction(
  workspaceSlug: string,
  input: { importFileId: string },
): Promise<ImportConfirmation> {
  const { organizationId } = await requireWorkspaceContext(workspaceSlug, "asset.write");
  return confirmImportFile({
    supabase: await createClient(),
    organizationId,
    importFileId: input.importFileId,
  });
}

export async function cancelImportsAction(
  workspaceSlug: string,
  input: { importFileIds: readonly string[] },
): Promise<{ canceled: number }> {
  const { organizationId } = await requireWorkspaceContext(workspaceSlug, "asset.write");
  return cancelImportFiles({
    supabase: await createClient(),
    organizationId,
    importFileIds: input.importFileIds,
  });
}

export async function importBatchStateAction(
  workspaceSlug: string,
  input: { batchId: string },
): Promise<ImportBatchState | null> {
  const { organizationId } = await requireWorkspaceContext(workspaceSlug, "asset.read");
  return getImportBatchState({
    supabase: await createClient(),
    organizationId,
    batchId: input.batchId,
  });
}

export async function outstandingImportsAction(
  workspaceSlug: string,
  input: { shootId?: string } = {},
): Promise<readonly ImportBatchState[]> {
  const { organizationId } = await requireWorkspaceContext(workspaceSlug, "asset.read");
  return outstandingImportBatches({
    supabase: await createClient(),
    organizationId,
    shootId: input.shootId,
  });
}

export async function noteImportRetryAction(
  workspaceSlug: string,
  input: {
    importFileId: string;
    attemptCount: number;
    errorCode: string;
    errorMessage: string;
  },
): Promise<void> {
  const { organizationId } = await requireWorkspaceContext(workspaceSlug, "asset.write");
  await noteImportRetry({ supabase: await createClient(), organizationId, ...input });
}

export async function reportImportFailureAction(
  workspaceSlug: string,
  input: {
    importFileId: string;
    errorCode: string;
    errorMessage: string;
    attemptCount?: number;
  },
): Promise<void> {
  const { organizationId } = await requireWorkspaceContext(workspaceSlug, "asset.write");
  await recordImportFailure({
    supabase: await createClient(),
    organizationId,
    importFileId: input.importFileId,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    attemptCount: input.attemptCount,
  });
}
