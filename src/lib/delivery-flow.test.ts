import { describe, expect, it } from "vitest";
import {
  type DeliveryFlowFacts,
  clampStage,
  currentStage,
  isDeliveryFlowStage,
  stageReachable,
  stepStates,
} from "./delivery-flow";

const facts = (over: Partial<DeliveryFlowFacts> = {}): DeliveryFlowFacts => ({
  frameCount: 0,
  detailsReady: false,
  recipientReady: false,
  approved: false,
  linkCreated: false,
  shared: false,
  ...over,
});

describe("delivery flow stages", () => {
  it("recognises exactly the five stage keys", () => {
    for (const key of ["photos", "details", "recipient", "review", "shared"]) {
      expect(isDeliveryFlowStage(key)).toBe(true);
    }
    expect(isDeliveryFlowStage("sent")).toBe(false);
    expect(isDeliveryFlowStage("")).toBe(false);
  });

  it("starts an empty package at photos and opens stages only as the record fills in", () => {
    expect(currentStage(facts())).toBe("photos");
    expect(stageReachable("details", facts())).toBe(false);
    expect(stageReachable("recipient", facts({ frameCount: 2 }))).toBe(false);
    expect(stageReachable("recipient", facts({ frameCount: 2, detailsReady: true }))).toBe(true);
    expect(stageReachable("review", facts({ frameCount: 2, detailsReady: true }))).toBe(false);
    expect(
      stageReachable("review", facts({ frameCount: 2, detailsReady: true, recipientReady: true })),
    ).toBe(true);
  });

  it("clamps a URL that skips ahead back to the work that is actually next", () => {
    expect(clampStage("review", facts({ frameCount: 3 }))).toBe("details");
    expect(clampStage("recipient", facts())).toBe("photos");
    expect(clampStage("shared", facts({ frameCount: 1, detailsReady: true }))).toBe("recipient");
  });

  it("keeps an unknown or absent request on the record's own stage", () => {
    expect(clampStage(undefined, facts({ frameCount: 1, detailsReady: true }))).toBe("recipient");
    expect(
      clampStage(undefined, facts({ frameCount: 1, detailsReady: true, recipientReady: true })),
    ).toBe("review");
  });

  it("closes the working stages once the package is approved", () => {
    const approved = facts({
      frameCount: 3,
      detailsReady: true,
      recipientReady: true,
      approved: true,
    });
    expect(stageReachable("photos", approved)).toBe(false);
    expect(stageReachable("details", approved)).toBe(false);
    // Recipient stays open in its reduced form: a new link for another
    // recipient on the same frozen package.
    expect(stageReachable("recipient", approved)).toBe(true);
    expect(clampStage("photos", approved)).toBe("review");
    expect(currentStage(approved)).toBe("review");
  });

  it("opens Shared only once sharing was actually recorded", () => {
    const approved = facts({
      frameCount: 3,
      detailsReady: true,
      recipientReady: true,
      approved: true,
      linkCreated: true,
    });
    expect(stageReachable("shared", approved)).toBe(false);
    expect(clampStage("shared", approved)).toBe("review");

    const shared = facts({ ...approved, shared: true });
    expect(stageReachable("shared", shared)).toBe(true);
    expect(currentStage(shared)).toBe("shared");
  });

  it("marks steps complete from the record, current from the rendered stage", () => {
    const steps = stepStates(
      "recipient",
      facts({ frameCount: 2, detailsReady: true, recipientReady: false }),
    );
    expect(steps.map((step) => step.state)).toEqual([
      "complete",
      "complete",
      "current",
      "upcoming",
      "upcoming",
    ]);
    expect(steps.map((step) => step.label)).toEqual([
      "Photos",
      "Details",
      "Recipient",
      "Review & share",
      "Shared",
    ]);
  });

  it("never marks review complete before a link exists, nor shared before a share", () => {
    const approvedNoLink = facts({
      frameCount: 1,
      detailsReady: true,
      recipientReady: true,
      approved: true,
    });
    const steps = stepStates("review", approvedNoLink);
    expect(steps.find((step) => step.key === "review")?.state).toBe("current");
    expect(steps.find((step) => step.key === "shared")?.state).toBe("upcoming");
  });
});
