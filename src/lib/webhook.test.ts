import { describe, expect, it } from "vitest";
import { parseDeliveryPayload, signBody, timingSafeEqual, verifySignature } from "./webhook";

describe("timingSafeEqual", () => {
  it("matches identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  it("rejects strings of different length", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("compares the whole string rather than stopping at the first difference", () => {
    // Both differ only in the last character; both must be rejected.
    expect(timingSafeEqual("aaaaaaaab", "aaaaaaaaa")).toBe(false);
    expect(timingSafeEqual("baaaaaaaa", "aaaaaaaaa")).toBe(false);
  });

  it("treats empty strings as equal", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("signatures", () => {
  const SECRET = "a-development-secret";
  const BODY = JSON.stringify({ event_id: "evt_1", reference: "BG-1", status: "delivered" });

  it("accepts a correct signature", async () => {
    const signature = await signBody(BODY, SECRET);
    expect(await verifySignature(BODY, signature, SECRET)).toBe(true);
  });

  it("accepts the sha256= prefix providers commonly send", async () => {
    const signature = await signBody(BODY, SECRET);
    expect(await verifySignature(BODY, `sha256=${signature}`, SECRET)).toBe(true);
  });

  it("rejects a signature made with a different secret", async () => {
    const signature = await signBody(BODY, "wrong-secret");
    expect(await verifySignature(BODY, signature, SECRET)).toBe(false);
  });

  it("rejects a signature for a different body", async () => {
    const signature = await signBody(BODY, SECRET);
    expect(await verifySignature(`${BODY} `, signature, SECRET)).toBe(false);
  });

  it("rejects a missing signature", async () => {
    expect(await verifySignature(BODY, null, SECRET)).toBe(false);
  });

  it("rejects an empty signature", async () => {
    expect(await verifySignature(BODY, "", SECRET)).toBe(false);
  });

  it("produces a stable hex digest", async () => {
    const first = await signBody(BODY, SECRET);
    const second = await signBody(BODY, SECRET);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("parseDeliveryPayload", () => {
  it("reads a well-formed delivered event", () => {
    const parsed = parseDeliveryPayload({
      event_id: "evt_1",
      reference: "BG-0819-441",
      status: "delivered",
    });
    expect(parsed?.eventId).toBe("evt_1");
    expect(parsed?.reference).toBe("BG-0819-441");
    expect(parsed?.status).toBe("delivered");
  });

  it("reads a failure with its error detail", () => {
    const parsed = parseDeliveryPayload({
      event_id: "evt_2",
      reference: "BG-1",
      status: "failed",
      error_code: "SFTP_AUTH",
      error_detail: "Credentials rejected by the host.",
    });
    expect(parsed?.errorCode).toBe("SFTP_AUTH");
    expect(parsed?.errorDetail).toMatch(/Credentials/);
  });

  it.each([
    ["no event id", { reference: "BG-1", status: "delivered" }],
    ["no reference", { event_id: "evt_1", status: "delivered" }],
    ["an unknown status", { event_id: "evt_1", reference: "BG-1", status: "maybe" }],
    ["a blank event id", { event_id: "   ", reference: "BG-1", status: "delivered" }],
  ])("rejects a payload with %s", (_label, payload) => {
    expect(parseDeliveryPayload(payload)).toBeNull();
  });

  it("rejects something that is not an object", () => {
    expect(parseDeliveryPayload(null)).toBeNull();
    expect(parseDeliveryPayload("delivered")).toBeNull();
    expect(parseDeliveryPayload(42)).toBeNull();
  });

  it("does not accept a status it was not told to expect", () => {
    // "sending" is a real internal status but is not something a provider
    // reports, so it must not be accepted from outside.
    expect(parseDeliveryPayload({ event_id: "e", reference: "r", status: "sending" })).toBeNull();
  });
});
