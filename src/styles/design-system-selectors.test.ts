import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The stylesheet is the other half of a component's contract, and a component
 * test cannot see it. These pin the selectors a component relies on to say a
 * state it only expresses through an attribute: a route tab that is current
 * says so with aria-current="page" and nothing else, so the sheet has to draw
 * from exactly that. (e2e/route-tabs.spec.ts proves the rendered result on a
 * real page; this catches the selector being edited away before it gets there.)
 */
// A path string rather than a URL object: under jsdom the global URL is not
// Node's, and fs will not take it.
const sheet = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "mastline-dashboard-design-system.css"),
  "utf8",
);

/** The selector list of every rule whose declarations contain `needle`. */
function rulesDeclaring(needle: string): string[] {
  return Array.from(sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter(([, , body]) => body.includes(needle))
    .map(([, selectors]) => selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim());
}

describe("route tab active state", () => {
  it("colours the current route tab from aria-current, alongside the interactive forms", () => {
    const rule = rulesDeclaring("color: var(--ml-ink)").find((s) => s.includes(".ml-tab["));
    expect(rule).toBeDefined();
    expect(rule).toContain('.ml-tab[aria-current="page"]');
    expect(rule).toContain('.ml-tab[aria-selected="true"]');
    expect(rule).toContain(".ml-tab.is-active");
  });

  it("shows the underline for the current route tab", () => {
    const rule = rulesDeclaring("transform: scaleX(1)").find((s) => s.includes(".ml-tab["));
    expect(rule).toBeDefined();
    expect(rule).toContain('.ml-tab[aria-current="page"]::after');
    expect(rule).toContain('.ml-tab[aria-selected="true"]::after');
    expect(rule).toContain(".ml-tab.is-active::after");
  });

  it("draws a current filter link the same way as a pressed chip", () => {
    const rule = rulesDeclaring("background: var(--ml-ink)").find((s) =>
      s.includes(".ml-filter-chip["),
    );
    expect(rule).toContain(".ml-filter-chip[aria-current]");
    expect(rule).toContain('.ml-filter-chip[aria-pressed="true"]');
  });
});
