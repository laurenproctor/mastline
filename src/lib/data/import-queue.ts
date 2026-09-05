import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id, ImportFileStatus } from "../domain";
import { sanitizeErrorMessage } from "../import-queue/errors";
import { importStoragePath, isClientFileId } from "../import-queue/paths";
import type {
  FinalizeOutcome,
  ImportBatchState,
  ImportConfirmation,
  RegisteredFile,
  RegisterFileInput,
} from "../import-queue/types";
import { isSha256 } from "../validation";
import { registerImport } from "./imports";

/**
 * The server's record of what is being imported.
 *
 * The browser queue in src/lib/import-queue is the thing that survives a
 * reload; this is the thing that survives the browser. Between them they answer
 * a question the product could not answer before: forty files were selected --
 * where are they now?
 *
 * Everything here is idempotent, and idempotent by constraint rather than by
 * checking first. The callers are a queue that retries, a tab that was reopened,
 * and possibly two of each at once, so a read followed by a write would lose
 * the race it exists to win. What makes each one safe:
 *
 *   * a batch is unique on (organization_id, idempotency_key)
 *   * a file is unique on (import_batch_id, client_file_id)
 *   * a finalization claims its row with a conditional update before it creates
 *     anything, and an import file may hold at most one asset, ever
 *
 * Every function takes the caller's Supabase client, so row level security
 * applies to each step. Nothing here uses the service role.
 */

/** How long a finalization may hold its claim before another attempt may take it. */
const FINALIZATION_CLAIM_MINUTES = 10;

export interface ImportBatchRef {
  readonly batchId: Id;
  readonly shootId: Id;
  /** False when the batch already existed, which is the common case on a retry. */
  readonly created: boolean;
}

/**
 * Create the batch, or return the one this key already made.
 *
 * The client supplies both the id and the idempotency key -- the same uuid, in
 * practice -- because the storage path is derived from the batch id and the
 * queue has to be able to stage files with no connection at all. Handing the
 * key to the client is what lets a card dump start in a car park and be
 * registered twenty minutes later without addressing itself to a different
 * batch than the one on disk.
 *
 * A client-chosen primary key is safe here because it is a v4 uuid checked
 * against this workspace: the insert is scoped by RLS, and a collision with
 * another workspace's batch is refused rather than joined.
 */
export async function createImportBatch(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  shootId: Id;
  batchId: Id;
  idempotencyKey: string;
}): Promise<ImportBatchRef> {
  const { supabase, organizationId, actorId, shootId, batchId, idempotencyKey } = input;

  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new Error("An import batch needs a stable idempotency key.");
  }

  const existing = await findBatch(supabase, organizationId, idempotencyKey);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("import_batches")
    .insert({
      id: batchId,
      organization_id: organizationId,
      shoot_id: shootId,
      created_by: actorId,
      idempotency_key: idempotencyKey,
    })
    .select("id, shoot_id")
    .single();

  if (error) {
    // Somebody else won the race between the read above and this insert. That
    // is the case this function exists to handle, so it is not an error.
    const settled = await findBatch(supabase, organizationId, idempotencyKey);
    if (settled) return settled;
    throw new Error(`Could not open the import: ${error.message}`);
  }

  return { batchId: data.id as string, shootId: data.shoot_id as string, created: true };
}

