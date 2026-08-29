import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilterBar, FilterChip, FilterLink } from "@/components/filter-chip";

describe("FilterChip", () => {
  it("is a toggle button that reports its state with aria-pressed", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <FilterChip onClick={onClick} pressed={false}>
        Warnings
      </FilterChip>,
    );
    const chip = screen.getByRole("button", { name: "Warnings" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveAttribute("type", "button");
    expect(chip).toHaveClass("ml-filter-chip");
    await user.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows the pressed state the page gives it", () => {
    render(
      <FilterChip className="sheet-filter" pressed>
        Selected
      </FilterChip>,
    );
    const chip = screen.getByRole("button", { name: "Selected" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveClass("ml-filter-chip", "sheet-filter");
    expect(chip).not.toHaveAttribute("aria-selected");
  });
});

describe("FilterLink", () => {
  it("is a link that keeps its query string", () => {
    render(
      <FilterLink current={false} href="/studio/archive?q=hotel&filter=earning">
        Has earned
      </FilterLink>,
    );
    const link = screen.getByRole("link", { name: "Has earned" });
    expect(link).toHaveAttribute("href", "/studio/archive?q=hotel&filter=earning");
    expect(link).toHaveClass("ml-filter-chip");
    expect(link).not.toHaveAttribute("aria-current");
    expect(link).not.toHaveAttribute("aria-pressed");
    expect(link).not.toHaveAttribute("aria-selected");
  });

  it("marks the filter already applied as current", () => {
    render(
      <FilterLink current href="/studio/archive">
        All assets
      </FilterLink>,
    );
    expect(screen.getByRole("link", { name: "All assets" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});

describe("FilterBar", () => {
  it("groups chips on the bar treatment", () => {
    render(
      <FilterBar className="archive-filters">
        <FilterLink current href="/studio/archive">
          All
        </FilterLink>
      </FilterBar>,
    );
    expect(screen.getByRole("link").parentElement).toHaveClass("ml-filter-bar", "archive-filters");
  });
});
