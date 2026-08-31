import { describe, expect, it } from "vitest";
import { DISPATCH_STAGES, dispatchStage } from "./dispatch-lifecycle";

/**
 * The stage strip on the dispatch screen is derived from the record, not from
 * a constant. Each case pins one boundary the product used to blur.
 */
describe("dispatchStage", () => {
  it("names five stages in the order they happen", () => {
    expect(DISPATCH_STAGES).toEqual([
      "Build package",
      "Review & approve",
      "Create recipient link",
      "Shared / awaiting outcome",
      "Outcome recorded",
    ]);
  });

  it("is building while the package is a draft", () => {
    expect(dispatchStage({ packageStatus: "draft" })).toMatchObject({
      stage: "Build package",
      index: 0,
    });
  });

  it.each(["needs_review", "ready"] as const)("is under review while %s", (status) => {
    expect(dispatchStage({ packageStatus: status }).stage).toBe("Review & approve");
  });

  it("moves to the recipient link once approved, because approval is not a send", () => {
    const lifecycle = dispatchStage({
      packageStatus: "approved",
      submission: { status: "queued" },
    });
    expect(lifecycle).toMatchObject({ stage: "Create recipient link", index: 2 });
    expect(lifecycle.detail).toMatch(/No recipient link has been created/);
  });

  it("stays at the recipient link when a link exists but was never shared, and says so", () => {
    // A link created and not shared is recorded nowhere on the submission:
    // `sent_at` stays null and the status stays queued. That is the point.
    const one = dispatchStage({
      packageStatus: "approved",
      submission: { status: "queued", sentAt: undefined },
      links: [{}],
    });
    expect(one.stage).toBe("Create recipient link");
    expect(one.detail).toBe(
      "A recipient link exists and has not been marked as shared. Nothing has left Mastline.",
    );

    const two = dispatchStage({
      packageStatus: "approved",
      submission: { status: "queued" },
      links: [{}, {}],
    });
    expect(two.detail).toMatch(/^2 recipient links exist and have not been marked as shared/);

    // A withdrawn link is not an unshared one waiting to go out.
    const withdrawn = dispatchStage({
      packageStatus: "approved",
      submission: { status: "queued" },
      links: [{ revokedAt: "2026-08-28T10:00:00Z" }],
    });
    expect(withdrawn.stage).toBe("Create recipient link");
    expect(withdrawn.detail).toMatch(/No recipient link has been created/);
  });

  it("is shared once the submission records a send, however it was evidenced", () => {
    expect(
      dispatchStage({
        packageStatus: "sending",
        submission: { status: "sent", sentAt: "2026-08-28T10:00:00Z" },
      }).stage,
    ).toBe("Shared / awaiting outcome");

    // A link marked shared, read from the link itself.
    expect(
      dispatchStage({
        packageStatus: "approved",
        submission: { status: "queued" },
        links: [{ sharedAt: "2026-08-28T10:00:00Z" }],
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
      ).toMatchObject({ stage: "Outcome recorded", index: 4 });
    },
  );

  it("never emphasises review for an approved package", () => {
    for (const packageStatus of ["approved", "sending", "delivered"] as const) {
      expect(dispatchStage({ packageStatus }).index).toBeGreaterThan(1);
    }
  });

  it("carries no detail outside the recipient-link stage", () => {
    expect(dispatchStage({ packageStatus: "draft" }).detail).toBeUndefined();
    expect(
      dispatchStage({
        packageStatus: "delivered",
        submission: { status: "sold", sentAt: "2026-08-28T10:00:00Z" },
      }).detail,
    ).toBeUndefined();
  });
});
