/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The download route with a signer under the test's control.
 *
 * What is pinned: the order authorise → sign → record → release, that a
 * signing failure writes no `downloaded` event, that a failed record releases
 * nothing, that the released URL is the one signed for the exact frozen
 * object, and that no storage key or token reaches a log line or a response.
 */

const TOKEN = "t".repeat(43);
const ASSET = "a0000000-0000-0000-0000-0000000000d1";
const FROZEN = {
  object_key: "aaaaaaaa-0000-0000-0000-000000000001/shoot/MH_0819_0472_delivery.jpg",
  storage_bucket: "derivatives",
  filename: "MH_0819_0472",
};

const rpc = vi.fn();
const createSignedUrl = vi.fn();
const from = vi.fn(() => ({ createSignedUrl }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "desk" }),
}));
// Everything the route asks the database runs with the service role: the two
// functions are executable by nothing else. The anonymous server client is
// deliberately absent, so a call through it would fail loudly here.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("the download route must not use the anonymous client");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc, storage: { from } }),
}));

const { GET } = await import("./route");

function call() {
  return GET(new Request(`http://mastline.test/d/${TOKEN}/frame/${ASSET}`), {
    params: Promise.resolve({ token: TOKEN, assetId: ASSET }),
  });
}

function authorised() {
  rpc.mockImplementation(async (name: string) => {
    if (name === "authorize_delivery_download") return { data: [FROZEN], error: null };
    if (name === "record_delivery_download") {
      return { data: [{ recorded_at: "2026-08-28T10:00:00Z" }], error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
}

let logged: string[];

beforeEach(() => {
  rpc.mockReset();
  createSignedUrl.mockReset();
  from.mockClear();
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /d/[token]/frame/[assetId]", () => {
  it("signs the exact frozen object, records the download, then redirects", async () => {
    authorised();
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.test/sign/derivatives/frozen?token=signed" },
      error: null,
    });

    const response = await call();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://storage.test/sign/derivatives/frozen?token=signed",
    );

    // The object handed to the signer is the one the record authorised.
    expect(from).toHaveBeenCalledWith("derivatives");
    expect(createSignedUrl).toHaveBeenCalledWith(FROZEN.object_key, 300, {
      download: FROZEN.filename,
    });

    // authorise, then record -- and record only after signing.
    const names = rpc.mock.calls.map(([name]) => name);
    expect(names).toEqual(["authorize_delivery_download", "record_delivery_download"]);
    expect(createSignedUrl.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[1],
    );

    // Both calls carry the caller's address for the record, and the same frame.
    for (const [, args] of rpc.mock.calls) {
      expect(args).toMatchObject({
        delivery_token: TOKEN,
        target_asset: ASSET,
        caller_ip: "203.0.113.9",
        caller_agent: "desk",
      });
    }
  });

  it("writes no download event when signing fails", async () => {
    authorised();
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "object not found" } });

    const response = await call();

    expect(response.status).toBe(404);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["authorize_delivery_download"]);
    expect(await response.text()).toBe("Not found");
  });

  it("releases nothing when the download cannot be recorded", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "authorize_delivery_download") return { data: [FROZEN], error: null };
      return { data: null, error: { message: "connection reset" } };
    });
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.test/sign/derivatives/frozen?token=signed" },
      error: null,
    });

    const response = await call();

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).not.toContain("storage.test");
  });

  it("refuses without signing or recording when the record says no", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    const response = await call();

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["authorize_delivery_download"]);
  });

  it("names neither the storage key nor the token in a response or a log line", async () => {
    authorised();
    createSignedUrl.mockRejectedValue(
      new Error(`could not sign ${FROZEN.storage_bucket}/${FROZEN.object_key}`),
    );

    const response = await call();
    const body = await response.text();

    for (const text of [body, ...logged]) {
      expect(text).not.toContain(FROZEN.object_key);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("derivatives/");
    }
    // ...but the operator does learn that an authorised download was not released.
    expect(logged.join("\n")).toMatch(/authorised but not released/);
  });

  it("answers a malformed token or frame without touching the database", async () => {
    const response = await GET(new Request("http://mastline.test/d/short/frame/x"), {
      params: Promise.resolve({ token: "short", assetId: "not-a-record-id" }),
    });
    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
