import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The approval gate, still two motions.
 *
 * The shoot-creation flow lost its confirmation step deliberately: a private
 * draft is reversible and did not earn one. This is the screen that did earn
 * it, so these tests exist to make sure the two were not conflated -- that
 * approval still shows what is about to be frozen, still needs a second
 * explicit act, and never shares its copy with the button that writes a draft.
 *
 * The copy assertions changed with the lifecycle. This button no longer claims
 * a dispatch, because approving one does not perform one, and a test asserting
 * the old wording would be pinning the product to a claim it cannot support.
 */

const submitted: FormData[] = [];

vi.mock("../actions", () => ({
  approvePackageAction: vi.fn(async (_workspaceSlug: string, _previous: unknown, form: FormData) => {
    submitted.push(form);
    return {};
  }),
}));

const { ApprovePanel } = await import("./approve-panel");

const READY = {
  workspaceSlug: "hale-studio",
  packageId: "package-1",
  buyerName: "Northern Wire",
  assetCount: 4,
  terms: "One-time editorial, worldwide",
  restrictions: "No syndication",
  isApprovable: true,
  blockingTitles: [] as string[],
  defaultRecipient: "New York picture desk",
};

beforeEach(() => {
  submitted.length = 0;
});

describe("approval keeps its own confirmation", () => {
  it("does not approve on the first press", async () => {
    const user = userEvent.setup();
    render(<ApprovePanel {...READY} />);

    await user.click(screen.getByRole("button", { name: /approve package/i }));

    expect(submitted).toHaveLength(0);
    expect(screen.getByRole("button", { name: /yes, approve this package/i })).toBeInTheDocument();
  });

  it("names the frames, the buyer, the terms, and the restrictions before it commits", async () => {
    const user = userEvent.setup();
    render(<ApprovePanel {...READY} />);

    await user.click(screen.getByRole("button", { name: /approve package/i }));

    expect(screen.getByText("Northern Wire")).toBeInTheDocument();
    expect(screen.getByText("One-time editorial, worldwide")).toBeInTheDocument();
    expect(screen.getByText("No syndication")).toBeInTheDocument();
    expect(screen.getByText(/this becomes permanent/i)).toBeInTheDocument();
  });

  it("carries an explicit confirmation, which the action refuses to act without", async () => {
    const user = userEvent.setup();
    render(<ApprovePanel {...READY} />);

    await user.click(screen.getByRole("button", { name: /approve package/i }));
    await user.click(screen.getByRole("button", { name: /yes, approve this package/i }));

    expect(submitted).toHaveLength(1);
    expect(submitted[0].get("confirmed")).toBe("yes");
    expect(submitted[0].get("packageId")).toBe("package-1");
  });

  it("lets the second thoughts win", async () => {
    const user = userEvent.setup();
    render(<ApprovePanel {...READY} />);

    await user.click(screen.getByRole("button", { name: /approve package/i }));
    await user.click(screen.getByRole("button", { name: /go back/i }));

    expect(submitted).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: /approve package/i }),
    ).toBeInTheDocument();
  });

  it("stays disabled while any check is blocking", () => {
    render(<ApprovePanel {...READY} isApprovable={false} blockingTitles={["Missing captions"]} />);

    expect(screen.getByRole("button", { name: /approve package/i })).toBeDisabled();
    expect(screen.getByText(/missing captions/i)).toBeInTheDocument();
  });

  it("does not offer to create anything, so the two actions cannot be confused", () => {
    render(<ApprovePanel {...READY} />);

    const names = screen.getAllByRole("button").map((control) => control.textContent ?? "");
    expect(names.filter((name) => /create shoot/i.test(name))).toEqual([]);
  });
});
