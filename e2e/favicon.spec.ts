import { expect, test } from "@playwright/test";

/**
 * The 32-second favicon blink, in a real browser.
 *
 * This is the one place it can be checked. A browser draws an SVG favicon as a
 * still image and ignores the animation inside the file, which is why the blink
 * is driven from JavaScript at all -- and jsdom, where the unit tests run, has
 * no opinion about any of that.
 *
 * page.clock fast-forwards the wait, so nothing here takes 32 seconds.
 */

/** The icon a browser would use: the last one it can decode. */
async function currentIcon(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    return links.at(-1)?.getAttribute("href") ?? "";
  });
}

test("holds the mark, then blinks the focus square", async ({ page }) => {
  await page.clock.install();
  await page.goto("/welcome");

  // Hydration replaces the static icon with the animated one.
  await expect.poll(() => currentIcon(page)).toContain("data:image/svg+xml,");
  const resting = await currentIcon(page);
  expect(decodeURIComponent(resting)).toContain('opacity="1"');
  expect(decodeURIComponent(resting)).not.toContain("transform=");

  // Most of the cycle is a hold: nothing should move.
  await page.clock.fastForward(29_000);
  expect(await currentIcon(page)).toBe(resting);

  // Then the shutter.
  await page.clock.fastForward(920);
  const blinking = decodeURIComponent(await currentIcon(page));
  expect(blinking).toContain('opacity="0.28"');
  expect(blinking).toContain("scale(0.68)");

  // And back to rest, still one icon link rather than one per frame.
  await page.clock.fastForward(1_376);
  expect(await currentIcon(page)).toBe(resting);
  expect(await page.locator('link[rel~="icon"][type="image/svg+xml"]').count()).toBe(1);
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
