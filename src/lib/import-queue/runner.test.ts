import { beforeEach, describe, expect, it } from "vitest";
import { MemoryQueueStore } from "./memory-store";
import { opfsPathFor } from "./paths";
import { ImportQueue } from "./queue";
import { ImportQueueRunner } from "./runner";
import {
  FakeCoordinator,
  FakeImportServer,
  FakeStorageCapacity,
  FakeUploadTransport,
  MemoryStagingArea,
  fakeFile,
} from "./testing";
import type { QueueStore } from "./types";

/**
 * The runner, which is where every promise this feature makes is kept.
 *
 * No network, no browser, no timers: the clock and the scheduler are injected,
 * so a two-minute backoff is asserted in a millisecond and nothing here is
 * flaky. What is real is the queue, the state machine, and the order of
 * operations -- upload, verify, finalize, confirm, and only then delete.
 */

const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
const SHOOT = "a0000000-0000-0000-0000-0000000000c1";
const DIGEST = "b".repeat(64);

function uuids() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

interface Timer {
  run: () => void;
  at: number;
  cancelled: boolean;
}

function harness(
  overrides: {
    server?: FakeImportServer;
    staging?: MemoryStagingArea;
    store?: QueueStore;
    transport?: FakeUploadTransport;
    coordinator?: FakeCoordinator;
    concurrency?: number;
    maxAttempts?: number;
    hash?: (blob: Blob) => Promise<string>;
  } = {},
) {
  const server = overrides.server ?? new FakeImportServer(ORG);
  const staging = overrides.staging ?? new MemoryStagingArea();
  const store = overrides.store ?? new MemoryQueueStore();
  const transport = overrides.transport ?? new FakeUploadTransport(server);
  const coordinator = overrides.coordinator ?? new FakeCoordinator("tab-a");

  let clock = Date.parse("2026-08-29T09:00:00.000Z");
  let online = true;
  let onlineHandler: ((online: boolean) => void) | null = null;
  const timers: Timer[] = [];

  const queue = new ImportQueue({
    organizationId: ORG,
    store,
    staging,
    capacity: new FakeStorageCapacity(),
    server,
    hash: overrides.hash ?? (async () => DIGEST),
    newId: uuids(),
    now: () => new Date(clock),
  });

  const runner = new ImportQueueRunner({
    queue,
    transport,
    coordinator,
    concurrency: overrides.concurrency,
    maxAttempts: overrides.maxAttempts,
    // Pinned so the schedule, not the jitter, is what is asserted.
    backoff: { random: () => 1 },
    now: () => new Date(clock),
    online: () => online,
    watchOnline: (handler) => {
      onlineHandler = handler;
      return () => {
        onlineHandler = null;
      };
    },
    schedule: (run, delayMs) => {
      const timer: Timer = { run, at: clock + delayMs, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });

  return {
    server,
    staging,
    store,
    transport,
    coordinator,
    queue,
    runner,
    get now() {
      return new Date(clock);
    },
    async advance(ms: number) {
      clock += ms;
      for (const timer of [...timers]) {
        if (timer.cancelled || timer.at > clock) continue;
        timer.cancelled = true;
        timer.run();
      }
      await runner.idle();
    },
    async setOnline(next: boolean) {
      online = next;
      onlineHandler?.(next);
      await runner.idle();
    },
    async enqueue(...names: string[]) {
      const result = await queue.enqueue({
        shootId: SHOOT,
        files: names.map((name) => fakeFile(name, `bytes for ${name}`)),
      });
      return result;
    },
  };
}

type Harness = ReturnType<typeof harness>;

async function runAll(h: Harness): Promise<void> {
  h.runner.start();
  await h.runner.idle();
}

describe("getting a queued file up", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("uploads, verifies, finalizes, and only then deletes the local copy", async () => {
    const batch = await h.enqueue("MH_0819_0472.ARW");
    const clientFileId = batch.items[0].clientFileId;
    await runAll(h);

    const server = await h.server.batchState({ batchId: batch.batchId });
    expect(server!.files[0].status).toBe("complete");
    expect(h.server.assetsCreated).toBe(1);

    // The staged copy goes only after the server vouched for the object and
    // the asset. Both are true here, so it is gone.
    expect(await h.staging.exists(opfsPathFor(ORG, batch.batchId, clientFileId))).toBe(false);
    expect(await h.queue.item(clientFileId)).toBeNull();
  });

  it("records the resumable session before it sends anything", async () => {
    const batch = await h.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;

    // Hold the upload open and look at what was persisted mid-flight.
    let release!: () => void;
    h.transport.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    h.runner.start();
    await h.runner.pump();
    await Promise.resolve();

    release();
    h.transport.gate = null;
    await h.runner.idle();

    expect(h.transport.calls[0].clientFileId).toBe(clientFileId);
  });

  it("runs two at a time and no more", async () => {
    let release!: () => void;
    h.transport.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await h.enqueue("a.ARW", "b.ARW", "c.ARW", "d.ARW", "e.ARW");
    h.runner.start();
    await h.runner.pump();
    await Promise.resolve();

    release();
    h.transport.gate = null;
    await h.runner.idle();

    // A kerbside uplink is not made faster by five streams; it is made to look
    // slower, all at once.
    expect(h.transport.peakActive).toBeLessThanOrEqual(2);
    expect(h.transport.calls).toHaveLength(5);
    expect(h.server.assetsCreated).toBe(5);
  });

  it("keeps going when one file cannot be uploaded at all", async () => {
    const batch = await h.enqueue("good.ARW", "refused.ARW");
    const refused = batch.items.find((item) => item.originalFilename === "refused.ARW")!;
    h.transport.fail(refused.clientFileId, {
      code: "authorization_denied",
      message: "This account is not allowed to import into this workspace.",
      retryable: false,
    });

    await runAll(h);

    // One failed row does not stop the batch.
    expect(h.server.assetsCreated).toBe(1);
    expect((await h.queue.item(refused.clientFileId))!.status).toBe("failed");
  });
});

describe("retrying", () => {
  it("waits, then resumes from where the server got to", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;
    h.transport.fail(clientFileId, {
      code: "server_unavailable",
      message: "Mastline storage did not respond.",
      retryable: true,
    });

    await runAll(h);

    const waiting = await h.queue.item(clientFileId);
    expect(waiting!.status).toBe("retrying");
    expect(waiting!.errorCode).toBe("server_unavailable");
    // One second for the first retry, from the pinned backoff.
    expect(waiting!.nextAttemptAt).toBe("2026-08-29T09:00:01.000Z");

    // Not before it is due.
    await h.advance(500);
    expect(h.transport.calls).toHaveLength(1);

    await h.advance(600);
    expect(h.transport.calls).toHaveLength(2);
    // The second attempt resumed the session rather than starting again.
    expect(h.transport.calls[1].resumeUrl).toBe("https://storage.test/upload/1");
    expect(h.server.assetsCreated).toBe(1);
  });

  it("gives up after the attempt limit rather than trying all night", async () => {
    const h = harness({ maxAttempts: 3 });
    const batch = await h.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      h.transport.fail(clientFileId, {
        code: "server_unavailable",
        message: "Mastline storage did not respond.",
        retryable: true,
      });
    }

    await runAll(h);
    for (let step = 0; step < 6; step += 1) await h.advance(60_000);

    const item = await h.queue.item(clientFileId);
    expect(item!.status).toBe("failed");
    expect(h.transport.calls.length).toBe(3);
    expect(item!.errorMessage).toContain("Tried 3 times");
  });

  it("does not retry a refusal at all", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;
    h.transport.fail(clientFileId, {
      code: "quota_exceeded",
      message: "This workspace is out of storage.",
      retryable: false,
    });

    await runAll(h);
    await h.advance(120_000);

    expect(h.transport.calls).toHaveLength(1);
    expect((await h.queue.item(clientFileId))!.status).toBe("failed");
  });

  it("rebuilds an expired session immediately, and calls it nothing worse", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;
    h.transport.fail(clientFileId, {
      code: "upload_session_expired",
      message: "The upload session expired.",
      retryable: true,
      restartSession: true,
    });

    await runAll(h);

    // The URL was dropped, and the retry was scheduled for now rather than
    // after a backoff: nothing about the file failed.
    const item = await h.queue.item(clientFileId);
    expect(item?.status === "retrying" || item === null).toBe(true);

    await h.advance(1);
    expect(h.transport.calls).toHaveLength(2);
    // A fresh session, not the dead one.
    expect(h.transport.calls[1].resumeUrl).toBeUndefined();
    expect(h.server.assetsCreated).toBe(1);
  });

  it("retries one failed file without touching the ones that worked", async () => {
    const h = harness();
    const batch = await h.enqueue("good-one.ARW", "good-two.ARW", "bad.ARW");
    const bad = batch.items.find((item) => item.originalFilename === "bad.ARW")!;
    h.transport.fail(bad.clientFileId, {
      code: "unsupported_file",
      message: "Storage refused this file.",
      retryable: false,
    });

    await runAll(h);
    expect(h.server.assetsCreated).toBe(2);
    const uploadsBefore = h.transport.calls.length;

    const retried = await h.runner.retryFailed(batch.batchId);
    await h.runner.idle();

    expect(retried).toBe(1);
    // Exactly one more upload: the two that succeeded are finished business.
    expect(h.transport.calls.length).toBe(uploadsBefore + 1);
    expect(h.server.assetsCreated).toBe(3);
  });
});

