import { expect, test } from "@playwright/test";
import {
  SEEDED,
  acceptCookies,
  at,
  clearDeliveryLinks,
  createApprovablePackage,
  engagementForRecipient,
  purgeShootWithAssets,
  putDeliveryFixture,
  refuseCookies,
  removeDeliveryFixture,
  signIn,
} from "./helpers";

/**
 * Approval, two links, a share, a visit, and what the photographer sees.
 *
 * This drives the real interface end to end, because the defect it guards
 * against was never visible in a unit test: every individual function was
 * doing what it said, and the screen still told the photographer their package
 * had been sent to a buyer when nothing had left Mastline.
 *
 * The load-bearing assertions are the negative ones. That the screen does not
 * say "sent" after approval. That copying a link does not mark it shared. That
 * the link nobody opened still reads "Not opened yet" while its sibling shows
 * activity. Those are the claims the product used to make and cannot support.
 */

const SEEDED_SUBMISSION = "a0000000-0000-0000-0000-00000000a001";

/**
 * A recipient label no other run shares.
 *
 * The panel lists every link a submission has ever had, and the three viewport
 * projects run against one database, so a bare locator matches more elements
 * every run. Naming each desk uniquely gives a test a handle on the link it
 * just made.
 */
function desk(info: { project: { name: string } }, name: string): string {
  return `${name} ${info.project.name} ${Date.now()}`;
}

