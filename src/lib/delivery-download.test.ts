import { describe, expect, it, vi } from "vitest";
import { type DownloadAuthorization, serveDeliveryDownload } from "./delivery-download";

const FROZEN: DownloadAuthorization = {
  objectKey: "aaaaaaaa-0000-0000-0000-000000000001/shoot/MH_0819_0472_delivery.jpg",
  storageBucket: "derivatives",
  filename: "MH_0819_0472",
};

/**
 * The order is the contract: authorise, sign, record, release. Each test
 * breaks one step and checks that nothing after it happened.
 */
describe("serveDeliveryDownload", () => {
  it("signs the exact authorised object, records, then releases", async () => {
    const calls: string[] = [];
    const sign = vi.fn(async (target: DownloadAuthorization) => {
      calls.push("sign");
      expect(target).toEqual(FROZEN);
      return { url: "https://storage.example/signed" };
    });
    const record = vi.fn(async () => {
      calls.push("record");
      return true;
    });

    const outcome = await serveDeliveryDownload({
      authorize: async () => {
        calls.push("authorize");
        return FROZEN;
      },
      sign,
      record,
    });

    expect(outcome).toEqual({ kind: "released", url: "https://storage.example/signed" });
    expect(calls).toEqual(["authorize", "sign", "record"]);
  });

  it("refuses without signing or recording when the record says no", async () => {
    const sign = vi.fn();
    const record = vi.fn();

    const outcome = await serveDeliveryDownload({ authorize: async () => null, sign, record });

    expect(outcome).toEqual({ kind: "refused" });
    expect(sign).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("writes no download event when signing fails", async () => {
    const record = vi.fn(async () => true);

    const outcome = await serveDeliveryDownload({
      authorize: async () => FROZEN,
      sign: async () => null,
      record,
    });

    expect(outcome).toEqual({ kind: "unavailable", reason: "unsigned" });
    expect(record).not.toHaveBeenCalled();
  });

  it("treats a signer that throws the same as one that returns nothing", async () => {
    const record = vi.fn(async () => true);

    const outcome = await serveDeliveryDownload({
      authorize: async () => FROZEN,
      sign: async () => {
        throw new Error(`bucket derivatives key ${FROZEN.objectKey} unreadable`);
      },
      record,
    });

    expect(outcome).toEqual({ kind: "unavailable", reason: "unsigned" });
    expect(record).not.toHaveBeenCalled();
  });

  it("releases nothing when the download cannot be recorded", async () => {
    const outcome = await serveDeliveryDownload({
      authorize: async () => FROZEN,
      sign: async () => ({ url: "https://storage.example/signed" }),
      record: async () => false,
    });

    expect(outcome).toEqual({ kind: "unavailable", reason: "unrecorded" });
  });

  it("releases nothing when the record write throws", async () => {
    const outcome = await serveDeliveryDownload({
      authorize: async () => FROZEN,
      sign: async () => ({ url: "https://storage.example/signed" }),
      record: async () => {
        throw new Error("connection reset");
      },
    });

    expect(outcome).toEqual({ kind: "unavailable", reason: "unrecorded" });
  });

  it("puts no bucket, key, or token into a non-released outcome", async () => {
    const outcomes = await Promise.all([
      serveDeliveryDownload({ authorize: async () => null, sign: vi.fn(), record: vi.fn() }),
      serveDeliveryDownload({
        authorize: async () => FROZEN,
        sign: async () => null,
        record: vi.fn(),
      }),
      serveDeliveryDownload({
        authorize: async () => FROZEN,
        sign: async () => ({ url: "https://storage.example/signed" }),
        record: async () => false,
      }),
    ]);

    for (const outcome of outcomes) {
      const serialized = JSON.stringify(outcome);
      expect(serialized).not.toContain(FROZEN.objectKey);
      expect(serialized).not.toContain("derivatives");
      expect(serialized).not.toContain("https://storage.example/signed");
    }
  });
});