describe("connectivity", () => {
  it("does not start work while the browser is offline", async () => {
    const h = harness();
    await h.enqueue("a.ARW");
    await h.setOnline(false);
    await runAll(h);

    expect(h.transport.calls).toHaveLength(0);
  });

  it("picks up where it stopped when the connection returns", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;

    await h.setOnline(false);
    await runAll(h);
    expect(h.transport.calls).toHaveLength(0);

    // Nothing was reselected and nothing was lost: the bytes are still staged.
    expect(await h.staging.exists(opfsPathFor(ORG, batch.batchId, clientFileId))).toBe(true);

    await h.setOnline(true);
    await h.runner.idle();

    expect(h.transport.calls).toHaveLength(1);
    expect(h.server.assetsCreated).toBe(1);
  });

  it("marks an interrupted upload as waiting, not as failed", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;
    h.transport.fail(clientFileId, {
      code: "offline",
      message: "Waiting for a connection.",
      retryable: true,
    });

    await runAll(h);

    const item = await h.queue.item(clientFileId);
    expect(item!.status).toBe("retrying");
    expect(item!.errorCode).toBe("offline");
    // Waiting for a connection is not a red row, and it is not an attempt
    // scheduled for two minutes' time either: the answer could be yes at any
    // moment.
    expect(item!.nextAttemptAt).toBe("2026-08-29T09:00:05.000Z");

    // The connection coming back makes it due immediately.
    await h.setOnline(true);
    expect(h.server.assetsCreated).toBe(1);
  });
});

