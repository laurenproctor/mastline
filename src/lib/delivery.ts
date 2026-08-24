import { randomBytes } from "node:crypto";

/**
 * Handing a package to a picture desk.
 *
 * A desk does not adopt software; it opens a link. So a delivery is a link:
 * unguessable, dated, withdrawable, and watched. The token is the only
 * credential the recipient has, which is why it is generated from a
 * cryptographic source and never derived from anything about the submission.
 *
 * Nothing in here sends anything. The operator creates the link and passes it
 * on themselves, because `CLAUDE.md` puts buyer communication among the things
 * a person must decide to do.
 */

/** 32 bytes, base64url. Long enough that guessing is not a strategy. */
export function newDeliveryToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The database check constraint, mirrored so a bad token fails here first. */
export function isDeliveryToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

export const DELIVERY_WINDOWS_DAYS = [3, 7, 14, 30] as const;
export type DeliveryWindowDays = (typeof DELIVERY_WINDOWS_DAYS)[number];
export const DEFAULT_DELIVERY_WINDOW: DeliveryWindowDays = 7;

export function isDeliveryWindow(days: number): days is DeliveryWindowDays {
  return (DELIVERY_WINDOWS_DAYS as readonly number[]).includes(days);
}

export function expiryFrom(days: DeliveryWindowDays, now: Date): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export type DeliveryStanding = "live" | "withdrawn" | "expired";

export function deliveryStanding(input: {
  expiresAt: string | Date;
  revokedAt?: string | Date | null;
  now: Date;
}): DeliveryStanding {
  if (input.revokedAt) return "withdrawn";
  return new Date(input.expiresAt) > input.now ? "live" : "expired";
}

/** Whether a link still opens. Withdrawn and expired are both closed. */
export function deliveryIsOpen(standing: DeliveryStanding): boolean {
  return standing === "live";
}

/**
 * The address a request came from.
 *
 * Behind a proxy the socket address is the proxy, so the forwarded chain is
 * read first and the left-most entry -- the original client -- is taken. It is
 * evidence about who opened a link, not an access control decision, so a
 * spoofable header is acceptable here in a way it would not be for a gate.
 */
export function callerAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip");
}

/** Trimmed, because a user agent string is unbounded and this is a log line. */
export function callerAgent(headers: Headers): string | null {
  return headers.get("user-agent")?.slice(0, 400) ?? null;
}

export function deliveryUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/d/${token}`;
}
