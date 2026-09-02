import type { Id, ImportFileStatus } from "@/lib/domain";
import type { UploadFailure } from "./failure";
import { importStoragePath, opfsPathString } from "./paths";
import type { TusPreviousUpload, TusUploadFactory, TusUploadOptions } from "./tus-transport";
import type {
  FinalizeOutcome,
  ImportBatchState,
  ImportConfirmation,
  ImportServerAdapter,
  RegisteredFile,
  RegisterFileInput,
  StagedUpload,
  QueueBroadcast,
  QueueCoordinator,
  QueueLock,
  StagedPath,
  StagingArea,
  StorageCapacity,
  UploadRequest,
  UploadResult,
  UploadTransport,
} from "./types";

/**
 * Doubles for the four things the queue depends on a browser or a server for.
 *
 * These live in src/ rather than in a test folder because they are part of the
 * adapter contract: anything implementing StagingArea has to behave like the
 * memory one below, and a transport has to be as unforgiving about idempotency
 * as the fake server is. They are the executable half of the interface
 * documentation.
 */

// ---------------------------------------------------------------------------
// A staging area in a Map
// ---------------------------------------------------------------------------

export class MemoryStagingArea implements StagingArea {
  readonly files = new Map<string, Blob>();
  /** Paths that refuse to be written, to exercise the unstaged path. */
  readonly refuse = new Set<string>();
  /** Set to simulate a full origin. */
  quotaExceeded = false;

  constructor(readonly available: boolean = true) {}

  private key(path: StagedPath): string {
    return opfsPathString(path);
  }

  async stage(path: StagedPath, blob: Blob): Promise<void> {
    const key = this.key(path);
    if (this.quotaExceeded) throw new Error("The quota for this origin has been exceeded.");
    if (this.refuse.has(key)) throw new Error("This browser refused to write the staged copy.");
    this.files.set(key, blob);
  }

  async read(path: StagedPath): Promise<Blob | null> {
    return this.files.get(this.key(path)) ?? null;
  }

  async exists(path: StagedPath): Promise<boolean> {
    return this.files.has(this.key(path));
  }

  async remove(path: StagedPath): Promise<void> {
    this.files.delete(this.key(path));
  }

  async removeBatch(organizationId: Id, batchId: Id): Promise<void> {
    const prefix = `mastline-imports/${organizationId}/${batchId}/`;
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(prefix)) this.files.delete(key);
    }
  }

  /** Simulate the browser evicting the origin's storage. */
  evictEverything(): void {
    this.files.clear();
  }
}

// ---------------------------------------------------------------------------
// A storage manager that answers whatever the test needs
// ---------------------------------------------------------------------------

export class FakeStorageCapacity implements StorageCapacity {
  persistGranted = true;
  isPersisted = false;
  persistCalls = 0;

  constructor(
    private readonly quota: number | undefined = 10 * 1024 * 1024 * 1024,
    private readonly usage: number = 0,
  ) {}

  async estimate(): Promise<{ quota?: number; usage?: number }> {
    return { quota: this.quota, usage: this.usage };
  }

  async persisted(): Promise<boolean> {
    return this.isPersisted;
  }

  async persist(): Promise<boolean> {
    this.persistCalls += 1;
    this.isPersisted = this.persistGranted;
    return this.persistGranted;
  }
}

// ---------------------------------------------------------------------------
// A server that enforces the same idempotency the database does
// ---------------------------------------------------------------------------

interface FakeFile {
  importFileId: Id;
  clientFileId: string;
  status: ImportFileStatus;
  storagePath: string;
  assetId?: Id;
  errorCode?: string;
  errorMessage?: string;
}

export class FakeImportServer implements ImportServerAdapter {
  readonly batches = new Map<string, { batchId: Id; shootId: Id; files: FakeFile[] }>();
  /** Object keys the fake storage holds. Cleared to test unconfirmed cleanup. */
  readonly storedObjects = new Set<string>();
  /** The size storage believes each object is, for verification mismatches. */
  readonly storedSizes = new Map<string, number>();
  /** The registered size of each file, which verification compares against. */
  readonly expectedBytes = new Map<string, number>();
  readonly assets = new Set<Id>();
  /** Every finalize call, so a test can prove a repeat created nothing. */
  finalizeCalls = 0;
  assetsCreated = 0;
  offline = false;

  constructor(readonly organizationId: Id = "00000000-0000-4000-8000-000000000001") {}

  private guard(): void {
    if (this.offline) throw new Error("Network request failed.");
  }

