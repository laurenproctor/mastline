import type { Id, ImportFileStatus } from "@/lib/domain";
import { assessCapacity, type CapacityAssessment } from "./capacity";
import { sanitizeErrorMessage, type ImportErrorCode } from "./errors";
import type { UploadFailureCode } from "./failure";
import { importStoragePath, newClientFileId, opfsPathFor } from "./paths";
import { isServerHeld, resumeActionFor, transition } from "./state";
import { createTelemetry, sizeBucket, type ImportTelemetry } from "./telemetry";
import type {
  ImportServerAdapter,
  QueueItemRecord,
  QueueItemView,
  QueueStore,
  StagedUpload,
  StagingArea,
  StorageCapacity,
} from "./types";

/**
 * The import queue.
 *
 * A service, not a component. It owns three things a React tree cannot: the
 * record of what was selected, the local copy of the bytes, and the
 * reconciliation between those and what the server believes. All three have to
 * outlive an unmount, a navigation, and the tab itself, which is why none of
 * them are state.
 *
 * It does not move bytes. Uploading is behind the ImportServerAdapter boundary
 * so the resumable transport can be dropped in without this file changing: what
 * lives here is which file is where, what may happen to it next, and what may
 * safely be deleted. That separation is deliberate -- the queue's correctness
 * is testable without a network, and the transport's is testable without a
 * queue.
 *
 * Every promise it makes to the operator is backed by evidence it has checked:
 * "staged" means a copy was written and read back, "recoverable" means either
 * this machine or the server demonstrably holds the bytes, and "imported" means
 * the server confirmed an asset exists. Nothing is inferred from having asked.
 */

export interface ImportQueueOptions {
  readonly organizationId: Id;
  readonly store: QueueStore;
  /** Null when this browser has no origin private file system. */
  readonly staging: StagingArea | null;
  /** Null when navigator.storage is unavailable. */
  readonly capacity: StorageCapacity | null;
  readonly server: ImportServerAdapter;
  /** True when `store` survives a reload. False for the in-memory fallback. */
  readonly durableMetadata?: boolean;
  readonly hash?: (blob: Blob) => Promise<string>;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly onChange?: (items: readonly QueueItemView[]) => void;
  /** Operational events. Silent by default: telemetry is never load-bearing. */
  readonly telemetry?: ImportTelemetry;
}

export interface EnqueueResult {
  readonly batchId: Id;
  readonly items: readonly QueueItemView[];
  readonly capacity: CapacityAssessment;
  readonly stagedCount: number;
  readonly unstagedCount: number;
  /** False when the server could not be told about this batch yet. */
  readonly registered: boolean;
  readonly warnings: readonly string[];
}

export interface RestoreReport {
  readonly restored: number;
  readonly needsFile: number;
  readonly completed: number;
  readonly cleaned: number;
  readonly reRegistered: number;
  readonly unreachableBatches: number;
}

export interface CleanupReport {
  readonly removed: number;
  readonly kept: number;
  readonly reasons: readonly string[];
}

/**
 * How long a Supabase resumable upload URL lasts.
 *
 * The service documents "up to 24 hours". Twenty-three is used so a session is
 * abandoned before the edge rather than at it: a card dump left overnight
 * should not spend its first minute back discovering that every URL it saved
 * has just died.
 */
export const UPLOAD_SESSION_LIFETIME_MS = 23 * 60 * 60 * 1000;

const UNSTAGED_WARNING =
  "Reload recovery cannot be guaranteed for this file. If this page is reloaded before it uploads, it will have to be selected again.";

export class ImportQueue {
  private readonly options: ImportQueueOptions;
  /**
   * The File objects from this session's pickers.
   *
   * Not persisted and not persistable: a File is a reference to the operator's
   * disk that dies with the page. It is kept only so a file that could not be
   * copied into durable staging can still be uploaded now, in this tab, rather
   * than being refused twice.
   */
  private readonly sessionFiles = new Map<string, File>();

  private readonly telemetry: ImportTelemetry;

  constructor(options: ImportQueueOptions) {
    this.options = options;
    this.telemetry = options.telemetry ?? createTelemetry();
  }

