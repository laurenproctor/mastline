import { describe, expect, it } from "vitest";
import {
  DELIVERY_WINDOWS_DAYS,
  callerAddress,
  callerAgent,
  deliveryIsOpen,
  deliveryStanding,
  deliveryUrl,
  expiryFrom,
  isDeliveryToken,
  isDeliveryWindow,
  newDeliveryToken,
} from "./delivery";

describe("newDeliveryToken", () => {
  it("is the only credential a recipient has, so it is not guessable", () => {
    const tokens = new Set(Array.from({ length: 500 }, newDeliveryToken));
    expect(tokens.size).toBe(500);
    for (const token of tokens) {
      expect(isDeliveryToken(token), token).toBe(true);
      // 32 bytes of randomness, base64url encoded.
      expect(token.length).toBeGreaterThanOrEqual(43);
    }
  });

  it("is URL-safe, because it is handed over as a URL", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(newDeliveryToken()).not.toMatch(/[+/=]/);
    }
  });
});

describe("isDeliveryToken", () => {
  it("mirrors the database constraint, so a bad token fails before the query", () => {
    expect(isDeliveryToken("a".repeat(31))).toBe(false);
    expect(isDeliveryToken("a".repeat(32))).toBe(true);
    expect(isDeliveryToken("a".repeat(128))).toBe(true);
    expect(isDeliveryToken("a".repeat(129))).toBe(false);
  });

  it("refuses anything that is not the alphabet a token is made of", () => {
    for (const bad of ["a".repeat(40) + "/", "a".repeat(40) + "+", "a".repeat(40) + " ", ""]) {
      expect(isDeliveryToken(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("how long a link stays open", () => {
  it("offers only windows it accepts", () => {
    for (const days of DELIVERY_WINDOWS_DAYS) {
      expect(isDeliveryWindow(days), String(days)).toBe(true);
    }
  });

  it("refuses a window that was not offered", () => {
    // A form can post anything; open-ended links are the thing to avoid.
    for (const bad of [0, -7, 1, 365, 99999]) {
      expect(isDeliveryWindow(bad), String(bad)).toBe(false);
    }
  });

  it("counts forward from the moment it is made", () => {
    const now = new Date("2026-08-23T12:00:00Z");
    expect(expiryFrom(7, now).toISOString()).toBe("2026-08-30T12:00:00.000Z");
    expect(expiryFrom(3, now).toISOString()).toBe("2026-08-26T12:00:00.000Z");
  });
});

describe("deliveryStanding", () => {
  const now = new Date("2026-08-23T12:00:00Z");

  it("is open while it lasts", () => {
    expect(deliveryStanding({ expiresAt: "2026-08-30T12:00:00Z", now })).toBe("live");
  });

  it("is closed once it runs out", () => {
    expect(deliveryStanding({ expiresAt: "2026-08-23T11:59:59Z", now })).toBe("expired");
  });

  it("is withdrawn whatever the expiry says", () => {
    // Withdrawal is a decision; expiry is a clock. The decision wins, and a
    // withdrawn link that has not expired must not read as open.
    expect(
      deliveryStanding({
        expiresAt: "2026-12-30T12:00:00Z",
        revokedAt: "2026-08-23T10:00:00Z",
        now,
      }),
    ).toBe("withdrawn");
  });

  it("only opens for one of the three", () => {
    expect(deliveryIsOpen("live")).toBe(true);
    expect(deliveryIsOpen("withdrawn")).toBe(false);
    expect(deliveryIsOpen("expired")).toBe(false);
  });
});

describe("callerAddress", () => {
  it("takes the client, not the proxy", () => {
    // Left-most is the original caller; everything after is infrastructure.
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" });
    expect(callerAddress(headers)).toBe("203.0.113.9");
  });

  it("falls back to the real-ip header", () => {
    expect(callerAddress(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("is null when nothing says", () => {
    expect(callerAddress(new Headers())).toBeNull();
    expect(callerAddress(new Headers({ "x-forwarded-for": "   " }))).toBeNull();
  });
});

describe("callerAgent", () => {
  it("keeps the agent within a log line", () => {
    const long = "x".repeat(1000);
    expect(callerAgent(new Headers({ "user-agent": long }))?.length).toBe(400);
  });

  it("is null when absent", () => {
    expect(callerAgent(new Headers())).toBeNull();
  });
});

describe("deliveryUrl", () => {
  it("builds the address the recipient opens", () => {
    expect(deliveryUrl("https://mastline.co", "abc")).toBe("https://mastline.co/d/abc");
  });

  it("does not double the slash", () => {
    expect(deliveryUrl("https://mastline.co/", "abc")).toBe("https://mastline.co/d/abc");
  });
});