  async registerBatch(input: { shootId: Id; idempotencyKey: string }) {
    this.guard();
    const existing = this.batches.get(input.idempotencyKey);
    if (existing) return { batchId: existing.batchId, organizationId: this.organizationId };

    this.batches.set(input.idempotencyKey, {
      batchId: input.idempotencyKey,
      shootId: input.shootId,
      files: [],
    });
    return { batchId: input.idempotencyKey, organizationId: this.organizationId };
  }

  async registerFiles(input: {
    batchId: Id;
    files: readonly RegisterFileInput[];
  }): Promise<readonly RegisteredFile[]> {
    this.guard();
    const batch = this.batches.get(input.batchId);
    if (!batch) throw new Error("No such batch.");

    for (const file of input.files) {
      // Registered once. A repeat finds the row it made and changes nothing.
      if (batch.files.some((row) => row.clientFileId === file.clientFileId)) continue;
      const importFileId = `if-${batch.files.length + 1}-${file.clientFileId}`;
      this.expectedBytes.set(importFileId, file.byteSize);
      batch.files.push({
        importFileId,
        clientFileId: file.clientFileId,
        status: "pending",
        storagePath: importStoragePath(this.organizationId, input.batchId, file.clientFileId),
      });
    }

    const wanted = new Set(input.files.map((file) => file.clientFileId));
    return batch.files
      .filter((row) => wanted.has(row.clientFileId))
      .map((row) => ({
        clientFileId: row.clientFileId,
        importFileId: row.importFileId,
        storageBucket: "originals" as const,
        storagePath: row.storagePath,
        status: row.status,
        assetId: row.assetId,
      }));
  }

  private find(importFileId: Id): FakeFile | undefined {
    for (const batch of this.batches.values()) {
      const file = batch.files.find((row) => row.importFileId === importFileId);
      if (file) return file;
    }
    return undefined;
  }

  readonly attemptsSeen = new Map<string, number>();

  async markUploaded(input: { importFileId: Id; sha256: string; attemptCount?: number }) {
    this.guard();
    const file = this.find(input.importFileId);
    if (!file) throw new Error("No such import file.");
    if (typeof input.attemptCount === "number") {
      this.attemptsSeen.set(input.importFileId, input.attemptCount);
    }
    if (file.status !== "complete") file.status = "uploaded";
    // Deliberately not adding the object to storage: saying the bytes arrived
    // is not the same as the bytes arriving, and the whole point of the
    // verification step is that the two can disagree.
    return { status: file.status };
  }

  async finalize(input: { importFileId: Id }): Promise<FinalizeOutcome> {
    this.guard();
    this.finalizeCalls += 1;

    const file = this.find(input.importFileId);
    if (!file) return { ok: false, errorCode: "not_found", error: "No such import file." };

    // The property the database guarantees, reproduced here: an import file
    // holds one asset forever, so a repeat returns it rather than making more.
    if (file.assetId) return { ok: true, assetId: file.assetId, alreadyComplete: true };

    file.assetId = `asset-${++this.assetsCreated}`;
    file.status = "complete";
    this.assets.add(file.assetId);
    this.storedObjects.add(`canonical/${file.assetId}`);
    return { ok: true, assetId: file.assetId };
  }

  /** What storage holds at the staged path, as far as this fake is concerned. */
  async verifyUpload(input: { importFileId: Id }): Promise<StagedUpload> {
    this.guard();
    const file = this.find(input.importFileId);
    if (!file) throw new Error("No such import file.");

    const expectedBytes = this.expectedBytes.get(file.importFileId) ?? 0;
    if (file.assetId) {
      return {
        exists: false,
        expectedBytes,
        matches: false,
        alreadyFinalized: true,
        assetId: file.assetId,
      };
    }

    const exists = this.storedObjects.has(file.storagePath);
    const byteSize = exists ? (this.storedSizes.get(file.storagePath) ?? expectedBytes) : undefined;
    return {
      exists,
      byteSize,
      expectedBytes,
      matches: exists && byteSize === expectedBytes,
      alreadyFinalized: false,
    };
  }

  async confirm(input: { importFileId: Id }): Promise<ImportConfirmation> {
    this.guard();
    const file = this.find(input.importFileId);
    if (!file || !file.assetId || file.status !== "complete") {
      return { complete: false, assetExists: false, objectExists: false };
    }
    return {
      complete: true,
      assetExists: this.assets.has(file.assetId),
      objectExists: this.storedObjects.has(`canonical/${file.assetId}`),
      assetId: file.assetId,
    };
  }

  async cancel(input: { importFileIds: readonly Id[] }): Promise<void> {
    this.guard();
    for (const id of input.importFileIds) {
      const file = this.find(id);
      if (file && file.status !== "complete") file.status = "canceled";
    }
  }

