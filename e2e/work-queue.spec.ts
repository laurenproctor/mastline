import { expect, test } from "@playwright/test";
import {
  SEEDED,
  SEEDED_WORKSPACE,
  at,
  collectPageErrors,
  createThrowawayWorkspace,
  hasHorizontalOverflow,
  overflowingElements,
  purgeWorkspace,
  refuseCookies,
  signIn,
} from "./helpers";

/**
 * The redesigned Work Queue: Next up, the filtered attention queue, active
 * shoots, recipient evidence, and the money strip. These check what parsing
 * HTML cannot -- that the composition holds at the three required sizes, that
 * the filters are real controls, and that nothing on the surface leaks a
 * delivery credential.
 */

test.beforeEach(async ({ context }) => {
  await refuseCookies(context);
});

test("the work queue holds at this size without sideways scrolling", async ({ page }) => {
  const errors = collectPageErrors(page);
  await signIn(page);

  await expect(page.getByRole("heading", { level: 1, name: "Work queue" })).toBeVisible();
  const overflowing = await overflowingElements(page);
  expect(overflowing, `work queue overflows: ${overflowing.join(", ")}`).toEqual([]);
  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(errors).toEqual([]);
});

test("the composition renders each named region once", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport-independent");
  await signIn(page);

  await expect(page.getByRole("heading", { level: 1, name: "Work queue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next up" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active shoots" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent recipient activity" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Money to reconcile" })).toBeVisible();

  // Exactly one h1, and the dateline is written, not hardcoded.
  await expect(page.locator("h1")).toHaveCount(1);
  const eyebrow = page.locator(".page-header .eyebrow");
  await expect(eyebrow).toHaveText(/\w+, \w+ \d{1,2}, \d{4}/);
});

test("Import a shoot goes to the canonical workspace path", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport-independent");
  await signIn(page);

  await page.getByRole("link", { name: "Import a shoot" }).click();
  await page.waitForURL(`**/${SEEDED_WORKSPACE}/shoots/new`);
  expect(new URL(page.url()).pathname).toBe(`/${SEEDED_WORKSPACE}/shoots/new`);
});

test("the queue filters are real controls that expose their state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport-independent");
  await signIn(page);

  const filters = page.getByRole("navigation", { name: "Queue filters" });
  await expect(filters.getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "true");

  await filters.getByRole("link", { name: /^Money/ }).click();
  await page.waitForURL(`**/${SEEDED_WORKSPACE}/work?queue=money`);

  const money = page
    .getByRole("navigation", { name: "Queue filters" })
    .getByRole("link", { name: /^Money/ });
  await expect(money).toHaveAttribute("aria-current", "true");

  /*
   * The count on the pill and the rows below it must agree: a chosen filter
   * shows everything it matches, so the visible list is the count's proof.
   */
  const advertised = Number(await money.locator(".work-filter-count").innerText());
  const rows = page.locator(".work-attention-row");
  if (advertised === 0) {
    await expect(rows).toHaveCount(0);
    await expect(page.getByText("Nothing in this part of the queue")).toBeVisible();
  } else {
    await expect(rows).toHaveCount(advertised);
    for (const badge of await rows.locator(".badge").allInnerTexts()) {
      // The badge is uppercased by CSS, which innerText reports.
      expect(badge.toLowerCase()).toBe("money");
    }
  }
});

test("the first row action stays inside the canonical workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport-independent");
  await signIn(page);

  const first = page.locator(".row-action").first();
  if (await first.count()) {
    const href = await first.getAttribute("href");
    expect(href?.startsWith(`/${SEEDED_WORKSPACE}/`)).toBe(true);
  }
});

test("a viewer is shown no write actions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport-independent");
  await signIn(page, SEEDED.viewer);

  await expect(page.getByRole("heading", { level: 1, name: "Work queue" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Import a shoot" })).toHaveCount(0);
  // Active-shoot actions fall back to reading, never to a task a viewer cannot do.
  await expect(
    page
      .locator(".work-active-shoot")
      .getByRole("link", { name: /Complete metadata|Review package|Create recipient link/ }),
  ).toHaveCount(0);
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

test("an empty workspace renders its calm states", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "shared fixture; one project is enough");
  const errors = collectPageErrors(page);
  const workspace = await createThrowawayWorkspace(SEEDED.owner, "empty-queue");

  try {
    await signIn(page);
    await page.goto(at("/work", workspace.slug));

    await expect(page.getByText("Everything is up to date")).toBeVisible();
    await expect(page.getByText("Import a shoot or wait for recipient activity.")).toBeVisible();
    await expect(page.getByText("No recipient activity yet.")).toBeVisible();
    await expect(page.getByText("No shoot is in progress.")).toBeVisible();
    await expect(page.getByText("Nothing else needs attention.")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await purgeWorkspace(workspace.id);
  }
});
