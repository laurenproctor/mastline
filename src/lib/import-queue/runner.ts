import type { Id } from "@/lib/domain";
import { backoffDelay, isDue, type BackoffOptions } from "./backoff";
import { isRetryable, messageFor, type UploadFailure, type UploadFailureCode } from "./failure";
import type { ImportQueue } from "./queue";
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
  private cancelWake: (() => void) | null = null;
  private unwatchOnline: (() => void) | null = null;
  private unsubscribeTabs: (() => void) | null = null;

  constructor(options: QueueRunnerOptions) {
    this.options = options;
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
        if (online) void this.onReconnected();
        else void this.onDisconnected();
      }) ?? null;

    // Another tab finishing a file changes what this one should show, and
    // another tab claiming one changes what this one should attempt.
    this.unsubscribeTabs = this.options.coordinator.subscribe(() => {
      void this.publish();
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
    await this.publish();
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
    await this.publish();
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
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }

    this.pumping = true;
    try {
      do {
        this.pumpAgain = false;
        await this.fill();
      } while (this.pumpAgain);
    } finally {
      this.pumping = false;
    }
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
   * A file needing its bytes back is not eligible however many times it is
   * retried: only the operator can fix it, and spinning on it would push a real
   * failure off the top of the list.
   */
  private isEligible(item: QueueItemView, now: Date): boolean {
    if (this.active.has(item.clientFileId)) return false;
    if (!isDue(item.nextAttemptAt, now)) return false;

    switch (item.status) {
      case "staged":
      case "retrying":
        return !item.needsFile;
      case "pending":
        // Never staged -- OPFS refused it -- but this tab still holds the File.
        return !item.needsFile && item.stagingState !== "missing";
      case "uploaded":
        // The bytes are the server's. This is a finalization, and it does not
        // need a local copy at all.
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

    const controller = new AbortController();
    const renewal = this.keepLease(lock, controller);
    this.active.set(item.clientFileId, { controller, lock, renewal });

    const work = this.run(item, controller)
      .catch(async (error) => {
        await this.options.queue.fail(item.clientFileId, { code: "unknown", message: error });
      })
      .finally(async () => {
        renewal?.();
        this.active.delete(item.clientFileId);
        await lock.release();
        this.inFlight.delete(work);
        await this.publish();
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

  private async run(item: QueueItemView, controller: AbortController): Promise<void> {
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

    const uploading = await queue.markUploading(item.clientFileId);
    this.progress.set(item.clientFileId, { uploadedBytes: 0, totalBytes: blob.size });
    await this.publish();

    const result = await this.options.transport.upload({
      item: uploading,
      blob,
      resumeUrl: queue.resumableUrlFor(uploading, this.now()),
      onUploadUrl: (url) => void queue.recordUploadSession(item.clientFileId, url),
      onProgress: (uploadedBytes, totalBytes) => {
        this.progress.set(item.clientFileId, { uploadedBytes, totalBytes });
        this.options.onChange?.(this.buildSnapshot(undefined));
      },
      onChunk: (uploadedBytes) => void queue.recordProgress(item.clientFileId, uploadedBytes),
      signal: controller.signal,
    });

    if (result.ok) {
      await queue.markUploaded(item.clientFileId, item.sha256);
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
    if (failure.retryable && attempts < this.maxAttempts) {
      const delay =
        failure.code === "offline" ? 0 : backoffDelay(attempts, this.options.backoff);
      await queue.scheduleRetry(
        item.clientFileId,
        { code: failure.code, message: failure.message },
        new Date(this.now().getTime() + delay).toISOString(),
      );
      return;
    }

    await queue.fail(item.clientFileId, {
      code: failure.code,
      message: failure.retryable
        ? `${failure.message} Tried ${attempts} times.`
        : failure.message,
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
        // Uploaded, not finalized. Retried as a finalization: the bytes are in
        // the bucket and are never sent again.
        await queue.scheduleRetry(
          clientFileId,
          {
            code: "finalization_failed",
            message: finalized.errorMessage ?? "Could not record the import.",
          },
          new Date(
            this.now().getTime() + backoffDelay(finalized.attemptCount, this.options.backoff),
          ).toISOString(),
        );
      }
      return;
    }

    if (this.options.onFinalized) {
      try {
        await this.options.onFinalized({ item: finalized, blob, assetId: finalized.assetId });
      } catch {
        // A missing preview costs a thumbnail, never a frame.
      }
    }

    // Only now, and only if the server vouches for the object and the asset.
    await queue.confirmAndCleanup(clientFileId);
    this.progress.delete(clientFileId);
  }

  // -------------------------------------------------------------------------
  // What the interface can ask for
  // -------------------------------------------------------------------------

  async pauseItem(clientFileId: string): Promise<void> {
    const active = this.active.get(clientFileId);
    // Aborted, not terminated: the session survives, so resuming continues
    // from the server's offset instead of byte zero.
    active?.controller.abort();
    await this.options.queue.pause(clientFileId);
    await this.publish();
  }

  async resumeItem(clientFileId: string): Promise<void> {
    await this.options.queue.resume(clientFileId);
    await this.publish();
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
    await this.publish();
  }

  async resumeBatch(batchId: Id): Promise<void> {
    for (const item of await this.options.queue.itemsFor(batchId)) {
      if (item.status === "paused") await this.options.queue.resume(item.clientFileId);
    }
    await this.publish();
    void this.pump();
  }

  /** One failed file, tried again now. */
  async retryItem(clientFileId: string): Promise<void> {
    await this.options.queue.resume(clientFileId);
    await this.publish();
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

    await this.publish();
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
    await this.publish();
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
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
      // A completion schedules the next pump on a microtask; give it one.
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
        (item) => item.status === "staged" || item.status === "pending" || item.status === "retrying",
      ).length,
      failed: list.filter((item) => item.status === "failed").length,
      complete: list.filter((item) => item.status === "complete").length,
      paused: list.filter((item) => item.status === "paused").length,
      needsFile: list.filter((item) => item.needsFile).length,
      totalBytes: list.reduce((total, item) => total + item.byteSize, 0),
      uploadedBytes,
    };
  }

  private async publish(): Promise<void> {
    const snapshot = await this.snapshot();
    this.options.onChange?.(snapshot);
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
