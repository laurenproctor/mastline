import { describe, expect, it } from "vitest";
import { chooseLandingWorkspace } from "./workspace-landing";

const A = { id: "org-a", slug: "marcus-hale-studio" };
const B = { id: "org-b", slug: "northline-pictures" };

/**
 * The hint is a preference. Every case here is really the same question asked
 * four ways: what happens when it cannot be trusted?
 */
describe("chooseLandingWorkspace", () => {
  it("honours a hint that still names a live membership", () => {
    expect(chooseLandingWorkspace([A, B], "org-b")).toEqual({ outcome: "resolved", workspace: B });
  });

  it("ignores a hint naming a workspace they are no longer in", () => {
    // The membership list is already filtered to this person, so a workspace
    // they were removed from simply is not in it.
    expect(chooseLandingWorkspace([A], "org-b")).toEqual({ outcome: "resolved", workspace: A });
  });

  it("ignores a forged hint", () => {
    expect(chooseLandingWorkspace([A, B], "../../etc/passwd")).toEqual({ outcome: "ambiguous" });
    expect(chooseLandingWorkspace([A, B], "org-c")).toEqual({ outcome: "ambiguous" });
  });

  it("needs no hint when there is only one workspace", () => {
    expect(chooseLandingWorkspace([A], undefined)).toEqual({ outcome: "resolved", workspace: A });
    expect(chooseLandingWorkspace([A], null)).toEqual({ outcome: "resolved", workspace: A });
    expect(chooseLandingWorkspace([A], "")).toEqual({ outcome: "resolved", workspace: A });
  });

  it("asks rather than guesses between several", () => {
    expect(chooseLandingWorkspace([A, B], undefined)).toEqual({ outcome: "ambiguous" });
  });

  it("has nowhere to send somebody with no workspace", () => {
    expect(chooseLandingWorkspace([], "org-a")).toEqual({ outcome: "none" });
    expect(chooseLandingWorkspace([], undefined)).toEqual({ outcome: "none" });
  });

  it("never resolves to a workspace outside the list it was given", () => {
    for (const hint of ["org-b", "org-zzz", "", null, undefined]) {
      const choice = chooseLandingWorkspace([A], hint);
      if (choice.outcome === "resolved") expect(choice.workspace).toBe(A);
    }
  });
});
