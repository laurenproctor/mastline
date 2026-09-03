import { describe, expect, it } from "vitest";
import { REQUEST_STATUSES, type BuyerRequest, type RequestStatus } from "./domain";
import { money } from "./money";
import {
  CLOSED_STATUSES,
  CONNECTION_STATUSES,
  NOT_PROVIDED,
  REASON_MAX_LENGTH,
  allowedTransitions,
  canRecordWin,
  canTransition,
  checkBudget,
  checkTransition,
  describeBudget,
  describeQuantity,
  isClosed,
  isPastDeadline,
  isPastExpiry,
  nextAction,
  orNotProvided,
  statusLabel,
  statusTone,
} from "./requests";

/**
 * The rules a buyer request lives by, tested without a database.
 *
 * The database enforces the same things again -- a closed request cannot move,
 * lost and declined need a reason -- because a client is not a boundary. These
 * tests are about the half a person meets: which controls appear, which
 * refusals they get, and what "the buyer did not say" looks like on a screen.
 */

const NOW = new Date("2026-08-28T12:00:00Z");

function request(overrides: Partial<BuyerRequest> = {}): BuyerRequest {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    organizationId: "aaaaaaaa-0000-0000-0000-000000000001",
    createdBy: "22222222-2222-2222-2222-222222222222",
    reference: "REQ-0828-1234",
    source: "manual",
    requestType: "archive",
    status: "new",
    title: "Anything from the Chelsea departure?",
    subjectNames: [],
    topics: [],
    requestedFormats: [],
    budgetDisclosed: false,
    currency: "USD",
    createdAt: "2026-08-28T09:00:00Z",
    updatedAt: "2026-08-28T09:00:00Z",
    hasSensitiveNote: false,
    ...overrides,
  };
}

describe("the status vocabulary", () => {
  it("labels and tones every status the schema has", () => {
    for (const status of REQUEST_STATUSES) {
      expect(statusLabel(status)).toBeTruthy();
      expect(statusTone(status)).toBeTruthy();
    }
  });

  it("spells cancelled the way the rest of the schema does", () => {
    // shoot_status and license_status both use two Ls. One schema, one spelling.
    expect(REQUEST_STATUSES).toContain("cancelled");
    expect(REQUEST_STATUSES).not.toContain("canceled");
  });

  it("keeps cancelled and declined as separate endings", () => {
    // Cancelled is the buyer withdrawing; declined is the photographer saying
    // no. Collapsing them would make "how often do we turn work down"
    // unanswerable.
    expect(isClosed("cancelled")).toBe(true);
    expect(isClosed("declined")).toBe(true);
    expect(statusLabel("cancelled")).not.toBe(statusLabel("declined"));
  });
});

