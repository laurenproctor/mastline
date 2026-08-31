import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/components/page-header";

describe("PageHeader", () => {
  it("renders the title as the page's h1 by default", () => {
    render(<PageHeader title="Work queue" />);

    const heading = screen.getByRole("heading", { level: 1, name: "Work queue" });
    expect(heading).toHaveClass("ml-display");
    expect(heading.closest("header")).toHaveClass("ml-page-header");
  });

  it("lets a section header take a lower level without changing its look", () => {
    render(<PageHeader level={2} title="Packages" />);

    expect(screen.getByRole("heading", { level: 2, name: "Packages" })).toHaveClass("ml-display");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("shows the eyebrow and description only when given", () => {
    const { rerender } = render(<PageHeader title="Work queue" />);
    expect(document.querySelector(".ml-eyebrow")).toBeNull();
    expect(document.querySelector(".ml-page-header__description")).toBeNull();

    rerender(
      <PageHeader
        description="12 items need action."
        eyebrow="Friday, August 28"
        title="Work queue"
      />,
    );
    expect(screen.getByText("Friday, August 28")).toHaveClass("ml-eyebrow");
    expect(screen.getByText("12 items need action.")).toHaveClass("ml-page-header__description");
  });

  it("renders no actions region when there is nothing to act on", () => {
    render(<PageHeader title="Submissions" />);
    expect(document.querySelector(".ml-page-header__actions")).toBeNull();
  });

  it("draws exactly one dark primary action and outlines the rest", () => {
    render(
      <PageHeader
        primaryAction={{ label: "Create shoot", href: "/studio/shoots/new" }}
        secondaryActions={[
          { label: "Import", href: "/studio/shoots/import" },
          { label: "Export", href: "/studio/export" },
        ]}
        title="Shoots"
      />,
    );

    const actions = document.querySelector(".ml-page-header__actions");
    expect(actions).not.toBeNull();
    const links = within(actions as HTMLElement).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Import", "Export", "Create shoot"]);

    const primary = screen.getByRole("link", { name: "Create shoot" });
    expect(primary).toHaveAttribute("href", "/studio/shoots/new");
    expect(primary).toHaveClass("ml-button");
    expect(primary).not.toHaveClass("ml-button--secondary");

    const dark = links.filter((link) => !link.classList.contains("ml-button--secondary"));
    expect(dark).toHaveLength(1);
    for (const link of [
      screen.getByRole("link", { name: "Import" }),
      screen.getByRole("link", { name: "Export" }),
    ]) {
      expect(link).toHaveClass("ml-button", "ml-button--secondary");
    }
  });

  it("keeps secondary actions even without a primary one", () => {
    render(
      <PageHeader
        secondaryActions={[{ label: "View archive", href: "/studio/archive" }]}
        title="Recent activity"
      />,
    );
    expect(screen.getByRole("link", { name: "View archive" })).toHaveClass("ml-button--secondary");
  });

  it("appends a caller's class to the header", () => {
    render(<PageHeader className="work-header" title="Work queue" />);
    expect(document.querySelector("header")).toHaveClass("ml-page-header", "work-header");
  });
});
