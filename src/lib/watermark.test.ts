import { describe, expect, it } from "vitest";
import {
  escapeXml,
  watermarkFooter,
  watermarkGeometry,
  watermarkLine,
  watermarkSvg,
} from "./watermark";

describe("what the mark says", () => {
  it("names the recipient, which is the reason for burning it in", () => {
    expect(watermarkLine({ recipient: "New York picture desk", sentOn: "24 Aug 2026" })).toBe(
      "MASTLINE PREVIEW · New York picture desk · 24 Aug 2026",
    );
  });

  it("still says something when nothing is known about the recipient", () => {
    expect(watermarkLine({})).toBe("MASTLINE PREVIEW");
  });

  it("puts the credit and the terms along the bottom", () => {
    expect(watermarkFooter({ credit: "Marcus Hale" })).toBe(
      "© Marcus Hale  ·  Preview only — not licensed for publication",
    );
  });

  it("says it is not licensed even with no credit to show", () => {
    expect(watermarkFooter({})).toContain("not licensed for publication");
  });
});

describe("escapeXml", () => {
  it("survives the apostrophe in a real desk name", () => {
    // Without this, "O'Brien Picture Desk" makes invalid SVG and the whole
    // preview fails to render.
    expect(escapeXml("O'Brien Picture Desk")).toBe("O&apos;Brien Picture Desk");
  });

  it("keeps typed text from reaching the document", () => {
    expect(escapeXml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeXml("Dow & Jones")).toBe("Dow &amp; Jones");
  });

  it("escapes the ampersand first, so an escape is not escaped twice", () => {
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });
});

describe("watermarkGeometry", () => {
  it("scales to the frame rather than assuming one size", () => {
    const large = watermarkGeometry(1400, 1000);
    const small = watermarkGeometry(320, 240);
    expect(large.fontSize).toBeGreaterThan(small.fontSize);
    expect(large.footerHeight).toBeGreaterThan(small.footerHeight);
  });

  it("stays readable on a tiny frame", () => {
    const tiny = watermarkGeometry(40, 30);
    expect(tiny.fontSize).toBeGreaterThanOrEqual(11);
    expect(tiny.footerFontSize).toBeGreaterThanOrEqual(9);
  });

  it("uses the short edge, so a panorama is not marked with giant text", () => {
    expect(watermarkGeometry(4000, 400).fontSize).toBe(watermarkGeometry(400, 4000).fontSize);
  });
});

describe("watermarkSvg", () => {
  const svg = watermarkSvg({
    width: 1400,
    height: 1000,
    text: { recipient: "O'Brien Picture Desk", credit: "Marcus Hale", sentOn: "24 Aug 2026" },
  });

  it("is a well-formed document of the right size", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="1400"');
    expect(svg).toContain('height="1000"');
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("escapes the recipient into the document rather than breaking it", () => {
    expect(svg).toContain("O&apos;Brien Picture Desk");
    expect(svg).not.toContain("O'Brien");
  });

  it("repeats across the frame, so a crop does not remove it", () => {
    const occurrences = svg.split("MASTLINE PREVIEW").length - 1;
    expect(occurrences).toBeGreaterThan(3);
  });

  it("is light enough to leave the picture judgeable", () => {
    // A preview an editor cannot assess does not get bought.
    const opacity = Number(svg.match(/fill-opacity="([\d.]+)" letter-spacing/)?.[1]);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(0.4);
  });

  it("carries the credit along the bottom", () => {
    expect(svg).toContain("© Marcus Hale");
  });

  it("does not fall apart on a frame with no metadata at all", () => {
    const bare = watermarkSvg({ width: 100, height: 100, text: {} });
    expect(bare).toContain("MASTLINE PREVIEW");
    expect(bare).toContain("not licensed");
  });
});
