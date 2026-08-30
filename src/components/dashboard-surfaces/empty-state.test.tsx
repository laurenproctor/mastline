import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./index";

describe("EmptyState", () => {
  it("has a title at the configured heading level and the caller's words", () => {
    const { rerender } = render(
      <EmptyState
        description="Import a shoot to start building the archive."
        title="No assets yet"
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "No assets yet" })).toHaveClass(
      "ml-empty-state__title",
    );
    expect(screen.getByText("Import a shoot to start building the archive.")).toHaveClass(
      "ml-empty-state__copy",
    );
    rerender(<EmptyState level={3} title="Nothing recorded yet." />);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Nothing recorded yet.");
  });

  it.each([
    ["neither", {}, 0],
    [
      "a primary link",
      { primaryAction: { label: "Import a shoot", href: "/studio/shoots/new" } },
      1,
    ],
    [
      "a secondary link",
      { secondaryAction: { label: "View archive", href: "/studio/archive" } },
      1,
    ],
    [
      "both links",
      {
        primaryAction: { label: "Import a shoot", href: "/studio/shoots/new" },
        secondaryAction: { label: "View archive", href: "/studio/archive" },
      },
      2,
    ],
  ] as const)("renders %s", (_case, props, expectedLinks) => {
    const { container } = render(<EmptyState title="Empty" {...props} />);
    expect(screen.queryAllByRole("link")).toHaveLength(expectedLinks);
    if (expectedLinks === 0) {
      expect(container.querySelector(".ml-empty-state__actions")).toBeNull();
    } else {
      expect(container.querySelector(".ml-empty-state__actions")).not.toBeNull();
    }
  });

  it("draws the primary action dark and the secondary outlined, in that order", () => {
    render(
      <EmptyState
        primaryAction={{ label: "Import a shoot", href: "/studio/shoots/new" }}
        secondaryAction={{ label: "View archive", href: "/studio/archive" }}
        title="Empty"
      />,
    );
    const [primary, secondary] = screen.getAllByRole("link");
    expect(primary).toHaveTextContent("Import a shoot");
    expect(primary).toHaveAttribute("href", "/studio/shoots/new");
    expect(primary).toHaveClass("ml-button");
    expect(primary).not.toHaveClass("ml-button--secondary");
    expect(secondary).toHaveClass("ml-button", "ml-button--secondary");
  });

  it("accepts an action as a node, for a button that does something on the page", () => {
    render(
      <EmptyState
        primaryAction={
          <button className="ml-button" type="button">
            Retry import
          </button>
        }
        title="Import failed"
      />,
    );
    expect(screen.getByRole("button", { name: "Retry import" }).parentElement).toHaveClass(
      "ml-empty-state__actions",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("hides the visual from readers and has a compact layout", () => {
    const { container } = render(
      <EmptyState compact title="Nothing here" visual={<svg data-testid="mark" />} />,
    );
    expect(container.firstElementChild).toHaveClass("ml-empty-state", "ml-empty-state--compact");
    expect(screen.getByTestId("mark").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("mark").parentElement).toHaveClass("ml-empty-state__visual");
  });
});
