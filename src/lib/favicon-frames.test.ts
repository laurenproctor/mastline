import { describe, expect, it } from "vitest";
import {
  BLINK_CYCLE_MS,
  BLINK_FRAMES,
  faviconCycle,
  faviconFrame,
  RESTING_FOCUS,
} from "@/lib/favicon-frames";

describe("favicon frames", () => {
  it("blinks once every 32 seconds", () => {
    expect(BLINK_CYCLE_MS).toBe(32_000);
  });

  it("opens and closes the cycle at rest", () => {
    expect(BLINK_FRAMES[0]).toMatchObject({ at: 0, ...RESTING_FOCUS });
    expect(BLINK_FRAMES[BLINK_FRAMES.length - 1]).toMatchObject(RESTING_FOCUS);
  });

  it("orders the frames and keeps them inside one cycle", () => {
    const offsets = BLINK_FRAMES.map((frame) => frame.at);
    expect(offsets).toStrictEqual([...offsets].sort((a, b) => a - b));
    expect(new Set(offsets).size).toBe(offsets.length);
    expect(Math.max(...offsets)).toBeLessThan(BLINK_CYCLE_MS);
  });

  it("holds the resting icon for most of the cycle", () => {
    // The point of the long hold: a tab strip that flickers every few seconds
    // is an irritation, not a signal.
    const blinkStart = BLINK_FRAMES[1].at;
    expect(blinkStart / BLINK_CYCLE_MS).toBeGreaterThan(0.9);
  });

  it("renders a decodable SVG data URI carrying the focus square", () => {
    const svg = decodeURIComponent(faviconFrame(RESTING_FOCUS).replace("data:image/svg+xml,", ""));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('fill="#89FF0A"');
    expect(svg).toContain('opacity="1"');
    // The resting frame carries no transform: scale(1) is not worth the bytes.
    expect(svg).not.toContain("transform=");
  });

  it("scales the focus square about its own centre", () => {
    const svg = decodeURIComponent(
      faviconFrame({ opacity: 0.28, scale: 0.68 }).replace("data:image/svg+xml,", ""),
    );
    expect(svg).toContain("translate(128.5 69.5) scale(0.68) translate(-128.5 -69.5)");
  });

  it("renders one href per frame and returns to the icon it started on", () => {
    const cycle = faviconCycle();
    expect(cycle).toHaveLength(BLINK_FRAMES.length);
    expect(cycle.every((frame) => frame.href.startsWith("data:image/svg+xml,"))).toBe(true);

    // The closing frame is the opening frame again: the cycle ends at rest and
    // then holds. AnimatedFavicon leans on this to skip the wrap-around repaint.
    expect(cycle[cycle.length - 1].href).toBe(cycle[0].href);

    // Inside the blink, no frame repeats its neighbour, or a paint is wasted.
    const blink = cycle.slice(0, -1);
    expect(new Set(blink.map((frame) => frame.href)).size).toBe(blink.length);
  });
});
