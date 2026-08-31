import { expect, test } from "@playwright/test";
import {
  at,
  clearDeliveryLinks,
  createApprovablePackageWithFiles,
  purgeApprovedShoot,
  refuseCookies,
  signIn,
} from "./helpers";

/**
 * Visual verification captures for the delivery flow, at the sizes
 * docs/ACCEPTANCE.md and the redesign brief name. Not a test of behavior —
 * the delivery-flow suite owns that — so it runs only when asked:
 *
 *   CAPTURE_DELIVERY_FLOW=1 npx playwright test delivery-flow-capture --project=desktop
 *
 * Captures land in docs/design/verification/delivery-flow/. Each state is
 * exercised through the real interface against the local stack; nothing is
 * mocked, nothing external is contacted, and the shoot is purged afterwards.
 */
const CAPTURING = process.env.CAPTURE_DELIVERY_FLOW === "1";
const OUT = "docs/design/verification/delivery-flow";

test.describe("delivery flow captures", () => {
  test.skip(!CAPTURING, "Set CAPTURE_DELIVERY_FLOW=1 to record screenshots");
  test.beforeEach(async ({ context }) => refuseCookies(context));

  test("photographer flow at 1440×1024 and 1280, recipient at 390 and 200% zoom", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(300_000);
    const fixture = await createApprovablePackageWithFiles(`CAP${testInfo.project.name}`);
    const shot = (name: string) => page.screenshot({ fullPage: true, path: `${OUT}/${name}.png` });

    try {
      await signIn(page);
      await page.setViewportSize({ width: 1440, height: 1024 });

      const base = `/dispatch/${fixture.shootId}?package=${fixture.packageId}`;
      await page.goto(at(`${base}&stage=photos`));
      await expect(page.getByRole("heading", { name: "Select photographs" })).toBeVisible();
      await shot("01-photos-1440");

      await page.goto(at(`${base}&stage=details`));
      await expect(page.getByRole("heading", { name: "Describe the photographs" })).toBeVisible();
      await shot("02-details-1440");

      await page.goto(at(`${base}&stage=recipient`));
      await expect(
        page.getByRole("heading", { name: "Choose recipient and access" }),
      ).toBeVisible();
      await page.getByLabel("Recipient desk or contact").fill("Hudson Square photo desk");
      await page
        .getByLabel("Recipient note")
        .fill("Sharing three photographs from the alpine shoot. Hope they're a good fit.");
      await shot("03-recipient-1440");

      await page.getByRole("button", { name: "Review delivery" }).click();
      await page.waitForURL(/stage=review/);
      await shot("04-review-1440");

      await page.getByRole("button", { name: "Create private delivery" }).click();
      await expect(page.getByText(/This becomes permanent/)).toBeVisible();
      await shot("05-review-confirm-1440");

      await page.getByRole("button", { name: "Yes, create the private delivery" }).click();
      await expect(page.getByText("Private delivery created")).toBeVisible();
      await shot("06-link-created-1440");
      const deliveryPath = new URL(
        (await page.locator(".ml-delivery-review__url code").innerText()).trim(),
      ).pathname;

      await page.getByRole("button", { name: "Mark as shared" }).click();
      await page.waitForURL(/stage=shared/);
      await shot("07-shared-1440");

      // The photographer flow again at 1280.
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(at(`${base}&stage=review`));
      await expect(page.getByText("Private delivery created")).toBeVisible();
      await shot("08-review-1280");
      await page.goto(at(`${base}&stage=shared`));
      await shot("09-shared-1280");

      // The recipient, desktop and phone and zoomed.
      const desk = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
      const deskPage = await desk.newPage();
      try {
        await deskPage.goto(deliveryPath);
        await expect(deskPage.getByRole("heading", { level: 1 })).toBeVisible();
        await deskPage.screenshot({ fullPage: true, path: `${OUT}/10-recipient-1440.png` });

        await deskPage.setViewportSize({ width: 390, height: 844 });
        await deskPage.screenshot({ fullPage: true, path: `${OUT}/11-recipient-390.png` });

        // 200% zoom approximated the way browsers implement it: half the CSS
        // viewport at the same window size.
        await deskPage.setViewportSize({ width: 720, height: 512 });
        await deskPage.screenshot({ fullPage: true, path: `${OUT}/12-recipient-zoom200.png` });
      } finally {
        await desk.close();
      }
    } finally {
      await clearDeliveryLinks();
      await purgeApprovedShoot(fixture.shootId, fixture.objectKeys).catch(() => undefined);
    }
  });
});
