import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Panel, PanelBody, PanelHeader, SectionHeader } from "./index";

describe("Panel", () => {
  it("is a section by default, with the canonical class and its density", () => {
    const { container } = render(
      <Panel aria-labelledby="t">
        <PanelHeader id="t" title="Needs attention" />
        <PanelBody>Body</PanelBody>
      </Panel>,
    );
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.tagName).toBe("SECTION");
    expect(panel).toHaveClass("ml-panel");
    expect(panel).not.toHaveClass("ml-panel--compact");
    expect(panel).toHaveAttribute("aria-labelledby", "t");
    expect(screen.getByRole("heading", { name: "Needs attention" })).toHaveAttribute("id", "t");
  });

  it("can be another landmark-neutral element and compact", () => {
    const { container } = render(
      <Panel as="aside" compact>
        <PanelBody flush>x</PanelBody>
      </Panel>,
    );
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.tagName).toBe("ASIDE");
    expect(panel).toHaveClass("ml-panel", "ml-panel--compact");
    expect(panel.querySelector(".ml-panel__body")).toHaveClass("ml-panel__body--flush");
  });
});

describe("SectionHeader", () => {
  it("renders one h2 by default at any configured level", () => {
    const { rerender } = render(<SectionHeader title="Recent activity" />);
    expect(screen.getByRole("heading", { level: 2, name: "Recent activity" })).toHaveClass(
      "ml-section-title",
    );
    rerender(<SectionHeader level={4} title="Recent activity" />);
    expect(screen.getByRole("heading", { level: 4, name: "Recent activity" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("places description, metadata, and actions in their own regions", () => {
    render(
      <SectionHeader
        actions={<button type="button">Refresh</button>}
        description="Everything that changed."
        meta="Now · 12"
        title="Needs attention"
      />,
    );
    expect(screen.getByText("Everything that changed.")).toHaveClass(
      "ml-section-header__description",
    );
    expect(screen.getByText("Now · 12")).toHaveClass("ml-section-header__meta");
    expect(screen.getByRole("button", { name: "Refresh" }).parentElement).toHaveClass(
      "ml-section-header__actions",
    );
  });

  it("omits empty regions rather than rendering blank boxes", () => {
    const { container } = render(<SectionHeader title="Money" />);
    expect(container.querySelector(".ml-section-header__description")).toBeNull();
    expect(container.querySelector(".ml-section-header__meta")).toBeNull();
    expect(container.querySelector(".ml-section-header__actions")).toBeNull();
  });

  it("uses the canonical section-header class plus its own hook, and the panel variant adds the panel class", () => {
    const { container, rerender } = render(<SectionHeader title="Money" />);
    let header = container.firstElementChild as HTMLElement;
    expect(header).toHaveClass("ml-section-header", "ml-surface-header");
    expect(header).not.toHaveClass("ml-panel__header");
    rerender(<PanelHeader className="extra" title="Money" />);
    header = container.firstElementChild as HTMLElement;
    expect(header).toHaveClass(
      "ml-section-header",
      "ml-surface-header",
      "ml-panel__header",
      "extra",
    );
  });
});
