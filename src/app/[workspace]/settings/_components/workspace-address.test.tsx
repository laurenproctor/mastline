import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAddress } from "./workspace-address";

vi.mock("../actions", () => ({
  renameWorkspaceAddressAction: vi.fn(async () => ({})),
}));

/**
 * Changing the address is not a settings field like a timezone: it is the URL
 * somebody has been sending to picture desks. So the cases below are mostly
 * about what has to be true before the button can be pressed at all.
 */
describe("WorkspaceAddress", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the current address without opening anything", () => {
    render(<WorkspaceAddress slug="marcus-hale-studio" workspaceSlug="marcus-hale-studio" />);
    expect(screen.getByText("mastline.co/marcus-hale-studio")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Workspace address/)).not.toBeInTheDocument();
  });

  it("says what will happen to old links before anything is typed", async () => {
    const user = userEvent.setup();
    render(<WorkspaceAddress slug="marcus-hale-studio" workspaceSlug="marcus-hale-studio" />);
    await user.click(screen.getByRole("button", { name: "Change address" }));

    expect(screen.getByText(/keep working/i)).toBeInTheDocument();
    expect(screen.getByText(/3 times a year/i)).toBeInTheDocument();
  });

  it("will not submit the address it already has", async () => {
    const user = userEvent.setup();
    render(<WorkspaceAddress slug="marcus-hale-studio" workspaceSlug="marcus-hale-studio" />);
    await user.click(screen.getByRole("button", { name: "Change address" }));

    expect(screen.getByRole("button", { name: "Change address" })).toBeDisabled();
  });

  it("refuses a reserved address without asking the server", async () => {
    const user = userEvent.setup();
    render(<WorkspaceAddress slug="marcus-hale-studio" workspaceSlug="marcus-hale-studio" />);
    await user.click(screen.getByRole("button", { name: "Change address" }));

    const field = screen.getByLabelText(/Workspace address/);
    await user.clear(field);
    await user.type(field, "pricing");

    expect(screen.getByText(/reserved for Mastline/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change address" })).toBeDisabled();
  });

  it("keeps what is typed to what a URL can hold", async () => {
    const user = userEvent.setup();
    render(<WorkspaceAddress slug="marcus-hale-studio" workspaceSlug="marcus-hale-studio" />);
    await user.click(screen.getByRole("button", { name: "Change address" }));

    const field = screen.getByLabelText(/Workspace address/);
    await user.clear(field);
    await user.type(field, "Hale Studio!");
    expect(field).toHaveValue("hale-studio-");
  });

  it("previews the address it would become", async () => {
    const user = userEvent.setup();
    render(<WorkspaceAddress slug="marcus-hale-studio" workspaceSlug="marcus-hale-studio" />);
    await user.click(screen.getByRole("button", { name: "Change address" }));

    const field = screen.getByLabelText(/Workspace address/);
    await user.clear(field);
    await user.type(field, "hale-studio");

    expect(screen.getByText(/mastline\.co\/hale-studio/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change address" })).toBeEnabled();
  });

  it("puts the original address back when cancelled", async () => {
    const user = userEvent.setup();
    render(<WorkspaceAddress slug="marcus-hale-studio" workspaceSlug="marcus-hale-studio" />);
    await user.click(screen.getByRole("button", { name: "Change address" }));

    const field = screen.getByLabelText(/Workspace address/);
    await user.clear(field);
    await user.type(field, "something-else");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // Reopening should not show the abandoned edit.
    await user.click(screen.getByRole("button", { name: "Change address" }));
    expect(screen.getByLabelText(/Workspace address/)).toHaveValue("marcus-hale-studio");
  });
});