async function findBatch(
  supabase: SupabaseClient,
  organizationId: Id,
  idempotencyKey: string,
): Promise<ImportBatchRef | null> {
  const { data } = await supabase
    .from("import_batches")
    .select("id, shoot_id")
    .eq("organization_id", organizationId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  return data
    ? { batchId: data.id as string, shootId: data.shoot_id as string, created: false }
    : null;
}

/**
 * Register the files in a batch.
 *
 * Repeatable: a file already registered is left exactly as it is, including its
 * status. Updating on conflict would be worse than useless -- a retry of the
 * registration call would knock a file that is midway through uploading back to
 * `pending`, and the storage path is immutable in the database anyway.
 */
export async function registerImportFiles(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  batchId: Id;
  files: readonly RegisterFileInput[];
}): Promise<readonly RegisteredFile[]> {
  const { supabase, organizationId, batchId, files } = input;
  if (files.length === 0) return [];

  const rows = files.map((file) => {
    if (!isClientFileId(file.clientFileId)) {
      throw new Error(`${file.originalFilename} has an unusable client file id.`);
    }
    if (!Number.isFinite(file.byteSize) || file.byteSize <= 0) {
      throw new Error(`${file.originalFilename} arrived without a size.`);
    }
    if (file.sha256 && !isSha256(file.sha256)) {
      throw new Error(`${file.originalFilename} has an unreadable digest.`);
    }

    return {
      import_batch_id: batchId,
      organization_id: organizationId,
      client_file_id: file.clientFileId,
      // The name the camera gave it, kept whole and kept away from the path.
      original_filename: file.originalFilename.slice(0, 255),
      byte_size: file.byteSize,
      mime_type: file.mimeType || "application/octet-stream",
      last_modified_at: file.lastModifiedAt ?? null,
      sha256: file.sha256 ?? null,
      storage_bucket: "originals",
      storage_path: importStoragePath(organizationId, batchId, file.clientFileId),
      status: "pending" as ImportFileStatus,
    };
  });

  const { error } = await supabase
    .from("import_files")
    .upsert(rows, { onConflict: "import_batch_id,client_file_id", ignoreDuplicates: true });

  if (error) throw new Error(`Could not record the files to import: ${error.message}`);

  const { data, error: readError } = await supabase
    .from("import_files")
    .select("id, client_file_id, storage_bucket, storage_path, status, asset_id")
    .eq("organization_id", organizationId)
    .eq("import_batch_id", batchId)
    .in(
      "client_file_id",
      files.map((file) => file.clientFileId),
    );

  if (readError) throw new Error(`Could not read the files to import: ${readError.message}`);

  return (data ?? []).map((row) => ({
    clientFileId: row.client_file_id as string,
    importFileId: row.id as string,
    storageBucket: "originals" as const,
    storagePath: row.storage_path as string,
    status: row.status as ImportFileStatus,
    assetId: (row.asset_id as string | null) ?? undefined,
  }));
}

/** The bytes are in the bucket. A lifecycle transition, not a progress report. */
export async function markImportFileUploaded(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  importFileId: Id;
  sha256: string;
  /** The client's attempt count, recorded at a transition rather than per try. */
  attemptCount?: number;
}): Promise<{ status: ImportFileStatus }> {
  const { supabase, organizationId, importFileId, sha256 } = input;
  if (!isSha256(sha256)) throw new Error("An uploaded file needs a valid SHA-256 digest.");

  const { data, error } = await supabase
    .from("import_files")
    .update({ status: "uploaded", sha256, ...attempts(input.attemptCount) })
    .eq("organization_id", organizationId)
    .eq("id", importFileId)
    // A completed import is never reopened, and the trigger would refuse it
    // anyway; excluding it here keeps the refusal from looking like a failure.
    .in("status", ["pending", "staged", "uploading", "retrying", "failed", "paused"])
    .select("status")
    .maybeSingle();

  if (error) throw new Error(`Could not record the upload: ${error.message}`);
  if (data) return { status: data.status as ImportFileStatus };

  const { data: current } = await supabase
    .from("import_files")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("id", importFileId)
    .maybeSingle();

  if (!current) throw new Error("That import file is not in this workspace.");
  return { status: current.status as ImportFileStatus };
}

interface ImportFileRow {
  id: string;
  import_batch_id: string;
  client_file_id: string;
  original_filename: string;
  byte_size: number;
  mime_type: string;
  last_modified_at: string | null;
  storage_bucket: string;
  storage_path: string;
  status: ImportFileStatus;
  sha256: string | null;
  asset_id: string | null;
}

