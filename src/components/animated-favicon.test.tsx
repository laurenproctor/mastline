import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedFavicon } from "@/components/animated-favicon";
import { BLINK_CYCLE_MS, BLINK_FRAMES, faviconFrame, RESTING_FOCUS } from "@/lib/favicon-frames";

/** jsdom has no matchMedia, and this component asks it about reduced motion. */
function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

const currentIcon = () =>
  Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')).at(-1)?.href ??
  null;

describe("AnimatedFavicon", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.head.querySelectorAll('link[rel="icon"]').forEach((link) => link.remove());
  });

  it("shows the resting mark and holds it until the blink", () => {
    render(<AnimatedFavicon />);

    expect(currentIcon()).toBe(faviconFrame(RESTING_FOCUS));

    vi.advanceTimersByTime(BLINK_FRAMES[1].at - 1);
    expect(currentIcon()).toBe(faviconFrame(RESTING_FOCUS));
  });

  it("blinks through every frame and settles back at rest", () => {
    render(<AnimatedFavicon />);

    let clock = 0;
    for (const frame of BLINK_FRAMES.slice(1)) {
      vi.advanceTimersByTime(frame.at - clock);
      clock = frame.at;
      expect(currentIcon()).toBe(faviconFrame(frame));
    }

    expect(currentIcon()).toBe(faviconFrame(RESTING_FOCUS));
  });

  it("blinks again on the next cycle", () => {
    render(<AnimatedFavicon />);

    vi.advanceTimersByTime(BLINK_CYCLE_MS + BLINK_FRAMES[2].at);
    expect(currentIcon()).toBe(faviconFrame(BLINK_FRAMES[2]));
  });

  it("keeps exactly one animated icon link, not one per frame", () => {
    render(<AnimatedFavicon />);
    vi.advanceTimersByTime(BLINK_CYCLE_MS * 2);

    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  });

  it("removes its icon link when unmounted", () => {
    const { unmount } = render(<AnimatedFavicon />);
    expect(currentIcon()).not.toBeNull();

    unmount();
    expect(currentIcon()).toBeNull();
  });

  it("holds the mark open when reduced motion is asked for", () => {
    stubReducedMotion(true);
    render(<AnimatedFavicon />);

    vi.advanceTimersByTime(BLINK_CYCLE_MS * 2);
    expect(currentIcon()).toBe(faviconFrame(RESTING_FOCUS));
  });
});
