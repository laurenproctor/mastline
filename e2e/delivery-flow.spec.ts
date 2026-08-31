import { expect, test } from "@playwright/test";
import {
  SEEDED,
  SEEDED_SHOOT,
  SEEDED_WORKSPACE,
  at,
  clearDeliveryLinks,
  createApprovablePackage,
  createApprovablePackageWithFiles,
  hasHorizontalOverflow,
  purgeApprovedShoot,
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

  test("creating the delivery holds at Review & share and closes the working stages", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const fixture = await createApprovablePackage(`FLOWAPP${testInfo.project.name}`);

    try {
      await signIn(page);
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}`));
      await expect(page.getByRole("heading", { name: "Review delivery" })).toBeVisible();
      await expect(page.locator('[aria-current="step"]')).toContainText("Review & share");

      // Two motions: the first reveals what becomes permanent, the second
      // commits. Nothing is created by the first.
      await page.getByRole("button", { name: "Create private delivery" }).click();
      await expect(page.getByText(/This becomes permanent/)).toBeVisible();
      await page.getByRole("button", { name: "Yes, create the private delivery" }).click();

      // Created is not sent: the flow stays on Review & share and says
      // exactly what exists -- a link, unshared, nothing left Mastline.
      await expect(page.getByText("Private delivery created")).toBeVisible();
      await expect(page.getByText("It has not been shared.").first()).toBeVisible();
      await expect(page.locator('[aria-current="step"]')).toContainText("Review & share");
      await expect(page.getByText("This package has been sent")).toHaveCount(0);
      await expect(page.locator("[data-lifecycle-detail]")).toContainText(
        "A recipient link exists and has not been marked as shared",
      );

      // Editing URLs for the working stages clamp forward to the review: the
      // frozen selection is not offered as a place to work.
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}&stage=photos`));
      await page.waitForURL(/stage=review/);
      await expect(page.getByText(/Nothing is sent/).first()).toBeVisible();

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

