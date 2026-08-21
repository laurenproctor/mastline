import { describe, expect, it } from "vitest";
import { translateStripeEvent, verifyStripeSignature } from "./stripe";

const SECRET = "whsec_test_secret";
const NOW = new Date("2026-08-21T12:00:00.000Z");

async function sign(body: string, timestamp: number, secret = SECRET): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${hex}`;
}

describe("webhook signatures", () => {
  const body = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
  const timestamp = Math.floor(NOW.getTime() / 1000);

  it("accepts a correctly signed request", async () => {
    expect(await verifyStripeSignature(body, await sign(body, timestamp), SECRET, NOW)).toBe(true);
  });

  it("rejects a signature made with a different secret", async () => {
    const header = await sign(body, timestamp, "whsec_wrong");
    expect(await verifyStripeSignature(body, header, SECRET, NOW)).toBe(false);
  });

  it("rejects a signature for a different body", async () => {
    const header = await sign(body, timestamp);
    expect(await verifyStripeSignature(`${body} `, header, SECRET, NOW)).toBe(false);
  });

  /**
   * The timestamp is what stops a captured request being replayed tomorrow.
   * Without the tolerance check a valid signature would be valid forever.
   */
  it("rejects a request older than the tolerance", async () => {
    const old = timestamp - 3600;
    expect(await verifyStripeSignature(body, await sign(body, old), SECRET, NOW)).toBe(false);
  });

  it("rejects a request timestamped in the future beyond tolerance", async () => {
    const future = timestamp + 3600;
    expect(await verifyStripeSignature(body, await sign(body, future), SECRET, NOW)).toBe(false);
  });

  it("accepts one inside the tolerance", async () => {
    const recent = timestamp - 120;
    expect(await verifyStripeSignature(body, await sign(body, recent), SECRET, NOW)).toBe(true);
  });

  it("accepts a header carrying several signatures, as during a rotation", async () => {
    const valid = await sign(body, timestamp);
    const hex = valid.split("v1=")[1];
    const header = `t=${timestamp},v1=${"0".repeat(64)},v1=${hex}`;
    expect(await verifyStripeSignature(body, header, SECRET, NOW)).toBe(true);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["no timestamp", "v1=abc"],
    ["a non-numeric timestamp", "t=soon,v1=abc"],
  ])("rejects a %s signature header", async (_label, header) => {
    expect(await verifyStripeSignature(body, header, SECRET, NOW)).toBe(false);
  });
});

describe("translating Stripe events", () => {
  const event = (type: string, object: Record<string, unknown>) => ({
    id: `evt_${type}`,
    type,
    data: { object },
  });

  it("reads a completed checkout as a subscription starting", () => {
    const parsed = translateStripeEvent(
      event("checkout.session.completed", {
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: "org_1",
      }),
    );
    expect(parsed?.kind).toBe("subscription_started");
    expect(parsed?.organizationId).toBe("org_1");
    expect(parsed?.subscriptionId).toBe("sub_1");
    expect(parsed?.hasPaymentMethod).toBe(true);
  });

  it("prefers metadata over the client reference for the workspace", () => {
    const parsed = translateStripeEvent(
      event("checkout.session.completed", {
        client_reference_id: "org_from_reference",
        metadata: { organization_id: "org_from_metadata" },
      }),
    );
    expect(parsed?.organizationId).toBe("org_from_metadata");
  });

  it.each([
    ["active", "active"],
    ["trialing", "trialing"],
    ["past_due", "past_due"],
    ["unpaid", "past_due"],
    ["canceled", "cancelled"],
  ])("maps a %s subscription to %s", (stripeStatus, expected) => {
    const parsed = translateStripeEvent(
      event("customer.subscription.updated", {
        id: "sub_1",
        status: stripeStatus,
        metadata: { organization_id: "org_1" },
      }),
    );
    expect(parsed?.status).toBe(expected);
  });

  it("reads the period end as an ISO instant", () => {
    const parsed = translateStripeEvent(
      event("customer.subscription.updated", {
        id: "sub_1",
        status: "active",
        current_period_end: 1_790_000_000,
        metadata: { organization_id: "org_1" },
      }),
    );
    expect(parsed?.currentPeriodEnd).toBe(new Date(1_790_000_000 * 1000).toISOString());
  });

  it("carries a pending cancellation", () => {
    const parsed = translateStripeEvent(
      event("customer.subscription.updated", {
        id: "sub_1",
        status: "active",
        cancel_at_period_end: true,
        metadata: { organization_id: "org_1" },
      }),
    );
    expect(parsed?.cancelAtPeriodEnd).toBe(true);
  });

  it("reads a failed invoice as past due", () => {
    const parsed = translateStripeEvent(
      event("invoice.payment_failed", { subscription: "sub_1", customer: "cus_1" }),
    );
    expect(parsed?.kind).toBe("payment_failed");
    expect(parsed?.status).toBe("past_due");
  });

  it("reads a paid invoice as active", () => {
    const parsed = translateStripeEvent(
      event("invoice.paid", { subscription: "sub_1", customer: "cus_1" }),
    );
    expect(parsed?.kind).toBe("payment_succeeded");
    expect(parsed?.status).toBe("active");
  });

  it("reads a deleted subscription as cancelled", () => {
    const parsed = translateStripeEvent(
      event("customer.subscription.deleted", { id: "sub_1", metadata: { organization_id: "o" } }),
    );
    expect(parsed?.kind).toBe("subscription_cancelled");
    expect(parsed?.status).toBe("cancelled");
  });

  /**
   * Stripe sends dozens of event types. Anything not recognised is reported as
   * unhandled and acknowledged, rather than guessed at or retried forever.
   */
  it("marks an unrecognised event unhandled rather than guessing", () => {
    const parsed = translateStripeEvent(event("customer.discount.created", {}));
    expect(parsed?.kind).toBe("unhandled");
  });

  it.each([
    ["no id", { type: "invoice.paid" }],
    ["no type", { id: "evt_1" }],
    ["neither", {}],
  ])("refuses a payload with %s", (_label, payload) => {
    expect(translateStripeEvent(payload as Record<string, unknown>)).toBeNull();
  });
});
