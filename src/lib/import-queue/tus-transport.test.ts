import { beforeEach, describe, expect, it } from "vitest";
import { SUPABASE_TUS_CHUNK_SIZE, TusUploadTransport } from "./tus-transport";
import { FakeTusClient } from "./testing";
import type { QueueItemRecord } from "./types";

/**
 * The transport, against a TUS client that answers without a network.
 *
 * What matters here is the contract with Supabase Storage: the chunk size it
 * insists on, the metadata it reads, the credential it is given, and the two
 * things it must never be sent -- a service key, and an upsert.
 */

const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
const BATCH = "b1111111-0000-4000-8000-000000000001";
const ENDPOINT = "https://project.storage.supabase.co/storage/v1/upload/resumable";

const ITEM: QueueItemRecord = {
  clientFileId: "abc123",
  organizationId: ORG,
  shootId: "a0000000-0000-0000-0000-0000000000c1",
  batchId: BATCH,
  batchIdempotencyKey: BATCH,
  importFileId: "if-1",
  originalFilename: "MH_0819_0472.ARW",
  byteSize: 12,
  mimeType: "image/x-sony-arw",
  status: "staged",
  stagingState: "staged",
  storageBucket: "originals",
  storagePath: `${ORG}/_staging/${BATCH}/abc123`,
  attemptCount: 0,
  createdAt: "2026-08-29T09:00:00.000Z",
  updatedAt: "2026-08-29T09:00:00.000Z",
};

const BLOB = new Blob(["twelve bytes"]);

function transportFor(
  client: FakeTusClient,
  overrides: {
    token?: string | null;
    refreshed?: string | null;
    online?: () => boolean;
  } = {},
) {
  const refreshes: number[] = [];
  const transport = new TusUploadTransport({
    endpoint: ENDPOINT,
    accessToken: async () => (overrides.token === undefined ? "token-one" : overrides.token),
    refreshAccessToken: async () => {
      refreshes.push(1);
      return overrides.refreshed === undefined ? "token-two" : overrides.refreshed;
    },
    createUpload: client.factory(),
    online: overrides.online,
  });
  return { transport, refreshes };
}

describe("what Supabase Storage is sent", () => {
  let client: FakeTusClient;

  beforeEach(() => {
    client = new FakeTusClient();
  });

  it("uses the 6 MiB chunk size the service requires", async () => {
    const { transport } = transportFor(client);
    await transport.upload({ item: ITEM, blob: BLOB });

    // Six mebibytes exactly. Supabase rejects anything else, and the
    // documentation says not to change it.
    expect(SUPABASE_TUS_CHUNK_SIZE).toBe(6 * 1024 * 1024);
    expect(SUPABASE_TUS_CHUNK_SIZE).toBe(6_291_456);
    expect(client.lastOptions.chunkSize).toBe(6 * 1024 * 1024);
  });

  it("posts to the resumable endpoint it was given", async () => {
    const { transport } = transportFor(client);
    await transport.upload({ item: ITEM, blob: BLOB });
    expect(client.lastOptions.endpoint).toBe(ENDPOINT);
  });

  it("sends the bucket, the object path, the type, and a cache header", async () => {
    const { transport } = transportFor(client);
    await transport.upload({ item: ITEM, blob: BLOB });

    expect(client.lastOptions.metadata).toEqual({
      bucketName: "originals",
      objectName: `${ORG}/_staging/${BATCH}/abc123`,
      contentType: "image/x-sony-arw",
      cacheControl: "3600",
    });
    // The camera's filename is the operator's record, not a path.
    expect(JSON.stringify(client.lastOptions.metadata)).not.toContain("MH_0819_0472");
  });

  it("carries the user's own token and never an upsert", async () => {
    const { transport } = transportFor(client);
    await transport.upload({ item: ITEM, blob: BLOB });

    expect(client.lastOptions.headers.authorization).toBe("Bearer token-one");
    // An original is written once. Overwriting is not a thing this may do.
    expect(client.lastOptions.headers["x-upsert"]).toBeUndefined();
    expect(JSON.stringify(client.lastOptions.headers)).not.toMatch(/service_role|secret/i);
  });

  it("leaves retry timing to the queue", async () => {
    const { transport } = transportFor(client);
    await transport.upload({ item: ITEM, blob: BLOB });

    // Two layers of retries would multiply into delays nobody chose, and the
    // operator would be shown neither.
    expect(client.lastOptions.retryDelays).toEqual([]);
    expect(client.lastOptions.onShouldRetry()).toBe(false);
  });

  it("asks for a resumable session and to forget the fingerprint afterwards", async () => {
    const { transport } = transportFor(client);
    await transport.upload({ item: ITEM, blob: BLOB });
    expect(client.lastOptions.uploadDataDuringCreation).toBe(true);
    expect(client.lastOptions.removeFingerprintOnSuccess).toBe(true);
    expect(client.lastOptions.storeFingerprintForResuming).toBe(true);
  });

  it("hands the session back the moment it exists", async () => {
    const { transport } = transportFor(client);
    const seen: string[] = [];
    const result = await transport.upload({
      item: ITEM,
      blob: BLOB,
      onUploadUrl: (url) => seen.push(url),
    });

    // Recorded before the bytes go, because the failure this defends against
    // is the tab closing mid-upload.
    expect(seen).toHaveLength(1);
    expect(result.ok).toBe(true);
    expect(result.uploadUrl).toBe(seen[0]);
  });
});

