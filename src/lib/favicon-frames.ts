/**
 * The Mastline favicon and its 32-second focus blink.
 *
 * Browsers draw an SVG favicon as a still image: the CSS animation and any SMIL
 * inside the file are ignored once it is in the tab strip. So the blink is
 * driven from JavaScript instead, swapping the `<link rel="icon">` through a
 * short list of pre-rendered frames. This module holds the pure parts — the
 * artwork, the frames and the schedule — so they can be tested without a DOM.
 *
 * The same artwork lives in public/favicon.svg, which is the still icon a tab
 * gets before hydration, in a feed reader, and anywhere JavaScript never runs.
 * Change both together.
 */

const INK = "#16171A";
const FOCUS = "#89FF0A";

/**
 * A favicon is drawn into a square. The wordmark's own 142x91 frame would be
 * letterboxed down to a sliver of that square, so the artwork is re-centred in
 * a square viewBox with four units of side padding.
 */
const VIEW_BOX = "16 -7.5 150 150";

const MARK_PATHS = [
  "M37.4 46.7c-3.2 0-6.1 1.9-7.5 4.7-.6 1.2-.9 2.5-.9 3.9v45.6c0 1.8 1.4 3.2 3.2 3.2h7.2c1.8 0 3.2-1.4 3.2-3.2V64.7l13.2 15.5c1.7 2 4.7 2.1 6.5.1l12-13.7c1.5-1.7 2.3-4 2.3-6.4V46.5L59.1 66.2 43.2 48.8c-1.5-1.4-3.5-2.1-5.8-2.1Z",
  "M86.5 30.8c-4 0-7.3 3.3-7.3 7.3v58.6c0 4.1 3.3 7.4 7.4 7.4h61.9c2.5 0 4.5-2 4.5-4.5v-3.9c0-2.5-2-4.5-4.5-4.5H93.7V35.3c0-2.5-2-4.5-4.5-4.5h-2.7Z",
  "M97 45.4v12.8h36.8c2.7 0 4.9 2.2 4.9 4.9V88c8-1.4 13.7-8.6 13.7-17.3v-8.9c0-9.1-7.3-16.4-16.4-16.4H97Z",
];

const FOCUS_RECT = { x: 121.8, y: 62.8, size: 13.4, radius: 2.3 };
const FOCUS_CENTER_X = FOCUS_RECT.x + FOCUS_RECT.size / 2;
const FOCUS_CENTER_Y = FOCUS_RECT.y + FOCUS_RECT.size / 2;

/** How the green focus indicator looks in one frame. */
export type FocusState = { opacity: number; scale: number };

export const RESTING_FOCUS: FocusState = { opacity: 1, scale: 1 };

/** One full pass: a long hold, then the blink, then back to the hold. */
export const BLINK_CYCLE_MS = 32_000;

/**
 * The blink, as discrete frames rather than a tween.
 *
 * Offsets are milliseconds from the start of a cycle and match the percentages
 * the designed keyframes used (92% of 32s is 29.44s, and so on). A favicon is
 * 16 CSS pixels, where the two mid frames read as a shutter rather than as
 * separate steps, so the whole thing is six paints instead of an interpolation.
 */
export const BLINK_FRAMES: ReadonlyArray<{ at: number } & FocusState> = [
  { at: 0, ...RESTING_FOCUS },
  { at: 29_440, opacity: 0.62, scale: 0.86 },
  { at: 29_920, opacity: 0.28, scale: 0.68 },
  { at: 30_400, opacity: 1, scale: 1.08 },
  { at: 30_784, opacity: 0.48, scale: 0.82 },
  { at: 31_296, ...RESTING_FOCUS },
];

/**
 * One frame as a `data:` URI, ready to hand to a `<link rel="icon">`.
 *
 * Percent-encoded rather than base64: the artwork is ASCII, the result is
 * smaller, and it stays readable in devtools.
 */
export function faviconFrame({ opacity, scale }: FocusState): string {
  // transform-box/transform-origin are a CSS convenience the still file can
  // use; a presentation transform has to scale about the square's centre by
  // hand.
  const transform =
    scale === 1
      ? ""
      : ` transform="translate(${FOCUS_CENTER_X} ${FOCUS_CENTER_Y}) scale(${scale}) translate(${-FOCUS_CENTER_X} ${-FOCUS_CENTER_Y})"`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_BOX}">` +
    `<g fill="${INK}">${MARK_PATHS.map((d) => `<path d="${d}"/>`).join("")}</g>` +
    `<rect x="${FOCUS_RECT.x}" y="${FOCUS_RECT.y}" width="${FOCUS_RECT.size}" height="${FOCUS_RECT.size}"` +
    ` rx="${FOCUS_RECT.radius}" fill="${FOCUS}" opacity="${opacity}"${transform}/>` +
    `</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * The whole cycle, rendered once. Building six data URIs per cycle would be
 * wasted work in a tab that may stay open all day, so callers build this list
 * on mount and then only swap hrefs.
 */
export function faviconCycle(): ReadonlyArray<{ at: number; href: string }> {
  return BLINK_FRAMES.map(({ at, opacity, scale }) => ({
    at,
    href: faviconFrame({ opacity, scale }),
  }));
}
