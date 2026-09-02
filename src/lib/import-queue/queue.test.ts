import { beforeEach, describe, expect, it } from "vitest";
import { MemoryQueueStore } from "./memory-store";
import { opfsPathFor } from "./paths";
import { ImportQueue } from "./queue";
import { FakeImportServer, FakeStorageCapacity, MemoryStagingArea, fakeFile } from "./testing";
import type { QueueStore, StagingArea } from "./types";

/**
 * The queue, end to end, without a browser or a network.
 *
 * These are the promises the feature is sold on, each asserted as a promise
 * rather than as a code path: a card dump survives a reload, a file whose local
 * copy is gone says so instead of pretending, nothing is ever imported twice,
 * and a local copy is only deleted once the server has vouched for the asset.
 */

const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
const SHOOT = "a0000000-0000-0000-0000-0000000000c1";
const DIGEST = "b".repeat(64);

/** Valid v4-shaped ids, in a fixed order, so paths are predictable. */
function uuids() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

interface Harness {
  queue: ImportQueue;
  store: QueueStore;
  staging: MemoryStagingArea;
  capacity: FakeStorageCapacity;
  server: FakeImportServer;
}

function harness(
  overrides: {
    staging?: MemoryStagingArea | null;
    capacity?: FakeStorageCapacity;
    server?: FakeImportServer;
    store?: QueueStore;
    durableMetadata?: boolean;
    hash?: (blob: Blob) => Promise<string>;
  } = {},
): Harness {
  const staging = overrides.staging === undefined ? new MemoryStagingArea() : overrides.staging;
  const capacity = overrides.capacity ?? new FakeStorageCapacity();
  const server = overrides.server ?? new FakeImportServer(ORG);
  const store = overrides.store ?? new MemoryQueueStore();

  return {
    queue: new ImportQueue({
      organizationId: ORG,
      store,
      staging: staging as StagingArea | null,
      capacity,
      server,
      durableMetadata: overrides.durableMetadata ?? true,
      hash: overrides.hash ?? (async () => DIGEST),
      newId: uuids(),
      now: () => new Date("2026-08-29T09:00:00.000Z"),
    }),
    store,
    staging: staging as MemoryStagingArea,
    capacity,
    server,
  };
}

/** Everything a file goes through once, so the tests that need it can say so. */
async function importOne(h: Harness, name = "MH_0819_0472.ARW") {
  const result = await h.queue.enqueue({ shootId: SHOOT, files: [fakeFile(name, "raw bytes")] });
  const [item] = result.items;
  await h.queue.markUploading(item.clientFileId);
  await h.queue.markUploaded(item.clientFileId, DIGEST);
  return { batchId: result.batchId, clientFileId: item.clientFileId };
}

