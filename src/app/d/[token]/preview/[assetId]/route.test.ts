/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markedPreviewKey } from "@/lib/preview-selection";

/**
 * The preview route without an image library.
 *
 * What is pinned: that importing the route does not load sharp; that every
 * refusal -- malformed, unknown, expired, withdrawn, foreign frame -- is the
 * same neutral 404 reached without the image library; that a cached mark is
 * served without it; that a new mark loads it only after the token has been
 * authorized and the frozen source read; that a library that cannot load, or
 * a render that fails, answers 404 and never the clean source; and that no
 * token, bucket, key or library message reaches a log line or a response.
 */

const TOKEN = "t".repeat(43);
const OTHER_TOKEN = "u".repeat(43);
const ASSET = "a0000000-0000-0000-0000-0000000000d1";
const ROW = {
  snapshot_id: "11111111-2222-3333-4444-555555555555",
  sha256: "b".repeat(64),
  storage_bucket: "derivatives",
  object_key: "aaaaaaaa-0000-0000-0000-000000000001/shoot/MH_0819_0472_delivery.jpg",
  recipient_label: "NY picture desk",
  credit_line: "Marcus Hale / Mastline",
  sent_on: "2026-08-28T10:00:00Z",
};
const CLEAN_SOURCE = Buffer.from("clean-source-bytes-that-must-never-be-served");
const CACHED_MARK = Buffer.from("cached-marked-jpeg");
const FRESH_MARK = Buffer.from("freshly-marked-jpeg");

/** Every call the route makes, in order, so the sequence itself can be asserted. */
let calls: string[];
const rpc = vi.fn();
const download = vi.fn();
const upload = vi.fn();
const from = vi.fn((bucket: string) => ({
  download: (key: string) => {
    calls.push(`download ${bucket} ${key}`);
    return download(bucket, key);
  },
  upload: (key: string, body: unknown, options: unknown) => {
    calls.push(`upload ${bucket} ${key}`);
    return upload(key, body, options);
  },
}));

/**
 * The image library, as a switch the test flips: loadable and working,
 * loadable and failing, or refusing to load at all -- the shape of a native
 * module missing its shared library on a serverless host.
 */
const watermark = vi.fn();
/** How many times the watermark module was actually evaluated. */
let watermarkLoads = 0;
/**
 * Registered per test with `vi.doMock`, because a `vi.mock` factory's result
 * is cached for the file and `vi.resetModules()` does not re-run it.
 */
function mockWatermark(mode: "ok" | "throws") {
  vi.doMock("@/lib/images/watermark.server", () => {
    watermarkLoads += 1;
    if (mode === "throws") {
      throw new Error('Could not load the "sharp" module using the linux-x64 runtime');
    }
    return {
      watermarkPreview: (...args: unknown[]) => {
        calls.push("watermark");
        return watermark(...args);
      },
    };
  });
}
// sharp itself must never be reached by this route in these tests.
vi.mock("sharp", () => {
  throw new Error("sharp was imported");
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("the preview route must not use the anonymous client");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (...args: unknown[]) => {
      calls.push(`rpc ${String(args[0])}`);
      return rpc(...args);
    },
    storage: { from },
  }),
}));

function call(token = TOKEN, assetId = ASSET) {
  return import("./route").then(({ GET }) =>
    GET(new Request(`http://mastline.test/d/${token}/preview/${assetId}`), {
      params: Promise.resolve({ token, assetId }),
    }),
  );
}

function authorized() {
  rpc.mockImplementation(async (name: string) => {
    if (name === "delivery_preview") return { data: [ROW], error: null };
    throw new Error(`unexpected rpc ${name}`);
  });
}

function refused() {
  rpc.mockResolvedValue({ data: [], error: null });
}

/** The cache is empty, the frozen source reads fine. */
function cacheMissSourceOk() {
  download.mockImplementation(async (bucket: string, key: string) => {
    if (key === ROW.object_key && bucket === ROW.storage_bucket) {
      return { data: new Blob([CLEAN_SOURCE]), error: null };
    }
    return { data: null, error: { message: "Object not found" } };
  });
}

let logged: string[];