test.describe("a package reaches a recipient", () => {
  test.beforeEach(async ({ context }) => {
    await refuseCookies(context);
    await clearDeliveryLinks();
  });
  test.afterEach(async () => clearDeliveryLinks());

  test("is approved, linked twice, shared once, opened, accepted, and downloaded", async ({
    page,
    browser,
  }, testInfo) => {
    const newYork = desk(testInfo, "New York picture desk");
    const london = desk(testInfo, "London syndication");
    const fixtureKey = await putDeliveryFixture();

    try {
      await signIn(page, SEEDED.owner);
      await page.goto(at(`/submissions/${SEEDED_SUBMISSION}`));

      // ---------------------------------------------------------------
      // Two links, for two recipients, with different attribution
      // ---------------------------------------------------------------
      await page.getByRole("button", { name: "Create a delivery link" }).click();
      /*
       * Scoped to the create form. Once a link exists it offers its own
       * "Recipient" and attribution fields for editing, so an unscoped locator
       * matches both and Playwright rightly refuses to guess.
       */
      const createForm = page.locator("form.delivery-create-form");
      await createForm.getByLabel("Recipient", { exact: true }).fill(newYork);
      await createForm.getByLabel("Contact reference").fill("buyer-contact-123");
      await createForm.getByPlaceholder("campaign").fill("campaign");
      await createForm.getByPlaceholder("awards-season").fill("awards-season");
      await createForm.getByRole("button", { name: "Create the link" }).click();

      const firstLink = page.locator(".delivery-link").filter({ hasText: newYork });
      await expect(firstLink.locator(".delivery-link-url code")).toBeVisible();

      await page.getByRole("button", { name: "Create a delivery link" }).click();
      const secondForm = page.locator("form.delivery-create-form");
      await secondForm.getByLabel("Recipient", { exact: true }).fill(london);
      await secondForm.getByPlaceholder("campaign").fill("desk");
      await secondForm.getByPlaceholder("awards-season").fill("london");
      await secondForm.getByRole("button", { name: "Create the link" }).click();

      const secondLink = page.locator(".delivery-link").filter({ hasText: london });
      await expect(secondLink.locator(".delivery-link-url code")).toBeVisible();

      const newYorkUrl = (await firstLink.locator(".delivery-link-url code").innerText()).trim();
      const londonUrl = (await secondLink.locator(".delivery-link-url code").innerText()).trim();

      // Separate tokens, so the two recipients can be measured apart.
      expect(new URL(newYorkUrl).pathname).not.toBe(new URL(londonUrl).pathname);

      // ---------------------------------------------------------------
      // The attribution is in the URL. The recipient is not.
      // ---------------------------------------------------------------
      expect(newYorkUrl).toContain("campaign=awards-season");
      expect(londonUrl).toContain("desk=london");
      for (const url of [newYorkUrl, londonUrl]) {
        expect(url).not.toContain("buyer-contact-123");
        expect(url).not.toMatch(/picture%20desk|picture\+desk|picture desk/i);
        expect(url).not.toMatch(/syndication/i);
        expect(url).not.toContain("@");
      }

      // Before anything is shared, the header must not claim a send.
      await expect(page.locator(".page-header")).not.toContainText(/^Sent to/);
      await expect(firstLink.getByText("Link created")).toBeVisible();

      // ---------------------------------------------------------------
      // Copying is not sharing
      // ---------------------------------------------------------------
      await firstLink.getByRole("button", { name: "Copy delivery link" }).click();
      // Either outcome is honest; what matters is that it says which. Headless
      // Chrome can refuse clipboard access, and a silent success would be the
      // bug this control exists to avoid.
      await expect(
        firstLink.getByText(
          /Link copied\. Mastline has not marked it as shared\.|Could not copy to the clipboard/,
        ),
      ).toBeVisible();

      // The server did not move.
      await page.reload();
      const firstAfterCopy = page.locator(".delivery-link").filter({ hasText: newYork });
      await expect(firstAfterCopy.getByText("Link created")).toBeVisible();
      await expect(firstAfterCopy.getByRole("button", { name: "Mark as shared" })).toBeVisible();

      // ---------------------------------------------------------------
      // Marking shared is the deliberate act that records a send
      // ---------------------------------------------------------------
      await firstAfterCopy.getByRole("button", { name: "Mark as shared" }).click();
      await page.waitForURL(/saved=link-shared/);

      const shared = page.locator(".delivery-link").filter({ hasText: newYork });
      await expect(shared.getByText(/Marked as shared on/)).toBeVisible();
      // ...and only that link. The other is untouched.
      const untouched = page.locator(".delivery-link").filter({ hasText: london });
      await expect(untouched.getByRole("button", { name: "Mark as shared" })).toBeVisible();

      // ---------------------------------------------------------------
      // The desk opens it, with no account and no session
      // ---------------------------------------------------------------
      const deskContext = await browser.newContext();
      const deskPage = await deskContext.newPage();
      try {
        await deskPage.goto(new URL(newYorkUrl).pathname + new URL(newYorkUrl).search);
        await expect(deskPage.getByRole("heading", { level: 1 })).toContainText("Package");

        // The disclosure is on the page the visitor is actually looking at.
        await expect(
          deskPage.getByText(/Opening this link, accepting the terms, and downloading a file/),
        ).toBeVisible();

        // Each frame is marked for the observer, which is what per-photograph
        // timing hangs off.
        await expect(deskPage.locator("[data-asset-id]").first()).toBeVisible();

        await deskPage.getByLabel("Name", { exact: true }).fill("Dana Whitfield");
        await deskPage.getByRole("button", { name: "Accept these terms" }).click();
        await expect(deskPage.getByText(/Accepted by Dana Whitfield/)).toBeVisible();

        const download = deskPage.getByRole("link", { name: /Download full resolution/ }).first();
        const target = await download.getAttribute("href");
        const response = await deskPage.request.get(target ?? "");
        expect(response.status()).toBe(200);
        expect(response.headers()["content-type"]).toContain("image");
      } finally {
        await deskContext.close();
      }

      // ---------------------------------------------------------------
      // Back to the photographer
      // ---------------------------------------------------------------
      await page.goto(at(`/submissions/${SEEDED_SUBMISSION}`));

      const analytics = page.locator(".recipient-analytics").filter({ hasText: newYork });
      await expect(analytics).toBeVisible();
      // The activity landed on the right recipient's link.
      await expect(analytics.getByText(/Accepted by Dana Whitfield/)).toBeVisible();
      await expect(analytics.getByText(/Recorded against the link created for/)).toBeVisible();

      // ...and the other link is still, truthfully, unopened.
      const quiet = page.locator(".recipient-analytics").filter({ hasText: london });
      // "Not opened yet" appears twice for an untouched link -- once as the
      // first-opened value and once as the engagement summary -- which is the
      // right amount of saying so.
      await expect(quiet.getByText("Not opened yet", { exact: true })).toBeVisible();
      await expect(quiet.getByText("Not opened yet.", { exact: true })).toBeVisible();

      // The full lifecycle is legible as distinct states rather than one
      // "delivered".
      await expect(page.getByText("A link was opened").first()).toBeVisible();
      await expect(page.getByText(/Terms accepted/).first()).toBeVisible();
      await expect(page.getByText("A frame was downloaded").first()).toBeVisible();

      // No control anywhere offers to resend anything.
      await expect(page.getByRole("button", { name: /Retry delivery/i })).toHaveCount(0);
    } finally {
      await removeDeliveryFixture(fixtureKey);
    }
  });

  test("shows a link that was opened without measurable viewing as unknown, not zero", async ({
    page,
    browser,
  }, testInfo) => {
    const recipient = desk(testInfo, "Wire desk");

    await signIn(page, SEEDED.owner);
    await page.goto(at(`/submissions/${SEEDED_SUBMISSION}`));
    await page.getByRole("button", { name: "Create a delivery link" }).click();
    const form = page.locator("form.delivery-create-form");
    await form.getByLabel("Recipient", { exact: true }).fill(recipient);
    await form.getByRole("button", { name: "Create the link" }).click();

    const made = page.locator(".delivery-link").filter({ hasText: recipient });
    const url = (await made.locator(".delivery-link-url code").innerText()).trim();

    /*
     * A visitor who declined optional analytics. Consent is refused for this
     * context, so the page records the open -- which is commercial evidence and
     * is not optional -- and sends no heartbeats at all.
     */
    const deskContext = await browser.newContext();
    await refuseCookies(deskContext);
    const deskPage = await deskContext.newPage();
    try {
      await deskPage.goto(new URL(url).pathname);
      await expect(deskPage.getByRole("heading", { level: 1 })).toContainText("Package");
      // The page says so rather than measuring quietly.
      await expect(deskPage.getByText(/Viewing-time measurement is off for this visit/)).toBeVisible();
    } finally {
      await deskContext.close();
    }

    await page.goto(at(`/submissions/${SEEDED_SUBMISSION}`));
    const analytics = page.locator(".recipient-analytics").filter({ hasText: recipient });
    // Not "0 seconds". Missing measurement is not an absence of interest.
    await expect(
      analytics.getByText(/detailed viewing time was unavailable/),
    ).toBeVisible();
  });

  test("refuses attribution that names a credential or a person", async ({ page }, testInfo) => {
    const recipient = desk(testInfo, "Rejecting desk");

    await signIn(page, SEEDED.owner);
    await page.goto(at(`/submissions/${SEEDED_SUBMISSION}`));
    await page.getByRole("button", { name: "Create a delivery link" }).click();
    const form = page.locator("form.delivery-create-form");
    await form.getByLabel("Recipient", { exact: true }).fill(recipient);

    await form.getByPlaceholder("campaign").fill("token");
    await form.getByPlaceholder("awards-season").fill("anything");
    await form.getByRole("button", { name: "Create the link" }).click();
    await expect(form.locator("p.auth-error")).toContainText(/reserved/i);

    await form.getByPlaceholder("campaign").fill("email");
    await form.getByPlaceholder("awards-season").fill("jane@example.com");
    await form.getByRole("button", { name: "Create the link" }).click();
    await expect(form.locator("p.auth-error")).toContainText(/reserved/i);

    // Nothing was created by either attempt.
    await expect(page.locator(".delivery-link").filter({ hasText: recipient })).toHaveCount(0);
  });
});

