import type { Id } from "@/lib/domain";
import { backoffDelay, isDue, type BackoffOptions } from "./backoff";
import {
  classifyFinalizationFailure,
  isRetryable,
  messageFor,
  type UploadFailure,
  type UploadFailureCode,
} from "./failure";
import type { ImportQueue } from "./queue";
import { connectionState, createTelemetry, sizeBucket, type ImportTelemetry } from "./telemetry";
import type { QueueCoordinator, QueueItemView, QueueLock, UploadTransport } from "./types";

/**
 * The thing that actually gets the files up.
 *
 * The queue knows what exists and what state it is in. The transport knows how
 * to move bytes. This is the part that decides what to do next: which files are
 * eligible, how many at once, when to try again after a failure, what to do
 * when the connection goes, and which tab owns a given file.
 *
 * It holds no durable state of its own. Everything it decides is written back
 * to the queue, so a reload picks up exactly where this left off -- including
 * a backoff that had been deliberately scheduled for two minutes' time.
 *
 * The order it works in, per file:
 *
 *   claim it across tabs -> read the local bytes -> upload, resuming from the
 *   server's offset -> verify the object is really there -> finalize into an
 *   asset -> confirm -> delete the local copy
 *
 * Nothing after "upload" re-sends bytes. A finalization that fails is retried
 * as a finalization, which is the difference between a photographer waiting ten
 * seconds and waiting for 60 MB to go up a second time.
 */

/**
 * How many files upload at once.
 *
 * Two, not more. This is a kerbside uplink shared with a phone hotspot: more
 * streams do not make it faster, they make every progress bar move at a third
 * of the speed and make the first file finish last. Two keeps the link busy
 * while one is waiting on a chunk boundary.
 */
export const DEFAULT_CONCURRENCY = 2;

/**
 * How many times a file is retried before it waits for a person.
 *
 * Six attempts across the default backoff is around two minutes of trying. A
 * connection that has not come back by then is not going to be fixed by asking
 * again, and a row that says "failed - retry" is more use than one that has
 * been quietly retrying since the car park.
 */
export const DEFAULT_MAX_ATTEMPTS = 6;

/** How often a held lease is renewed while a file is uploading. */
const LEASE_RENEW_MS = 5_000;

/**
 * How long a file waits after the connection dropped mid-upload.
 *
 * The online event is what normally makes these due again, and it usually
 * arrives first. This is the backstop for the case the event does not fire, or
 * fires while the connection is still not really usable: a short fixed wait
 * rather than a growing one, because nothing is wrong with the file and the
 * answer could be yes at any moment.
 */
const OFFLINE_RETRY_MS = 5_000;

export interface QueueRunnerOptions {
  readonly queue: ImportQueue;
  readonly transport: UploadTransport;
  readonly coordinator: QueueCoordinator;
  readonly concurrency?: number;
  readonly maxAttempts?: number;
  readonly backoff?: BackoffOptions;
  readonly now?: () => Date;
  readonly online?: () => boolean;
  /** Subscribes to connectivity changes. Returns an unsubscribe. */
  readonly watchOnline?: (handler: (online: boolean) => void) => () => void;
  /** Injected so tests do not wait in real time. */
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
  /**
   * Called once a file has become an asset, with the bytes still to hand.
   *
   * This is where the preview is generated and registered. It runs before the
   * local copy is deleted, because it is the last moment the bytes exist on
   * this machine, and its failure is never allowed to fail the import.
   */
  readonly onFinalized?: (input: {
    item: QueueItemView;
    blob: Blob | null;
    assetId: Id;
  }) => Promise<void>;
  readonly onChange?: (snapshot: QueueSnapshot) => void;
  readonly telemetry?: ImportTelemetry;
}

export interface ItemProgress {
  readonly uploadedBytes: number;
  readonly totalBytes: number;
}

export interface QueueSnapshot {
  readonly items: readonly QueueItemView[];
  readonly progress: ReadonlyMap<string, ItemProgress>;
  readonly online: boolean;
  readonly uploading: number;
  readonly waiting: number;
  readonly failed: number;
  readonly complete: number;
  readonly paused: number;
  readonly needsFile: number;
  readonly totalBytes: number;
  readonly uploadedBytes: number;
}