  async batchState(input: { batchId: Id }): Promise<ImportBatchState | null> {
    this.guard();
    const batch = this.batches.get(input.batchId);
    if (!batch) return null;
    return {
      batchId: batch.batchId,
      organizationId: this.organizationId,
      shootId: batch.shootId,
      status: "uploading",
      totalFiles: batch.files.length,
      completedFiles: batch.files.filter((file) => file.status === "complete").length,
      failedFiles: batch.files.filter((file) => file.status === "failed").length,
      files: batch.files.map((file) => ({
        importFileId: file.importFileId,
        clientFileId: file.clientFileId,
        status: file.status,
        storagePath: file.storagePath,
        assetId: file.assetId,
        errorCode: file.errorCode,
        errorMessage: file.errorMessage,
      })),
    };
  }

  async noteRetry(input: {
    importFileId: Id;
    attemptCount: number;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    this.guard();
    this.attemptsSeen.set(input.importFileId, input.attemptCount);
    const file = this.find(input.importFileId);
    if (!file || file.status === "complete") return;
    file.status = "retrying";
    file.errorCode = input.errorCode;
    file.errorMessage = input.errorMessage;
  }

  async reportFailure(input: {
    importFileId: Id;
    errorCode: string;
    errorMessage: string;
    attemptCount?: number;
  }): Promise<void> {
    this.guard();
    if (typeof input.attemptCount === "number") {
      this.attemptsSeen.set(input.importFileId, input.attemptCount);
    }
    const file = this.find(input.importFileId);
    if (!file) return;
    file.status = "failed";
    file.errorCode = input.errorCode;
    file.errorMessage = input.errorMessage;
  }
}

// ---------------------------------------------------------------------------
// Just enough IndexedDB
// ---------------------------------------------------------------------------

type Listener = ((event: unknown) => void) | null;

class FakeRequest<T> {
  onsuccess: Listener = null;
  onerror: Listener = null;
  onupgradeneeded: Listener = null;
  onblocked: Listener = null;
  result!: T;
  error: unknown = null;

  settle(value: T, before?: () => void): void {
    // Asynchronous, like the real thing: code that assumes a synchronous
    // callback here would work in a test and deadlock in a browser.
    queueMicrotask(() => {
      this.result = value;
      before?.();
      this.onsuccess?.({ target: this });
    });
  }
}

class FakeObjectStore {
  constructor(
    private readonly rows: Map<string, unknown>,
    private readonly keyPath: string,
  ) {}

  put(value: Record<string, unknown>) {
    const request = new FakeRequest<undefined>();
    const key = String(value[this.keyPath]);
    this.rows.set(key, structuredClone(value));
    request.settle(undefined);
    return request;
  }

  get(key: string) {
    const request = new FakeRequest<unknown>();
    request.settle(this.rows.has(key) ? structuredClone(this.rows.get(key)) : undefined);
    return request;
  }

  getAll() {
    const request = new FakeRequest<unknown[]>();
    request.settle([...this.rows.values()].map((row) => structuredClone(row)));
    return request;
  }

  delete(key: string) {
    const request = new FakeRequest<undefined>();
    this.rows.delete(key);
    request.settle(undefined);
    return request;
  }

  clear() {
    const request = new FakeRequest<undefined>();
    this.rows.clear();
    request.settle(undefined);
    return request;
  }
}

/**
 * An IndexedDB that lives in a Map.
 *
 * Enough of the API for IndexedDbQueueStore and no more, so the store is
 * exercised as written -- open, upgrade, transaction, object store -- without
 * a browser. `data` is exposed so a test can prove what was persisted, and
 * survives being handed to a second store instance, which is how a reload is
 * simulated.
 */
export class FakeIndexedDb {
  readonly stores = new Map<string, Map<string, unknown>>();

  open(name: string, _version?: number) {
    const request = new FakeRequest<unknown>();
    const created = !this.stores.has(`${name}:items`);

    const database = {
      objectStoreNames: {
        contains: (store: string) => this.stores.has(`${name}:${store}`),
      },
      createObjectStore: (store: string, options: { keyPath: string }) => {
        this.stores.set(`${name}:${store}`, new Map());
        return new FakeObjectStore(this.stores.get(`${name}:${store}`)!, options.keyPath);
      },
      transaction: (store: string) => ({
        objectStore: () => {
          const rows = this.stores.get(`${name}:${store}`) ?? new Map();
          this.stores.set(`${name}:${store}`, rows);
          return new FakeObjectStore(rows, "clientFileId");
        },
      }),
    };

    request.settle(database, () => {
      if (created) {
        request.result = database;
        request.onupgradeneeded?.({ target: request });
      }
    });
    return request;
  }

