/**
 * The mark burned into a preview before a buyer sees it.
 *
 * A watermark does not stop a screenshot, and pretending otherwise would be a
 * poor reason to build one. What it does is make the screenshot *attributable*:
 * the recipient's own name is in the frame, so a picture that turns up
 * somewhere it should not can be traced to the desk it was sent to. For a
 * business whose asset is provenance, that is the point.
 *
 * This half builds the overlay and nothing else. It has no image library in it,
 * so the wording, the geometry, and the escaping can all be tested directly.
 */

export interface WatermarkText {
  /** Who the link was made for. The reason the mark is worth burning in. */
  readonly recipient?: string;
  /** Whose work it is. */
  readonly credit?: string;
  /** When it was sent, so an old leak dates itself. */
  readonly sentOn?: string;
}

/** Kept short: it repeats across the frame and must stay readable at an angle. */
export function watermarkLine(text: WatermarkText): string {
  const parts = ["MASTLINE PREVIEW"];
  if (text.recipient) parts.push(text.recipient);
  if (text.sentOn) parts.push(text.sentOn);
  return parts.join(" · ");
}

/** The line along the bottom, which carries the credit and the terms. */
export function watermarkFooter(text: WatermarkText): string {
  const parts: string[] = [];
  if (text.credit) parts.push(`© ${text.credit}`);
  parts.push("Preview only — not licensed for publication");
  return parts.join("  ·  ");
}

/**
 * XML escaping.
 *
 * A recipient label is free text typed by an operator. Without this, an
 * apostrophe in "O'Brien Picture Desk" produces invalid SVG and the whole
 * preview fails to render, and a `<` would let that text reach the document.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Scale everything to the frame.
 *
 * A fixed size is either invisible on a large frame or covers a small one, and
 * previews here run to 1400px on the long edge but can be much smaller.
 */
export function watermarkGeometry(width: number, height: number) {
  const shortEdge = Math.max(1, Math.min(width, height));
  return {
    /** Big enough to read, small enough to leave the picture judgeable. */
    fontSize: Math.max(11, Math.round(shortEdge * 0.035)),
    footerFontSize: Math.max(9, Math.round(shortEdge * 0.022)),
    /** Spacing of the repeated diagonal rows. */
    rowGap: Math.max(60, Math.round(shortEdge * 0.28)),
    footerHeight: Math.max(22, Math.round(shortEdge * 0.06)),
  };
}

/**
 * The overlay, as SVG.
 *
 * Repeated diagonal text at low opacity, plus a solid bar along the bottom. The
 * diagonal is what survives a crop; the bar is what a person reads. Both are
 * deliberately light enough that a picture editor can still judge the frame,
 * because a preview nobody can assess does not get bought.
 */
export function watermarkSvg(input: {
  width: number;
  height: number;
  text: WatermarkText;
}): string {
  const { width, height, text } = input;
  const geometry = watermarkGeometry(width, height);
  const line = escapeXml(watermarkLine(text));
  const footer = escapeXml(watermarkFooter(text));

  // Enough rows to cover the frame once it is rotated.
  const diagonal = Math.ceil(Math.sqrt(width * width + height * height));
  const rows: string[] = [];
  for (let y = -diagonal; y < diagonal; y += geometry.rowGap) {
    rows.push(
      `<text x="0" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${geometry.fontSize}" ` +
        `fill="#ffffff" fill-opacity="0.28" letter-spacing="2">${line}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <g transform="rotate(-30 ${width / 2} ${height / 2})" text-rendering="geometricPrecision">
    ${rows.join("\n    ")}
  </g>
  <rect x="0" y="${height - geometry.footerHeight}" width="${width}" height="${geometry.footerHeight}" fill="#000000" fill-opacity="0.55"/>
  <text x="${Math.round(geometry.footerHeight * 0.4)}" y="${height - Math.round(geometry.footerHeight * 0.32)}" font-family="Helvetica, Arial, sans-serif" font-size="${geometry.footerFontSize}" fill="#ffffff" fill-opacity="0.92">${footer}</text>
</svg>`;
}
