import type { Id } from "@/lib/domain";
import { fromStored, toStored } from "./serialization";
import type { QueueItemRecord, QueueStore } from "./types";

/**
 * The metadata store, in memory.
 *
 * Two uses, and it is worth being precise about the second.
 *
 * In tests it stands in for IndexedDB. In a browser that has no IndexedDB -- a
 * locked-down private window, mainly -- the queue still needs somewhere to keep
 * its records for the life of the tab, so uploads work and the interface is
 * consistent. What it must never do in that case is imply recovery: an item
 * held only here is reported as unrecoverable, because a reload will lose it.
 *
 * It round-trips through the same serialization as the real store so a test
 * that passes here is testing the shape the browser database will hold.
 */
export class MemoryQueueStore implements QueueStore {
  private readonly rows = new Map<string, unknown>();

  async put(record: QueueItemRecord): Promise<void> {
    this.rows.set(record.clientFileId, structuredClone(toStored(record)));
  }

  async get(clientFileId: string): Promise<QueueItemRecord | null> {
    return fromStored(this.rows.get(clientFileId));
  }

  async all(): Promise<readonly QueueItemRecord[]> {
    return [...this.rows.values()]
      .map(fromStored)
      .filter((row): row is QueueItemRecord => row !== null);
  }

  async byBatch(batchId: Id): Promise<readonly QueueItemRecord[]> {
    return (await this.all()).filter((record) => record.batchId === batchId);
  }

  async delete(clientFileId: string): Promise<void> {
    this.rows.delete(clientFileId);
  }

  async clear(): Promise<void> {
    this.rows.clear();
  }
}