describe("resuming", () => {
  let client: FakeTusClient;

  beforeEach(() => {
    client = new FakeTusClient();
  });

  it("continues from the offset the server already holds", async () => {
    const url = "https://storage.test/upload/existing";
    // The server took two thirds of it before the connection went.
    client.serverOffsets.set(url, 8);

    const { transport } = transportFor(client);
    const progress: number[] = [];
    const result = await transport.upload({
      item: ITEM,
      blob: BLOB,
      resumeUrl: url,
      onProgress: (sent) => progress.push(sent),
    });

    expect(result.ok).toBe(true);
    // The same session, not a new one: no second creation happened.
    expect(client.lastOptions.uploadUrl).toBe(url);
    expect(client.sessions).toHaveLength(0);
    // And the chunk that was reported covers only what was left.
    expect(client.lastOptions.chunkSize).toBe(SUPABASE_TUS_CHUNK_SIZE);
    expect(progress.at(-1)).toBe(BLOB.size);
  });

  it("finds an unfinished session the client still remembers", async () => {
    client.previous = [
      {
        uploadUrl: "https://storage.test/upload/discovered",
        size: BLOB.size,
        creationTime: "2026-08-29T08:00:00.000Z",
      },
    ];
    client.serverOffsets.set("https://storage.test/upload/discovered", 6);

    const { transport } = transportFor(client);
    const result = await transport.upload({ item: ITEM, blob: BLOB });

    expect(result.ok).toBe(true);
    expect(result.uploadUrl).toBe("https://storage.test/upload/discovered");
    expect(client.sessions).toHaveLength(0);
  });

  it("ignores a remembered session for a different file", async () => {
    client.previous = [
      {
        uploadUrl: "https://storage.test/upload/someone-else",
        size: BLOB.size + 500,
        creationTime: "2026-08-29T08:00:00.000Z",
      },
    ];

    const { transport } = transportFor(client);
    await transport.upload({ item: ITEM, blob: BLOB });
    expect(client.sessions).toHaveLength(1);
  });

  it("reports an expired session as expired, not as a failed file", async () => {
    // Supabase expires a resumable URL after about a day. TUS answers a PATCH
    // to a URL it no longer knows with 404.
    client.script.push({ status: 404 });

    const { transport } = transportFor(client);
    const result = await transport.upload({
      item: ITEM,
      blob: BLOB,
      resumeUrl: "https://storage.test/upload/yesterday",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("upload_session_expired");
    expect(result.failure.restartSession).toBe(true);
    expect(result.failure.retryable).toBe(true);
  });
});

describe("credentials", () => {
  let client: FakeTusClient;

  beforeEach(() => {
    client = new FakeTusClient();
  });

  it("refreshes an expired session and tries once more", async () => {
    client.script.push({ status: 401 });

    const { transport, refreshes } = transportFor(client);
    const result = await transport.upload({ item: ITEM, blob: BLOB });

    expect(refreshes).toHaveLength(1);
    expect(result.ok).toBe(true);
    // The second attempt carried the new token.
    expect(client.uploads).toHaveLength(2);
    expect(client.uploads[1].options.headers.authorization).toBe("Bearer token-two");
  });

  it("gives up when the refresh cannot produce a session", async () => {
    client.script.push({ status: 401 });

    const { transport } = transportFor(client, { refreshed: null });
    const result = await transport.upload({ item: ITEM, blob: BLOB });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("authentication_expired");
    expect(client.uploads).toHaveLength(1);
  });

  it("does not start an upload when there is no session to be had", async () => {
    const { transport } = transportFor(client, { token: null, refreshed: null });
    const result = await transport.upload({ item: ITEM, blob: BLOB });

    expect(result.ok).toBe(false);
    expect(client.uploads).toHaveLength(0);
  });
});

describe("failures", () => {
  let client: FakeTusClient;

  beforeEach(() => {
    client = new FakeTusClient();
  });

  it("does not attempt an upload while offline", async () => {
    const { transport } = transportFor(client, { online: () => false });
    const result = await transport.upload({ item: ITEM, blob: BLOB });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("offline");
    expect(client.uploads).toHaveLength(0);
  });

  it("reports a conflict as a conflict, so it can be reconciled", async () => {
    client.script.push({ status: 409 });
    const { transport } = transportFor(client);
    const result = await transport.upload({ item: ITEM, blob: BLOB });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("object_conflict");
  });

  it("stops when asked, keeping the session for later", async () => {
    const controller = new AbortController();
    controller.abort();

    const { transport } = transportFor(client);
    const result = await transport.upload({ item: ITEM, blob: BLOB, signal: controller.signal });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.retryable).toBe(true);
  });

  it("gives up on a stalled connection rather than waiting forever", async () => {
    const stalling = new FakeTusClient();
    // A client that starts and then says nothing at all.
    stalling.factory = () => () => ({
      url: null,
      async abort() {},
      async findPreviousUploads() {
        return [];
      },
      resumeFromPreviousUpload() {},
      start() {},
    });

    const transport = new TusUploadTransport({
      endpoint: ENDPOINT,
      accessToken: async () => "token-one",
      refreshAccessToken: async () => "token-two",
      createUpload: stalling.factory(),
      stallTimeoutMs: 5,
    });

    const result = await transport.upload({ item: ITEM, blob: BLOB });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("timeout");
  });
});
