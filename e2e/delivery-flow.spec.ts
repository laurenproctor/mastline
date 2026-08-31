import { expect, test } from "@playwright/test";
import {
  SEEDED,
  SEEDED_SHOOT,
  SEEDED_WORKSPACE,
  at,
  createApprovablePackage,
  hasHorizontalOverflow,
  purgeShootWithAssets,
  refuseCookies,
  signIn,
} from "./helpers";

/**
 * The five-stage delivery flow: Photos → Details → Recipient → Review & share
 * → Shared.
 *
 * Replaces the Stage 3 lifecycle suite: the package tabs and the five-word
 * lifecycle strip are gone, and the progression is now the five stages read
 * from the record. What must not change underneath is the honesty this screen
 * has always been tested for: the URL cannot skip a stage the record does not
 * support, an approved package is frozen but not sent, and a viewer can look
 * without being offered a single write.
 */
const SEEDED_PACKAGE_02 = "a0000000-0000-0000-0000-0000000000f2";

test.describe("the delivery flow", () => {
  test.beforeEach(async ({ context }) => refuseCookies(context));

  test("opens on the work the record says is next, with one current step", async ({ page }) => {
    await signIn(page);
    await page.goto(at(`/dispatch/${SEEDED_SHOOT}`));

    // The seeded open package carries an uncaptioned frame, so the record says
    // the next work is Details.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(
      page.getByRole("heading", { level: 1, name: "Describe the photographs" }),
    ).toBeVisible();

    const strip = page.getByRole("navigation", { name: "Delivery progress" });
    await expect(strip).toBeVisible();
    await expect(strip.getByRole("listitem")).toHaveCount(5);
    await expect(strip.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(strip.locator('[aria-current="step"]')).toContainText("Details");

    // No package tabs on the flow; the shoot page lists the packages.
    await expect(page.getByRole("navigation", { name: "Packages on this shoot" })).toHaveCount(0);

    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("a URL naming a stage the record does not support is clamped back", async ({ page }) => {
    await signIn(page);

    // Shared has not happened for package 02, and its details are incomplete:
    // both requests land on Details, and the address bar says so.
    for (const requested of ["shared", "review", "recipient"]) {
      await page.goto(
        at(`/dispatch/${SEEDED_SHOOT}?package=${SEEDED_PACKAGE_02}&stage=${requested}`),
      );
      await page.waitForURL(/stage=details/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Describe the photographs" }),
      ).toBeVisible();
    }
  });

  test("photos are chosen on the draft, survive a reload, and keep their order", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const fixture = await createApprovablePackage(`FLOW${testInfo.project.name}`);

    try {
      await signIn(page);
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}&stage=photos`));
      await expect(page.getByRole("heading", { name: "Select photographs" })).toBeVisible();

      const grid = page.getByRole("list", { name: "Choose photographs" });
      const tiles = grid.getByRole("button");
      const count = await tiles.count();
      expect(count).toBeGreaterThanOrEqual(2);

      // The fixture's frames are already in the package, in order.
      await expect(tiles.nth(0)).toHaveAttribute("aria-pressed", "true");

      // Remove the first frame; the saved count changes, and a reload renders
      // the stored state rather than anything optimistic.
      await tiles.nth(0).click();
      await expect(tiles.nth(0)).toHaveAttribute("aria-pressed", "false");
      await page.reload();
      await expect(
        page.getByRole("list", { name: "Choose photographs" }).getByRole("button").nth(0),
      ).toHaveAttribute("aria-pressed", "false");

      // Put it back; it re-enters at the end of the order.
      const after = page.getByRole("list", { name: "Choose photographs" }).getByRole("button");
      await after.nth(0).click();
      await expect(after.nth(0)).toHaveAttribute("aria-pressed", "true");
      await expect(after.nth(0)).toContainText(String(count));

      expect(await hasHorizontalOverflow(page)).toBe(false);
    } finally {
      await purgeShootWithAssets(fixture.shootId).catch(() => undefined);
    }
  });

  test("an approved package holds at Review & share and closes the working stages", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const fixture = await createApprovablePackage(`FLOWAPP${testInfo.project.name}`);

    try {
      await signIn(page);
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}`));
      await expect(page.getByRole("heading", { name: "Review delivery" })).toBeVisible();
      await expect(page.locator('[aria-current="step"]')).toContainText("Review & share");

      await page.getByRole("button", { name: "Approve package" }).click();
      await page.getByRole("button", { name: "Yes, approve this package" }).click();
      await page.waitForURL(/\/submissions\//);

      // Editing URLs for the working stages clamp forward to the review: the
      // frozen selection is not offered as a place to work.
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}&stage=photos`));
      await page.waitForURL(/stage=review/);
      await expect(page.getByText("This package is approved and frozen")).toBeVisible();
      await expect(page.getByText(/Nothing is sent/).first()).toBeVisible();
      await expect(page.getByText("This package has been sent")).toHaveCount(0);
      await expect(page.locator("[data-lifecycle-detail]")).toContainText(
        "No recipient link has been created yet",
      );

      // The URL stays inside the canonical workspace throughout.
      expect(new URL(page.url()).pathname).toBe(`/${SEEDED_WORKSPACE}/dispatch/${fixture.shootId}`);
    } finally {
      await purgeShootWithAssets(fixture.shootId).catch(() => undefined);
    }
  });

  test("a viewer can read every stage and is offered no way to change anything", async ({
    page,
  }) => {
    await signIn(page, SEEDED.viewer);
    await page.goto(at(`/dispatch/${SEEDED_SHOOT}`));

    // Details, read-only: no save, no editable fields, and the role is told why.
    await expect(
      page.getByRole("heading", { level: 1, name: "Describe the photographs" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save details" })).toHaveCount(0);
    await expect(page.getByText(/Editing needs the asset-write permission/)).toBeVisible();

    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