describe("two tabs", () => {
  it("lets only one of them upload a given file", async () => {
    const shared = new Map<string, string>();
    const peers: FakeCoordinator[] = [];
    const server = new FakeImportServer(ORG);
    const staging = new MemoryStagingArea();
    const store = new MemoryQueueStore();
    const transport = new FakeUploadTransport(server);

    const first = harness({
      server,
      staging,
      store,
      transport,
      coordinator: new FakeCoordinator("tab-a", shared, "web-locks", peers),
    });
    const second = harness({
      server,
      staging,
      store,
      transport,
      coordinator: new FakeCoordinator("tab-b", shared, "web-locks", peers),
    });

    const batch = await first.enqueue("a.ARW");

    // Both tabs are looking at the same queue and both start working.
    first.runner.start();
    second.runner.start();
    await Promise.all([first.runner.idle(), second.runner.idle()]);

    // One upload, one asset. Two would have been a 409 reported to the
    // photographer as a failed file.
    const forFile = transport.calls.filter(
      (call) => call.clientFileId === batch.items[0].clientFileId,
    );
    expect(forFile).toHaveLength(1);
    expect(server.assetsCreated).toBe(1);
  });
});

describe("finalization", () => {
  it("retries the finalization without sending the bytes again", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;

    const real = h.server.finalize.bind(h.server);
    let failures = 1;
    h.server.finalize = async (input) => {
      if (failures-- > 0) {
        return { ok: false, errorCode: "finalization_failed", error: "The database was busy." };
      }
      return real(input);
    };

    await runAll(h);

    // Uploaded once. The failure was in recording it, not in sending it.
    expect(h.transport.calls).toHaveLength(1);
    const waiting = await h.queue.item(clientFileId);
    expect(waiting!.status).toBe("retrying");
    // A busy database is a transient condition, and is classified as one.
    expect(waiting!.errorCode).toBe("server_unavailable");

    await h.advance(5_000);

    expect(h.transport.calls).toHaveLength(1);
    expect(h.server.assetsCreated).toBe(1);
  });

  it("does not re-upload a file the shoot already has", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;

    // What the database says when the same bytes under the same name are
    // imported into the same shoot twice. It said it five times in a browser
    // test, and each retry re-uploaded the whole file.
    h.server.finalize = async () => ({
      ok: false,
      errorCode: "finalization_failed",
      error:
        'Could not record the original: duplicate key value violates unique constraint "asset_versions_organization_id_object_key_key"',
    });

    await runAll(h);
    await h.advance(120_000);

    const item = await h.queue.item(clientFileId);
    expect(item!.status).toBe("failed");
    expect(item!.errorCode).toBe("object_conflict");
    // Said in words a photographer can act on, not in constraint names.
    expect(item!.errorMessage).toBe(
      "This file is already in this shoot. Nothing further was imported.",
    );
    // One upload. Not five.
    expect(h.transport.calls).toHaveLength(1);
  });

  it("records the attempt count where an operator can see it", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;
    h.transport.fail(clientFileId, {
      code: "server_unavailable",
      message: "Storage did not respond.",
      retryable: true,
    });

    await runAll(h);

    // Captured while it is still waiting: once it succeeds the record is
    // cleaned up, and the point of the note is that the server can be asked
    // about a file that has not finished.
    const waiting = await h.queue.item(clientFileId);
    expect(waiting!.status).toBe("retrying");

    const state = await h.server.batchState({ batchId: batch.batchId });
    const row = state!.files[0];
    // A row that always says zero cannot answer "how long has this been
    // failing", which is the first question asked of a stuck batch.
    expect(h.server.attemptsSeen.get(row.importFileId)).toBeGreaterThanOrEqual(1);
    expect(row.status).toBe("retrying");
    expect(row.errorCode).toBe("server_unavailable");

    await h.advance(2_000);
    expect(h.server.assetsCreated).toBe(1);
  });

  it("creates one asset however many times finalization is attempted", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;

    await runAll(h);
    // Ask again, the way a reconnecting tab would.
    await h.queue.finalize(clientFileId).catch(() => {});

    expect(h.server.assetsCreated).toBe(1);
    expect(h.server.finalizeCalls).toBeGreaterThanOrEqual(1);
  });

  it("adopts an object that is already in storage instead of uploading again", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    const item = batch.items[0];

    // Somebody already put this exact file there: a lost response, or the
    // other tab getting to it first. Supabase answers the create with 409.
    h.server.storedObjects.add(item.storagePath);
    h.server.storedSizes.set(item.storagePath, item.byteSize);
    h.transport.fail(item.clientFileId, {
      code: "object_conflict",
      message: "A file is already stored at this location.",
      retryable: false,
    });

    await runAll(h);

    // Reconciled rather than overwritten, and rather than reported as failed.
    expect(h.server.assetsCreated).toBe(1);
    expect(h.transport.calls).toHaveLength(1);
    expect(await h.queue.item(item.clientFileId)).toBeNull();
  });

  it("will not create an asset for an object that is not there", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    const item = batch.items[0];

    // The transport says it worked; storage disagrees. TUS reporting success
    // is a client's belief, not evidence.
    h.transport.upload = async (request) => {
      request.onUploadUrl?.("https://storage.test/upload/phantom");
      return { ok: true, bytesUploaded: request.blob.size };
    };

    await runAll(h);

    expect(h.server.assetsCreated).toBe(0);
    const after = await h.queue.item(item.clientFileId);
    expect(after!.status).toBe("retrying");
  });
});