interface ActiveUpload {
  readonly controller: AbortController;
  readonly lock: QueueLock;
  readonly renewal?: () => void;
}

export class ImportQueueRunner {
  private readonly options: QueueRunnerOptions;
  private readonly active = new Map<string, ActiveUpload>();
  private readonly progress = new Map<string, ItemProgress>();
  private readonly inFlight = new Set<Promise<void>>();
  private running = false;
  private pumping = false;
  private pumpAgain = false;
  /** The cycle in progress, so awaiting pump() means what it says. */
  private current: Promise<void> | null = null;
  private cancelWake: (() => void) | null = null;
  private unwatchOnline: (() => void) | null = null;
  private unsubscribeTabs: (() => void) | null = null;

  private readonly telemetry: ImportTelemetry;
  /** Batches already reported complete, so it is said once. */
  private readonly announced = new Set<string>();

  constructor(options: QueueRunnerOptions) {
    this.options = options;
    this.telemetry = options.telemetry ?? createTelemetry();
  }

  private get concurrency(): number {
    return Math.max(1, this.options.concurrency ?? DEFAULT_CONCURRENCY);
  }

  private get maxAttempts(): number {
    return Math.max(1, this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private isOnline(): boolean {
    return this.options.online?.() ?? true;
  }

  private schedule(run: () => void, delayMs: number): () => void {
    if (this.options.schedule) return this.options.schedule(run, delayMs);
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;

    this.unwatchOnline =
      this.options.watchOnline?.((online) => {
        // Tracked like any other work, so "nothing is happening" means the
        // reconnection has been dealt with too rather than being in flight
        // behind it.
        const work = online ? this.onReconnected() : this.onDisconnected();
        this.inFlight.add(work);
        void work.finally(() => this.inFlight.delete(work));
      }) ?? null;

    // Another tab finishing a file changes what this one should show, and
    // another tab claiming one changes what this one should attempt.
    //
    // Answered locally, and never re-broadcast. Re-broadcasting would be a
    // message from A causing a message from B causing a message from A: two
    // open tabs would talk each other to a standstill, which is exactly what
    // happened the first time this was written.
    this.unsubscribeTabs = this.options.coordinator.subscribe(() => {
      void this.emit({ broadcast: false });
      void this.pump();
    });

    void this.pump();
  }

  /**
   * Stop working, without giving anything up.
   *
   * Uploads are aborted rather than terminated, so their sessions stay valid
   * and the next run resumes from the server's offset. Nothing is marked
   * failed: stopping is not a failure, and a queue that turned red every time
   * a tab closed would be lying about the files.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.cancelWake?.();
    this.cancelWake = null;
    this.unwatchOnline?.();
    this.unwatchOnline = null;
    this.unsubscribeTabs?.();
    this.unsubscribeTabs = null;

    for (const [clientFileId, upload] of [...this.active]) {
      upload.controller.abort();
      upload.renewal?.();
      await upload.lock.release();
      this.active.delete(clientFileId);
    }
  }

  // -------------------------------------------------------------------------
  // Connectivity
  // -------------------------------------------------------------------------

  /**
   * The connection went.
   *
   * Active uploads are aborted so they stop burning a dead socket, and left in
   * a state that resumes rather than one that needs pressing. The distinction
   * the operator sees is "waiting for a connection", not "failed".
   */
  private async onDisconnected(): Promise<void> {
    for (const [clientFileId, upload] of [...this.active]) {
      upload.controller.abort();
      upload.renewal?.();
      await upload.lock.release();
      this.active.delete(clientFileId);
      await this.options.queue.scheduleRetry(
        clientFileId,
        { code: "offline", message: messageFor("offline") },
        this.now().toISOString(),
      );
    }
    await this.emit();
  }

  /** The connection came back. Anything waiting on it becomes due now. */
  private async onReconnected(): Promise<void> {
    const items = await this.options.queue.items();
    for (const item of items) {
      if (item.status === "retrying" && item.errorCode === "offline") {
        await this.options.queue.scheduleRetry(
          item.clientFileId,
          { code: "offline", message: messageFor("offline") },
          this.now().toISOString(),
        );
      }
    }
    await this.emit();
    void this.pump();
  }

  // -------------------------------------------------------------------------
  // The pump
  // -------------------------------------------------------------------------

  /**
   * Start as much work as the concurrency limit allows.
   *
   * Re-entrant calls are folded into the running one rather than queued: every
   * completion calls pump(), and a batch of two hundred files would otherwise
   * build a stack two hundred deep.
   */
  async pump(): Promise<void> {
    if (!this.running) return;

    // Folded into the cycle already running, and awaiting the same promise it
    // does. A caller that awaits pump() means "a cycle has run", and returning
    // early from here would have it mean "a cycle was requested" -- which is
    // how a caller ends up looking at a queue before anything has started.
    if (this.pumping) {
      this.pumpAgain = true;
      return this.current ?? undefined;
    }

    this.pumping = true;
    const cycle = (async () => {
      try {
        do {
          this.pumpAgain = false;
          await this.fill();
        } while (this.pumpAgain);
      } finally {
        this.pumping = false;
        this.current = null;
      }
    })();

    this.current = cycle;
    return cycle;
  }

  private async fill(): Promise<void> {
    if (!this.isOnline()) {
      await this.wakeForNothing();
      return;
    }

    const records = await this.options.queue.items();
    const now = this.now();

    const eligible = records
      .filter((item) => this.isEligible(item, now))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const item of eligible) {
      if (this.active.size >= this.concurrency) break;
      if (this.active.has(item.clientFileId)) continue;
      await this.begin(item);
    }

    await this.armWake(records, now);
  }

  /**
   * Whether this file is work the runner may pick up right now.
   *
   * A file that needs its bytes back is still eligible, exactly once in
   * practice: run() is what converts "the bytes are gone" from a hint on the
   * row into a settled fact. Either verification finds the server already
   * holds them and the file finalizes, or uploadOne() finds bytes nowhere and
   * fails it as file_missing -- a state that waits for the operator and is not
   * eligible, so nothing spins. Skipping such files here is how a browser with
   * no origin private file system left a reloaded upload saying "Retrying"
   * for ever, for work no runner was ever going to touch.
   */
  private isEligible(item: QueueItemView, now: Date): boolean {
    if (this.active.has(item.clientFileId)) return false;
    if (!isDue(item.nextAttemptAt, now)) return false;

    switch (item.status) {
      case "staged":
      case "retrying":
      case "pending":
        return true;
      case "uploaded":
        // The bytes are the server's. This is a finalization, and it does not
        // need a local copy at all.
        return true;
      case "uploading":
      case "finalizing":
        // Left mid-flight by a tab that is no longer here. This one is only
        // reached when `active` does not already hold the file, and the
        // cross-tab lock in begin() is what decides whether it is really
        // abandoned or whether another tab is still working on it.
        return true;
      default:
        return false;
    }
  }

  /** Sleep until the next scheduled attempt, so a backoff actually fires. */
  private async armWake(items: readonly QueueItemView[], now: Date): Promise<void> {
    this.cancelWake?.();
    this.cancelWake = null;

    const due = items
      .filter((item) => item.status === "retrying" && item.nextAttemptAt)
      .map((item) => new Date(item.nextAttemptAt!).getTime())
      .filter((time) => Number.isFinite(time) && time > now.getTime())
      .sort((a, b) => a - b)[0];

    if (due === undefined) return;
    this.cancelWake = this.schedule(() => void this.pump(), Math.max(0, due - now.getTime()));
  }

  private async wakeForNothing(): Promise<void> {
    this.cancelWake?.();
    this.cancelWake = null;
  }

  // -------------------------------------------------------------------------
  // One file
  // -------------------------------------------------------------------------

  private async begin(item: QueueItemView): Promise<void> {
    // Across tabs and within this one: exactly one worker per file. A second
    // writer to the same TUS session is answered with 409, which would be
    // reported as a conflict for a file that was uploading perfectly well.
    const lock = await this.options.coordinator.acquire(item.clientFileId);
    if (!lock) return;

    // The lock is held, so nothing else is working on this file: anything left
    // `uploading` or `finalizing` belongs to a tab that is gone, and is ours to
    // pick up.
    const claimed = await this.options.queue.reclaim(item.clientFileId);

    const controller = new AbortController();
    const renewal = this.keepLease(lock, controller);
    this.active.set(item.clientFileId, { controller, lock, renewal });

    const work = this.run(claimed, controller)
      .catch(async (error) => {
        await this.options.queue.fail(item.clientFileId, { code: "unknown", message: error });
      })
      .finally(async () => {
        renewal?.();
        this.active.delete(item.clientFileId);
        await lock.release();
        this.inFlight.delete(work);
        await this.emit();
        void this.pump();
      });

    this.inFlight.add(work);
  }

  /**
   * Keep a lease alive while an upload runs.
   *
   * Only the fallback needs this -- a Web Lock is held by the browser until the
   * tab lets go or stops existing. If a renewal fails the lease was taken over,
   * which means another tab believes it owns this file, so this one stops
   * immediately rather than both of them uploading.
   */
  private keepLease(lock: QueueLock, controller: AbortController): (() => void) | undefined {
    if (this.options.coordinator.kind !== "lease") return undefined;

    let stopped = false;
    const tick = () => {
      if (stopped) return;
      void lock.renew().then((held) => {
        if (stopped) return;
        if (!held) return controller.abort();
        stop = this.schedule(tick, LEASE_RENEW_MS);
      });
    };
    let stop = this.schedule(tick, LEASE_RENEW_MS);

    return () => {
      stopped = true;
      stop();
    };
  }

  private async run(original: QueueItemView, controller: AbortController): Promise<void> {
    // Registered first, always.
    //
    // A batch queued with no signal has no server row, and uploading one of its
    // files anyway produces bytes in a bucket that nothing points at -- and
    // then a hard throw at finalization, which turned "waiting for a
    // connection" into a permanently failed file. Registration is idempotent,
    // so asking again costs nothing and is the whole recovery.
    const item = await this.ensureRegistered(original);
    if (!item) return;

    // A file whose bytes the server already holds skips straight to
    // finalization. So does one that a verification says already landed --
    // which is what a 409, or a lost response, looks like from here.
    if (item.status !== "uploaded") {
      const reconciled = await this.reconcile(item);
      if (reconciled === "finalize") return this.finalize(item.clientFileId);
      if (reconciled === "stop") return;
      if (!(await this.uploadOne(item, controller))) return;
    }

    await this.finalize(item.clientFileId);
  }

  /**
   * Make sure Mastline knows about this file before any bytes move.
   *
   * Returns null when it still does not, having scheduled another attempt. That
   * is the offline case, and it is a wait rather than a failure: the files are
   * staged on this machine and the batch registers itself the moment there is a
   * connection.
   */
  private async ensureRegistered(item: QueueItemView): Promise<QueueItemView | null> {
    if (item.importFileId) return item;

    await this.options.queue.register(item.batchId);
    const fresh = await this.options.queue.item(item.clientFileId);
    if (fresh?.importFileId) return fresh;

    const attempts = item.attemptCount + 1;
    await this.options.queue.scheduleRetry(
      item.clientFileId,
      {
        code: this.isOnline() ? "server_unavailable" : "offline",
        message: this.isOnline()
          ? "Waiting to reach Mastline. These files are safe on this device."
          : messageFor("offline"),
      },
      new Date(
        this.now().getTime() +
          (this.isOnline() ? backoffDelay(attempts, this.options.backoff) : OFFLINE_RETRY_MS),
      ).toISOString(),
    );
    return null;
  }

  /**
   * Check, before uploading, whether this file is already up.
   *
   * Only asked when there is a reason to think so: a session was started, or an
   * attempt has already been made. A fresh file goes straight to the upload
   * rather than paying a round trip to be told what is obvious.
   */
  private async reconcile(item: QueueItemView): Promise<"upload" | "finalize" | "stop"> {
    const worthAsking = Boolean(item.uploadUrl) || item.attemptCount > 0;
    if (!worthAsking) return "upload";

    const verified = await this.options.queue.verifyUpload(item.clientFileId);
    if (!verified) return "upload";

    if (verified.alreadyFinalized && verified.assetId) {
      // Finished, and this device never heard. Adopt it rather than importing
      // the same frame twice.
      await this.options.queue.finalize(item.clientFileId);
      return "stop";
    }

    if (verified.exists && verified.matches) {
      await this.options.queue.markUploaded(item.clientFileId, item.sha256);
      return "finalize";
    }

    return "upload";
  }

  private async uploadOne(item: QueueItemView, controller: AbortController): Promise<boolean> {
    const queue = this.options.queue;

    const blob = await queue.bytesFor(item.clientFileId);
    if (!blob) {
      // Nothing on this machine and nothing on the server. Only the operator
      // can fix this, so it stops here rather than retrying into nothing.
      await queue.fail(item.clientFileId, {
        code: "file_missing",
        message: messageFor("file_missing"),
      });
      return false;
    }

    // The digest normally exists before anything moves. When enqueue could not
    // read the file to compute one -- WebKit refuses File reads while offline
    // -- it is taken here, from the same bytes that are about to travel.
    const sha256 = item.sha256 ?? (await queue.ensureDigest(item.clientFileId, blob));
    if (!sha256) {
      await queue.fail(item.clientFileId, {
        code: "unknown",
        message: "This file could not be read from the device. Select it again to import it.",
      });
      return false;
    }

    const uploading = await queue.markUploading(item.clientFileId);
    this.progress.set(item.clientFileId, { uploadedBytes: 0, totalBytes: blob.size });
    await this.emit();

    const resumeUrl = queue.resumableUrlFor(uploading, this.now());
    const elapsed = this.telemetry.timer();
    this.telemetry.emit("upload_started", {
      workspaceId: item.organizationId,
      batchId: item.batchId,
      importFileId: item.importFileId,
      sizeBucket: sizeBucket(item.byteSize),
      attempt: uploading.attemptCount,
      resumed: Boolean(resumeUrl),
      connection: connectionState(),
    });

    const result = await this.options.transport.upload({
      item: uploading,
      blob,
      resumeUrl,
      onUploadUrl: (url) => void queue.recordUploadSession(item.clientFileId, url),
      onProgress: (uploadedBytes, totalBytes) => {
        this.progress.set(item.clientFileId, { uploadedBytes, totalBytes });
        this.options.onChange?.(this.buildSnapshot(undefined));
      },
      onChunk: (uploadedBytes) => void queue.recordProgress(item.clientFileId, uploadedBytes),
      signal: controller.signal,
    });

    if (result.ok) {
      this.telemetry.emit("upload_completed", {
        workspaceId: item.organizationId,
        batchId: item.batchId,
        importFileId: item.importFileId,
        sizeBucket: sizeBucket(item.byteSize),
        attempt: uploading.attemptCount,
        durationMs: elapsed(),
        resumed: Boolean(resumeUrl),
      });
      await queue.markUploaded(item.clientFileId, sha256);
      return true;
    }

    await this.handleFailure(item, result.failure);
    return false;
  }

  /**
   * Decide what a failure means for this file.
   *
   * Three outcomes, and keeping them apart is the whole point:
   *
   *   * a session that expired is rebuilt at once -- it says nothing about the
   *     file, and treating it as a failure would be telling a photographer to
   *     retry something that was never broken;
   *   * a transient failure is retried on a bounded, jittered backoff;
   *   * anything a retry cannot fix -- a refusal, a quota, a file the bucket
   *     will not take -- stops and says so, rather than spending the rest of
   *     the night asking.
   */
  private async handleFailure(item: QueueItemView, failure: UploadFailure): Promise<void> {
    const queue = this.options.queue;

    if (failure.restartSession) {
      await queue.clearUploadSession(item.clientFileId);
      await queue.scheduleRetry(
        item.clientFileId,
        { code: failure.code, message: failure.message },
        this.now().toISOString(),
      );
      return;
    }

    if (failure.code === "object_conflict") {
      // Something is at that path. Almost always this same file, finished.
      const verified = await queue.verifyUpload(item.clientFileId);
      if (verified?.alreadyFinalized || (verified?.exists && verified.matches)) {
        await queue.markUploaded(item.clientFileId, item.sha256);
        await this.finalize(item.clientFileId);
        return;
      }
    }

    const attempts = item.attemptCount + 1;
    const shared = {
      workspaceId: item.organizationId,
      batchId: item.batchId,
      importFileId: item.importFileId,
      errorCode: failure.code,
      attempt: attempts,
      connection: connectionState(),
    };

    if (failure.retryable && attempts < this.maxAttempts) {
      this.telemetry.emit("upload_retry_scheduled", shared);
      // A server that said when to come back is obeyed. Guessing over the top
      // of an explicit Retry-After is how a client keeps hitting a rate limit
      // it was politely asked to stop hitting.
      const delay =
        failure.retryAfterMs !== undefined
          ? failure.retryAfterMs
          : failure.code === "offline"
            ? OFFLINE_RETRY_MS
            : backoffDelay(attempts, this.options.backoff);
      await queue.scheduleRetry(
        item.clientFileId,
        { code: failure.code, message: failure.message },
        new Date(this.now().getTime() + delay).toISOString(),
      );
      return;
    }

    await queue.fail(item.clientFileId, {
      code: failure.code,
      message: failure.retryable ? `${failure.message} Tried ${attempts} times.` : failure.message,
    });
  }

  /**
   * A finalization that did not succeed.
   *
   * Deliberately not routed through handleFailure: that one reconciles an
   * object conflict by finalizing again, which for a conflict raised *by*
   * finalization would be a loop. Here a conflict is terminal and says so.
   */
  private async handleFinalizationFailure(
    clientFileId: string,
    attempts: number,
    failure: UploadFailure,
  ): Promise<void> {
    const item = await this.options.queue.item(clientFileId);
    this.telemetry.emit("finalization_failed", {
      workspaceId: item?.organizationId,
      batchId: item?.batchId,
      importFileId: item?.importFileId,
      errorCode: failure.code,
      attempt: attempts + 1,
    });

    if (failure.retryable && attempts + 1 < this.maxAttempts) {
      await this.options.queue.scheduleRetry(
        clientFileId,
        { code: failure.code, message: failure.message },
        new Date(
          this.now().getTime() + backoffDelay(attempts + 1, this.options.backoff),
        ).toISOString(),
      );
      return;
    }

    await this.options.queue.fail(clientFileId, {
      code: failure.code,
      message: failure.message,
    });
  }

  /**
   * Verify, finalize, hand over the preview, then clean up.
   *
   * The verification is not ceremony. TUS reporting success means this client
   * believes every chunk was accepted; it is not evidence that an object
   * exists, and an asset record pointing at nothing is worse than a file that
   * has to be uploaded again.
   */
  private async finalize(clientFileId: string): Promise<void> {
    const queue = this.options.queue;

    const verified = await queue.verifyUpload(clientFileId);
    if (verified && !verified.alreadyFinalized && !verified.exists) {
      const item = await queue.item(clientFileId);
      await this.handleFailure(item!, {
        code: "server_unavailable",
        message: "The upload finished but the file is not in storage yet.",
        retryable: true,
      });
      return;
    }

    // The bytes are still on this machine at this point, and this is the last
    // moment they are: the preview is made from them before cleanup.
    const blob = await queue.bytesFor(clientFileId);
    const finalized = await queue.finalize(clientFileId);

    if (finalized.status !== "complete" || !finalized.assetId) {
      if (finalized.status === "failed") {
        // Uploaded, not finalized. Classified rather than retried on reflex:
        // the commonest finalization failure is "this frame is already on this
        // shoot", which no amount of retrying will change and which -- because
        // a failed finalization removes the staged object -- costs a complete
        // re-upload every time it is tried.
        await this.handleFinalizationFailure(
          clientFileId,
          finalized.attemptCount,
          classifyFinalizationFailure({
            errorCode: finalized.errorCode,
            message: finalized.errorMessage,
          }),
        );
      }
      return;
    }

    // Announced the moment it is true, and before the cleanup that removes the
    // record. Waiting for the confirmation round trip would mean the interface
    // never showed the file as imported at all -- it would simply vanish.
    await this.emit();

    if (this.options.onFinalized) {
      try {
        await this.options.onFinalized({ item: finalized, blob, assetId: finalized.assetId });
      } catch {
        // A missing preview costs a thumbnail, never a frame.
      }
    }

    this.telemetry.emit("import_file_completed", {
      workspaceId: finalized.organizationId,
      batchId: finalized.batchId,
      importFileId: finalized.importFileId,
      sizeBucket: sizeBucket(finalized.byteSize),
      attempt: finalized.attemptCount,
    });

    // Only now, and only if the server vouches for the object and the asset.
    await queue.confirmAndCleanup(clientFileId);
    this.progress.delete(clientFileId);
    await this.announceBatchIfDone(finalized.batchId);
  }

  // -------------------------------------------------------------------------
  // What the interface can ask for
  // -------------------------------------------------------------------------

  /**
   * Say the batch is done, once.
   *
   * Completed files are cleaned up, so "done" is the absence of anything still
   * in flight rather than a count reaching a total.
   */
  private async announceBatchIfDone(batchId: Id): Promise<void> {
    if (this.announced.has(batchId)) return;

    const items = await this.options.queue.itemsFor(batchId);
    const outstanding = items.filter(
      (item) =>
        item.status !== "complete" && item.status !== "canceled" && item.status !== "failed",
    );
    if (outstanding.length > 0) return;

    this.announced.add(batchId);
    this.telemetry.emit("import_batch_completed", {
      batchId,
      fileCount: items.length,
      completedCount: items.filter((item) => item.status === "complete").length,
      failedCount: items.filter((item) => item.status === "failed").length,
    });
  }

  async pauseItem(clientFileId: string): Promise<void> {
    // The server's id, not the local one: a client file id is a handle to
    // something on this machine and has no meaning to anyone reading this back.
    const item = await this.options.queue.item(clientFileId);
    this.telemetry.emit("upload_paused", {
      workspaceId: item?.organizationId,
      batchId: item?.batchId,
      importFileId: item?.importFileId,
    });

    const active = this.active.get(clientFileId);
    // Aborted, not terminated: the session survives, so resuming continues
    // from the server's offset instead of byte zero.
    active?.controller.abort();
    await this.options.queue.pause(clientFileId);
    await this.emit();
  }

  async resumeItem(clientFileId: string): Promise<void> {
    const item = await this.options.queue.item(clientFileId);
    this.telemetry.emit("upload_resumed", {
      workspaceId: item?.organizationId,
      batchId: item?.batchId,
      importFileId: item?.importFileId,
      connection: connectionState(),
    });

    await this.options.queue.resume(clientFileId);
    await this.emit();
    void this.pump();
  }

  async pauseBatch(batchId: Id): Promise<void> {
    for (const item of await this.options.queue.itemsFor(batchId)) {
      if (item.status === "complete" || item.status === "canceled" || item.status === "paused") {
        continue;
      }
      this.active.get(item.clientFileId)?.controller.abort();
      await this.options.queue.pause(item.clientFileId);
    }
    await this.emit();
  }

  async resumeBatch(batchId: Id): Promise<void> {
    for (const item of await this.options.queue.itemsFor(batchId)) {
      if (item.status === "paused") await this.options.queue.resume(item.clientFileId);
    }
    await this.emit();
    void this.pump();
  }

  /** One failed file, tried again now. */
  async retryItem(clientFileId: string): Promise<void> {
    await this.options.queue.resume(clientFileId);
    await this.emit();
    void this.pump();
  }

  /**
   * Every failed file, tried again now.
   *
   * Only the failed ones. A batch where three files failed and ninety-seven
   * succeeded must not restart the ninety-seven, which is why this reads the
   * status rather than the batch.
   */
  async retryFailed(batchId?: Id): Promise<number> {
    const items = batchId
      ? await this.options.queue.itemsFor(batchId)
      : await this.options.queue.items();

    let retried = 0;
    for (const item of items) {
      if (item.status !== "failed") continue;
      if (item.needsFile) continue; // Nothing to retry with. The operator holds it.
      await this.options.queue.resume(item.clientFileId);
      retried += 1;
    }

    await this.emit();
    void this.pump();
    return retried;
  }

  async cancelItem(clientFileId: string): Promise<void> {
    const active = this.active.get(clientFileId);
    active?.controller.abort();

    const item = await this.options.queue.item(clientFileId);
    await this.options.queue.cancel(clientFileId);

    // Give the half-finished session back rather than leaving it to expire.
    if (item?.uploadUrl && this.options.transport.discard) {
      await this.options.transport.discard({ uploadUrl: item.uploadUrl });
    }

    this.progress.delete(clientFileId);
    await this.emit();
    void this.pump();
  }

  /**
   * Resolves when nothing is in flight.
   *
   * The interface uses it to know when a batch has stopped moving; tests use it
   * to know when to look. It loops rather than awaiting once, because finishing
   * one file is what starts the next.
   */
  async idle(): Promise<void> {
    // Bounded, because "wait until nothing is happening" and "loop forever" are
    // the same program when something keeps rescheduling itself.
    for (let guard = 0; guard < 5_000; guard += 1) {
      // Finishing one file is what makes the next one eligible, so a pump is
      // part of settling rather than something that happens after it.
      await this.pump();
      if (this.inFlight.size === 0) return;
      await Promise.all([...this.inFlight]);
      await Promise.resolve();
    }
  }

  progressFor(clientFileId: string): ItemProgress | undefined {
    return this.progress.get(clientFileId);
  }

  async snapshot(batchId?: Id): Promise<QueueSnapshot> {
    const items = batchId
      ? await this.options.queue.itemsFor(batchId)
      : await this.options.queue.items();
    return this.buildSnapshot(items);
  }

  private lastItems: readonly QueueItemView[] = [];

  private buildSnapshot(items: readonly QueueItemView[] | undefined): QueueSnapshot {
    const list = items ?? this.lastItems;
    if (items) this.lastItems = items;

    const uploadedBytes = list.reduce((total, item) => {
      if (item.status === "complete") return total + item.byteSize;
      const live = this.progress.get(item.clientFileId);
      return total + (live?.uploadedBytes ?? item.uploadedBytes ?? 0);
    }, 0);

    return {
      items: list,
      progress: new Map(this.progress),
      online: this.isOnline(),
      uploading: list.filter((item) => item.status === "uploading").length,
      waiting: list.filter(
        (item) =>
          item.status === "staged" || item.status === "pending" || item.status === "retrying",
      ).length,
      failed: list.filter((item) => item.status === "failed").length,
      complete: list.filter((item) => item.status === "complete").length,
      paused: list.filter((item) => item.status === "paused").length,
      needsFile: list.filter((item) => item.needsFile).length,
      totalBytes: list.reduce((total, item) => total + item.byteSize, 0),
      uploadedBytes,
    };
  }

  /**
   * Tell this tab's interface, and optionally the other tabs.
   *
   * The two are separate on purpose. Every change this runner makes is worth
   * telling the other tabs about; a change another tab told this one about is
   * not, or the two of them would bounce the same message between themselves
   * indefinitely.
   */
  private async emit(options: { broadcast: boolean } = { broadcast: true }): Promise<void> {
    const snapshot = await this.snapshot();
    this.options.onChange?.(snapshot);
    if (!options.broadcast) return;
    this.options.coordinator.publish({
      kind: "changed",
      ownerId: this.options.coordinator.ownerId,
    });
  }
}

/**
 * Whether a failure is one a person has to resolve.
 *
 * The interface uses this to decide between offering a Retry button and
 * explaining what has to change first: retrying a quota or a refusal is not a
 * remedy, it is the same failure again a moment later.
 */
export function needsPerson(code: string | undefined): boolean {
  return Boolean(code) && !isRetryable(code as UploadFailureCode);
}
