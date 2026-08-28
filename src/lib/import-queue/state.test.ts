import { describe, expect, it } from "vitest";
import { IMPORT_FILE_STATUSES } from "@/lib/domain";
import {
  canTransition,
  InvalidTransitionError,
  isOutstanding,
  isServerHeld,
  resumeActionFor,
  transition,
} from "./state";

/**
 * The transitions, asserted rather than assumed.
 *
 * The happy path is the least interesting part. What these are really about is
 * the transitions that must be refused: a completed import going backwards, a
 * finalization being paused, a cancelled file resuming into the middle of an
 * upload it never started.
 */

describe("the import lifecycle", () => {
  it("runs pending to complete in the documented order", () => {
    const path = ["pending", "staged", "uploading", "uploaded", "finalizing", "complete"] as const;

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransition(path[index], path[index + 1])).toBe(true);
    }
  });

  it("treats complete as terminal", () => {
    for (const status of IMPORT_FILE_STATUSES) {
      if (status === "complete") continue;
      expect(canTransition("complete", status)).toBe(false);
    }
    // Asking for the state it is already in is not a transition.
    expect(transition("complete", "complete")).toBe("complete");
  });

  it("refuses to pause a finalization", () => {
    // The server is creating an asset. There is nothing local left to suspend.
    expect(canTransition("finalizing", "paused")).toBe(false);
    expect(canTransition("finalizing", "complete")).toBe(true);
  });

  it("will not skip staging straight to uploaded", () => {
    expect(canTransition("pending", "uploaded")).toBe(false);
    expect(canTransition("staged", "uploaded")).toBe(false);
  });

  it("explains a refusal instead of returning false into a caller", () => {
    expect(() => transition("complete", "uploading", "file-9")).toThrow(InvalidTransitionError);
    try {
      transition("complete", "uploading", "file-9");
    } catch (error) {
      expect((error as Error).message).toContain("file-9");
      expect((error as Error).message).toContain("Allowed from complete");
    }
  });

  it("lets a failed or cancelled item be picked up again", () => {
    expect(canTransition("failed", "retrying")).toBe(true);
    expect(canTransition("canceled", "pending")).toBe(true);
    // But never straight back into flight.
    expect(canTransition("canceled", "uploading")).toBe(false);
  });

  it("counts everything but complete and cancelled as outstanding", () => {
    expect(isOutstanding("pending")).toBe(true);
    expect(isOutstanding("failed")).toBe(true);
    expect(isOutstanding("complete")).toBe(false);
    expect(isOutstanding("canceled")).toBe(false);
  });

  it("knows when the bytes have stopped being this machine's problem", () => {
    expect(isServerHeld("uploaded")).toBe(true);
    expect(isServerHeld("finalizing")).toBe(true);
    expect(isServerHeld("complete")).toBe(true);
    expect(isServerHeld("staged")).toBe(false);
  });
});

describe("resuming", () => {
  it("finalizes rather than uploading again when the bucket has the bytes", () => {
    expect(resumeActionFor({ serverStatus: "uploaded", bytesAvailableLocally: true })).toBe(
      "finalize",
    );
    // Even with no local copy at all: the server does not need one.
    expect(resumeActionFor({ serverStatus: "finalizing", bytesAvailableLocally: false })).toBe(
      "finalize",
    );
  });

  it("asks for the file when nothing holds the bytes", () => {
    expect(resumeActionFor({ serverStatus: "staged", bytesAvailableLocally: false })).toBe(
      "needs_file",
    );
  });

  it("uploads when this machine still has them", () => {
    expect(resumeActionFor({ serverStatus: "pending", bytesAvailableLocally: true })).toBe(
      "upload",
    );
    expect(resumeActionFor({ serverStatus: "unknown", bytesAvailableLocally: true })).toBe(
      "upload",
    );
  });

  it("does nothing for work that is finished or abandoned", () => {
    expect(resumeActionFor({ serverStatus: "complete", bytesAvailableLocally: true })).toBe("done");
    expect(resumeActionFor({ serverStatus: "canceled", bytesAvailableLocally: true })).toBe("wait");
  });
});