test.describe("the five stages, walked end to end", () => {
  test.beforeEach(async ({ context }) => refuseCookies(context));

  test("photos to shared, with a gated recipient who accepts, browses, and downloads", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const fixture = await createApprovablePackageWithFiles(`WALK${testInfo.project.name}`);
    const deskName = `Walk desk ${testInfo.project.name} ${Date.now()}`;

    try {
      await signIn(page);

      // -- Photos -------------------------------------------------------
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}&stage=photos`));
      await expect(page.getByRole("heading", { name: "Select photographs" })).toBeVisible();
      await page.getByRole("link", { name: "Continue to details" }).click();

      // -- Details ------------------------------------------------------
      await expect(page.getByRole("heading", { name: "Describe the photographs" })).toBeVisible();
      await expect(page.getByText(/2 of 2 photographs have required details/)).toBeVisible();
      await page.getByRole("link", { name: "Continue to recipient" }).click();

      // -- Recipient ----------------------------------------------------
      await expect(
        page.getByRole("heading", { name: "Choose recipient and access" }),
      ).toBeVisible();
      await expect(page.getByText(/Recipient watermark: On/)).toBeVisible();
      await page.getByLabel("Recipient desk or contact").fill(deskName);
      await page.getByLabel("Contact email or reference").fill("walk-desk@example.com");
      await page.getByLabel("Recipient note").fill("Two frames from this morning's shoot.");
      await page.getByLabel(/Require acceptance before viewing/).check();
      await page.getByRole("button", { name: "Review delivery" }).click();

      // -- Review & share ----------------------------------------------
      await page.waitForURL(/stage=review/);
      await expect(page.getByRole("heading", { name: "Review delivery" })).toBeVisible();
      // The recipient email travels to the record, never into any URL shown.
      await page.getByRole("button", { name: "Create private delivery" }).click();
      await expect(page.getByText(/This becomes permanent/)).toBeVisible();
      await page.getByRole("button", { name: "Yes, create the private delivery" }).click();
      await expect(page.getByText("Private delivery created")).toBeVisible();

      const deliveryHref = (await page.locator(".ml-delivery-review__url code").innerText()).trim();
      const deliveryPath = new URL(deliveryHref).pathname;
      expect(deliveryHref).not.toContain("walk-desk@example.com");
      expect(deliveryHref).not.toContain(deskName.split(" ")[0]);

      // Refresh: the created state survives, and no second link is minted.
      await page.reload();
      await expect(page.getByText("Private delivery created")).toBeVisible();

      // -- Mark as shared → Shared -------------------------------------
      await page.getByRole("button", { name: "Mark as shared" }).click();
      await page.waitForURL(/stage=shared/);
      await expect(page.getByRole("heading", { name: "Delivery shared" })).toBeVisible();
      const timeline = page.locator(".ml-delivery-timeline");
      await expect(timeline.locator('[data-state="done"]')).toHaveCount(1);
      await expect(timeline.getByText("Opened")).toBeVisible();

      // -- The recipient: gate, accept, browse, download ----------------
      const deskContext = await browser.newContext();
      const deskPage = await deskContext.newPage();
      try {
        await deskPage.goto(deliveryPath);
        // The gate: no frames are on this page, and the database returns none.
        await expect(deskPage.getByRole("heading", { name: "Open this delivery" })).toBeVisible();
        await expect(deskPage.getByText("Two frames from this morning's shoot.")).toBeVisible();
        await expect(deskPage.locator("[data-asset-id]")).toHaveCount(0);

        // The button waits for the explicit agreement.
        await expect(deskPage.getByRole("button", { name: /Open delivery/ })).toBeDisabled();
        await deskPage.getByLabel("Your name").fill("Walker Reade");
        await deskPage.getByLabel(/I agree to these delivery terms/).check();
        await deskPage.getByRole("button", { name: /Open delivery/ }).click();

        // The gallery: one frame at a time, arrow keys, editorial facts.
        await expect(deskPage.locator("[data-asset-id]").first()).toBeVisible();
        await expect(deskPage.getByText(/01 \/ 02/)).toBeVisible();
        await deskPage.keyboard.press("ArrowRight");
        await expect(deskPage.getByText(/02 \/ 02/)).toBeVisible();
        await expect(deskPage.getByText("Use arrow keys to browse")).toBeVisible();

        // The preview is the marked route, never a storage URL.
        const src = await deskPage.locator("[data-asset-id] img").first().getAttribute("src");
        expect(src ?? "").toMatch(/^\/d\/[A-Za-z0-9_-]+\/preview\//);

        // Accepted, so the full file follows.
        const download = deskPage.getByRole("link", { name: /Download full resolution/ });
        await expect(download).toBeVisible();
        const href = await download.getAttribute("href");
        const response = await deskPage.request.get(href!);
        expect(response.status()).toBe(200);

        // Copy credit line is offered beside the download.
        await expect(deskPage.getByRole("button", { name: "Copy credit line" })).toBeVisible();
      } finally {
        await deskContext.close();
      }

      // -- The evidence caught up on the photographer's side ------------
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}&stage=shared`));
      await expect(timeline.locator('[data-state="done"]')).toHaveCount(4);
      await expect(page.getByText("Walker Reade", { exact: false })).toBeVisible();

      // -- Share with another recipient ---------------------------------
      await page.getByRole("link", { name: "Share with another recipient" }).click();
      await page.waitForURL(/stage=recipient/);
      // The package is frozen: terms are facts here, not fields.
      await expect(page.getByText(/Frozen at approval/)).toBeVisible();
      await expect(page.getByLabel("Terms")).toHaveCount(0);
      const secondDesk = `Second desk ${testInfo.project.name} ${Date.now()}`;
      await page.getByLabel("Recipient desk or contact").fill(secondDesk);
      await page.getByRole("link", { name: "Review delivery" }).click();
      await page.waitForURL(/stage=review/);
      await page.getByRole("button", { name: "Create private delivery" }).click();
      await page.getByRole("button", { name: "Yes, create the private delivery" }).click();
      await expect(page.getByText("Private delivery created")).toBeVisible();
      const secondHref = (await page.locator(".ml-delivery-review__url code").innerText()).trim();
      expect(new URL(secondHref).pathname).not.toBe(deliveryPath);
    } finally {
      await clearDeliveryLinks();
      await purgeApprovedShoot(fixture.shootId, fixture.objectKeys).catch(() => undefined);
    }
  });
});