  /** The rows one database holds, for assertions. */
  rows(databaseName: string): Map<string, unknown> {
    return this.stores.get(`${databaseName}:items`) ?? new Map();
  }

  /**
   * The fake as an IDBFactory.
   *
   * The cast is the point of the double: IDBFactory has surface this queue
   * never touches (deleteDatabase, databases, cmp), and implementing it in full
   * would be inventing behaviour no test can check.
   */
  asFactory(): IDBFactory {
    return this as unknown as IDBFactory;
  }
}

/** A File without a filesystem, for tests that only care about bytes and name. */
export function fakeFile(name: string, contents: string, type = "image/jpeg"): File {
  return new File([contents], name, { type, lastModified: 1_756_000_000_000 });
}

// ---------------------------------------------------------------------------
// A transport that moves no bytes
// ---------------------------------------------------------------------------

export interface FakeUploadCall {
  readonly clientFileId: string;
  readonly resumeUrl?: string;
  readonly storagePath: string;
}

/**
 * The upload transport, without a network.
 *
 * It behaves the way the real one is required to: it reports a session URL
 * before it sends anything, it reports progress, it honours an abort, and a
 * successful upload leaves an object in the fake server's storage so
 * verification and finalization can find it. Failures are scripted per file, so
 * a test can say "this one fails twice with a 503 and then works" without
 * inventing a server.
 */
export class FakeUploadTransport implements UploadTransport {
  readonly calls: FakeUploadCall[] = [];
  /** How many uploads were running at once, at the busiest moment. */
  peakActive = 0;
  private active = 0;
  /** Set to hold every upload open, so concurrency can be observed. */
  gate: Promise<void> | null = null;
  readonly discarded: string[] = [];
  /** Scripted outcomes per client file id, consumed in order. */
  readonly script = new Map<string, UploadFailure[]>();
  /** How far the "server" has accepted for each path, for resumption. */
  readonly offsets = new Map<string, number>();
  private sessions = 0;

  constructor(private readonly server: FakeImportServer) {}

  fail(clientFileId: string, ...failures: UploadFailure[]): void {
    this.script.set(clientFileId, [...(this.script.get(clientFileId) ?? []), ...failures]);
  }

  async upload(request: UploadRequest): Promise<UploadResult> {
    this.active += 1;
    this.peakActive = Math.max(this.peakActive, this.active);
    try {
      return await this.run(request);
    } finally {
      this.active -= 1;
    }
  }

  private async run(request: UploadRequest): Promise<UploadResult> {
    const { item, blob } = request;
    if (this.gate) await this.gate;
    this.calls.push({
      clientFileId: item.clientFileId,
      resumeUrl: request.resumeUrl,
      storagePath: item.storagePath,
    });

    if (request.signal?.aborted) {
      return {
        ok: false,
        failure: { code: "offline", message: "Paused.", retryable: true },
        bytesUploaded: this.offsets.get(item.storagePath) ?? 0,
      };
    }

    // A resumed upload continues from what the server already holds. A fresh
    // one starts a session and starts at zero.
    const already = request.resumeUrl ? (this.offsets.get(item.storagePath) ?? 0) : 0;
    if (!request.resumeUrl) {
      this.offsets.set(item.storagePath, 0);
      request.onUploadUrl?.(`https://storage.test/upload/${++this.sessions}`);
    }

    const failure = this.script.get(item.clientFileId)?.shift();
    if (failure) {
      // A failure part-way through leaves the server holding what it accepted.
      const partial = Math.min(blob.size, already + Math.floor(blob.size / 2));
      this.offsets.set(item.storagePath, partial);
      request.onProgress?.(partial, blob.size);
      return { ok: false, failure, bytesUploaded: partial };
    }

    request.onProgress?.(blob.size, blob.size);
    request.onChunk?.(blob.size);
    this.offsets.set(item.storagePath, blob.size);
    this.server.storedObjects.add(item.storagePath);
    this.server.storedSizes.set(item.storagePath, blob.size);
    return { ok: true, bytesUploaded: blob.size };
  }

  async discard(input: { uploadUrl: string }): Promise<void> {
    this.discarded.push(input.uploadUrl);
  }
}

// ---------------------------------------------------------------------------
// Two tabs, one lock table
// ---------------------------------------------------------------------------

/**
 * A coordinator over a shared map, so two of them contend the way two tabs do.
 *
 * Pass the same `shared` map to both to simulate one browser with two Mastline
 * tabs open on the same queue.
 */
export class FakeCoordinator implements QueueCoordinator {
  readonly published: QueueBroadcast[] = [];
  private readonly listeners = new Set<(message: QueueBroadcast) => void>();

