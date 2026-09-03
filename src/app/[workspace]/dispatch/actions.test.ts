import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The approval gate, tested at the form boundary.
 *
 * Approval is the consequential action of the dispatch loop: it freezes the
 * package and opens a submission. These tests pin the order of its refusals --
 * no confirmation means nothing else is even consulted, and a stale page's
 * blocking findings are re-derived here rather than trusted -- with the data
 * layer stood in for, the same way the money action tests do it.
 */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  notFound: vi.fn(),
}));
vi.mock("@/lib/session-context", () => ({
  requireWorkspaceContext: vi.fn(async () => ({
    organizationId: "org-1",
    actorId: "user-1",
    canonicalSlug: "studio",
  })),
}));
vi.mock("@/lib/data/packages", () => ({
  createPackageFromSelection: vi.fn(),
  ensureDraftPackage: vi.fn(),
  setPackageSelection: vi.fn(),
  updatePackage: vi.fn(),
  getPackage: vi.fn(async () => null),
}));
vi.mock("@/lib/data/submissions", () => ({
  approvePackageAndCreateSubmission: vi.fn(),
  recordSubmissionOutcome: vi.fn(),
}));
vi.mock("@/lib/data/assets", () => ({ listAssets: vi.fn(async () => []) }));
vi.mock("@/lib/data/shoots", () => ({ getShoot: vi.fn(async () => null) }));
vi.mock("@/lib/data/workspace", () => ({ listWorkspaceBuyers: vi.fn(async () => []) }));
vi.mock("@/lib/dispatch-rules", () => ({ reviewDispatch: vi.fn() }));

import { getPackage } from "@/lib/data/packages";
import { recordSubmissionOutcome } from "@/lib/data/submissions";
import { reviewDispatch } from "@/lib/dispatch-rules";
import { requireWorkspaceContext } from "@/lib/session-context";
import { approvePackageAction, recordOutcomeAction } from "./actions";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPackage).mockResolvedValue(null);
});

describe("approvePackageAction refusals", () => {
  it("refuses without the explicit confirmation, before consulting the session", async () => {
    const state = await approvePackageAction("studio", {}, form({ packageId: "pkg-1" }));
    expect(state).toEqual({
      error: "Approval needs an explicit confirmation before anything is recorded.",
    });
    expect(requireWorkspaceContext).not.toHaveBeenCalled();
    expect(reviewDispatch).not.toHaveBeenCalled();
  });

  it("treats any value but the exact confirmation as unconfirmed", async () => {
    const state = await approvePackageAction(
      "studio",
      {},
      form({ packageId: "pkg-1", confirmed: "true" }),
    );
    expect(state.error).toMatch(/explicit confirmation/);
  });

  it("says when the package cannot be found rather than approving nothing", async () => {
    const state = await approvePackageAction(
      "studio",
      {},
      form({ packageId: "pkg-gone", confirmed: "yes" }),
    );
    expect(state).toEqual({ error: "That package could not be found." });
  });

  it("re-runs the dispatch review at the gate and names what blocks approval", async () => {
    vi.mocked(getPackage).mockResolvedValue({ id: "pkg-1", shootId: "shoot-1" } as never);
    vi.mocked(reviewDispatch).mockReturnValue({
      isApprovable: false,
      blocking: [{ title: "Captions are incomplete" }, { title: "No terms proposed" }],
    } as never);

    const state = await approvePackageAction(
      "studio",
      {},
      form({ packageId: "pkg-1", confirmed: "yes" }),
    );
    expect(state).toEqual({
      error: "Approval is blocked: captions are incomplete, no terms proposed.",
    });
    expect(reviewDispatch).toHaveBeenCalledTimes(1);
  });
});

describe("recordOutcomeAction", () => {
  it("surfaces a data-layer refusal as the form error", async () => {
    vi.mocked(recordSubmissionOutcome).mockRejectedValue(
      new Error("An outcome never rewrites what was sent."),
    );
    const state = await recordOutcomeAction(
      "studio",
      {},
      form({ submissionId: "sub-1", status: "sold" }),
    );
    expect(state).toEqual({ error: "An outcome never rewrites what was sent." });
  });
});
