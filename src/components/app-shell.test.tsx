import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The shell is an async server component. It reads the request's cookies and
 * the session, and everything it draws follows from those two, so both are
 * stood in for here and the component is awaited like the function it is.
 */
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

const STUDIO = {
  id: "org-1",
  name: "Marcus Hale Studio",
  slug: "marcus-hale-studio",
  role: "owner",
};
const session = {
  userId: "user-1",
  email: "marcus@mastline.test",
  hasVerifiedFactor: true,
  displayName: "Marcus Hale",
  initials: "MH",
  workspaces: [STUDIO],
  activeWorkspace: STUDIO,
};
vi.mock("@/lib/auth", () => ({
  requireWorkspace: vi.fn(async () => session),
}));
vi.mock("@/lib/data/subscription", () => ({
  getWorkspaceStatus: vi.fn(async () => ({ notice: null })),
}));
vi.mock("@/lib/data/profiles", () => ({
  getProfile: vi.fn(async () => null),
  signAvatarUrl: vi.fn(async () => undefined),
}));
// A server action; the switcher only renders it when there are two workspaces.
vi.mock("@/app/workspace/actions", () => ({ switchWorkspace: vi.fn() }));

import { AppShell, type NavLabel } from "@/components/app-shell";

async function renderShell(active?: NavLabel) {
  const tree = await AppShell({ active, workspace: STUDIO.slug, children: <p>Body</p> });
  return render(tree);
}

const NAV_ORDER = [
  "Work",
  "News radar",
  "Shoots",
  "Submissions",
  "Commercial",
  "Money",
  "Rights",
  "Archive",
];

describe("AppShell", () => {
  beforeEach(() => {
    cookieJar.clear();
  });

  it("marks the active destination with aria-current and nothing else", async () => {
    await renderShell("Money");

    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Money");
    expect(current[0]).toHaveClass("ml-nav-item");
  });

  it("keeps every destination, in the operating-loop order", async () => {
    await renderShell("Work");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent?.trim());
    expect(labels).toEqual(NAV_ORDER);
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(new RegExp(`^/${STUDIO.slug}/`));
    }
  });

  it("puts Settings in the footer and marks it when it is the page", async () => {
    await renderShell("Settings");

    const settings = screen.getByRole("link", { name: "Settings" });
    expect(settings).toHaveAttribute("href", `/${STUDIO.slug}/settings`);
    expect(settings).toHaveAttribute("aria-current", "page");
    expect(settings.closest(".ml-sidebar__footer")).not.toBeNull();
    // It is not one of the primary destinations.
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("says whose workspace this is, with the role spelled out", async () => {
    await renderShell("Work");

    const identity = document.querySelector(".ml-workspace-identity");
    expect(identity).not.toBeNull();
    expect(identity).toHaveTextContent("Marcus Hale");
    expect(identity).toHaveTextContent("Marcus Hale Studio");
    expect(identity).toHaveTextContent("Owner · all access");
    // The truncating lines carry the full text for anyone who hovers.
    expect(within(identity as HTMLElement).getByTitle("Marcus Hale Studio")).toHaveClass(
      "ml-truncate",
    );
  });

  it("keeps the way out as a real form submission", async () => {
    await renderShell("Work");

    const signOut = screen.getByRole("button", { name: "Sign out" });
    expect(signOut).toHaveAttribute("type", "submit");
    expect(signOut.closest("form")).toHaveAttribute("action", "/auth/sign-out");
    expect(signOut.closest("form")).toHaveAttribute("method", "post");
  });

  it("offers the skip link first and points it at the main landmark", async () => {
    const { container } = await renderShell("Work");

    const shell = container.firstElementChild as HTMLElement;
    expect(shell).toHaveAttribute("data-mastline-app");
    const first = shell.firstElementChild as HTMLElement;
    expect(first).toHaveClass("skip-link");
    expect(first).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(screen.getByRole("main")).toHaveTextContent("Body");
  });

  describe("phone navigation modes", () => {
    it("draws the tile header with no cookie, and no tab bar", async () => {
      const { container } = await renderShell("Work");

      const shell = container.firstElementChild as HTMLElement;
      expect(shell).toHaveClass("ml-app-shell", "app-shell");
      expect(shell).not.toHaveClass("nav-bottom");
      expect(shell).toHaveAttribute("data-nav-mode", "tiles");
      expect(document.querySelector(".tab-bar")).toBeNull();
      expect(document.querySelector(".mobile-top")).toBeNull();
      expect(screen.getAllByRole("navigation", { name: "Primary" })).toHaveLength(1);
    });

    it("draws the bottom bar when the cookie asks for it", async () => {
      cookieJar.set("mastline_nav", "bottom");
      const { container } = await renderShell("Shoots");

      const shell = container.firstElementChild as HTMLElement;
      expect(shell).toHaveClass("nav-bottom");
      expect(shell).toHaveAttribute("data-nav-mode", "bottom");
      const bar = document.querySelector(".tab-bar");
      expect(bar).not.toBeNull();
      expect(within(bar as HTMLElement).getByRole("link", { name: "Shoots" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      // The sidebar is still in the document; the stylesheet decides which of
      // the two is shown at a given width.
      expect(document.querySelector(".ml-sidebar")).not.toBeNull();
    });

    it("treats any other cookie value as the default", async () => {
      cookieJar.set("mastline_nav", "sideways");
      const { container } = await renderShell("Work");

      expect(container.firstElementChild).not.toHaveClass("nav-bottom");
      expect(container.firstElementChild).toHaveAttribute("data-nav-mode", "tiles");
      expect(document.querySelector(".tab-bar")).toBeNull();
    });
  });
});
