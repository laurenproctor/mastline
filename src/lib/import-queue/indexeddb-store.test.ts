import { describe, expect, it } from "vitest";
import { IndexedDbQueueStore } from "./indexeddb-store";
import { fromStored, RECORD_VERSION, toStored } from "./serialization";
import { FakeIndexedDb } from "./testing";
import type { QueueItemRecord } from "./types";

/**
 * What survives a reload, and what is refused on the way back in.
 *
 * The reload is simulated the way it actually happens: the same underlying
 * database, a brand new store object, no shared state in between. If a record
 * cannot make that trip, an operator loses a frame.
 */

const RECORD: QueueItemRecord = {
  clientFileId: "abc123",
  organizationId: "aaaaaaaa-0000-0000-0000-000000000001",
  shootId: "a0000000-0000-0000-0000-0000000000c1",
  batchId: "b1111111-0000-4000-8000-000000000001",
  batchIdempotencyKey: "b1111111-0000-4000-8000-000000000001",
  importFileId: "if-1",
  originalFilename: "MH_0819_0472.ARW",
  byteSize: 48_211_904,
  mimeType: "image/x-sony-arw",
  lastModifiedAt: "2026-08-19T18:47:18.000Z",
  sha256: "a".repeat(64),
  width: 8640,
  height: 5760,
  status: "staged",
  stagingState: "staged",
  storageBucket: "originals",
  storagePath:
    "aaaaaaaa-0000-0000-0000-000000000001/_staging/b1111111-0000-4000-8000-000000000001/abc123",
  attemptCount: 0,
  createdAt: "2026-08-19T18:50:00.000Z",
  updatedAt: "2026-08-19T18:50:00.000Z",
};

describe("serializing a queue item", () => {
  it("round-trips every field", () => {
    expect(fromStored(toStored(RECORD))).toEqual(RECORD);
  });

  it("stamps a version so a later shape can be recognised", () => {
    expect(toStored(RECORD).v).toBe(RECORD_VERSION);
  });

  it("leaves a record written by a newer build alone", () => {
    // Read half-correctly and written back, it would be truncated for the tab
    // that still understands it.
    expect(fromStored({ ...toStored(RECORD), v: RECORD_VERSION + 1 })).toBeNull();
  });

  it("drops a record it cannot trust rather than throwing", () => {
    expect(fromStored({ ...toStored(RECORD), byteSize: 0 })).toBeNull();
    expect(fromStored({ ...toStored(RECORD), status: "teleporting" })).toBeNull();
    expect(fromStored({ ...toStored(RECORD), storagePath: "" })).toBeNull();
    expect(fromStored(null)).toBeNull();
    expect(fromStored("not a record")).toBeNull();
  });

  it("falls back to unstaged when the staging state is unreadable", () => {
    // Not recoverable is the safe reading of a value this build cannot parse.
    expect(fromStored({ ...toStored(RECORD), stagingState: "elsewhere" })?.stagingState).toBe(
      "none",
    );
  });
});

describe("the IndexedDB store", () => {
  it("persists a record across a reload", async () => {
    const database = new FakeIndexedDb();
    const store = new IndexedDbQueueStore(database.asFactory());

    await store.put(RECORD);
    expect(await store.get(RECORD.clientFileId)).toEqual(RECORD);

    // The tab goes away; the database does not.
    const afterReload = new IndexedDbQueueStore(database.asFactory());
    expect(await afterReload.get(RECORD.clientFileId)).toEqual(RECORD);
    expect(await afterReload.all()).toHaveLength(1);
  });

  it("returns null for a file it has never seen", async () => {
    const store = new IndexedDbQueueStore(new FakeIndexedDb().asFactory());
    expect(await store.get("nothing")).toBeNull();
  });

  it("lists a batch without reading another one", async () => {
    const store = new IndexedDbQueueStore(new FakeIndexedDb().asFactory());
    await store.put(RECORD);
    await store.put({
      ...RECORD,
      clientFileId: "def456",
      batchId: "b2222222-0000-4000-8000-000000000002",
    });

    expect(await store.byBatch(RECORD.batchId)).toHaveLength(1);
    expect(await store.all()).toHaveLength(2);
  });

  it("skips a row a later build wrote and keeps the rest", async () => {
    const database = new FakeIndexedDb();
    const store = new IndexedDbQueueStore(database.asFactory());
    await store.put(RECORD);

    database
      .rows("mastline-import-queue")
      .set("from-the-future", { ...toStored(RECORD), clientFileId: "from-the-future", v: 99 });

    // One unreadable row loses one row. An exception would lose the queue.
    const all = await store.all();
    expect(all).toHaveLength(1);
    expect(all[0].clientFileId).toBe(RECORD.clientFileId);
  });

  it("deletes and clears", async () => {
    const store = new IndexedDbQueueStore(new FakeIndexedDb().asFactory());
    await store.put(RECORD);
    await store.delete(RECORD.clientFileId);
    expect(await store.all()).toHaveLength(0);

    await store.put(RECORD);
    await store.clear();
    expect(await store.all()).toHaveLength(0);
  });
});
