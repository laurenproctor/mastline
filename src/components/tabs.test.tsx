import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabLink, Tabs } from "@/components/tabs";

describe("Tabs", () => {
  function renderPackages() {
    return render(
      <Tabs className="package-row" label="Packages on this shoot">
        <TabLink current href="/studio/dispatch/s1?package=p1">
          Package 01 <small>Ready</small>
        </TabLink>
        <TabLink href="/studio/dispatch/s1?package=p2">
          Package 02 <small>Draft</small>
        </TabLink>
      </Tabs>,
    );
  }

  it("is a named navigation landmark of links", () => {
    renderPackages();
    const nav = screen.getByRole("navigation", { name: "Packages on this shoot" });
    expect(nav).toHaveClass("ml-tabs", "package-row");
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/studio/dispatch/s1?package=p1");
    expect(links[1]).toHaveAttribute("href", "/studio/dispatch/s1?package=p2");
    for (const link of links) expect(link).toHaveClass("ml-tab");
  });

  it("marks the current route with aria-current=page and nothing else", () => {
    renderPackages();
    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Package 01");
    expect(screen.getByRole("link", { name: /Package 02/ })).not.toHaveAttribute("aria-current");
  });

  it("never claims the tab roles a row of links cannot honour", () => {
    renderPackages();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(document.querySelector("[aria-selected]")).toBeNull();
  });
});