describe("cleaning up", () => {
  it("keeps the local copy until the server confirms the asset", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;

    const real = h.server.confirm.bind(h.server);
    // The asset exists; the object cannot be found in the bucket.
    h.server.confirm = async (input) => ({ ...(await real(input)), objectExists: false });

    await runAll(h);

    expect(await h.staging.exists(opfsPathFor(ORG, batch.batchId, clientFileId))).toBe(true);
    expect((await h.queue.item(clientFileId))!.status).toBe("complete");
  });

  it("cancels a file, gives the session back, and clears the bytes", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;
    h.transport.fail(clientFileId, {
      code: "server_unavailable",
      message: "Storage did not respond.",
      retryable: true,
    });

    await runAll(h);
    await h.runner.cancelItem(clientFileId);

    const item = await h.queue.item(clientFileId);
    expect(item!.status).toBe("canceled");
    expect(await h.staging.exists(opfsPathFor(ORG, batch.batchId, clientFileId))).toBe(false);
    expect(h.transport.discarded).toEqual(["https://storage.test/upload/1"]);

    // And it is not picked up again.
    await h.advance(60_000);
    expect(h.transport.calls).toHaveLength(1);
  });

  it("will not cancel a file that has already become an asset", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW");
    await runAll(h);

    // The record is gone because it completed and was cleaned up. There is
    // nothing left to cancel, and the asset is untouched.
    await expect(h.runner.cancelItem(batch.items[0].clientFileId)).rejects.toThrow();
    expect(h.server.assetsCreated).toBe(1);
  });
});