  constructor(
    readonly ownerId: string,
    private readonly shared: Map<string, string> = new Map(),
    readonly kind: QueueCoordinator["kind"] = "web-locks",
    private readonly peers: FakeCoordinator[] = [],
  ) {
    this.peers.push(this);
  }

  async acquire(key: string): Promise<QueueLock | null> {
    const holder = this.shared.get(key);
    if (holder && holder !== this.ownerId) return null;
    this.shared.set(key, this.ownerId);

    let released = false;
    return {
      key,
      renew: async () => this.shared.get(key) === this.ownerId,
      release: async () => {
        if (released) return;
        released = true;
        if (this.shared.get(key) === this.ownerId) this.shared.delete(key);
      },
    };
  }

  publish(message: QueueBroadcast): void {
    this.published.push(message);
    for (const peer of this.peers) {
      if (peer === this) continue;
      for (const listener of peer.listeners) listener(message);
    }
  }

  subscribe(listener: (message: QueueBroadcast) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// A TUS client that answers without a server
// ---------------------------------------------------------------------------

export interface RecordedTusUpload {
  readonly options: TusUploadOptions;
  readonly file: Blob;
}

/**
 * A stand-in for tus-js-client.
 *
 * It records the options it was constructed with -- which is how the chunk
 * size, the metadata, and the absence of x-upsert are asserted -- and it can be
 * told to succeed, to fail with a status, or to resume from an offset the
 * "server" already holds.
 */
export class FakeTusClient {
  readonly uploads: RecordedTusUpload[] = [];
  /** Bytes the server already holds per upload URL, for resumption. */
  readonly serverOffsets = new Map<string, number>();
  /** Sessions handed out, newest last. */
  readonly sessions: string[] = [];
  /** Previous uploads that discovery will report. */
  previous: TusPreviousUpload[] = [];
  /** Scripted responses, consumed in order. Anything left is a success. */
  readonly script: Array<{
    status?: number;
    body?: string;
    error?: Error;
    headers?: Record<string, string>;
  }> = [];
  /** Progress reported before the outcome, as a fraction of the file. */
  progressFraction = 1;
  /**
   * Where a completed upload lands.
   *
   * A finished TUS upload creates an object, and the verification step exists
   * precisely to ask whether it did. A fake that skips this reports "the
   * upload finished but the file is not in storage", which is a true statement
   * about the fake and a lie about the system.
   */
  onStored: ((objectName: string, size: number) => void) | null = null;

  get lastOptions(): TusUploadOptions {
    return this.uploads[this.uploads.length - 1].options;
  }

  factory(): TusUploadFactory {
    return (file, options) => {
      this.uploads.push({ file, options });
      let url = options.uploadUrl ?? null;

      // Arrow properties throughout, so `this` is the client rather than the
      // handle: the handle is a shape tus defines, not an object of ours.
      return {
        get url() {
          return url;
        },
        abort: async () => {},
        findPreviousUploads: async () => this.previous,
        resumeFromPreviousUpload: (previous: TusPreviousUpload) => {
          url = previous.uploadUrl;
          options.uploadUrl = previous.uploadUrl ?? undefined;
        },
        start: () => {
          queueMicrotask(() => {
            if (!url) {
              url = `https://storage.test/upload/${this.sessions.length + 1}`;
              this.sessions.push(url);
              options.onUploadUrlAvailable?.();
            }

            const held = this.serverOffsets.get(url) ?? 0;
            const total = (file as Blob).size;
            const next = this.script.shift();

            if (next) {
              const sent = held + Math.floor((total - held) * this.progressFraction * 0.5);
              options.onProgress?.(sent, total);
              this.serverOffsets.set(url, sent);
              options.onError?.(
                next.error ??
                  Object.assign(new Error("upload failed"), {
                    originalResponse: {
                      getStatus: () => next.status ?? 500,
                      getBody: () => next.body ?? "",
                      getHeader: (name: string) => next.headers?.[name.toLowerCase()] ?? undefined,
                    },
                  }),
              );
              return;
            }

            // Resumption is the point: a file the server already holds half of
            // reports progress from there, not from zero.
            options.onProgress?.(total, total);
            options.onChunkComplete?.(total - held, total, total);
            this.serverOffsets.set(url, total);
            this.onStored?.(options.metadata.objectName, total);
            options.onSuccess?.();
          });
        },
      };
    };
  }
}