describe("taking a selection into the queue", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("stages the bytes, records the file, and tells the server", async () => {
    const result = await h.queue.enqueue({
      shootId: SHOOT,
      files: [fakeFile("MH_0819_0472.ARW", "raw"), fakeFile("MH_0819_0473.ARW", "raw two")],
    });

    expect(result.stagedCount).toBe(2);
    expect(result.unstagedCount).toBe(0);
    expect(result.registered).toBe(true);
    expect(result.warnings).toEqual([]);

    for (const item of result.items) {
      expect(item.status).toBe("staged");
      expect(item.recoverable).toBe(true);
      expect(item.needsFile).toBe(false);
      expect(item.importFileId).toBeTruthy();
      // The digest is taken from the bytes on this machine, before anything
      // leaves it, so a resumed session does not need to read the file again.
      expect(item.sha256).toBe(DIGEST);
      expect(await h.staging.exists(opfsPathFor(ORG, result.batchId, item.clientFileId))).toBe(
        true,
      );
    }
  });

  it("keeps the camera's filename away from the storage path", async () => {
    const result = await h.queue.enqueue({
      shootId: SHOOT,
      files: [fakeFile("Låt oss/gå 0472.ARW", "raw")],
    });
    const [item] = result.items;

    expect(item.originalFilename).toBe("Låt oss/gå 0472.ARW");
    expect(item.storagePath).toBe(`${ORG}/_staging/${result.batchId}/${item.clientFileId}`);
    expect(item.storagePath).not.toContain("gå");
  });

  it("asks for persistent storage once, before copying anything", async () => {
    await h.queue.enqueue({ shootId: SHOOT, files: [fakeFile("one.jpg", "x")] });
    expect(h.capacity.persistCalls).toBe(1);

    // Already granted: not asked again on the next selection.
    await h.queue.enqueue({ shootId: SHOOT, files: [fakeFile("two.jpg", "y")] });
    expect(h.capacity.persistCalls).toBe(1);
  });

  it("warns, and does not claim recovery, when there is not enough room", async () => {
    const tight = harness({ capacity: new FakeStorageCapacity(1024, 1000) });
    const result = await tight.queue.enqueue({
      shootId: SHOOT,
      files: [fakeFile("big.ARW", "much larger than the quota")],
    });

    expect(result.capacity.sufficient).toBe(false);
    expect(result.warnings.join(" ")).toContain("not enough free storage");
    expect(result.stagedCount).toBe(0);

    const [item] = result.items;
    expect(item.recoverable).toBe(false);
    expect(item.errorCode).toBe("quota_exceeded");
    // Still in the queue, and still importable in this tab.
    expect(item.status).toBe("pending");
    expect(await tight.queue.bytesFor(item.clientFileId)).not.toBeNull();
  });

  it("keeps unstageable files visible and honestly labelled", async () => {
    const noOpfs = harness({ staging: null });
    const result = await noOpfs.queue.enqueue({
      shootId: SHOOT,
      files: [fakeFile("one.jpg", "x")],
    });

    const [item] = result.items;
    expect(result.items).toHaveLength(1);
    expect(item.recoverable).toBe(false);
    expect(item.errorCode).toBe("staging_unavailable");
    expect(item.errorMessage).toContain("cannot be guaranteed");
    expect(result.warnings.join(" ")).toContain("cannot be recovered after a reload");
  });

  it("still hashes a file it could not stage, so it can still be imported", async () => {
    // No local copy means no recovery after a reload -- but the file in this
    // tab is perfectly uploadable, and it has to carry a digest or it uploads
    // to 100% and then fails at finalization for want of one.
    const noOpfs = harness({ staging: null });
    const result = await noOpfs.queue.enqueue({ shootId: SHOOT, files: [fakeFile("a.jpg", "x")] });

    expect(result.items[0].sha256).toBe(DIGEST);
    expect(result.items[0].recoverable).toBe(false);

    const full = harness({ capacity: new FakeStorageCapacity(1024, 1000) });
    const tight = await full.queue.enqueue({ shootId: SHOOT, files: [fakeFile("b.jpg", "yy")] });
    expect(tight.items[0].sha256).toBe(DIGEST);
  });

  it("keeps a selection whose bytes cannot be read yet", async () => {
    // WebKit routes File reads through its network process, so hashing fails
    // while the browser is offline. The selection has to survive that: the
    // record is written and visible, and the digest is computed later from
    // the same bytes, just before they are uploaded (see the runner).
    const unreadable = harness({
      hash: async () => {
        throw new Error("The I/O read operation failed.");
      },
    });
    const result = await unreadable.queue.enqueue({
      shootId: SHOOT,
      files: [fakeFile("carpark.ARW", "raw")],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sha256).toBeUndefined();
    // The copy itself still landed; only the digest is owed.
    expect(result.items[0].status).toBe("staged");
  });

  it("does not call an item recoverable when only the tab remembers it", async () => {
    // No IndexedDB: the records live in memory, so nothing survives a reload
    // even though the bytes were copied.
    const fragile = harness({ durableMetadata: false });
    const result = await fragile.queue.enqueue({ shootId: SHOOT, files: [fakeFile("a.jpg", "x")] });

    expect(result.items[0].recoverable).toBe(false);
    expect(result.warnings.join(" ")).toContain("not storing the import queue");
  });

  it("survives having no connection at all", async () => {
    const server = new FakeImportServer(ORG);
    server.offline = true;
    const offline = harness({ server });

    const result = await offline.queue.enqueue({
      shootId: SHOOT,
      files: [fakeFile("carpark.ARW", "raw")],
    });

    expect(result.registered).toBe(false);
    expect(result.stagedCount).toBe(1);
    expect(result.items[0].errorCode).toBe("registration_failed");
    // The bytes are safe on this machine, which is the promise that matters.
    expect(result.items[0].recoverable).toBe(true);

    server.offline = false;
    expect(await offline.queue.register(result.batchId)).toBe(true);

    const [item] = await offline.queue.itemsFor(result.batchId);
    expect(item.importFileId).toBeTruthy();
    expect(item.errorCode).toBeUndefined();
  });
});

