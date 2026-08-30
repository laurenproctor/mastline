import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The surfaces stylesheet has to stay inside its lane: ml- classes only, no
 * bare elements, no generic names, tokens rather than literal values, and no
 * !important. And every class a surface component writes has to be drawn by
 * one of the two sheets, or it is a typo nobody will notice until a screen
 * looks wrong.
 */
const here = dirname(fileURLToPath(import.meta.url));
const surfaces = readFileSync(join(here, "mastline-dashboard-surfaces.css"), "utf8");
const canonical = readFileSync(join(here, "mastline-dashboard-design-system.css"), "utf8");

const stripped = surfaces.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every selector list in the sheet, one entry per comma-separated selector. */
function selectors(css: string): string[] {
  const out: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const head = match[1].trim();
    if (head.startsWith("@")) continue;
    for (const part of head.split(",")) out.push(part.trim());
  }
  return out;
}

const GENERIC = /^\.(card|panel|table|row|empty|status|list|button|badge|field)$/;

describe("mastline-dashboard-surfaces.css", () => {
  it("only ever starts a selector with an ml- class", () => {
    for (const selector of selectors(stripped)) {
      expect(selector, selector).toMatch(/^\.ml-[a-z0-9_-]+/);
    }
  });

  it("styles no bare element globally and no generic name anywhere", () => {
    for (const selector of selectors(stripped)) {
      const compounds = selector.split(/\s+|>|\+|~/).filter(Boolean);
      // A bare element may appear only beneath an ml- class (".ml-x .ml-table th").
      expect(compounds[0], selector).not.toMatch(/^[a-z][a-z0-9]*$/);
      for (const compound of compounds) expect(compound, selector).not.toMatch(GENERIC);
    }
  });

  it("uses tokens rather than literal colours, and never !important", () => {
    expect(stripped).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(stripped).not.toMatch(/\brgba?\(/);
    expect(stripped).not.toMatch(/!important/);
    for (const token of stripped.matchAll(/var\((--[a-z0-9-]+)/g)) {
      expect(token[1], token[1]).toMatch(/^--ml-/);
      expect(canonical, `${token[1]} is defined by the canonical sheet`).toContain(`${token[1]}:`);
    }
  });

  it("draws every ml- class the surface components write", () => {
    const dir = join(here, "..", "components", "dashboard-surfaces");
    const written = new Set<string>();
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".tsx") || file.endsWith(".test.tsx")) continue;
      const source = readFileSync(join(dir, file), "utf8");
      for (const cls of source.matchAll(/"(ml-[a-z0-9_-]+)"/g)) written.add(cls[1]);
      for (const cls of source.matchAll(/\b(ml-[a-z0-9_-]+)\b/g)) written.add(cls[1]);
    }
    expect(written.size).toBeGreaterThan(20);
    const drawn = `${surfaces}\n${canonical}`;
    for (const cls of written) {
      expect(drawn, `.${cls} has a rule`).toMatch(
        new RegExp(`\\.${cls.replace(/[-]/g, "\\-")}(?![a-z0-9_-])`),
      );
    }
  });
});
