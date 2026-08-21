/**
 * Inbound delivery webhooks.
 *
 * Providers retry. A retry must not create a second submission, a second
 * delivery attempt, or a second activity event, so every inbound event is
 * claimed by its provider event id before anything else happens. The unique
 * constraint on webhook_events is the guarantee; this module is the protocol
 * around it.
 *
 * Signature verification uses a timing-safe comparison. A webhook endpoint is
 * an unauthenticated door into the workspace, and an early-exit compare on the
 * signature is a real way through it.
 */

export type WebhookOutcome =
  | { readonly kind: "processed"; readonly detail: string }
  | { readonly kind: "duplicate"; readonly detail: string }
  | { readonly kind: "rejected"; readonly status: number; readonly detail: string };

export interface DeliveryWebhookPayload {
  readonly eventId: string;
  readonly reference: string;
  readonly status: "delivered" | "failed";
  readonly errorCode?: string;
  readonly errorDetail?: string;
  readonly occurredAt?: string;
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/** HMAC-SHA256 of the raw body, hex encoded. */
export async function signBody(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifySignature(
  body: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  const expected = await signBody(body, secret);
  // Accept a "sha256=" prefix, which several providers send.
  const provided = header.startsWith("sha256=") ? header.slice(7) : header;
  return timingSafeEqual(expected, provided.toLowerCase());
}

/** Read a delivery event, rejecting anything malformed rather than guessing. */
export function parseDeliveryPayload(raw: unknown): DeliveryWebhookPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;

  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  const status = body.status;

  if (!eventId || !reference) return null;
  if (status !== "delivered" && status !== "failed") return null;

  return {
    eventId,
    reference,
    status,
    errorCode: typeof body.error_code === "string" ? body.error_code : undefined,
    errorDetail: typeof body.error_detail === "string" ? body.error_detail : undefined,
    occurredAt: typeof body.occurred_at === "string" ? body.occurred_at : undefined,
  };
}