describe("registering with the server", () => {
  it("is idempotent for the batch and for every file", async () => {
    const h = harness();
    const result = await h.queue.enqueue({
      shootId: SHOOT,
      files: [fakeFile("a.jpg", "1"), fakeFile("b.jpg", "2")],
    });

    const first = await h.server.batchState({ batchId: result.batchId });

    // Registering again, as a reload or a second tab would.
    await h.queue.register(result.batchId);
    await h.queue.register(result.batchId);

    const second = await h.server.batchState({ batchId: result.batchId });
    expect(h.server.batches.size).toBe(1);
    expect(second!.files).toHaveLength(2);
    expect(second!.files.map((file) => file.importFileId)).toEqual(
      first!.files.map((file) => file.importFileId),
    );
  });
});

describe("finalizing", () => {
  it("creates the asset once, however many times it is asked", async () => {
    const h = harness();
    const { clientFileId } = await importOne(h);

    const first = await h.queue.finalize(clientFileId);
    expect(first.status).toBe("complete");
    expect(first.assetId).toBeTruthy();

    // A retry, a reconnect, and a second tab all look like this.
    const second = await h.queue.finalize(clientFileId);
    const third = await h.queue.finalize(clientFileId);

    expect(second.assetId).toBe(first.assetId);
    expect(third.assetId).toBe(first.assetId);
    expect(h.server.assetsCreated).toBe(1);
  });

  it("waits rather than racing when another caller holds the finalization", async () => {
    const h = harness();
    const { clientFileId } = await importOne(h);

    const server = h.server;
    const original = server.finalize.bind(server);
    server.finalize = async () => ({ ok: false, inProgress: true });

    const held = await h.queue.finalize(clientFileId);
    expect(held.status).toBe("finalizing");
    expect(held.errorCode).toBeUndefined();

    server.finalize = original;
    expect((await h.queue.finalize(clientFileId)).status).toBe("complete");
    expect(server.assetsCreated).toBe(1);
  });

  it("records a failure without losing the file", async () => {
    const h = harness();
    const { clientFileId } = await importOne(h);
    h.server.finalize = async () => ({
      ok: false,
      errorCode: "finalization_failed",
      error: "Storage refused the promotion at https://example.test/x?token=abc",
    });

    const failed = await h.queue.finalize(clientFileId);
    expect(failed.status).toBe("failed");
    expect(failed.errorMessage).not.toContain("https://");
    expect(await h.queue.bytesFor(clientFileId)).not.toBeNull();
  });
});