beforeEach(() => {
  vi.resetModules();
  calls = [];
  watermarkLoads = 0;
  mockWatermark("ok");
  rpc.mockReset();
  download.mockReset();
  upload.mockReset().mockResolvedValue({ data: null, error: null });
  watermark.mockReset().mockResolvedValue({ body: FRESH_MARK, contentType: "image/jpeg" });
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** What must never appear in a log line or a body. */
const SECRETS = [TOKEN, OTHER_TOKEN, ROW.object_key, ROW.storage_bucket, ROW.sha256, "libvips"];

function expectNothingLeaked() {
  for (const line of logged) {
    for (const secret of SECRETS) expect(line).not.toContain(secret);
  }
}

describe("without the image library", () => {
  it("imports without loading sharp, even when the library cannot load", async () => {
    mockWatermark("throws");
    await expect(import("./route")).resolves.toHaveProperty("GET");
    // The module that would pull in sharp was never evaluated.
    expect(watermarkLoads).toBe(0);
    expect(calls).toEqual([]);
  });

  it("refuses a malformed token before anything is looked up, even with a broken library", async () => {
    mockWatermark("throws");
    const response = await call("not-a-token");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(calls).toEqual([]);
    expectNothingLeaked();
  });

  it("refuses a malformed asset id the same way", async () => {
    const response = await call(TOKEN, "not-an-id");
    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("refuses a well-formed unknown, expired, withdrawn, or foreign token without the library", async () => {
    refused();
    const response = await call(OTHER_TOKEN);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    // The database was asked once, with the token, and nothing else happened.
    expect(calls).toEqual(["rpc delivery_preview"]);
    expect(rpc).toHaveBeenCalledWith("delivery_preview", {
      delivery_token: OTHER_TOKEN,
      target_asset: ASSET,
    });
    expect(watermark).not.toHaveBeenCalled();
    expectNothingLeaked();
  });

  it("treats a database error as the same neutral refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied for function" } });
    const response = await call();
    expect(response.status).toBe(404);
    expect(calls).toEqual(["rpc delivery_preview"]);
    expectNothingLeaked();
  });

  it("serves a cached mark without the library, under the snapshot-derived key", async () => {
    authorized();
    const key = markedPreviewKey({ token: TOKEN, snapshotId: ROW.snapshot_id, sha256: ROW.sha256 });
    download.mockImplementation(async (_bucket: string, requested: string) =>
      requested === key
        ? { data: new Blob([CACHED_MARK]), error: null }
        : { data: null, error: { message: "Object not found" } },
    );

    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=900");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(CACHED_MARK);
    expect(calls).toEqual(["rpc delivery_preview", `download derivatives ${key}`]);
    expect(key).toBe(`watermarked/${TOKEN.slice(0, 24)}/${ROW.snapshot_id}-${"b".repeat(16)}.jpg`);
    expect(watermark).not.toHaveBeenCalled();
  });
});

describe("with the image library", () => {
  it("loads it only after authorization, a cache miss, and the frozen source, then caches the mark", async () => {
    authorized();
    cacheMissSourceOk();
    const key = markedPreviewKey({ token: TOKEN, snapshotId: ROW.snapshot_id, sha256: ROW.sha256 });

    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=900");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(FRESH_MARK);
    expect(calls).toEqual([
      "rpc delivery_preview",
      `download derivatives ${key}`,
      `download ${ROW.storage_bucket} ${ROW.object_key}`,
      "watermark",
      `upload derivatives ${key}`,
    ]);
    // Marked from the frozen bytes, for this recipient, with the recorded facts.
    expect(watermark).toHaveBeenCalledWith(CLEAN_SOURCE, {
      recipient: ROW.recipient_label,
      credit: ROW.credit_line,
      sentOn: "28 Aug 2026",
    });
    expect(upload).toHaveBeenCalledWith(key, FRESH_MARK, {
      contentType: "image/jpeg",
      upsert: true,
    });
    expectNothingLeaked();
  });

  it("answers 404, never the clean source, when the library cannot load", async () => {
    mockWatermark("throws");
    authorized();
    cacheMissSourceOk();

    const response = await call();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(calls.some((c) => c.startsWith("upload"))).toBe(false);
    expect(watermark).not.toHaveBeenCalled();
    // The operator learns the class of failure and the frame, and nothing else.
    expect(logged).toEqual([`delivery preview: watermark_runtime_unavailable for frame ${ASSET}`]);
    expectNothingLeaked();
  });

  it("answers 404, never the clean source, when the render fails", async () => {
    authorized();
    cacheMissSourceOk();
    watermark.mockRejectedValue(new Error("libvips: unsupported image format"));

    const response = await call();
    expect(response.status).toBe(404);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(CLEAN_SOURCE)).toBe(false);
    expect(calls.some((c) => c.startsWith("upload"))).toBe(false);
    expect(logged).toEqual([`delivery preview: watermark_failed for frame ${ASSET}`]);
    expectNothingLeaked();
  });

  it("answers 404 when the frozen source cannot be read, without touching the library", async () => {
    authorized();
    download.mockResolvedValue({ data: null, error: { message: "Object not found" } });

    const response = await call();
    expect(response.status).toBe(404);
    expect(watermark).not.toHaveBeenCalled();
    expect(logged).toEqual([`delivery preview: source_unreadable for frame ${ASSET}`]);
    expectNothingLeaked();
  });
});
