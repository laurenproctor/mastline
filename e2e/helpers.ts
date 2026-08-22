import type { Page } from "@playwright/test";

export const SEEDED = {
  owner: "marcus@mastline.test",
  editor: "jordan@mastline.test",
  viewer: "vera@mastline.test",
  password: "mastline-dev-password",
} as const;

export const SEEDED_SHOOT = "a0000000-0000-0000-0000-0000000000c1";
export const SEEDED_ASSET = "a0000000-0000-0000-0000-0000000000d1";

/** Sign in through the real form, because that is a smoke test in itself. */
export async function signIn(page: Page, email: string = SEEDED.owner): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SEEDED.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/work/, { timeout: 20_000 });
}

/**
 * Does the page scroll sideways?
 *
 * The most common responsive failure is a table or a grid that will not shrink,
 * and it is invisible to anything that only reads HTML.
 */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    // One pixel of tolerance for sub-pixel rounding.
    return doc.scrollWidth > doc.clientWidth + 1;
  });
}

/** Elements wider than the viewport, named so a failure says what to fix. */
export async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const guilty: string[] = [];
    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // Ignore anything that clips or scrolls on purpose, and anything inside
      // it. A wide table inside a scroller is the point, not a failure, and so
      // is a marquee that is deliberately wider than the window it runs in.
      // What matters is whether the page itself scrolls sideways, which
      // hasHorizontalOverflow answers.
      const clipped = (node: HTMLElement | null): boolean => {
        for (let el = node; el && el !== document.body; el = el.parentElement) {
          const overflowX = getComputedStyle(el).overflowX;
          if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden" || overflowX === "clip") {
            return true;
          }
        }
        return false;
      };
      if (clipped(element)) continue;
      if (box.right > width + 1) {
        const id = element.id ? `#${element.id}` : "";
        const cls = element.className && typeof element.className === "string"
          ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
          : "";
        guilty.push(`${element.tagName.toLowerCase()}${id}${cls} (right ${Math.round(box.right)} > ${width})`);
      }
    }
    return [...new Set(guilty)].slice(0, 8);
  });
}

/** Is anything actually painted where focus is? */
export async function focusRingIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) return false;
    const style = getComputedStyle(active);
    const hasOutline =
      style.outlineStyle !== "none" && parseFloat(style.outlineWidth || "0") > 0;
    const hasShadow = style.boxShadow !== "none" && style.boxShadow !== "";
    return hasOutline || hasShadow;
  });
}

/**
 * Collect real page errors, ignoring aborted RSC prefetches.
 *
 * Next prefetches the links in the nav. Navigating away kills those requests
 * mid-flight, and WebKit reports an aborted fetch as "Fetch API cannot load
 * <url> due to access control checks" -- same-origin, nothing to do with CORS.
 * It surfaces from Next's own router chunk, so there is nothing here to fix.
 *
 * Verified rather than assumed: a page left alone for five seconds raises none
 * of these, and every navigation test passes in WebKit. Only the `_rsc=`
 * prefetch URLs are ignored; anything else still fails the test.
 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    const text = `${error.name}: ${error.message}`;
    if (/[?&]_rsc=/.test(text)) return;
    errors.push(error.message);
  });
  return errors;
}
