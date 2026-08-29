import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/auth";

// The server action never runs in jsdom; the form only has to be bound to it.
vi.mock("@/app/workspace/actions", () => ({ switchWorkspace: vi.fn(async () => {}) }));

import { WorkspaceSwitcher } from "@/components/workspace-switcher";

/** Only the fields the switcher reads; the rest of a Workspace is irrelevant here. */
function workspace(id: string, name: string, slug: string, role: Workspace["role"]): Workspace {
  return { id, name, slug, role } as Workspace;
}

const STUDIO = workspace("org-a", "Marcus Hale Studio", "marcus-hale-studio", "owner");
const DESK = workspace("org-b", "Second Desk", "second-desk", "editor");
const LONG = workspace(
  "org-c",
  "The Extraordinarily Long-Named Editorial Photography Collective of Greater Los Angeles",
  "long",
  "viewer",
);

describe("WorkspaceSwitcher", () => {
  it("renders nothing for a person with one workspace", () => {
    const { container } = render(<WorkspaceSwitcher activeId={STUDIO.id} workspaces={[STUDIO]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers every workspace and preselects the active one", () => {
    render(<WorkspaceSwitcher activeId={DESK.id} workspaces={[STUDIO, DESK, LONG]} />);
    const select = screen.getByLabelText("Workspace");
    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect(select).toHaveValue(DESK.id);
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.getAttribute("value"))).toEqual([
      STUDIO.id,
      DESK.id,
      LONG.id,
    ]);
    expect(options.map((option) => option.textContent)).toEqual([
      STUDIO.name,
      DESK.name,
      LONG.name,
    ]);
  });

  it("posts organizationId to the server action from a real form", () => {
    render(<WorkspaceSwitcher activeId={STUDIO.id} workspaces={[STUDIO, DESK]} />);
    const select = screen.getByLabelText("Workspace");
    expect(select).toHaveAttribute("name", "organizationId");
    const form = select.closest("form");
    expect(form).not.toBeNull();
    expect(form).toHaveClass("workspace-switcher");
    // React binds a function action to the form; the attribute is then a
    // generated action URL, so the binding is checked through the element.
    expect((form as HTMLFormElement & { action?: unknown }).action).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Switch" });
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit.closest("form")).toBe(form);
  });

  it("uses the canonical field and button", () => {
    render(<WorkspaceSwitcher activeId={STUDIO.id} workspaces={[STUDIO, DESK]} />);
    expect(screen.getByLabelText("Workspace")).toHaveClass("ml-select");
    expect(screen.getByText("Workspace")).toHaveClass("ml-label");
    expect(screen.getByRole("button", { name: "Switch" })).toHaveClass(
      "ml-button",
      "ml-button--secondary",
      "ml-button--sm",
    );
    expect(document.querySelector(".ml-field")).not.toBeNull();
  });

  it("keeps a long workspace name as accessible text", () => {
    render(<WorkspaceSwitcher activeId={LONG.id} workspaces={[STUDIO, LONG]} />);
    expect(screen.getByRole("option", { name: LONG.name })).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace")).toHaveDisplayValue(LONG.name);
  });
});
