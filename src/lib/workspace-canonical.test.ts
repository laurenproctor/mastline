import { describe, expect, it } from "vitest";
import {
  type WorkspaceAddresses,
  slugStanding,
  splitWorkspacePath,
  withWorkspaceSlug,
} from "./workspace-canonical";

const HALE: WorkspaceAddresses = {
  currentSlug: "hale-pictures",
  historicalSlugs: ["marcus-hale-studio", "hale-studio"],
};
const NORTHLINE: WorkspaceAddresses = {
  currentSlug: "northline-photo",
  historicalSlugs: [],
};

describe("slugStanding", () => {
  it("recognises the address a workspace holds now", () => {
    expect(slugStanding("hale-pictures", [HALE, NORTHLINE])).toEqual({ standing: "current" });
  });

  it("sends a retired address to the one that replaced it", () => {
    expect(slugStanding("marcus-hale-studio", [HALE])).toEqual({
      standing: "historical",
      currentSlug: "hale-pictures",
    });
    expect(slugStanding("hale-studio", [HALE])).toEqual({
      standing: "historical",
      currentSlug: "hale-pictures",
    });
  });

  /**
   * The loop this ordering prevents. A workspace may return to an address it
   * once held, making that string both current and historical; checking history
   * first would redirect a request that had already arrived.
   */
  it("prefers current over historical when an address is both", () => {
    const returned: WorkspaceAddresses = {
      currentSlug: "hale-studio",
      historicalSlugs: ["hale-studio", "hale-pictures"],
    };
    expect(slugStanding("hale-studio", [returned])).toEqual({ standing: "current" });
  });

  it("prefers a current address over another workspace's history", () => {
    // Cannot happen while addresses are never reassigned, but the ordering
    // should not be the only thing standing between here and a wrong answer.
    const ghost: WorkspaceAddresses = {
      currentSlug: "northline-photo",
      historicalSlugs: ["hale-pictures"],
    };
    expect(slugStanding("hale-pictures", [ghost, HALE])).toEqual({ standing: "current" });
  });

  it("knows nothing of addresses outside the caller's workspaces", () => {
    expect(slugStanding("someone-elses-studio", [HALE, NORTHLINE])).toEqual({
      standing: "unknown",
    });
    expect(slugStanding("hale-pictures", [])).toEqual({ standing: "unknown" });
    expect(slugStanding("", [HALE])).toEqual({ standing: "unknown" });
  });
});

describe("splitWorkspacePath", () => {
  it("separates the address from everything after it", () => {
    expect(splitWorkspacePath("/hale-studio/work")).toEqual({
      slug: "hale-studio",
      rest: "/work",
    });
    expect(splitWorkspacePath("/hale-studio/shoots/abc-123")).toEqual({
      slug: "hale-studio",
      rest: "/shoots/abc-123",
    });
  });

  it("handles a bare address", () => {
    expect(splitWorkspacePath("/hale-studio")).toEqual({ slug: "hale-studio", rest: "" });
  });

  it("returns nothing for a path with no address in it", () => {
    expect(splitWorkspacePath("/")).toBeNull();
    expect(splitWorkspacePath("")).toBeNull();
    expect(splitWorkspacePath("hale-studio/work")).toBeNull();
  });
});

describe("withWorkspaceSlug", () => {
  it("swaps the address and keeps the rest of the path exactly", () => {
    expect(withWorkspaceSlug("/old/work", "new")).toBe("/new/work");
    expect(withWorkspaceSlug("/old/shoots/abc-123", "new")).toBe("/new/shoots/abc-123");
    expect(withWorkspaceSlug("/old/dispatch/pkg_1", "new")).toBe("/new/dispatch/pkg_1");
    expect(withWorkspaceSlug("/old", "new")).toBe("/new");
  });

  it("preserves a trailing slash rather than tidying it away", () => {
    expect(withWorkspaceSlug("/old/work/", "new")).toBe("/new/work/");
  });

  /**
   * The ids in these paths are the whole point of the link. A redirect that
   * dropped them would land somebody on a list instead of the frame they were
   * sent, which is a subtler failure than a 404 and easier to miss.
   */
  it("never loses a resource id", () => {
    const paths = [
      "/old/assets/a0000000-0000-0000-0000-0000000000d1",
      "/old/submissions/a0000000-0000-0000-0000-00000000a001",
      "/old/shoots/a0000000-0000-0000-0000-0000000000c1",
    ];
    for (const path of paths) {
      const moved = withWorkspaceSlug(path, "new");
      expect(moved.startsWith("/new/")).toBe(true);
      expect(moved.slice("/new".length)).toBe(path.slice("/old".length));
    }
  });
});