test.describe("the dispatch screen after approval", () => {
  test("does not claim a package has been sent", async ({ page, context }) => {
    await refuseCookies(context);
    await signIn(page, SEEDED.owner);

    /*
     * Package 01 on the seeded shoot: approved and opened. Named explicitly,
     * because the screen defaults to whichever package still needs work, and
     * that is package 02 -- which is exactly the right default and the wrong
     * one for this assertion.
     */
    await page.goto(
      at(
        "/dispatch/a0000000-0000-0000-0000-0000000000c1?package=a0000000-0000-0000-0000-0000000000f1",
      ),
    );

    await expect(page.getByText("This package has been sent")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /A delivery link for this package/ })).toBeVisible();
  });
});

test.describe("approving, then measuring what the desk actually looked at", () => {
  test.beforeEach(async ({ context }) => {
    await refuseCookies(context);
    await clearDeliveryLinks();
  });
  test.afterEach(async () => clearDeliveryLinks());

  test("says approved but not sent, and counts only visible time", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    const recipient = desk(testInfo, "Measured desk");
    const fixture = await createApprovablePackage(`APPROVE${testInfo.project.name}`);

    try {
      await signIn(page, SEEDED.owner);

      // ---------------------------------------------------------------
      // Approve the package
      // ---------------------------------------------------------------
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}`));
      await expect(page.getByRole("heading", { name: "Every check passes" })).toBeVisible();

      await page.getByRole("button", { name: "Approve package" }).click();
      await expect(
        page.getByText(/This freezes the selected frames, versions, buyer, terms/),
      ).toBeVisible();
      await page.getByRole("button", { name: "Yes, approve this package" }).click();

      // ---------------------------------------------------------------
      // Approved, and explicitly not sent
      // ---------------------------------------------------------------
      await page.waitForURL(/\/submissions\//);
      await expect(page.locator(".page-header")).toContainText(/nothing sent yet/i);
      await expect(page.locator(".page-header")).not.toContainText(/^Sent to/);
      await expect(page.getByText("Approved; nothing sent yet")).toBeVisible();

      // ---------------------------------------------------------------
      // A link, shared
      // ---------------------------------------------------------------
      await page.getByRole("button", { name: "Create a delivery link" }).click();
      const createForm = page.locator("form.delivery-create-form");
      await createForm.getByLabel("Recipient", { exact: true }).fill(recipient);
      await createForm.getByRole("button", { name: "Create the link" }).click();

      const link = page.locator(".delivery-link").filter({ hasText: recipient });
      const url = (await link.locator(".delivery-link-url code").innerText()).trim();
      await link.getByRole("button", { name: "Mark as shared" }).click();
      await page.waitForURL(/saved=link-shared/);

      // ---------------------------------------------------------------
      // The desk reads it, then leaves the tab in the background
      // ---------------------------------------------------------------
      const deskContext = await browser.newContext();
      // A recipient who agreed to the optional measurement. Without this the
      // page records the open and nothing else, which is the subject of its own
      // test above.
      await acceptCookies(deskContext);
      const deskPage = await deskContext.newPage();
      try {
        await deskPage.goto(new URL(url).pathname);
        await expect(deskPage.locator("[data-asset-id]").first()).toBeVisible();
        // The disclosure matches what is actually being collected.
        await expect(
          deskPage.getByText(/Mastline also measures roughly how long it is on screen/),
        ).toBeVisible();

        /*
         * Long enough for two heartbeats to land while the page is genuinely
         * visible and being read. Scrolled through the window rather than with
         * mouse.wheel, which mobile WebKit does not support -- and a scroll
         * event is what the tracker treats as a sign of life either way.
         */
        for (let step = 0; step < 12; step += 1) {
          await deskPage.evaluate(() => window.scrollBy(0, 60));
          await deskPage.waitForTimeout(1_000);
        }
        await deskPage.waitForTimeout(1_500);

        const whileVisible = await engagementForRecipient(recipient);
        expect(whileVisible).not.toBeNull();
        expect(whileVisible!.activeVisibleMs).toBeGreaterThan(0);
        expect(whileVisible!.sessionCount).toBe(1);
        expect(whileVisible!.visitorCount).toBe(1);
        // Per-photograph rows, for frames that were actually on screen.
        expect(whileVisible!.assetRows).toBeGreaterThan(0);

        /*
         * Now hide the tab. Playwright has no "background this tab", so the
         * Page Visibility API is overridden directly and the event the tracker
         * listens for is dispatched -- which is exactly what a real browser
         * does when somebody switches away.
         */
        await deskPage.evaluate(() => {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => "hidden",
          });
          Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
          document.dispatchEvent(new Event("visibilitychange"));
        });

        /*
         * Going hidden flushes the time already accrued while the page WAS
         * visible -- that time is real and belongs in the record -- so the
         * baseline is taken after that final beat has landed rather than
         * before. What must not move is anything after it.
         */
        await deskPage.waitForTimeout(2_000);
        const atMomentOfHiding = await engagementForRecipient(recipient);
        expect(atMomentOfHiding!.activeVisibleMs).toBeGreaterThanOrEqual(
          whileVisible!.activeVisibleMs,
        );

        // Well past two heartbeat intervals in the background. None of it counts.
        await deskPage.waitForTimeout(25_000);

        const whileHidden = await engagementForRecipient(recipient);
        expect(whileHidden!.activeVisibleMs).toBe(atMomentOfHiding!.activeVisibleMs);
        // ...and no second session was invented while the tab sat there.
        expect(whileHidden!.sessionCount).toBe(1);
      } finally {
        await deskContext.close();
      }

      // ---------------------------------------------------------------
      // The photographer's reading of it
      // ---------------------------------------------------------------
      await page.goto(page.url().split("?")[0]);
      const analytics = page.locator(".recipient-analytics").filter({ hasText: recipient });
      await expect(analytics.getByText(/Active viewing/)).toBeVisible();
      // A plausible figure, hedged where it is stated. Roughly the time the
      // page was actually scrolled, and nowhere near the wall-clock length of
      // the test -- which is the difference this whole mechanism exists for.
      await expect(analytics.getByText(/about \d+s \(approximate\)/)).toBeVisible();
      await expect(
        analytics.getByText(/Times are approximate\. They are measured only while/),
      ).toBeVisible();
      await expect(analytics.getByText(/anonymous browser/)).toBeVisible();
      // A link, not a person.
      await expect(analytics.getByText(/it does not know who was holding it/)).toBeVisible();
    } finally {
      await clearDeliveryLinks();
      await purgeShootWithAssets(fixture.shootId).catch(() => undefined);
    }
  });
});