describe("coming back to an unfinished import", () => {
  it("restores the queue and its bytes after a reload", async () => {
    const store = new MemoryQueueStore();
    const staging = new MemoryStagingArea();
    const server = new FakeImportServer(ORG);

    const before = harness({ store, staging, server });
    const { batchId, clientFileId } = await importOne(before);

    // The tab is gone. The store, the staged bytes, and the server are not.
    const after = harness({ store, staging, server });
    const report = await after.queue.restore();

    expect(report.needsFile).toBe(0);
    expect(report.restored).toBe(1);

    const [item] = await after.queue.itemsFor(batchId);
    expect(item.clientFileId).toBe(clientFileId);
    expect(item.recoverable).toBe(true);
    expect(await after.queue.bytesFor(clientFileId)).not.toBeNull();
  });

  it("says a file is needed when its local copy is gone", async () => {
    const store = new MemoryQueueStore();
    const staging = new MemoryStagingArea();
    const server = new FakeImportServer(ORG);

    const before = harness({ store, staging, server });
    const result = await before.queue.enqueue({
      shootId: SHOOT,
      files: [fakeFile("MH_0819_0472.ARW", "raw")],
    });
    const clientFileId = result.items[0].clientFileId;

    // The browser evicted the origin's storage while the tab was closed.
    staging.evictEverything();

    const after = harness({ store, staging, server });
    const report = await after.queue.restore();

    expect(report.needsFile).toBe(1);

    const item = await after.queue.item(clientFileId);
    expect(item!.stagingState).toBe("missing");
    expect(item!.needsFile).toBe(true);
    expect(item!.recoverable).toBe(false);
    expect(item!.errorMessage).toContain("Select it again");
    // The record itself is still there: the operator can hand the file back.
    expect(item!.originalFilename).toBe("MH_0819_0472.ARW");
  });

  it("takes the file back and stages it again", async () => {
    const h = harness();
    const result = await h.queue.enqueue({
      shootId: SHOOT,
      files: [fakeFile("MH_0819_0472.ARW", "raw")],
    });
    const clientFileId = result.items[0].clientFileId;
    h.staging.evictEverything();
    await h.queue.restore();

    const restored = await h.queue.provideFile(clientFileId, fakeFile("MH_0819_0472.ARW", "raw"));

    expect(restored.stagingState).toBe("staged");
    expect(restored.needsFile).toBe(false);
    expect(restored.recoverable).toBe(true);
  });

  it("refuses a different file under the same name", async () => {
    const h = harness();
    const result = await h.queue.enqueue({ shootId: SHOOT, files: [fakeFile("a.ARW", "raw")] });

    await expect(
      h.queue.provideFile(result.items[0].clientFileId, fakeFile("a.ARW", "different length")),
    ).rejects.toThrow(/not the same file/);
  });

  it("adopts what the server already finished, and creates nothing", async () => {
    const store = new MemoryQueueStore();
    const staging = new MemoryStagingArea();
    const server = new FakeImportServer(ORG);

    const before = harness({ store, staging, server });
    const { clientFileId } = await importOne(before);
    // The finalization landed; the response never got back to the browser.
    const files = [...server.batches.values()][0].files;
    await server.finalize({ importFileId: files[0].importFileId });
    expect(server.assetsCreated).toBe(1);

    const after = harness({ store, staging, server });
    const report = await after.queue.restore();
    await after.queue.restore();

    expect(report.completed).toBe(1);
    // Reconciliation registers and confirms. It never creates.
    expect(server.assetsCreated).toBe(1);
    expect(await after.queue.item(clientFileId)).toBeNull();
  });

  it("leaves local records alone when the server cannot be reached", async () => {
    const store = new MemoryQueueStore();
    const staging = new MemoryStagingArea();
    const server = new FakeImportServer(ORG);

    const before = harness({ store, staging, server });
    const { clientFileId } = await importOne(before);

    server.offline = true;
    const after = harness({ store, staging, server });
    const report = await after.queue.restore();

    expect(report.unreachableBatches).toBe(1);
    expect(await after.queue.item(clientFileId)).not.toBeNull();
  });
});