describe("transitions", () => {
  it("offers nothing at all from a closed state", () => {
    for (const status of CLOSED_STATUSES) {
      expect(allowedTransitions(status)).toEqual([]);
    }
  });

  it("refuses to reopen a closed request", () => {
    for (const from of CLOSED_STATUSES) {
      const result = checkTransition({ from, to: "new" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reason).toBe("invalid_transition");
    }
  });

  it("never routes a closed state back into an active one, by any path", () => {
    const active = REQUEST_STATUSES.filter((status) => !isClosed(status));
    for (const from of CLOSED_STATUSES) {
      for (const to of active) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("keeps won out of the generic move control, from everywhere", () => {
    // Won is performed by connecting a license, never by selecting it from a
    // dropdown: a dropdown entry with no license behind it would only ever be
    // refused, first here and then by the database's evidence gate.
    expect(CONNECTION_STATUSES).toContain("won");
    for (const from of REQUEST_STATUSES) {
      expect(allowedTransitions(from)).not.toContain("won");
      expect(canTransition(from, "won")).toBe(false);
    }
  });

  it("reaches won through the connection, from submitted and negotiating only", () => {
    expect(allowedTransitions("submitted", { unfiltered: true })).toContain("won");
    expect(allowedTransitions("negotiating", { unfiltered: true })).toContain("won");
    expect(canRecordWin("submitted")).toBe(true);
    expect(canRecordWin("negotiating")).toBe(true);

    const connected = checkTransition({
      from: "negotiating",
      to: "won",
      connectedLicenseId: "a0000000-0000-0000-0000-00000000b001",
    });
    expect(connected.ok).toBe(true);
  });

  it("does not let a connection shortcut the transition table", () => {
    // A license in hand does not make a win recordable from a request nobody
    // has even submitted: the table row still decides, the connection is only
    // how its allowance is exercised.
    for (const from of ["draft", "new", "qualified", "preparing_response"] as const) {
      expect(canRecordWin(from)).toBe(false);
      const result = checkTransition({
        from,
        to: "won",
        connectedLicenseId: "a0000000-0000-0000-0000-00000000b001",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reason).toBe("invalid_transition");
    }
    for (const from of CLOSED_STATUSES) {
      expect(canRecordWin(from)).toBe(false);
    }
  });

  it("explains that a win needs its connection rather than calling it invalid", () => {
    const result = checkTransition({ from: "submitted", to: "won" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("connection_required");
      expect(result.error.message).toMatch(/connect/i);
    }
  });

  it("walks the ordinary path from arrival to submitted", () => {
    const path: RequestStatus[] = [
      "draft",
      "new",
      "qualified",
      "coverage_planned",
      "preparing_response",
      "submitted",
    ];
    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransition(path[index], path[index + 1])).toBe(true);
    }
  });

  it("lets a clarified request go back to new", () => {
    // The desk answered the question. That is the ordinary case, not an edge one.
    expect(canTransition("needs_clarification", "new")).toBe(true);
  });

  it("will not let a draft be lost or declined", () => {
    // Nobody has seen a draft, so there is nothing to lose or turn down.
    expect(canTransition("draft", "lost")).toBe(false);
    expect(canTransition("draft", "declined")).toBe(false);
    expect(canTransition("draft", "cancelled")).toBe(true);
  });
});

describe("reasons", () => {
  it("requires one for lost and declined", () => {
    for (const to of ["lost", "declined"] as const) {
      const result = checkTransition({ from: "qualified", to });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reason).toBe("reason_required");
    }
  });

  it("rejects whitespace dressed up as a reason", () => {
    const result = checkTransition({ from: "qualified", to: "lost", reason: "    " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("reason_required");
  });

  it("accepts a real one and hands back the trimmed text", () => {
    const result = checkTransition({
      from: "qualified",
      to: "lost",
      reason: "  Went to Backgrid first  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reason).toBe("Went to Backgrid first");
  });

  it("does not require one for cancelled or expired", () => {
    expect(checkTransition({ from: "qualified", to: "cancelled" }).ok).toBe(true);
    expect(checkTransition({ from: "qualified", to: "expired" }).ok).toBe(true);
  });

  it("treats an omitted optional reason as leaving the previous one alone", () => {
    const result = checkTransition({ from: "new", to: "qualified" });
    expect(result.ok).toBe(true);
    // undefined rather than "" -- the caller writes nothing rather than erasing.
    if (result.ok) expect(result.reason).toBeUndefined();
  });

  it("refuses one longer than the column holds", () => {
    const result = checkTransition({
      from: "qualified",
      to: "lost",
      reason: "x".repeat(REASON_MAX_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("reason_too_long");
  });
});

describe("past deadline", () => {
  it("is derived from the deadline and the current instant", () => {
    expect(isPastDeadline(request({ responseDeadline: "2026-08-28T11:00:00Z" }), NOW)).toBe(true);
    expect(isPastDeadline(request({ responseDeadline: "2026-08-28T13:00:00Z" }), NOW)).toBe(false);
  });

  it("is false for a request with no deadline", () => {
    // No deadline is not an expired one: the desk never gave a time.
    expect(isPastDeadline(request(), NOW)).toBe(false);
  });

  it("is false once the request is closed", () => {
    // Otherwise every completed request carries a red flag for ever.
    for (const status of CLOSED_STATUSES) {
      expect(
        isPastDeadline(request({ status, responseDeadline: "2026-08-01T00:00:00Z" }), NOW),
      ).toBe(false);
    }
  });

  it("does the same for the request's own expiry", () => {
    expect(isPastExpiry(request({ expiresAt: "2026-08-27T00:00:00Z" }), NOW)).toBe(true);
    expect(isPastExpiry(request(), NOW)).toBe(false);
    expect(isPastExpiry(request({ status: "lost", expiresAt: "2026-08-01T00:00:00Z" }), NOW)).toBe(
      false,
    );
  });

  it("puts the deadline ahead of the status in the next action", () => {
    const late = request({
      status: "needs_clarification",
      responseDeadline: "2026-08-27T00:00:00Z",
    });
    expect(nextAction(late, NOW)).toMatch(/past deadline/i);
    expect(nextAction(request({ status: "new" }), NOW)).not.toMatch(/past deadline/i);
  });
});

describe("a budget nobody mentioned", () => {
  it("reads as not provided", () => {
    expect(describeBudget(request())).toBe(NOT_PROVIDED);
  });

  it("is a different answer from a budget of zero", () => {
    const undisclosed = describeBudget(request());
    const zero = describeBudget(
      request({ budgetDisclosed: true, budgetMin: money(0), budgetMax: money(0) }),
    );
    expect(undisclosed).toBe(NOT_PROVIDED);
    expect(zero).not.toBe(NOT_PROVIDED);
    // "$0" is a desk saying there is no money in it, which is information.
    expect(zero).toMatch(/0/);
  });

  it("renders a range, a floor, and a ceiling differently", () => {
    expect(
      describeBudget(
        request({ budgetDisclosed: true, budgetMin: money(50000), budgetMax: money(120000) }),
      ),
    ).toBe("$500 – $1,200");
    expect(describeBudget(request({ budgetDisclosed: true, budgetMin: money(50000) }))).toBe(
      "From $500",
    );
    expect(describeBudget(request({ budgetDisclosed: true, budgetMax: money(120000) }))).toBe(
      "Up to $1,200",
    );
  });

  it("collapses a range whose ends agree into one figure", () => {
    expect(
      describeBudget(
        request({ budgetDisclosed: true, budgetMin: money(50000), budgetMax: money(50000) }),
      ),
    ).toBe("$500");
  });
});

describe("the budget rules", () => {
  it("refuses figures without a disclosure", () => {
    const result = checkBudget({ disclosed: false, min: money(1000) });
    expect(result.ok).toBe(false);
  });

  it("refuses a disclosure with no figures", () => {
    expect(checkBudget({ disclosed: true }).ok).toBe(false);
  });

  it("refuses a maximum below the minimum", () => {
    expect(checkBudget({ disclosed: true, min: money(2000), max: money(1000) }).ok).toBe(false);
  });

  it("accepts silence, and accepts a stated zero", () => {
    expect(checkBudget({ disclosed: false }).ok).toBe(true);
    expect(checkBudget({ disclosed: true, min: money(0) }).ok).toBe(true);
  });
});

describe("other unstated facts", () => {
  it("renders an empty term as not provided rather than as an empty cell", () => {
    expect(orNotProvided(undefined)).toBe(NOT_PROVIDED);
    expect(orNotProvided("   ")).toBe(NOT_PROVIDED);
    expect(orNotProvided("Worldwide")).toBe("Worldwide");
  });

  it("does not turn an unstated quantity into zero", () => {
    expect(describeQuantity(undefined)).toBe(NOT_PROVIDED);
    expect(describeQuantity(0)).not.toBe(NOT_PROVIDED);
    expect(describeQuantity(20)).toContain("20");
  });
});
