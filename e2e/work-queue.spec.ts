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
 * The Work Queue on the Stage 4A surfaces: Next up, the filtered queue, the
 * active shoots, and recent activity. These check what parsing HTML cannot --
 * that the composition holds at the three required sizes, that the filters
 * are real links that keep the address honest, that nothing on the surface
 * leaks a delivery credential, and that a reader is offered nothing to write.
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

test("the composition renders each named region once, with one h1", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport-independent");
  await signIn(page);

  await expect(page.locator("h1")).toHaveCount(1);
  for (const name of ["Next up", "Needs attention", "Active shoots", "Recent activity"]) {
    await expect(page.getByRole("region", { name })).toHaveCount(1);
  }
  await expect(page.getByRole("group", { name: "This period" })).toBeVisible();
  await expect(page.locator("[role='tab'], [role='tablist'], [aria-selected]")).toHaveCount(0);
});

test("the queue filters are links that keep the address and expose their state", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport-independent");
  await signIn(page);
  await page.goto(at("/work?from=archive"));

  const filters = page.getByRole("navigation", { name: "Queue filters" });
  await expect(filters.getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "true");

  await filters.getByRole("link", { name: /^Money/ }).click();
  await page.waitForURL(`**/${SEEDED_WORKSPACE}/work?from=archive&queue=money`);

  const money = page
    .getByRole("navigation", { name: "Queue filters" })
    .getByRole("link", { name: /^Money/ });
  await expect(money).toHaveAttribute("aria-current", "true");
  await expect(
    page.getByRole("navigation", { name: "Queue filters" }).getByRole("link", { name: /^All/ }),
  ).toHaveAttribute("href", `/${SEEDED_WORKSPACE}/work?from=archive`);

  /*
   * The count on the link and the rows below it must agree: a chosen filter
   * shows everything it matches, so the visible list is the count's proof.
   */
  const advertised = Number(await money.locator(".ml-work-queue-filters__count").innerText());
  const rows = page.getByRole("list", { name: "Ranked queue" }).getByRole("listitem");
  if (advertised === 0) {
    await expect(rows).toHaveCount(0);
    await expect(page.getByText("Nothing in this part of the queue")).toBeVisible();
  } else {
    await expect(rows).toHaveCount(advertised);
    for (const badge of await rows.locator(".ml-badge").allInnerTexts()) {
      expect(badge.trim().toLowerCase()).toBe("money");
    }
  }
});

test("every row action stays inside the workspace and states its basis", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport-independent");
  await signIn(page);

  const rows = page.getByRole("list", { name: "Ranked queue" }).getByRole("listitem");
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const href = await row.getByRole("link").first().getAttribute("href");
    expect(href?.startsWith(`/${SEEDED_WORKSPACE}/`), `${href} is not workspace-scoped`).toBe(true);
    expect((await row.locator(".ml-work-queue-basis").innerText()).trim().length).toBeGreaterThan(
      0,
    );
  }
});

test("a viewer is shown no write actions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport-independent");
  await signIn(page, SEEDED.viewer);

  await expect(page.getByRole("heading", { level: 1, name: "Work queue" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create shoot" })).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Active shoots" })
      .getByRole("link", { name: /Complete metadata|Review package|Create recipient link/ }),
  ).toHaveCount(0);
});

test("no delivery credential reaches the page", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport-independent");
  await signIn(page);

  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"), (a) => a.getAttribute("href") ?? ""),
  );
  for (const href of hrefs) {
    expect(href.startsWith("/d/"), `${href} exposes a delivery link`).toBe(false);
  }
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

    await expect(page.getByRole("heading", { name: "Everything is up to date" })).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "No shoot is in progress" })).toBeVisible();
    // A new workspace already has its own creation on the record, so the
    // activity panel is present rather than empty.
    await expect(page.getByRole("region", { name: "Recent activity" })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await purgeWorkspace(workspace.id);
  }
});