describe("cleaning up", () => {
  it("deletes a local copy only once the server vouches for all three facts", async () => {
    const h = harness();
    const { batchId, clientFileId } = await importOne(h);
    await h.queue.finalize(clientFileId);

    const path = opfsPathFor(ORG, batchId, clientFileId);
    // The asset record exists but the object cannot be found in the bucket.
    h.server.storedObjects.clear();

    const kept = await h.queue.cleanupCompleted();
    expect(kept.removed).toBe(0);
    expect(kept.kept).toBe(1);
    expect(await h.staging.exists(path)).toBe(true);
    expect(await h.queue.item(clientFileId)).not.toBeNull();

    // Now storage confirms it too.
    h.server.storedObjects.add(`canonical/${(await h.queue.item(clientFileId))!.assetId}`);
    const removed = await h.queue.cleanupCompleted();

    expect(removed.removed).toBe(1);
    expect(await h.staging.exists(path)).toBe(false);
    expect(await h.queue.item(clientFileId)).toBeNull();
  });

  it("keeps the copy when the asset record has gone missing", async () => {
    const h = harness();
    const { clientFileId } = await importOne(h);
    await h.queue.finalize(clientFileId);
    h.server.assets.clear();

    expect((await h.queue.cleanupCompleted()).removed).toBe(0);
  });

  it("clears staged bytes when a file is cancelled", async () => {
    const h = harness();
    const { batchId, clientFileId } = await importOne(h);

    const canceled = await h.queue.cancel(clientFileId);
    expect(canceled.status).toBe("canceled");
    expect(await h.staging.exists(opfsPathFor(ORG, batchId, clientFileId))).toBe(false);

    const report = await h.queue.cleanupCanceled();
    expect(report.removed).toBe(1);
    expect(await h.queue.item(clientFileId)).toBeNull();
  });

  it("will not cancel a file that has already become an asset", async () => {
    const h = harness();
    const { clientFileId } = await importOne(h);
    await h.queue.finalize(clientFileId);

    await expect(h.queue.cancel(clientFileId)).rejects.toThrow(/already been imported/);
  });

  it("never removes a completed import as part of a cancellation sweep", async () => {
    const h = harness();
    const done = await importOne(h, "done.ARW");
    await h.queue.finalize(done.clientFileId);
    const abandoned = await importOne(h, "abandoned.ARW");
    await h.queue.cancel(abandoned.clientFileId);

    // The completed one has an unconfirmed object, so cleanup must keep it.
    h.server.storedObjects.clear();
    const report = await h.queue.cleanupCanceled();

    expect(report.removed).toBe(1);
    expect(await h.queue.item(done.clientFileId)).not.toBeNull();
    expect(await h.queue.item(abandoned.clientFileId)).toBeNull();
  });

  it("clears an abandoned batch only when nothing in it completed", async () => {
    const h = harness();
    const result = await h.queue.enqueue({
      shootId: SHOOT,
      files: [fakeFile("a.ARW", "1"), fakeFile("b.ARW", "2")],
    });

    const report = await h.queue.cleanupBatch(result.batchId);
    expect(report.removed).toBe(2);
    expect(await h.queue.itemsFor(result.batchId)).toHaveLength(0);
    expect(h.staging.files.size).toBe(0);
  });
});

describe("pausing and resuming", () => {
  it("resumes an uploaded file into finalization rather than uploading again", async () => {
    const h = harness();
    const { clientFileId } = await importOne(h);

    await h.queue.pause(clientFileId);
    const resumed = await h.queue.resume(clientFileId);

    expect(resumed.status).toBe("uploaded");
  });

  it("resumes a staged file back into the upload queue", async () => {
    const h = harness();
    const result = await h.queue.enqueue({ shootId: SHOOT, files: [fakeFile("a.ARW", "1")] });
    const clientFileId = result.items[0].clientFileId;

    await h.queue.pause(clientFileId);
    expect((await h.queue.resume(clientFileId)).status).toBe("staged");
  });

  it("leaves a paused file needing its bytes where it is", async () => {
    const store = new MemoryQueueStore();
    const staging = new MemoryStagingArea();
    const server = new FakeImportServer(ORG);

    const before = harness({ store, staging, server });
    const result = await before.queue.enqueue({ shootId: SHOOT, files: [fakeFile("a.ARW", "1")] });
    const clientFileId = result.items[0].clientFileId;
    await before.queue.pause(clientFileId);

    // The reload is what makes this a file the operator has to hand back: the
    // File object from the picker died with the tab, and the staged copy is
    // gone too.
    staging.evictEverything();
    const after = harness({ store, staging, server });
    await after.queue.restore();
    const resumed = await after.queue.resume(clientFileId);

    expect(resumed.status).toBe("retrying");
    expect(resumed.needsFile).toBe(true);
  });
});