const FILE_COLUMNS =
  "id, import_batch_id, client_file_id, original_filename, byte_size, mime_type, last_modified_at, storage_bucket, storage_path, status, sha256, asset_id";

/**
 * Turn one uploaded file into an asset, exactly once.
 *
 * The shape is claim, then act, then record:
 *
 *   1. A conditional update moves the row to `finalizing`. Only one caller can
 *      win that update, so only one caller reaches step 2. This is the whole
 *      of the concurrency control, and it is one statement.
 *   2. registerImport() does what it has always done -- asset, immutable
 *      original, promotion of the bytes to their canonical key -- so this path
 *      and the existing dropzone produce identical records.
 *   3. The asset id is written back to the import row, which may hold one
 *      forever and no more.
 *
 * A caller that arrives after the work is finished is answered from step 0 with
 * the asset that exists. A caller that arrives while it is in progress is told
 * so and asked to come back, rather than being allowed to create a second one.
 */
export async function finalizeImportFile(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  importFileId: Id;
  sha256: string;
  width?: number;
  height?: number;
  capturedAt?: string;
  defaults: {
    creatorName?: string;
    creditLine?: string;
    copyrightNotice?: string;
    locationName?: string;
    usageRestrictions?: string;
  };
  now?: Date;
}): Promise<FinalizeOutcome> {
  const { supabase, organizationId, actorId, importFileId, sha256 } = input;

  if (!isSha256(sha256)) {
    return { ok: false, errorCode: "bad_digest", error: "That is not a SHA-256 digest." };
  }

  const { data: existing } = await supabase
    .from("import_files")
    .select(FILE_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", importFileId)
    .maybeSingle<ImportFileRow>();

  if (!existing) {
    return { ok: false, errorCode: "not_found", error: "That import is not in this workspace." };
  }

  // Answered before anything is claimed: a repeat of a finalization that
  // already succeeded returns what it made.
  if (existing.asset_id) {
    return { ok: true, assetId: existing.asset_id, alreadyComplete: true };
  }

  const claimed = await claimForFinalization(supabase, organizationId, importFileId, input.now);
  if (!claimed.ok) return claimed.outcome;

  const { data: batch } = await supabase
    .from("import_batches")
    .select("shoot_id")
    .eq("organization_id", organizationId)
    .eq("id", existing.import_batch_id)
    .maybeSingle();

  if (!batch) {
    return await recordFailure(supabase, organizationId, importFileId, {
      code: "batch_missing",
      message: "The shoot this import belongs to no longer exists.",
    });
  }

  try {
    const imported = await registerImport({
      supabase,
      organizationId,
      actorId,
      shootId: batch.shoot_id as string,
      facts: {
        filename: existing.original_filename,
        sha256,
        bytes: Number(existing.byte_size),
        mimeType: existing.mime_type,
        // The filesystem's timestamp is the fallback, and is offered as a
        // starting point the operator can correct -- never as EXIF truth.
        capturedAt: input.capturedAt ?? existing.last_modified_at ?? undefined,
        width: input.width,
        height: input.height,
        stagingKey: existing.storage_path,
      },
      defaults: input.defaults,
    });

    const { error } = await supabase
      .from("import_files")
      .update({ status: "complete", asset_id: imported.assetId, sha256 })
      .eq("organization_id", organizationId)
      .eq("id", importFileId);

    if (error) {
      // The asset exists and the bytes are promoted; only the pointer failed.
      // Reported rather than retried, because retrying would import it twice.
      return {
        ok: false,
        assetId: imported.assetId,
        errorCode: "link_failed",
        error: `The file was imported as asset ${imported.assetId} but the import record could not be updated: ${error.message}`,
      };
    }

    return { ok: true, assetId: imported.assetId };
  } catch (error) {
    return await recordFailure(supabase, organizationId, importFileId, {
      code: "finalization_failed",
      message: sanitizeErrorMessage(error),
    });
  }
}

/**
 * Take the right to finalize one file, or explain why not.
 *
 * Two conditional updates rather than one. The first is the ordinary case. The
 * second exists because a browser that closes mid-finalization leaves a row
 * claimed forever, and an import queue with an unreachable file in it is the
 * failure this feature is supposed to remove -- so a claim older than ten
 * minutes may be taken over. Taking it over is safe: registerImport is what
 * creates the asset, and the unique index on asset_id means the loser of that
 * race records nothing.
 */
async function claimForFinalization(
  supabase: SupabaseClient,
  organizationId: Id,
  importFileId: Id,
  now?: Date,
): Promise<{ ok: true } | { ok: false; outcome: FinalizeOutcome }> {
  // The ordinary claim: a file that is waiting to be finalized.
  const { data: ready } = await supabase
    .from("import_files")
    .update({ status: "finalizing" })
    .eq("organization_id", organizationId)
    .eq("id", importFileId)
    .in("status", ["uploaded", "retrying", "uploading", "failed", "paused"])
    .select("id")
    .maybeSingle();

  if (ready) return { ok: true };

  // A claim nobody came back for. Ten minutes is far longer than a finalization
  // takes and far shorter than a photographer will wait before deciding the
  // product has eaten a frame.
  const cutoff = new Date((now ?? new Date()).getTime() - FINALIZATION_CLAIM_MINUTES * 60_000);
  const { data: stale } = await supabase
    .from("import_files")
    .update({ status: "finalizing" })
    .eq("organization_id", organizationId)
    .eq("id", importFileId)
    .eq("status", "finalizing")
    .lt("updated_at", cutoff.toISOString())
    .select("id")
    .maybeSingle();

  if (stale) return { ok: true };

  const { data: current } = await supabase
    .from("import_files")
    .select("status, asset_id")
    .eq("organization_id", organizationId)
    .eq("id", importFileId)
    .maybeSingle();

  if (current?.asset_id) {
    return {
      ok: false,
      outcome: { ok: true, assetId: current.asset_id as string, alreadyComplete: true },
    };
  }
  if (current?.status === "finalizing") {
    return { ok: false, outcome: { ok: false, inProgress: true } };
  }
  return {
    ok: false,
    outcome: {
      ok: false,
      errorCode: "not_ready",
      error: `That file is ${current?.status ?? "unknown"} and cannot be finalized yet.`,
    },
  };
}

/**
 * How many times the client has tried, when it has told us.
 *
 * Written at lifecycle transitions rather than on every attempt: the row exists
 * so somebody looking at a stuck batch can see that a file has been tried nine
 * times, not so anything can be counted in real time.
 */
function attempts(count: number | undefined): { attempt_count?: number } {
  return typeof count === "number" && count >= 0 ? { attempt_count: Math.floor(count) } : {};
}

async function recordFailure(
  supabase: SupabaseClient,
  organizationId: Id,
  importFileId: Id,
  failure: { code: string; message: string; attemptCount?: number },
): Promise<FinalizeOutcome> {
  await supabase
    .from("import_files")
    .update({
      status: "failed",
      error_code: failure.code.slice(0, 64),
      error_message: failure.message.slice(0, 500),
      ...attempts(failure.attemptCount),
    })
    .eq("organization_id", organizationId)
    .eq("id", importFileId);

  return { ok: false, errorCode: failure.code, error: failure.message };
}

/**
 * Note that a file is waiting to be tried again.
 *
 * Sets `retrying` rather than `failed`: the two mean different things to
 * whoever is looking at a stuck batch, and collapsing them would make a
 * recovering file look dead and a dead one look busy. A completed file is
 * excluded, so a late note cannot disturb one.
 */
export async function noteImportRetry(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  importFileId: Id;
  attemptCount: number;
  errorCode: string;
  errorMessage: string;
}): Promise<void> {
  await input.supabase
    .from("import_files")
    .update({
      status: "retrying",
      error_code: input.errorCode
        .replace(/[^a-z0-9_.-]/gi, "_")
        .toLowerCase()
        .slice(0, 64),
      error_message: sanitizeErrorMessage(input.errorMessage).slice(0, 500),
      ...attempts(input.attemptCount),
    })
    .eq("organization_id", input.organizationId)
    .eq("id", input.importFileId)
    .neq("status", "complete");
}

