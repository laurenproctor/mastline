import { expect, test } from "@playwright/test";
import { SEEDED, SEEDED_WORKSPACE, collectPageErrors, refuseCookies, signIn } from "./helpers";

/**
 * The Work Queue as it stands today, fed by the deterministic ranking. These
 * are the expectations that do not depend on how the screen is drawn: every
 * row leads somewhere inside the workspace, a viewer is offered nothing to
 * write, and nothing on the surface leaks a delivery credential. The layout
 * itself is covered by the acceptance suite's sideways-scroll checks.
 */

test.beforeEach(async ({ context }) => {
  await refuseCookies(context);
});

test("the queue renders without errors and every row action stays inside the workspace", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport-independent");
  const errors = collectPageErrors(page);
  await signIn(page);

  await expect(page.getByRole("heading", { level: 1, name: "Work queue" })).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();

  const actions = page.locator(".row-action");
  const count = await actions.count();
  for (let index = 0; index < count; index += 1) {
    const href = await actions.nth(index).getAttribute("href");
    expect(href?.startsWith(`/${SEEDED_WORKSPACE}/`), `${href} is not workspace-scoped`).toBe(true);
  }
  // Every row states the recorded basis it was ranked on.
  for (const text of await page.locator(".list-row .muted").allInnerTexts()) {
    expect(text.trim().length).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});

test("a viewer is shown no write actions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport-independent");
  await signIn(page, SEEDED.viewer);

  await expect(page.getByRole("heading", { level: 1, name: "Work queue" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create shoot" })).toHaveCount(0);
});

test("no delivery credential reaches the page", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport-independent");
  await signIn(page);

  // No rendered link may point at the recipient surface.
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"), (a) => a.getAttribute("href") ?? ""),
  );
  for (const href of hrefs) {
    expect(href.startsWith("/d/"), `${href} exposes a delivery link`).toBe(false);
  }

  // And no token-shaped value may appear in the text: a delivery token is a
  // 43-character base64url credential, far longer than any id shown here.
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/[A-Za-z0-9_-]{40,}/);
});