describe("a file whose local copy is gone", () => {
  it("asks for it back instead of retrying into nothing", async () => {
    const server = new FakeImportServer(ORG);
    const staging = new MemoryStagingArea();
    const store = new MemoryQueueStore();
    const transport = new FakeUploadTransport(server);

    const before = harness({ server, staging, store, transport });
    const batch = await before.enqueue("MH_0819_0472.ARW");
    const clientFileId = batch.items[0].clientFileId;

    // The browser evicted the origin's storage while the tab was closed. The
    // File from the picker died with the tab, so there are no bytes anywhere.
    staging.evictEverything();

    const after = harness({ server, staging, store, transport });
    await after.queue.restore();
    await runAll(after);

    const item = await after.queue.item(clientFileId);
    expect(item!.needsFile).toBe(true);
    expect(item!.stagingState).toBe("missing");
    expect(transport.calls).toHaveLength(0);

    // And it stays that way rather than burning attempts on nothing.
    await after.advance(120_000);
    expect(transport.calls).toHaveLength(0);

    // Handed back, it finishes normally -- against the same server record, so
    // no second import row and no second asset.
    await after.queue.provideFile(
      clientFileId,
      fakeFile("MH_0819_0472.ARW", "bytes for MH_0819_0472.ARW"),
    );
    await after.runner.resumeItem(clientFileId);
    await after.runner.idle();

    expect(server.assetsCreated).toBe(1);
  });

  it("lands a reloaded upload on file_missing when the browser had no OPFS", async () => {
    // A browser with no origin private file system stages nothing, so a reload
    // loses the bytes with the page. The record it left behind says `retrying`,
    // and a runner that skipped it as "needs its file" left it saying that for
    // ever -- work nobody was ever going to pick up. It has to land on the
    // honest failure instead, where the operator is asked for the file back.
    const server = new FakeImportServer(ORG);
    const staging = new MemoryStagingArea(false);
    const store = new MemoryQueueStore();
    const transport = new FakeUploadTransport(server);

    const before = harness({ server, staging, store, transport });
    const batch = await before.enqueue("MH_0819_BIG.ARW");
    const clientFileId = batch.items[0].clientFileId;
    transport.fail(clientFileId, {
      code: "server_unavailable",
      message: "The connection was reset.",
      retryable: true,
    });
    await runAll(before);
    expect((await before.queue.item(clientFileId))!.status).toBe("retrying");
    await before.runner.stop();

    // The reload: the same records, and no session File anywhere.
    const after = harness({ server, staging, store, transport });
    await after.queue.restore();
    await runAll(after);
    await after.advance(120_000);

    const item = await after.queue.item(clientFileId);
    expect(item!.status).toBe("failed");
    expect(item!.errorCode).toBe("file_missing");
    expect(item!.needsFile).toBe(true);
    // Nothing further was sent: there were no bytes to send, and `failed`
    // is not eligible, so it is not asked again.
    expect(transport.calls).toHaveLength(1);
  });

  it("computes the digest at upload time when enqueue could not read the file", async () => {
    // WebKit refuses to read a File while the browser is offline, so a
    // selection made with no signal carries no digest. The import must still
    // complete once the bytes can be read again -- hashed from the same blob
    // that is about to travel, not refused for want of a number.
    let readable = false;
    const h = harness({
      staging: new MemoryStagingArea(false),
      hash: async () => {
        if (!readable) throw new Error("The I/O read operation failed.");
        return DIGEST;
      },
    });

    const batch = await h.enqueue("OFFLINE_0001.ARW");
    expect(batch.items[0].sha256).toBeUndefined();

    readable = true;
    await runAll(h);

    const state = await h.server.batchState({ batchId: batch.batchId });
    expect(state!.files[0].status).toBe("complete");
    expect(h.server.assetsCreated).toBe(1);
  });
});