/** Record a failure the client saw, sanitized, against the import row. */
export async function recordImportFailure(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  importFileId: Id;
  errorCode: string;
  errorMessage: string;
  attemptCount?: number;
}): Promise<void> {
  await recordFailure(input.supabase, input.organizationId, input.importFileId, {
    code: input.errorCode.replace(/[^a-z0-9_.-]/gi, "_").toLowerCase(),
    message: sanitizeErrorMessage(input.errorMessage),
    attemptCount: input.attemptCount,
  });
}

/**
 * The three facts a local copy may be deleted on.
 *
 * Asked of the server rather than assumed from a local status, because the
 * thing being decided is whether the only remaining copy of a photographer's
 * frame can be thrown away. Each fact is checked where it lives: the import
 * row for finalization, the assets table for the record, and storage itself for
 * the object -- not asset_versions, which is a claim that an object exists
 * rather than evidence of one.
 */
export async function confirmImportFile(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  importFileId: Id;
}): Promise<ImportConfirmation> {
  const { supabase, organizationId, importFileId } = input;

  const { data: row } = await supabase
    .from("import_files")
    .select("status, asset_id")
    .eq("organization_id", organizationId)
    .eq("id", importFileId)
    .maybeSingle();

  const assetId = (row?.asset_id as string | null) ?? undefined;
  const complete = row?.status === "complete" && Boolean(assetId);
  if (!complete || !assetId) {
    return { complete: false, assetExists: false, objectExists: false, assetId };
  }

  const { data: asset } = await supabase
    .from("assets")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("id", assetId)
    .maybeSingle();

  const { data: version } = await supabase
    .from("asset_versions")
    .select("storage_bucket, object_key")
    .eq("organization_id", organizationId)
    .eq("asset_id", assetId)
    .eq("version_kind", "original")
    .maybeSingle();

  let objectExists = false;
  if (version) {
    const key = version.object_key as string;
    const slash = key.lastIndexOf("/");
    const { data: listed } = await supabase.storage
      .from(version.storage_bucket as string)
      .list(key.slice(0, slash), { search: key.slice(slash + 1), limit: 1 });
    objectExists = (listed ?? []).some((entry) => entry.name === key.slice(slash + 1));
  }

  return { complete: true, assetExists: Boolean(asset), objectExists, assetId };
}

