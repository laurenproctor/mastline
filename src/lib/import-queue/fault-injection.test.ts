import { beforeEach, describe, expect, it } from "vitest";
import { MemoryQueueStore } from "./memory-store";
import { ImportQueue } from "./queue";
import { ImportQueueRunner } from "./runner";
import {
  FakeCoordinator,
  FakeImportServer,
  FakeStorageCapacity,
  FakeTusClient,
  MemoryStagingArea,
  fakeFile,
} from "./testing";
import { TusUploadTransport } from "./tus-transport";
import type { ImportEventName } from "./telemetry";
import { createTelemetry } from "./telemetry";

/**
 * Every failure the storage service can hand back, through the real stack.
 *
 * Not the classifier in isolation -- the real transport, the real queue, and
 * the real runner, with only the TUS client and the clock replaced. What is
 * asserted is the thing an operator actually experiences: the state the row
 * ends in, the words on it, whether it will be tried again, and when.
 *
 * The status codes here are the ones Supabase Storage actually returns, and
 * each is listed in the hardening brief.
 */

const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
const SHOOT = "a0000000-0000-0000-0000-0000000000c1";
const DIGEST = "b".repeat(64);
const ENDPOINT = "https://project.storage.supabase.co/storage/v1/upload/resumable";

function uuids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function harness(options: { tokens?: (string | null)[] } = {}) {
  const client = new FakeTusClient();
  const server = new FakeImportServer(ORG);
  // A completed upload puts an object in the bucket, which is what the
  // verification step before finalization goes looking for.
  client.onStored = (objectName, size) => {
    server.storedObjects.add(objectName);
    server.storedSizes.set(objectName, size);
  };
  const staging = new MemoryStagingArea();
  const store = new MemoryQueueStore();
  const events: ImportEventName[] = [];

  let clock = Date.parse("2026-08-29T09:00:00.000Z");
  let online = true;
  const timers: { run: () => void; at: number; cancelled: boolean }[] = [];
  const tokens = [...(options.tokens ?? [])];
  const refreshes: string[] = [];

  const transport = new TusUploadTransport({
    endpoint: ENDPOINT,
    accessToken: async () => (tokens.length > 0 ? tokens.shift()! : "token-one"),
    refreshAccessToken: async () => {
      refreshes.push("refreshed");
      return "token-two";
    },
    createUpload: client.factory(),
    online: () => online,
  });

  const queue = new ImportQueue({
    organizationId: ORG,
    store,
    staging,
    capacity: new FakeStorageCapacity(),
    server,
    hash: async () => DIGEST,
    newId: uuids(),
    now: () => new Date(clock),
    telemetry: createTelemetry({ emit: (name) => events.push(name) }),
  });

  const runner = new ImportQueueRunner({
    queue,
    transport,
    coordinator: new FakeCoordinator("tab-a"),
    backoff: { random: () => 1 },
    now: () => new Date(clock),
    online: () => online,
    schedule: (run, delayMs) => {
      const timer = { run, at: clock + delayMs, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    telemetry: createTelemetry({ emit: (name) => events.push(name) }),
  });

  return {
    client,
    server,
    staging,
    queue,
    runner,
    events,
    refreshes,
    setOnline(next: boolean) {
      online = next;
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
    async enqueue(name = "MH_0819_0472.ARW") {
      const result = await queue.enqueue({ shootId: SHOOT, files: [fakeFile(name, "raw bytes")] });
      return result.items[0].clientFileId;
    },
    async run() {
      runner.start();
      await runner.idle();
    },
  };
}

type Harness = ReturnType<typeof harness>;

/** The row as a photographer would read it. */
async function row(h: Harness, clientFileId: string) {
  const item = await h.queue.item(clientFileId);
  return {
    status: item?.status,
    code: item?.errorCode,
    message: item?.errorMessage,
    nextAttemptAt: item?.nextAttemptAt,
    attempts: item?.attemptCount,
  };
}

describe("injected transport failures", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("a lost connection waits rather than failing", async () => {
    const id = await h.enqueue();
    h.setOnline(false);
    await h.run();

    // Nothing was even attempted, and the file is not red.
    expect(h.client.uploads).toHaveLength(0);
    expect((await row(h, id)).status).toBe("staged");
  });

  it("a network error mid-upload is retried", async () => {
    const id = await h.enqueue();
    h.client.script.push({ error: new Error("connection reset") });
    await h.run();

    const waiting = await row(h, id);
    expect(waiting.status).toBe("retrying");
    expect(waiting.code).toBe("server_unavailable");

    await h.advance(2_000);
    expect(h.server.assetsCreated).toBe(1);
  });

  it("a stalled request is a timeout, and is retried", async () => {
    const id = await h.enqueue();
    h.client.script.push({ error: new Error("the request timed out") });
    await h.run();

    expect((await row(h, id)).code).toBe("timeout");
    await h.advance(2_000);
    expect(h.server.assetsCreated).toBe(1);
  });

  it("401 refreshes the session and carries on", async () => {
    const id = await h.enqueue();
    h.client.script.push({ status: 401 });
    await h.run();

    // Recovered inside the transport: no retry was scheduled and the operator
    // saw nothing. An hour of uploading outlives an access token.
    expect(h.refreshes).toHaveLength(1);
    expect(h.client.uploads[1].options.headers.authorization).toBe("Bearer token-two");
    expect(h.server.assetsCreated).toBe(1);
    expect(await h.queue.item(id)).toBeNull();
  });

  it("403 stops and says the account is not allowed", async () => {
    const id = await h.enqueue();
    h.client.script.push({ status: 403, body: "new row violates row-level security policy" });
    await h.run();
    await h.advance(300_000);

    const failed = await row(h, id);
    expect(failed.status).toBe("failed");
    expect(failed.code).toBe("authorization_denied");
    expect(failed.message).toContain("not allowed to import");
    // Never retried. Asking again cannot change a policy.
    expect(h.client.uploads).toHaveLength(1);
  });

  it("409 reconciles against what storage actually holds", async () => {
    const id = await h.enqueue();
    const item = (await h.queue.item(id))!;
    h.server.storedObjects.add(item.storagePath);
    h.server.storedSizes.set(item.storagePath, item.byteSize);
    h.client.script.push({ status: 409 });

    await h.run();

    // The file was already there. It became an asset without being sent twice.
    expect(h.server.assetsCreated).toBe(1);
    expect(h.client.uploads).toHaveLength(1);
  });

  it("410 rebuilds the session instead of blaming the file", async () => {
    const id = await h.enqueue();
    await h.queue.recordUploadSession(id, "https://storage.test/upload/yesterday");
    h.client.script.push({ status: 410 });

    await h.run();

    // No wait at all: an expired session is not a reason to make anybody sit
    // there, so the rebuild happens within the same pass. That is why there is
    // no intermediate state to assert -- the outcome is the assertion.
    expect(h.client.uploads).toHaveLength(2);
    expect(h.client.uploads[0].options.uploadUrl).toBe("https://storage.test/upload/yesterday");
    // A brand new session, and the dead URL is gone.
    expect(h.client.uploads[1].options.uploadUrl).toBeUndefined();
    expect(h.server.assetsCreated).toBe(1);
    // And it finished, rather than being left as a failed file.
    expect(await h.queue.item(id)).toBeNull();
  });

  it("413 stops: the bucket will not take this file", async () => {
    const id = await h.enqueue();
    h.client.script.push({ status: 413 });
    await h.run();
    await h.advance(300_000);

    const failed = await row(h, id);
    expect(failed.status).toBe("failed");
    expect(failed.code).toBe("unsupported_file");
    expect(h.client.uploads).toHaveLength(1);
  });

  it("429 waits exactly as long as the server asked", async () => {
    const id = await h.enqueue();
    h.client.script.push({ status: 429, headers: { "retry-after": "30" } });
    await h.run();

    const waiting = await row(h, id);
    expect(waiting.status).toBe("retrying");
    expect(waiting.code).toBe("server_unavailable");
    // Thirty seconds, not the one second the backoff would have chosen.
    expect(waiting.nextAttemptAt).toBe("2026-08-29T09:00:30.000Z");

    await h.advance(29_000);
    expect(h.client.uploads).toHaveLength(1);
    await h.advance(2_000);
    expect(h.server.assetsCreated).toBe(1);
  });

  it("500 backs off and recovers", async () => {
    const id = await h.enqueue();
    h.client.script.push({ status: 500 });
    await h.run();

    expect((await row(h, id)).nextAttemptAt).toBe("2026-08-29T09:00:01.000Z");
    await h.advance(1_100);
    expect(h.server.assetsCreated).toBe(1);
  });

  it("503 repeatedly gives up rather than trying all night", async () => {
    const id = await h.enqueue();
    for (let attempt = 0; attempt < 8; attempt += 1) h.client.script.push({ status: 503 });

    await h.run();
    for (let step = 0; step < 8; step += 1) await h.advance(120_000);

    const failed = await row(h, id);
    expect(failed.status).toBe("failed");
    expect(failed.message).toContain("Tried");
    // Six attempts, the documented ceiling.
    expect(h.client.uploads).toHaveLength(6);
  });

  it("a finalization failure after a good upload never re-sends the bytes", async () => {
    const id = await h.enqueue();
    const real = h.server.finalize.bind(h.server);
    let failures = 1;
    h.server.finalize = async (input) =>
      failures-- > 0
        ? { ok: false, errorCode: "finalization_failed", error: "The database was busy." }
        : real(input);

    await h.run();

    expect(h.client.uploads).toHaveLength(1);
    expect((await row(h, id)).status).toBe("retrying");
    expect(h.events).toContain("finalization_failed");

    await h.advance(5_000);
    expect(h.client.uploads).toHaveLength(1);
    expect(h.server.assetsCreated).toBe(1);
  });

  it("reports each stage to the collector, and only in safe terms", async () => {
    await h.enqueue();
    await h.run();

    expect(h.events).toEqual(
      expect.arrayContaining([
        "import_batch_created",
        "import_file_staged",
        "upload_started",
        "upload_completed",
        "import_file_completed",
        "import_batch_completed",
      ]),
    );
  });
});
