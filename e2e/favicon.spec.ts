import { type Page, expect, test } from "@playwright/test";

/**
 * The 32-second favicon blink, in a real browser.
 *
 * This is the one place it can be checked. A browser draws an SVG favicon as a
 * still image and ignores the animation inside the file, which is why the blink
 * is driven from JavaScript at all -- and jsdom, where the unit tests run, has
 * no opinion about any of that.
 *
 * page.clock fast-forwards the wait, so nothing here takes 32 seconds. What is
 * asserted is the sequence -- rest, shutter, rest -- rather than the icon at an
 * exact millisecond: the cycle starts when the page hydrates rather than when
 * the clock installs, and a fast-forwarded clock collapses timers that come due
 * inside the same jump. Both are harness artefacts; the frame offsets
 * themselves are covered in src/lib/favicon-frames.test.ts.
 */

/** The icon a browser would use: the last one it can decode. */
async function currentIcon(page: Page): Promise<string> {
  const href = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    return links.at(-1)?.getAttribute("href") ?? "";
  });
  return decodeURIComponent(href);
}

/** Move the clock forward in slices until the icon satisfies `wanted`. */
async function advanceUntilIcon(
  page: Page,
  wanted: (icon: string) => boolean,
  budgetMs: number,
  what: string,
): Promise<string> {
  for (let elapsed = 0; elapsed < budgetMs; elapsed += 200) {
    await page.clock.fastForward(200);
    const icon = await currentIcon(page);
    if (wanted(icon)) return icon;
  }
  throw new Error(`Favicon never ${what} within ${budgetMs}ms`);
}

test("holds the mark, then blinks the focus square", async ({ page }) => {
  await page.clock.install();
  await page.goto("/welcome");

  // Hydration replaces the static icon with the animated one.
  await expect.poll(() => currentIcon(page)).toContain("<svg");
  const resting = await currentIcon(page);
  expect(resting).toContain('opacity="1"');
  expect(resting).not.toContain("transform=");

  // Most of the cycle is a hold. A tab strip that flickers every few seconds is
  // an irritation, not a signal.
  await page.clock.fastForward(29_000);
  expect(await currentIcon(page)).toBe(resting);

  // Then the shutter: the green square is transformed about its own centre.
  const blinking = await advanceUntilIcon(page, (icon) => icon !== resting, 4_000, "blinked");
  expect(blinking).toContain("translate(128.5 69.5) scale(");

  // And it settles back at rest.
  await advanceUntilIcon(page, (icon) => icon === resting, 4_000, "returned to rest");

  // One animated link after a full blink, not one per frame. The static links
  // from the document head stay put: they are the fallback for a browser that
  // cannot decode SVG, and the animated one is appended after them.
  await expect(page.locator('link[rel~="icon"][href^="data:"]')).toHaveCount(1);
  await expect(page.locator('link[rel~="icon"][href="/favicon.svg"]')).toHaveCount(1);
});

test("the static file a browser falls back to is square", async ({ request }) => {
  const response = await request.get("/favicon.svg");
  expect(response.ok()).toBe(true);

  // A non-square viewBox is letterboxed into the tab's square and the mark
  // shrinks to a sliver.
  const [, , width, height] = (/viewBox="([^"]+)"/.exec(await response.text())?.[1] ?? "")
    .split(/\s+/)
    .map(Number);
  expect(width).toBe(height);
});
