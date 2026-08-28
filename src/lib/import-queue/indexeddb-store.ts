import type { Id } from "@/lib/domain";
import { fromStored, toStored } from "./serialization";
import type { QueueItemRecord, QueueStore } from "./types";

/**
 * The queue's metadata, in IndexedDB.
 *
 * IndexedDB rather than localStorage, and not as a matter of taste:
 * localStorage is synchronous, string-only, and capped somewhere around five
 * megabytes shared with everything else this origin stores. A card dump of
 * three hundred frames is three hundred records that have to be written while
 * uploads are running, read back at startup, and updated on every lifecycle
 * transition. Serializing that through a synchronous string API would block the
 * main thread during exactly the work the operator is watching -- and no blob
 * ever belongs there at any size.
 *
 * Bytes are not stored here either. They go to the origin private file system,
 * which can hand back a stream; a Blob structured-cloned into a record can only
 * be handed back whole.
 *
 * The IDBFactory is injected so this can be pointed at a test double. Nothing
 * else in the queue touches the browser database directly.
 */

export const DATABASE_NAME = "mastline-import-queue";
export const STORE_NAME = "items";
export const DATABASE_VERSION = 1;

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export class IndexedDbQueueStore implements QueueStore {
  private database: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory,
    private readonly databaseName: string = DATABASE_NAME,
  ) {}

  /** Whether this browser offers the database at all. */
  static isAvailable(scope: { indexedDB?: IDBFactory } = globalThis): boolean {
    return Boolean(scope.indexedDB);
  }

  private async open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    // One in-flight open, shared: startup restore and the first staged file
    // both reach for the store, and two opens race the upgrade transaction.
    this.opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "clientFileId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open the import queue."));
      request.onblocked = () =>
        reject(new Error("Another tab is holding an older import queue open."));
    });

    this.database = await this.opening;
    return this.database;
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, mode);
    const result = promised(work(transaction.objectStore(STORE_NAME)));
    return result;
  }

  async put(record: QueueItemRecord): Promise<void> {
    await this.withStore("readwrite", (store) => store.put(toStored(record)));
  }

  async get(clientFileId: string): Promise<QueueItemRecord | null> {
    const stored = await this.withStore<unknown>("readonly", (store) => store.get(clientFileId));
    return fromStored(stored);
  }

  async all(): Promise<readonly QueueItemRecord[]> {
    const stored = await this.withStore<unknown[]>("readonly", (store) => store.getAll());
    // A row this build cannot read is skipped, not fatal. See serialization.ts.
    return (stored ?? []).map(fromStored).filter((row): row is QueueItemRecord => row !== null);
  }

  async byBatch(batchId: Id): Promise<readonly QueueItemRecord[]> {
    const everything = await this.all();
    return everything.filter((record) => record.batchId === batchId);
  }

  async delete(clientFileId: string): Promise<void> {
    await this.withStore("readwrite", (store) => store.delete(clientFileId));
  }

  async clear(): Promise<void> {
    await this.withStore("readwrite", (store) => store.clear());
  }
}
