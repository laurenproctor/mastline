"use client";

import { useEffect } from "react";
import { BLINK_CYCLE_MS, faviconCycle } from "@/lib/favicon-frames";

/**
 * Blinks the favicon's focus indicator once every 32 seconds.
 *
 * An SVG favicon is painted as a still image, so the animation has to happen
 * out here: the component appends its own icon link and repoints it through the
 * pre-rendered frames. It renders nothing.
 *
 * Two details worth keeping:
 *
 * - The link is replaced rather than mutated. Chrome does not reliably repaint
 *   a favicon whose href changed in place.
 * - Frame times are measured against the cycle start, not accumulated from the
 *   previous timeout. A background tab clamps timers to roughly a second, which
 *   is longer than the gaps inside the blink, and drift there would smear the
 *   shutter into a slow fade the next time the tab is looked at.
 */
export function AnimatedFavicon() {
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const frames = faviconCycle();

    let painted: HTMLLinkElement | null = null;
    let paintedHref: string | null = null;
    let timer: number | undefined;

    /**
     * The static icon links from the document head stay where they are: they
     * are the fallback for anything that cannot decode SVG, and this one is
     * appended last, which is the one a browser uses.
     */
    const paint = (href: string) => {
      // The cycle returns to rest before it wraps, so the wrap itself asks for
      // an icon that is already on screen.
      if (paintedHref === href) return;

      const link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/svg+xml";
      link.href = href;
      document.head.append(link);
      painted?.remove();
      painted = link;
      paintedHref = href;
    };

    const clear = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };

    const run = () => {
      const startedAt = performance.now();
      let index = 0;

      const step = () => {
        paint(frames[index].href);

        const next = (index + 1) % frames.length;
        const target = next === 0 ? BLINK_CYCLE_MS : frames[next].at;
        const elapsed = (performance.now() - startedAt) % BLINK_CYCLE_MS;

        index = next;
        timer = window.setTimeout(step, Math.max(0, target - elapsed));
      };

      step();
    };

    const sync = () => {
      clear();
      if (reducedMotion.matches) {
        // Someone who asked for less motion still gets the mark, held open.
        paint(frames[0].href);
        return;
      }
      run();
    };

    sync();
    reducedMotion.addEventListener("change", sync);

    return () => {
      clear();
      reducedMotion.removeEventListener("change", sync);
      painted?.remove();
      painted = null;
      paintedHref = null;
    };
  }, []);

  return null;
}
