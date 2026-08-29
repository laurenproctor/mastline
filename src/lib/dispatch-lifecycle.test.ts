import { describe, expect, it } from "vitest";
import { DISPATCH_STAGES, dispatchStage } from "./dispatch-lifecycle";

/**
 * The stage strip on the dispatch screen is derived from the record, not from
 * a constant. Each case pins one boundary the product used to blur.
 */
describe("dispatchStage", () => {
  it("names five stages in the order they happen", () => {
    expect(DISPATCH_STAGES).toEqual([
      "Preparing",
      "Review & approve",
      "Create recipient link",
      "Shared / awaiting outcome",
      "Outcome recorded",
    ]);
  });

  it("is preparing while the package is a draft", () => {
    expect(dispatchStage({ packageStatus: "draft" })).toEqual({ stage: "Preparing", index: 0 });
  });

  it.each(["needs_review", "ready"] as const)("is under review while %s", (status) => {
    expect(dispatchStage({ packageStatus: status }).stage).toBe("Review & approve");
  });

  it("moves to the recipient link once approved, because approval is not a send", () => {
    expect(
      dispatchStage({
        packageStatus: "approved",
        submission: { status: "queued" },
      }),
    ).toEqual({ stage: "Create recipient link", index: 2 });
  });

  it("stays at the recipient link when a link exists but was never shared", () => {
    // A link created and not shared is recorded nowhere on the submission:
    // `sent_at` stays null and the status stays queued. That is the point.
    expect(
      dispatchStage({
        packageStatus: "approved",
        submission: { status: "queued", sentAt: undefined },
      }).stage,
    ).toBe("Create recipient link");
  });

  it("is shared once the submission records a send, however it was evidenced", () => {
    expect(
      dispatchStage({
        packageStatus: "sending",
        submission: { status: "sent", sentAt: "2026-08-28T10:00:00Z" },
      }).stage,
    ).toBe("Shared / awaiting outcome");

    // Opened by a recipient before the operator marked it shared.
    expect(
      dispatchStage({
        packageStatus: "delivered",
        submission: { status: "delivered", sentAt: "2026-08-28T10:00:00Z" },
      }).stage,
    ).toBe("Shared / awaiting outcome");

    // Accepted is still awaiting an outcome.
    expect(
      dispatchStage({
        packageStatus: "delivered",
        submission: { status: "acknowledged", sentAt: "2026-08-28T10:00:00Z" },
      }).stage,
    ).toBe("Shared / awaiting outcome");
  });

  it.each(["sold", "no_sale", "recalled", "failed"] as const)(
    "is recorded once the submission outcome is %s",
    (status) => {
      expect(
        dispatchStage({
          packageStatus: "delivered",
          submission: { status, sentAt: "2026-08-28T10:00:00Z" },
        }),
      ).toEqual({ stage: "Outcome recorded", index: 4 });
    },
  );

  it("never emphasises review for an approved package", () => {
    for (const packageStatus of ["approved", "sending", "delivered"] as const) {
      expect(dispatchStage({ packageStatus }).index).toBeGreaterThan(1);
    }
  });
});