/**
 * Whether the bytes actually landed where the upload said they did.
 *
 * The step between "TUS reported success" and "create the asset". TUS reporting
 * success means the client believes every chunk was accepted; this asks storage
 * itself, through the caller's own credentials, whether the object is there and
 * whether it is the size it was registered as.
 *
 * It is also how an object conflict is reconciled. A resumable upload refused
 * with 409 usually means this exact file already completed -- a response lost
 * on the way back, a second tab that got there first -- and the right answer is
 * to verify what is there and carry on to finalization, not to overwrite it and
 * not to make the photographer upload it again.
 */
export interface StagedObjectCheck {
  readonly exists: boolean;
  readonly byteSize?: number;
  readonly expectedBytes: number;
  /** True when the stored object is exactly the size that was registered. */
  readonly matches: boolean;
  /** True when this import has already become an asset. */
  readonly alreadyFinalized: boolean;
  readonly assetId?: Id;
}

export async function verifyStagedUpload(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  importFileId: Id;
}): Promise<StagedObjectCheck> {
  const { supabase, organizationId, importFileId } = input;

  const { data: row } = await supabase
    .from("import_files")
    .select("storage_bucket, storage_path, byte_size, status, asset_id")
    .eq("organization_id", organizationId)
    .eq("id", importFileId)
    .maybeSingle();

  if (!row) throw new Error("That import is not in this workspace.");

  const expectedBytes = Number(row.byte_size);
  const assetId = (row.asset_id as string | null) ?? undefined;

  // Already an asset: the staged object has been promoted to its canonical key
  // and is supposed to be gone from staging. Saying so is the answer; looking
  // for it would report a missing file as a problem when it is the point.
  if (row.status === "complete" && assetId) {
    return { exists: false, expectedBytes, matches: false, alreadyFinalized: true, assetId };
  }

  const path = row.storage_path as string;
  const slash = path.lastIndexOf("/");
  const { data: listed } = await supabase.storage
    .from(row.storage_bucket as string)
    .list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 1 });

  const found = (listed ?? []).find((entry) => entry.name === path.slice(slash + 1));
  const byteSize = found?.metadata?.size as number | undefined;

  return {
    exists: Boolean(found),
    byteSize,
    expectedBytes,
    matches: Boolean(found) && byteSize === expectedBytes,
    alreadyFinalized: false,
    assetId,
  };
}

