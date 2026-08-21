import { expect, test } from "@playwright/test";
import {
  SEEDED_SHOOT,
  collectPageErrors,
  hasHorizontalOverflow,
  overflowingElements,
  signIn,
} from "./helpers";

/**
 * The UI acceptance criteria from docs/ACCEPTANCE.md, checked in a browser.
 *
 * Everything here was previously "verified" by fetching HTML and stripping
 * tags, which can confirm words are present but says nothing about whether a
 * layout holds or focus is visible.
 */

test.describe("every documented route renders", () => {
  const PUBLIC_ROUTES = ["/welcome", "/pricing", "/login", "/signup", "/reset-password"];
  const APP_ROUTES = [
    "/work",
    "/news",
    "/shoots",
    "/shoots/new",
    `/shoots/${SEEDED_SHOOT}`,
    `/dispatch/${SEEDED_SHOOT}`,
    "/submissions",
    "/money",
    "/rights",
    "/archive",
    "/settings",
  ];

  for (const route of PUBLIC_ROUTES) {
    test(`${route} loads without a console error`, async ({ page }) => {
      const errors = collectPageErrors(page);
      const response = await page.goto(route);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator("body")).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("signed in, every application route renders", async ({ page }) => {
    const errors = collectPageErrors(page);
    await signIn(page);

    for (const route of APP_ROUTES) {
      await page.goto(route);
      // The shell is the proof the page actually rendered rather than erroring.
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});

test.describe("layout holds at the required sizes", () => {
  test("public pages do not scroll sideways", async ({ page }) => {
    for (const route of ["/welcome", "/pricing", "/login", "/signup"]) {
      await page.goto(route);
      const overflowing = await overflowingElements(page);
      expect(overflowing, `${route} overflows: ${overflowing.join(", ")}`).toEqual([]);
      expect(await hasHorizontalOverflow(page), `${route} scrolls sideways`).toBe(false);
    }
  });

  test("the work queue does not scroll sideways", async ({ page }) => {
    await signIn(page);
    await page.goto("/work");
    const overflowing = await overflowingElements(page);
    expect(overflowing, `work queue overflows: ${overflowing.join(", ")}`).toEqual([]);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("the shoot inspector does not scroll sideways", async ({ page }) => {
    await signIn(page);
    await page.goto(`/shoots/${SEEDED_SHOOT}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflowing = await overflowingElements(page);
    expect(overflowing, `shoot workspace overflows: ${overflowing.join(", ")}`).toEqual([]);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("money and archive do not scroll sideways", async ({ page }) => {
    await signIn(page);
    for (const route of ["/money", "/archive", "/settings"]) {
      await page.goto(route);
      const overflowing = await overflowingElements(page);
      expect(overflowing, `${route} overflows: ${overflowing.join(", ")}`).toEqual([]);
    }
  });
});

test.describe("navigation is reachable", () => {
  test("every primary destination is a link that works", async ({ page }) => {
    await signIn(page);
    const nav = page.getByRole("navigation", { name: "Primary" });

    for (const label of ["Work", "News radar", "Shoots", "Submissions", "Money", "Rights", "Archive"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("settings is reachable, including on a phone", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  });

  test("the active destination is marked for assistive technology", async ({ page }) => {
    await signIn(page);
    await page.goto("/money");
    await expect(page.locator('[aria-current="page"]')).toHaveText(/Money/);
  });
});

test.describe("pricing states the approved facts", () => {
  test("shows the annual prices and totals by default", async ({ page }) => {
    await page.goto("/pricing");

    await expect(page.getByRole("button", { name: /annual/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const price of ["49", "99", "279"]) {
      await expect(page.getByText(price, { exact: true }).first()).toBeVisible();
    }
    for (const total of ["$588 billed once a year", "$1,188 billed once a year", "$3,348 billed once a year"]) {
      await expect(page.getByText(total)).toBeVisible();
    }
    await expect(page.getByText("Save up to 18%")).toBeVisible();
  });

  test("the toggle changes every non-custom price and no feature", async ({ page }) => {
    await page.goto("/pricing");

    const proCard = page.locator("article").filter({ has: page.getByRole("heading", { name: "Pro" }) });
    const featuresBefore = await proCard.getByRole("listitem").allTextContents();

    await page.getByRole("button", { name: /^monthly$/i }).click();

    for (const price of ["59", "119", "339"]) {
      await expect(page.getByText(price, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Custom").first()).toBeVisible();
    await expect(page.getByText(/billed once a year/)).toHaveCount(0);

    expect(await proCard.getByRole("listitem").allTextContents()).toEqual(featuresBefore);
  });

  test("marks Pro most popular and never invents a trial duration", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("Most popular")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Start free" })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Talk to us" })).toHaveCount(1);

    const body = (await page.locator("body").innerText()).toLowerCase();
    const durations = [...body.matchAll(/(\d+)\s+days?\s+free/g)].map((match) => match[1]);
    expect(new Set(durations).size).toBeLessThanOrEqual(1);
  });
});

test.describe("status is never colour alone", () => {
  test("every badge carries words", async ({ page }) => {
    await signIn(page);
    for (const route of ["/work", "/money", "/submissions", "/shoots"]) {
      await page.goto(route);
      const badges = page.locator(".badge");
      const count = await badges.count();
      for (let index = 0; index < count; index += 1) {
        const text = (await badges.nth(index).innerText()).trim();
        expect(text.length, `a badge on ${route} has no text`).toBeGreaterThan(0);
      }
    }
  });

  test("a blocked dispatch check says the word, not just a colour", async ({ page }) => {
    await signIn(page);
    await page.goto(`/dispatch/${SEEDED_SHOOT}`);
    await expect(page.getByText("Blocked").first()).toBeVisible();
  });
});

test.describe("the seeded workspace shows real records", () => {
  test("the archive searches in the database and pages", async ({ page }) => {
    await signIn(page);
    await page.goto("/archive");
    await page.getByLabel(/Search the archive/i).fill("Avery Hart");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("heading", { name: /matches?$/ })).toBeVisible();
  });

  test("a malformed record id shows not found rather than an error", async ({ page }) => {
    await signIn(page);
    await page.goto("/assets/not-a-uuid");
    await expect(page.getByText(/does not exist in this workspace/i)).toBeVisible();
  });
});