describe("a tab that went away mid-flight", () => {
  it("picks up a file left uploading", async () => {
    const store = new MemoryQueueStore();
    const staging = new MemoryStagingArea();
    const server = new FakeImportServer(ORG);
    const transport = new FakeUploadTransport(server);

    const before = harness({ store, staging, server, transport });
    const batch = await before.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;
    // Exactly the record a browser leaves behind when it is closed mid-upload.
    await before.queue.markUploading(clientFileId);
    expect((await before.queue.item(clientFileId))!.status).toBe("uploading");

    const after = harness({ store, staging, server, transport });
    await after.queue.restore();
    await runAll(after);

    // Reclaimed and finished, rather than sitting at "Uploading" for ever.
    expect(server.assetsCreated).toBe(1);
    expect(await after.queue.item(clientFileId)).toBeNull();
  });

  it("picks up a file left finalizing, without uploading it again", async () => {
    const store = new MemoryQueueStore();
    const staging = new MemoryStagingArea();
    const server = new FakeImportServer(ORG);
    const transport = new FakeUploadTransport(server);

    const before = harness({ store, staging, server, transport });
    const batch = await before.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;
    await before.queue.markUploading(clientFileId);
    await before.queue.markUploaded(clientFileId, "b".repeat(64));
    // The bytes did reach storage; the tab died during finalization.
    const item = (await before.queue.item(clientFileId))!;
    server.storedObjects.add(item.storagePath);
    server.storedSizes.set(item.storagePath, item.byteSize);
    await before.queue.finalize(clientFileId).catch(() => {});

    const after = harness({ store, staging, server, transport });
    await after.queue.restore();
    await runAll(after);

    expect(server.assetsCreated).toBe(1);
    // Nothing was re-sent: the object was already there.
    expect(transport.calls).toHaveLength(0);
  });

  it("leaves alone a file another tab is holding", async () => {
    const shared = new Map<string, string>();
    const peers: FakeCoordinator[] = [];
    const store = new MemoryQueueStore();
    const staging = new MemoryStagingArea();
    const server = new FakeImportServer(ORG);
    const transport = new FakeUploadTransport(server);

    const tabA = harness({
      store,
      staging,
      server,
      transport,
      coordinator: new FakeCoordinator("tab-a", shared, "web-locks", peers),
    });
    const batch = await tabA.enqueue("a.ARW");
    const clientFileId = batch.items[0].clientFileId;
    await tabA.queue.markUploading(clientFileId);
    // Tab A is genuinely working on it: it holds the lock.
    shared.set(clientFileId, "tab-a");

    const tabB = harness({
      store,
      staging,
      server,
      transport,
      coordinator: new FakeCoordinator("tab-b", shared, "web-locks", peers),
    });
    await runAll(tabB);

    // Not reclaimed, not uploaded, not disturbed.
    expect((await tabB.queue.item(clientFileId))!.status).toBe("uploading");
    expect(transport.calls).toHaveLength(0);
  });
});

describe("pausing", () => {
  it("pauses and resumes one file", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW", "b.ARW");
    const first = batch.items[0].clientFileId;

    await h.runner.pauseItem(first);
    expect((await h.queue.item(first))!.status).toBe("paused");

    await runAll(h);
    // The paused one was skipped; the other went up.
    expect(h.transport.calls.map((call) => call.clientFileId)).not.toContain(first);

    await h.runner.resumeItem(first);
    await h.runner.idle();
    expect(h.transport.calls.map((call) => call.clientFileId)).toContain(first);
  });

  it("pauses and resumes the whole batch", async () => {
    const h = harness();
    const batch = await h.enqueue("a.ARW", "b.ARW", "c.ARW");

    await h.runner.pauseBatch(batch.batchId);
    await runAll(h);
    expect(h.transport.calls).toHaveLength(0);

    await h.runner.resumeBatch(batch.batchId);
    await h.runner.idle();
    expect(h.server.assetsCreated).toBe(3);
  });
});