/** Abandon files. Never touches one that has already become an asset. */
export async function cancelImportFiles(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  importFileIds: readonly Id[];
}): Promise<{ canceled: number }> {
  if (input.importFileIds.length === 0) return { canceled: 0 };

  const { data, error } = await input.supabase
    .from("import_files")
    .update({ status: "canceled" })
    .eq("organization_id", input.organizationId)
    .in("id", [...input.importFileIds])
    .neq("status", "complete")
    .select("id");

  if (error) throw new Error(`Could not cancel those imports: ${error.message}`);
  return { canceled: (data ?? []).length };
}

/** Everything the server knows about one batch. The input to reconciliation. */
export async function getImportBatchState(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  batchId: Id;
}): Promise<ImportBatchState | null> {
  const { supabase, organizationId, batchId } = input;

  const { data: batch } = await supabase
    .from("import_batches")
    .select("id, organization_id, shoot_id, status, total_files, completed_files, failed_files")
    .eq("organization_id", organizationId)
    .eq("id", batchId)
    .maybeSingle();

  if (!batch) return null;

  const { data: files } = await supabase
    .from("import_files")
    .select("id, client_file_id, status, storage_path, asset_id, error_code, error_message")
    .eq("organization_id", organizationId)
    .eq("import_batch_id", batchId)
    .order("created_at", { ascending: true });

  return {
    batchId: batch.id as string,
    organizationId: batch.organization_id as string,
    shootId: batch.shoot_id as string,
    status: batch.status as string,
    totalFiles: Number(batch.total_files),
    completedFiles: Number(batch.completed_files),
    failedFiles: Number(batch.failed_files),
    files: (files ?? []).map((file) => ({
      importFileId: file.id as string,
      clientFileId: file.client_file_id as string,
      status: file.status as ImportFileStatus,
      storagePath: file.storage_path as string,
      assetId: (file.asset_id as string | null) ?? undefined,
      errorCode: (file.error_code as string | null) ?? undefined,
      errorMessage: (file.error_message as string | null) ?? undefined,
    })),
  };
}

/**
 * Batches this workspace has not finished.
 *
 * What a device with no local record of its own asks: another machine, a
 * reinstalled browser, or a colleague picking up an import that was started in
 * a car. The files themselves may still need to be selected again -- the bytes
 * were never on this machine -- but the queue is no longer a secret held by one
 * tab.
 */
export async function outstandingImportBatches(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  shootId?: Id;
  limit?: number;
}): Promise<readonly ImportBatchState[]> {
  const query = input.supabase
    .from("import_batches")
    .select("id")
    .eq("organization_id", input.organizationId)
    .in("status", ["pending", "uploading", "paused", "failed"])
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 20);

  const { data } = input.shootId ? await query.eq("shoot_id", input.shootId) : await query;

  const states: ImportBatchState[] = [];
  for (const row of data ?? []) {
    const state = await getImportBatchState({
      supabase: input.supabase,
      organizationId: input.organizationId,
      batchId: row.id as string,
    });
    if (state) states.push(state);
  }
  return states;
}
