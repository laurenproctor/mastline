"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * The scroll reveal the stylesheet was already written for.
 *
 * marketing.css has carried `[data-rv]` / `.rv-in` and a `.farrow` that starts
 * at `scaleX(0)` since the editorial direction landed, but nothing in the
 * application ever set either attribute. The rules were dormant, and one of
 * them was not merely dormant: the four connector arrows in the Commercial
 * Opportunities flow were scaled to nothing and never scaled back, so the
 * diagram has been rendering as four disconnected cards. This is what turns
 * them on.
 *
 * Reveal is opt-in from the markup rather than inferred by walking the DOM.
 * A container carries `data-rv-group` and its direct children stagger in; a
 * single element carries `data-rv`. Both are server-rendered, so the hidden
 * state is in the first paint and there is no flash of content that then
 * disappears. `<noscript>` in the layout unhides everything for a reader
 * without JavaScript, and this component reveals everything unconditionally if
 * IntersectionObserver is missing.
 *
 * Reduced motion is handled in the stylesheet, which neutralises `[data-rv]`
 * and `.farrow` outright, so nothing here needs to check for it.
 */

const SELECTOR = "[data-rv-group], [data-rv], .farrow, .fsplit";

export function SiteMotion() {
  // Mounted in the layout, which does not remount between marketing routes, so
  // the pathname is what re-runs this against the new page's markup.
  const pathname = usePathname();

  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
    if (targets.length === 0) return;

    const show = (el: Element) => el.classList.add("rv-in");

    if (typeof IntersectionObserver === "undefined") {
      targets.forEach(show);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          show(entry.target);
          // Reveal once. Re-hiding on the way back up would make a long page
          // flicker every time it is scrolled through a second time.
          observer.unobserve(entry.target);
        }
      },
      // Held back slightly from the bottom edge so a block starts moving as it
      // arrives rather than the instant its first pixel appears.
      { rootMargin: "0px 0px -6% 0px", threshold: 0.04 },
    );

    for (const target of targets) {
      // Anything already scrolled past -- an in-page anchor, or a restored
      // scroll position -- never intersects, so it would stay hidden for ever.
      if (target.getBoundingClientRect().bottom < 0) show(target);
      else observer.observe(target);
    }

    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