  private get now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }

  private id(): string {
    return this.options.newId?.() ?? crypto.randomUUID();
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /**
   * Whether the bytes for this item exist somewhere that survives a reload.
   *
   * Two ways for that to be true, and no third: this machine holds a staged
   * copy, or the server has already accepted the upload. Anything else is shown
   * as needing the file again, because the alternative is telling somebody a
   * frame is safe when it is one refresh away from being gone.
   */
  private view(record: QueueItemRecord): QueueItemView {
    const durablyStaged =
      record.stagingState === "staged" && Boolean(this.options.durableMetadata ?? true);
    const recoverable = durablyStaged || isServerHeld(record.status);
    const hasBytesNow =
      record.stagingState === "staged" || this.sessionFiles.has(record.clientFileId);
    return {
      ...record,
      recoverable,
      needsFile: !isServerHeld(record.status) && !hasBytesNow && record.status !== "canceled",
    };
  }

  async items(): Promise<readonly QueueItemView[]> {
    const records = await this.options.store.all();
    return records.map((record) => this.view(record));
  }

  async itemsFor(batchId: Id): Promise<readonly QueueItemView[]> {
    const records = await this.options.store.byBatch(batchId);
    return records.map((record) => this.view(record));
  }

  async item(clientFileId: string): Promise<QueueItemView | null> {
    const record = await this.options.store.get(clientFileId);
    return record ? this.view(record) : null;
  }

  /**
   * The bytes for one item, wherever they are.
   *
   * The staged copy first: it is the one that survived, and after a reload it
   * is the only one there is.
   */
  async bytesFor(clientFileId: string): Promise<Blob | null> {
    const record = await this.options.store.get(clientFileId);
    if (!record) return null;

    if (record.stagingState === "staged" && this.options.staging) {
      const blob = await this.options.staging.read(
        opfsPathFor(record.organizationId, record.batchId, record.clientFileId),
      );
      if (blob) return blob;
      // Staged once and gone now. Say so rather than falling through silently.
      await this.write({ ...record, stagingState: "missing", updatedAt: this.now });
    }

    return this.sessionFiles.get(clientFileId) ?? null;
  }

  /**
   * The digest for one item, computed now if enqueue could not.
   *
   * Normally the digest exists before anything moves -- see stageOne. The one
   * case it cannot is a browser that refused to read the File at selection
   * time (WebKit does, while offline), and for that file the digest is taken
   * here, from the same bytes that are about to be uploaded. Returns undefined
   * when the bytes still cannot be read, which the caller must treat as an
   * upload that cannot proceed.
   */
  async ensureDigest(clientFileId: string, blob: Blob): Promise<string | undefined> {
    const record = await this.require(clientFileId);
    if (record.sha256) return record.sha256;
    if (!this.options.hash) return undefined;
    try {
      const sha256 = await this.options.hash(blob);
      await this.update(clientFileId, (fresh) => ({ ...fresh, sha256, updatedAt: this.now }));
      return sha256;
    } catch {
      return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  /**
   * One writer at a time, per file.
   *
   * Every mutation here is a read, a change, and a write, and several of them
   * run concurrently against the same record: progress arrives every few
   * hundred milliseconds while the session URL, the attempt count, and the
   * status are all being written by other paths.
   *
   * Without this they clobber each other, and the clobbering is not
   * theoretical. The session URL was written the moment TUS created it and was
   * then overwritten, milliseconds later, by a progress write that had read the
   * record before the URL existed. The queue therefore had no session to
   * resume, and every reload restarted its uploads from byte zero -- silently,
   * because a re-upload looks exactly like a slow upload.
   *
   * The chain is per file id, so two files never wait on each other.
   */
  private readonly writes = new Map<string, Promise<unknown>>();

  private mutate<T>(clientFileId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(clientFileId) ?? Promise.resolve();
    const next = previous.then(work, work);
    // Swallowed on the chain only: the caller still sees the rejection.
    this.writes.set(
      clientFileId,
      next.catch(() => undefined),
    );
    return next;
  }

  /** Read the current record, change it, and write it back, atomically. */
  private async update(
    clientFileId: string,
    change: (record: QueueItemRecord) => QueueItemRecord,
  ): Promise<QueueItemRecord> {
    return this.mutate(clientFileId, async () => {
      const fresh = await this.require(clientFileId);
      return this.write(change(fresh));
    });
  }

  private async write(record: QueueItemRecord): Promise<QueueItemRecord> {
    await this.options.store.put(record);
    await this.notify();
    return record;
  }

  private async notify(): Promise<void> {
    if (!this.options.onChange) return;
    this.options.onChange(await this.items());
  }

  private async require(clientFileId: string): Promise<QueueItemRecord> {
    const record = await this.options.store.get(clientFileId);
    if (!record) throw new Error(`No queued import called ${clientFileId}.`);
    return record;
  }

  /**
   * Move one item's status, refusing transitions the state machine forbids.
   *
   * The transition is evaluated against the record as it is now, not as it was
   * when the caller read it: by the time an upload finishes, progress writes
   * have been landing on that row for minutes.
   */
  private async moveTo(
    record: QueueItemRecord,
    status: ImportFileStatus,
    changes: Partial<QueueItemRecord> = {},
  ): Promise<QueueItemRecord> {
    return this.update(record.clientFileId, (fresh) => ({
      ...fresh,
      ...changes,
      status: transition(fresh.status, status, fresh.clientFileId),
      updatedAt: this.now,
    }));
  }

  // -------------------------------------------------------------------------
  // Selecting files
  // -------------------------------------------------------------------------

  /**
   * Take a selection of files into the queue.
   *
   * The order is the order the promises are made in:
   *
   *   1. ask how much room there is, and ask for storage that will not be
   *      evicted, before copying anything;
   *   2. write the metadata record first, marked as not yet staged, so a crash
   *      during the copy leaves a truthful record rather than none;
   *   3. copy the bytes and read them back, and only then call the item staged;
   *   4. tell the server what is coming.
   *
   * Step 4 failing is not fatal and does not lose the selection. A card dump
   * that begins in a car park with no signal is exactly the case this feature
   * exists for: the files are staged locally, the batch is registered on the
   * next attempt, and registration is idempotent so the retry cannot duplicate
   * anything.
   */
  async enqueue(input: {
    shootId: Id;
    files: readonly File[];
    /** Supplied on a retry of the same selection, so it lands on the same batch. */
    batchId?: Id;
  }): Promise<EnqueueResult> {
    const batchId = input.batchId ?? this.id();
    const warnings: string[] = [];
    const requiredBytes = input.files.reduce((total, file) => total + file.size, 0);

    const capacity = await this.assess(requiredBytes);
    if (capacity.warning) warnings.push(capacity.warning);
    if (!this.options.staging?.available) {
      warnings.push(
        "This browser will not let Mastline keep a local copy of these files, so they cannot be recovered after a reload. Leave this tab open until the import finishes.",
      );
    }
    if (!(this.options.durableMetadata ?? true)) {
      warnings.push(
        "This browser is not storing the import queue, so a reload will lose anything that has not finished uploading.",
      );
    }

    const created: QueueItemRecord[] = [];
    // Once the origin is out of room, further copies are attempted only to
    // fail. The rest of the selection is admitted honestly instead.
    let outOfRoom = !capacity.sufficient && capacity.availableBytes !== undefined;

    for (const file of input.files) {
      const clientFileId = newClientFileId(this.options.newId);
      this.sessionFiles.set(clientFileId, file);

      const record: QueueItemRecord = {
        clientFileId,
        organizationId: this.options.organizationId,
        shootId: input.shootId,
        batchId,
        batchIdempotencyKey: batchId,
        originalFilename: file.name,
        byteSize: file.size,
        mimeType: file.type || "application/octet-stream",
        lastModifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : undefined,
        status: "pending",
        stagingState: "none",
        storageBucket: "originals",
        storagePath: importStoragePath(this.options.organizationId, batchId, clientFileId),
        attemptCount: 0,
        createdAt: this.now,
        updatedAt: this.now,
      };

      // Written before the copy, deliberately. A record saying "selected, not
      // yet staged" is recoverable information; a copy with no record is bytes
      // nobody will ever look for.
      await this.write(record);
      created.push(await this.stageOne(record, file, outOfRoom));
      const last = created[created.length - 1];
      if (last.errorCode === "quota_exceeded") outOfRoom = true;
    }

    this.telemetry.emit("import_batch_created", {
      workspaceId: this.options.organizationId,
      batchId,
      fileCount: input.files.length,
    });

    const registered = await this.register(batchId);
    if (!registered) {
      warnings.push(
        "These files are queued on this device but have not reached Mastline yet. They will be sent when the connection returns.",
      );
    }

    const items = await this.itemsFor(batchId);
    return {
      batchId,
      items,
      capacity,
      stagedCount: items.filter((item) => item.stagingState === "staged").length,
      unstagedCount: items.filter((item) => item.stagingState !== "staged").length,
      registered,
      warnings,
    };
  }

  /** The storage question, asked before anything is copied. */
  private async assess(requiredBytes: number): Promise<CapacityAssessment> {
    const capacity = this.options.capacity;
    if (!capacity) {
      return assessCapacity({ requiredBytes, persisted: false });
    }

    const estimate = await capacity.estimate();
    let persisted = await capacity.persisted();

    // Asked for once, here, because this is the moment it is about something
    // the person can see themselves doing. A refusal is a fact, not an error.
    if (!persisted && this.options.staging?.available) {
      persisted = await capacity.persist();
    }

    return assessCapacity({
      requiredBytes,
      quota: estimate.quota,
      usage: estimate.usage,
      persisted,
    });
  }

  /**
   * Copy one file into durable staging.
   *
   * A failure here never removes the item from the queue. It stays visible,
   * marked as not recoverable and needing the original file again if this page
   * is reloaded, which is the truth rather than a silent downgrade.
   */
  private async stageOne(
    record: QueueItemRecord,
    file: File,
    skipBecauseFull: boolean,
  ): Promise<QueueItemRecord> {
    const staging = this.options.staging;

    /*
     * The digest is computed first, and whatever happens to the staging.
     *
     * It is a fact about the bytes, not about where a copy of them was kept.
     * Computing it only on the staged path meant that a file which could not be
     * staged -- no room, or a browser with no origin private file system at all
     * -- uploaded perfectly and then failed at finalization, because there was
     * no digest to record against the original. Every such file reached 100%
     * and then went red.
     *
     * And a digest that cannot be computed right now is not a refused file.
     * WebKit routes File reads through its network process, so reading the
     * bytes fails while the browser is offline -- and a selection made with no
     * signal is exactly the case this queue exists for. The record proceeds
     * without a digest and ensureDigest() computes one from the same bytes
     * just before they are uploaded.
     */
    let sha256 = record.sha256;
    if (this.options.hash) {
      try {
        sha256 = await this.options.hash(file);
      } catch {
        // Left undefined. The selection survives; the digest comes later.
      }
    }
    const hashed: QueueItemRecord = { ...record, sha256 };

    if (!staging?.available) {
      return this.write({
        ...hashed,
        errorCode: "staging_unavailable" satisfies ImportErrorCode,
        errorMessage: UNSTAGED_WARNING,
        updatedAt: this.now,
      });
    }

    if (skipBecauseFull) {
      return this.write({
        ...hashed,
        errorCode: "quota_exceeded" satisfies ImportErrorCode,
        errorMessage: `There is not enough free storage to keep a recoverable copy. ${UNSTAGED_WARNING}`,
        updatedAt: this.now,
      });
    }

    try {
      const path = opfsPathFor(record.organizationId, record.batchId, record.clientFileId);
      await staging.stage(path, file);

      this.telemetry.emit("import_file_staged", {
        workspaceId: record.organizationId,
        batchId: record.batchId,
        sizeBucket: sizeBucket(record.byteSize),
      });

      return this.moveTo(record, "staged", {
        stagingState: "staged",
        sha256,
        errorCode: undefined,
        errorMessage: undefined,
      });
    } catch (error) {
      const message = sanitizeErrorMessage(error);
      const quota = /quota|space|storage/i.test(message);
      return this.write({
        ...hashed,
        stagingState: "none",
        errorCode: (quota ? "quota_exceeded" : "staging_failed") satisfies ImportErrorCode,
        errorMessage: `${message} ${UNSTAGED_WARNING}`,
        updatedAt: this.now,
      });
    }
  }

  /**
   * Hand back a file the queue could not recover.
   *
   * The operator selected it again after a reload. Everything else about the
   * item -- its place in the batch, its storage path, its server row -- is
   * unchanged, because none of it depended on holding the bytes.
   */
  async provideFile(clientFileId: string, file: File): Promise<QueueItemView> {
    const record = await this.require(clientFileId);

    if (file.size !== record.byteSize || file.name !== record.originalFilename) {
      throw new Error(
        `That is not the same file. ${record.originalFilename} was ${record.byteSize} bytes.`,
      );
    }

    this.sessionFiles.set(clientFileId, file);

    // Back through the state machine, not around it. A failed or canceled
    // import re-enters at `pending`; a paused one resumes through `retrying`;
    // anything already pending, staged, or retrying is re-staged where it
    // stands. The reset is persisted before staging, because stageOne moves
    // the record as it is in the store, not as this method remembers it.
    const reset =
      record.status === "failed" || record.status === "canceled"
        ? await this.moveTo(record, "pending", {
            errorCode: undefined,
            errorMessage: undefined,
            nextAttemptAt: undefined,
          })
        : record.status === "paused"
          ? await this.moveTo(record, "retrying", { resumeFrom: undefined })
          : record;

    const staged = await this.stageOne(reset, file, false);
    return this.view(staged);
  }

  // -------------------------------------------------------------------------
  // Talking to the server
  // -------------------------------------------------------------------------

  /**
   * Register a batch and its files, idempotently.
   *
   * Called on enqueue, and again on every startup for anything still
   * outstanding. Both calls are safe to repeat: the batch is keyed on an
   * idempotency key this client chose and the files on their client ids, so a
   * repeat lands on the rows that already exist.
   */
  async register(batchId: Id): Promise<boolean> {
    const records = await this.options.store.byBatch(batchId);
    if (records.length === 0) return true;

    const pending = records.filter((record) => !record.importFileId);
    if (pending.length === 0) return true;

    const first = records[0];

    try {
      const batch = await this.options.server.registerBatch({
        shootId: first.shootId,
        idempotencyKey: first.batchIdempotencyKey,
      });

      const registered = await this.options.server.registerFiles({
        batchId: batch.batchId,
        files: pending.map((record) => ({
          clientFileId: record.clientFileId,
          originalFilename: record.originalFilename,
          byteSize: record.byteSize,
          mimeType: record.mimeType,
          lastModifiedAt: record.lastModifiedAt,
          sha256: record.sha256,
        })),
      });

      const byClientId = new Map(registered.map((row) => [row.clientFileId, row]));
      for (const record of pending) {
        const row = byClientId.get(record.clientFileId);
        if (!row) continue;
        await this.write({
          ...record,
          importFileId: row.importFileId,
          // The server's path is authoritative: it is immutable there, and a
          // disagreement means this client computed it from stale ids.
          storagePath: row.storagePath,
          assetId: row.assetId ?? record.assetId,
          errorCode: record.errorCode === "registration_failed" ? undefined : record.errorCode,
          errorMessage:
            record.errorCode === "registration_failed" ? undefined : record.errorMessage,
          updatedAt: this.now,
        });
      }
      return true;
    } catch (error) {
      const message = sanitizeErrorMessage(error);
      for (const record of pending) {
        await this.write({
          ...record,
          errorCode: "registration_failed" satisfies ImportErrorCode,
          errorMessage: message,
          updatedAt: this.now,
        });
      }
      return false;
    }
  }

  /**
   * Ask the server whether the uploaded object is actually in the bucket.
   *
   * The queue owns the server adapter, so this is where the question is asked
   * from. The runner uses it twice: once between a successful upload and
   * finalization, so an asset is never created for an object that is not there,
   * and once to reconcile a conflict, where the answer is usually that this
   * exact file already landed.
   */
  async verifyUpload(clientFileId: string): Promise<StagedUpload | null> {
    const record = await this.require(clientFileId);
    if (!record.importFileId) return null;
    try {
      return await this.options.server.verifyUpload({ importFileId: record.importFileId });
    } catch {
      return null;
    }
  }

  /** The transport says the bytes are in the bucket. */
  async markUploading(clientFileId: string): Promise<QueueItemView> {
    const record = await this.require(clientFileId);
    return this.view(
      await this.moveTo(record, "uploading", { attemptCount: record.attemptCount + 1 }),
    );
  }

  async markUploaded(clientFileId: string, sha256?: string): Promise<QueueItemView> {
    const record = await this.require(clientFileId);
    const digest = sha256 ?? record.sha256;
    if (!digest) throw new Error("An uploaded file needs the digest of the bytes that were sent.");

    const uploaded = await this.moveTo(record, "uploaded", { sha256: digest });
    if (uploaded.importFileId) {
      try {
        await this.options.server.markUploaded({
          importFileId: uploaded.importFileId,
          sha256: digest,
          attemptCount: uploaded.attemptCount,
        });
      } catch {
        // A lifecycle transition the server missed is recoverable: finalization
        // accepts an uploaded file whether or not this call landed.
      }
    }
    return this.view(uploaded);
  }

  /**
   * Turn an uploaded file into an asset.
   *
   * Repeating this is safe by design. The server claims the row before it does
   * anything, and a call that arrives after the work is done returns the asset
   * that already exists rather than making a second one -- which is what makes
   * it callable from a reconnect, a retry, and a second tab without anybody
   * having to coordinate.
   */
  async finalize(clientFileId: string): Promise<QueueItemView> {
    const record = await this.require(clientFileId);
    if (record.status === "complete") return this.view(record);
    if (!record.importFileId) throw new Error("That file has not been registered with Mastline.");
    if (!record.sha256) throw new Error("That file has no digest, so it cannot be finalized.");

    const finalizing = await this.moveTo(record, "finalizing");

    try {
      const outcome = await this.options.server.finalize({
        importFileId: finalizing.importFileId!,
        sha256: finalizing.sha256!,
        width: finalizing.width,
        height: finalizing.height,
        capturedAt: finalizing.capturedAt ?? finalizing.lastModifiedAt,
      });

      if (outcome.ok && outcome.assetId) {
        return this.view(
          await this.moveTo(finalizing, "complete", {
            assetId: outcome.assetId,
            errorCode: undefined,
            errorMessage: undefined,
          }),
        );
      }

      // Another tab or an earlier request is mid-finalization. Waiting is the
      // correct move: forcing it would be the one path to a duplicate asset.
      if (outcome.inProgress) return this.view(finalizing);

      return this.view(
        await this.moveTo(finalizing, "failed", {
          errorCode: (outcome.errorCode ?? "finalization_failed") as string,
          errorMessage: sanitizeErrorMessage(outcome.error ?? "Finalization failed."),
        }),
      );
    } catch (error) {
      return this.view(
        await this.moveTo(finalizing, "failed", {
          errorCode: "finalization_failed" satisfies ImportErrorCode,
          errorMessage: sanitizeErrorMessage(error),
        }),
      );
    }
  }

  /** Record a failure against an item, locally and on the server. */
  async fail(
    clientFileId: string,
    failure: { code: ImportErrorCode | UploadFailureCode; message: unknown },
  ): Promise<QueueItemView> {
    const record = await this.require(clientFileId);
    const message = sanitizeErrorMessage(failure.message);

    const failed = await this.moveTo(record, "failed", {
      errorCode: failure.code,
      errorMessage: message,
    });

    if (failed.importFileId) {
      try {
        await this.options.server.reportFailure({
          importFileId: failed.importFileId,
          errorCode: failure.code,
          errorMessage: message,
          attemptCount: failed.attemptCount,
        });
      } catch {
        // The local record is the one the operator is looking at.
      }
    }
    return this.view(failed);
  }

  /**
   * Record a failure the runner intends to retry.
   *
   * Distinct from fail() on purpose. `failed` means a person has to do
   * something; `retrying` means the queue is still working on it and knows
   * when it will try again. Collapsing the two would either show a photographer
   * a red row for a tunnel, or hide a genuinely dead file among rows that are
   * quietly recovering.
   *
   * The schedule is persisted rather than held in a timer, so a reload does not
   * reset a backoff -- and a tab opened during an outage does not immediately
   * hammer a service the previous tab had already backed away from.
   */
  async scheduleRetry(
    clientFileId: string,
    failure: { code: ImportErrorCode | UploadFailureCode; message: unknown },
    nextAttempt: string,
  ): Promise<QueueItemView> {
    const record = await this.require(clientFileId);
    const message = sanitizeErrorMessage(failure.message);

    const retrying = await this.moveTo(record, "retrying", {
      errorCode: failure.code,
      errorMessage: message,
      nextAttemptAt: nextAttempt,
    });

    if (retrying.importFileId) {
      try {
        await this.options.server.noteRetry({
          importFileId: retrying.importFileId,
          attemptCount: retrying.attemptCount,
          errorCode: failure.code,
          errorMessage: message,
        });
      } catch {
        // The local record is what the operator is looking at; the note is for
        // whoever inspects the batch from the other side.
      }
    }

    return this.view(retrying);
  }

  /**
   * Remember the resumable session the transport created.
   *
   * Written the moment the URL exists, before any bytes are sent, because the
   * failure this defends against is the tab closing mid-upload: without the URL
   * the next session starts at zero, and on a 60 MB raw file over a phone that
   * is the difference between finishing and giving up.
   */
  async recordUploadSession(clientFileId: string, uploadUrl: string): Promise<void> {
    await this.update(clientFileId, (record) =>
      record.uploadUrl === uploadUrl
        ? record
        : { ...record, uploadUrl, uploadUrlCreatedAt: this.now, updatedAt: this.now },
    );
  }

  /**
   * Forget a session that can no longer be resumed.
   *
   * An expired upload URL is not a failed file. Clearing it is what turns
   * "this could not be resumed" into "this will be started again", which is the
   * distinction the operator would otherwise have to make for themselves.
   */
  async clearUploadSession(clientFileId: string): Promise<void> {
    await this.update(clientFileId, (record) => ({
      ...record,
      uploadUrl: undefined,
      uploadUrlCreatedAt: undefined,
      uploadedBytes: 0,
      updatedAt: this.now,
    }));
  }

  /**
   * How far the server had got, recorded at chunk boundaries.
   *
   * Six megabytes of progress per write, not one write per byte. This exists so
   * a reloaded page can draw the bar in roughly the right place; the offset
   * that is actually resumed from is the one the server states when the upload
   * is picked up again, which is the only number either side can be held to.
   */
  async recordProgress(clientFileId: string, uploadedBytes: number): Promise<void> {
    await this.mutate(clientFileId, async () => {
      const record = await this.options.store.get(clientFileId);
      if (!record || record.uploadedBytes === uploadedBytes) return;
      // Straight to the store rather than through write(): a chunk boundary is
      // not a state change and does not need to redraw the queue, which the
      // live progress callback is already doing.
      await this.options.store.put({ ...record, uploadedBytes });
    });
  }

  /**
   * Whether a stored upload session is worth trying to resume.
   *
   * Supabase expires a resumable URL after about twenty-four hours. Asking a
   * dead session for its offset costs a round trip and returns a 404 that has
   * to be told apart from a real failure, so a session near the edge is
   * abandoned before it is used rather than after.
   */
  resumableUrlFor(record: QueueItemRecord, now: Date = new Date()): string | undefined {
    if (!record.uploadUrl) return undefined;
    if (!record.uploadUrlCreatedAt) return record.uploadUrl;
    const age = now.getTime() - new Date(record.uploadUrlCreatedAt).getTime();
    return age < UPLOAD_SESSION_LIFETIME_MS ? record.uploadUrl : undefined;
  }

  /**
   * Take back a file that was mid-flight when its tab went away.
   *
   * `uploading` and `finalizing` mean a browser somewhere believes it owns this
   * file. When that browser is gone -- a reload, a crash, a phone locking --
   * nothing ever moved the record on, and the file sat at "Uploading 48%"
   * indefinitely. It was still safe: the bytes were staged and the server row
   * existed. It was simply never picked up again, which for a photographer is
   * indistinguishable from being lost.
   *
   * Only ever called by a runner that has just acquired the cross-tab lock for
   * this file, which is what makes "nobody else is working on it" true rather
   * than assumed. It returns the item to `retrying`, from where reconciliation
   * asks storage what actually landed and resumes accordingly.
   */
  async reclaim(clientFileId: string): Promise<QueueItemView> {
    const record = await this.require(clientFileId);
    if (record.status !== "uploading" && record.status !== "finalizing") {
      return this.view(record);
    }
    return this.view(await this.moveTo(record, "retrying", { nextAttemptAt: undefined }));
  }

  async pause(clientFileId: string): Promise<QueueItemView> {
    const record = await this.require(clientFileId);
    return this.view(await this.moveTo(record, "paused", { resumeFrom: record.status }));
  }

  /**
   * Resume a paused or failed item.
   *
   * Where it resumes to is decided by what the run had already achieved, not by
   * starting over: bytes the bucket has accepted are not sent twice, and a file
   * whose local copy is gone waits for the operator rather than pretending it
   * can continue.
   */
  async resume(clientFileId: string): Promise<QueueItemView> {
    const record = await this.require(clientFileId);
    // Already an asset. There is nothing to resume, and saying so is cheaper
    // than a transition that would have to be refused.
    if (record.status === "complete" || record.assetId) return this.view(record);

    // Already somewhere the runner will pick it up from -- a file just handed
    // back, most often. Resuming it means clearing any wait that was scheduled,
    // not moving it somewhere it has no reason to go.
    if (record.status === "staged" || record.status === "uploaded" || record.status === "pending") {
      return this.view(
        await this.write({
          ...record,
          nextAttemptAt: undefined,
          resumeFrom: undefined,
          updatedAt: this.now,
        }),
      );
    }

    const retrying = await this.moveTo(record, "retrying");
    const reached = record.resumeFrom ?? record.status;

    const action = resumeActionFor({
      serverStatus: record.assetId ? "complete" : reached,
      bytesAvailableLocally:
        retrying.stagingState === "staged" || this.sessionFiles.has(retrying.clientFileId),
    });

    // A person pressing resume means now, not after whatever backoff the runner
    // had scheduled for a server that may since have come back.
    const cleared = { resumeFrom: undefined, nextAttemptAt: undefined };
    if (action === "finalize") {
      return this.view(await this.moveTo(retrying, "uploaded", cleared));
    }
    if (action === "upload" && retrying.stagingState === "staged") {
      return this.view(await this.moveTo(retrying, "staged", cleared));
    }
    return this.view(await this.write({ ...retrying, ...cleared }));
  }

  async cancel(clientFileId: string): Promise<QueueItemView> {
    const record = await this.require(clientFileId);
    if (record.status === "complete") {
      throw new Error("That file has already been imported. Tombstone the asset instead.");
    }

    const canceled = await this.moveTo(record, "canceled", {
      errorCode: "canceled" satisfies ImportErrorCode,
      errorMessage: "Canceled.",
    });

    if (canceled.importFileId) {
      try {
        await this.options.server.cancel({ importFileIds: [canceled.importFileId] });
      } catch {
        // Reconciliation will carry the cancellation across next time.
      }
    }

    this.sessionFiles.delete(clientFileId);
    await this.removeStagedCopy(canceled);
    return this.view(canceled);
  }

  // -------------------------------------------------------------------------
  // Startup
  // -------------------------------------------------------------------------

  /**
   * Reconcile what this machine remembers with what the server knows.
   *
   * Run once at startup, and safe to run again. The rules it follows, in order
   * of authority:
   *
   *   * The server is right about anything it has a record of. An item it calls
   *     complete is complete here, whatever this device last wrote.
   *   * The origin private file system is right about whether the bytes are
   *     here. A record saying "staged" is checked, not believed -- storage gets
   *     evicted, and an item shown as recoverable that is not is the failure
   *     this whole feature exists to prevent.
   *   * Nothing in here creates. It registers (idempotent) and it confirms; it
   *     never finalizes on its own, so a reconciliation pass cannot be the
   *     thing that produces a second asset.
   */
  async restore(): Promise<RestoreReport> {
    const records = await this.options.store.all();
    let restored = 0;
    let needsFile = 0;
    let completed = 0;
    let cleaned = 0;
    let reRegistered = 0;
    let unreachableBatches = 0;

    const batches = [...new Set(records.map((record) => record.batchId))];

    for (const batchId of batches) {
      const inBatch = records.filter((record) => record.batchId === batchId);

      // Anything never registered gets another go: a batch queued with no
      // signal has been waiting for exactly this moment.
      if (inBatch.some((record) => !record.importFileId)) {
        if (await this.register(batchId)) reRegistered += 1;
      }

      let serverFiles = new Map<string, { status: ImportFileStatus; assetId?: Id }>();
      try {
        const state = await this.options.server.batchState({ batchId });
        if (state) {
          serverFiles = new Map(
            state.files.map((file) => [
              file.clientFileId,
              { status: file.status, assetId: file.assetId },
            ]),
          );
        }
      } catch {
        // Offline, or a batch the server has never heard of. Local records are
        // left exactly as they are: forgetting them would lose the queue, and
        // guessing at their state would be worse than not knowing.
        unreachableBatches += 1;
      }

      for (const record of inBatch) {
        const fresh = (await this.options.store.get(record.clientFileId)) ?? record;
        const server = serverFiles.get(fresh.clientFileId);
        let current = fresh;

        if (server?.status === "complete" && server.assetId) {
          // Already an asset. Adopt that, then clean up behind it -- but only
          // once the server has confirmed all three facts.
          // Written directly rather than through the state machine: this is not
          // a transition this device is making, it is one it is being told
          // about. Refusing it because the local status was, say, `pending`
          // would leave the queue arguing with the record of an asset that
          // demonstrably exists.
          current =
            current.status === "complete"
              ? current
              : await this.write({
                  ...current,
                  status: "complete",
                  assetId: server.assetId,
                  errorCode: undefined,
                  errorMessage: undefined,
                  updatedAt: this.now,
                });
          completed += 1;
          if (await this.cleanupIfConfirmed(current)) cleaned += 1;
          continue;
        }

        if (server?.status === "canceled" && current.status !== "canceled") {
          current = await this.write({ ...current, status: "canceled", updatedAt: this.now });
          continue;
        }

        // The bytes are checked rather than believed.
        if (current.stagingState === "staged") {
          const present = this.options.staging
            ? await this.options.staging.exists(
                opfsPathFor(current.organizationId, current.batchId, current.clientFileId),
              )
            : false;
          if (!present) {
            current = await this.write({
              ...current,
              stagingState: "missing",
              errorCode: "file_missing" satisfies ImportErrorCode,
              errorMessage:
                "The local copy of this file is gone. Select it again to finish importing it.",
              updatedAt: this.now,
            });
          }
        }

        const view = this.view(current);
        if (view.needsFile) needsFile += 1;
        else if (view.recoverable || this.sessionFiles.has(current.clientFileId)) restored += 1;
      }
    }

    await this.notify();

    // Only worth reporting when there was something to recover. A tab that
    // opens on an empty queue is not a recovery.
    if (restored + needsFile + completed > 0) {
      this.telemetry.emit("import_recovered_after_reload", {
        workspaceId: this.options.organizationId,
        fileCount: restored + needsFile + completed,
        completedCount: completed,
        failedCount: needsFile,
      });
    }

    return { restored, needsFile, completed, cleaned, reRegistered, unreachableBatches };
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  private async removeStagedCopy(record: QueueItemRecord): Promise<void> {
    if (!this.options.staging) return;
    await this.options.staging.remove(
      opfsPathFor(record.organizationId, record.batchId, record.clientFileId),
    );
  }

  /**
   * Delete the local copy of a finished import, and only a finished one.
   *
   * Three facts have to come back from the server first, and all three are
   * about the same file: the object is in the bucket, finalization succeeded,
   * and the asset record exists. Two out of three is a reason to keep the copy.
   * Deleting on the strength of a local status would mean trusting this
   * device's memory of a request that may never have arrived.
   */
  private async cleanupIfConfirmed(record: QueueItemRecord): Promise<boolean> {
    if (!record.importFileId) return false;

    let confirmation;
    try {
      confirmation = await this.options.server.confirm({ importFileId: record.importFileId });
    } catch {
      return false;
    }

    if (!confirmation.complete || !confirmation.assetExists || !confirmation.objectExists) {
      return false;
    }

    await this.removeStagedCopy(record);
    this.sessionFiles.delete(record.clientFileId);
    // The local queue record goes; the asset stays. Nothing in this method can
    // reach an asset, and nothing in this class ever deletes one.
    await this.options.store.delete(record.clientFileId);
    await this.notify();
    return true;
  }

  /**
   * Confirm and clean up one finished import.
   *
   * The runner's last step for a file. Returns false when the server has not
   * vouched for all three facts, in which case the local copy stays exactly
   * where it is and the sweep will ask again later.
   */
  async confirmAndCleanup(clientFileId: string): Promise<boolean> {
    const record = await this.options.store.get(clientFileId);
    if (!record || record.status !== "complete") return false;
    return this.cleanupIfConfirmed(record);
  }

  /** Clean up every completed import the server will vouch for. */
  async cleanupCompleted(): Promise<CleanupReport> {
    const records = await this.options.store.all();
    const reasons: string[] = [];
    let removed = 0;
    let kept = 0;

    for (const record of records) {
      if (record.status !== "complete") continue;
      if (await this.cleanupIfConfirmed(record)) removed += 1;
      else {
        kept += 1;
        reasons.push(
          `${record.originalFilename}: kept, because Mastline has not confirmed the stored file and its asset.`,
        );
      }
    }

    return { removed, kept, reasons };
  }

  /**
   * Clean up after cancellation and abandonment.
   *
   * The explicit counterpart to cleanupCompleted: these records are not going
   * to finish, so the staged bytes are dead weight. A completed item is never
   * touched here -- it has an asset, and the asset is the archive.
   */
  async cleanupCanceled(options: { abandonedBefore?: Date } = {}): Promise<CleanupReport> {
    const records = await this.options.store.all();
    const cutoff = options.abandonedBefore?.getTime();
    let removed = 0;
    let kept = 0;

    for (const record of records) {
      if (record.status === "complete" || record.assetId) {
        kept += 1;
        continue;
      }

      const canceled = record.status === "canceled";
      const abandoned =
        cutoff !== undefined &&
        new Date(record.updatedAt).getTime() < cutoff &&
        record.status !== "uploading" &&
        record.status !== "finalizing";

      if (!canceled && !abandoned) {
        kept += 1;
        continue;
      }

      await this.removeStagedCopy(record);
      this.sessionFiles.delete(record.clientFileId);
      await this.options.store.delete(record.clientFileId);
      removed += 1;
    }

    await this.notify();
    return { removed, kept, reasons: [] };
  }

  /** Everything staged for one batch, for a batch the operator gave up on. */
  async cleanupBatch(batchId: Id): Promise<CleanupReport> {
    const records = await this.options.store.byBatch(batchId);
    const finished = records.filter((record) => record.status === "complete");
    if (finished.length > 0) {
      // A batch with completed imports in it is cleaned up file by file, so a
      // recursive delete can never remove the local copy of a file whose asset
      // the server has not yet confirmed.
      return this.cleanupCanceled();
    }

    for (const record of records) {
      this.sessionFiles.delete(record.clientFileId);
      await this.options.store.delete(record.clientFileId);
    }
    if (this.options.staging && records.length > 0) {
      await this.options.staging.removeBatch(records[0].organizationId, batchId);
    }

    await this.notify();
    return { removed: records.length, kept: 0, reasons: [] };
  }
}
