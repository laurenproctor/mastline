import { expect, test, type Page } from "@playwright/test";
import {
  SEEDED,
  at,
  createApprovablePackage,
  purgeApprovedShoot,
  purgeMoneyRecords,
  refuseCookies,
  signIn,
} from "./helpers";

/**
 * The money end of the loop, driven through the real interface.
 *
 * A sale recorded on the submission's outcome panel, a payment recorded on the
 * money screen, and that payment attributed to the license that earned it --
 * with the screen's figures moving by exactly the net that arrived. The
 * database suite proves the same chain function by function; what only a
 * browser can prove is that the forms an operator actually touches feed it,
 * and that the reconciliation queue lets go of a payment once it is
 * attributed.
 *
 * The assertions favour durable postconditions -- the license card, the queue
 * row appearing and disappearing, the metric's delta -- over transient status
 * flashes, because a revalidated screen may re-render past a message before
 * the test reads it.
 */

/** Read a money metric ("$2,788" or "$2,788.50") as integer minor units. */
async function metricMinor(page: Page, label: string): Promise<number> {
  const metric = page
    .locator(".ml-metric")
    .filter({ has: page.locator(".ml-metric__label", { hasText: label }) });
  const text = (await metric.locator(".ml-metric__value").innerText()).trim();
  return Math.round(Number(text.replace(/[^0-9.]/g, "")) * 100);
}

test.describe("a sale becomes an attributed payment", () => {
  test.beforeEach(async ({ context }) => refuseCookies(context));

  test("records the sale, takes the payment, attributes it, and the figures move", async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    // Unique per project and run: three viewports share one database, and the
    // licenses table and reconciliation queue list every record they can see.
    const stamp = `${testInfo.project.name}-${Date.now()}`;
    const licensee = `Money loop desk ${stamp}`;
    const reference = `MONEYLOOP-${stamp}`;
    const fixture = await createApprovablePackage(`MONEY${testInfo.project.name}`);

    try {
      await signIn(page, SEEDED.owner);

      // ---------------------------------------------------------------
      // A submission to sell against, made through the real approval gate
      // ---------------------------------------------------------------
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}`));
      await expect(page.getByRole("heading", { name: "Ready", exact: true })).toBeVisible({
        timeout: 90_000,
      });
      await page.getByRole("button", { name: "Create private delivery" }).click();
      await expect(
        page.getByText(/frozen on the submission and cannot be edited afterwards/),
      ).toBeVisible();
      await page.getByRole("button", { name: "Yes, create the private delivery" }).click();
      await expect(page.getByText("Private delivery created")).toBeVisible({ timeout: 90_000 });
      await page.getByRole("link", { name: "View submission record" }).click();
      await page.waitForURL(/\/submissions\//);

      // ---------------------------------------------------------------
      // The sale, recorded where the outcome lives
      // ---------------------------------------------------------------
      const saleForm = page.locator("form").filter({ hasText: "Record a sale" });
      await saleForm.getByLabel("Licensee").fill(licensee);
      await saleForm
        .getByLabel("Where did this license come from?")
        .selectOption("mastline_sales_engine");
      await saleForm.getByLabel("Sale amount").fill("640");
      // The split is previewed before anything is committed.
      await expect(saleForm.getByText("$448.00")).toBeVisible();
      await expect(saleForm.getByText("$192.00")).toBeVisible();
      await saleForm.getByRole("button", { name: "Record sale" }).click();

      // The durable proof: the license card, with the server's own split. The
      // sale form goes with it, because a submission carries at most one sale.
      const licenseCard = page.locator(".side-card").filter({ hasText: licensee });
      await expect(licenseCard.getByRole("heading", { name: licensee })).toBeVisible({
        timeout: 90_000,
      });
      await expect(licenseCard.getByText("$640")).toBeVisible();
      await expect(licenseCard.getByText("$448")).toBeVisible();
      await expect(licenseCard.getByText("$192")).toBeVisible();
      await expect(
        licenseCard.getByText("Generated inside Mastline, so the 70/30 share applies."),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Record sale" })).toHaveCount(0);

      // ---------------------------------------------------------------
      // The money screen, before any money has arrived
      // ---------------------------------------------------------------
      await page.goto(at("/money"));
      const netBefore = await metricMinor(page, "Net received");
      const licenses = page.getByRole("table", { name: "Licenses recorded" });
      const licenseRow = licenses.getByRole("row").filter({ hasText: licensee });
      await expect(licenseRow.getByText("Via Mastline")).toBeVisible();

      // ---------------------------------------------------------------
      // The payment: gross and the Sales Engine share entered separately
      // ---------------------------------------------------------------
      await page.getByRole("button", { name: "Record payment" }).click();
      const paymentForm = page.locator("form").filter({ hasText: "Net that arrives" });
      await paymentForm.getByLabel("Reference").fill(reference);
      await paymentForm.getByLabel("Gross").fill("640");
      await paymentForm.getByLabel("Sales Engine share").fill("192");
      await expect(paymentForm.getByText("$448.00")).toBeVisible();
      await paymentForm.getByRole("button", { name: "Record payment" }).click();
      await expect(paymentForm.getByRole("status")).toContainText("Payment recorded. Net 448", {
        timeout: 90_000,
      });

      // ---------------------------------------------------------------
      // Received but unattributed: the queue holds it, the net has moved
      // ---------------------------------------------------------------
      await page.goto(at("/money"));
      expect(await metricMinor(page, "Net received")).toBe(netBefore + 44_800);

      const queue = page.getByRole("table", { name: "Payments with unattributed amounts" });
      const queueRow = queue.getByRole("row").filter({ hasText: reference });
      await expect(queueRow).toHaveCount(1);

      // ---------------------------------------------------------------
      // Attributed to the license that earned it
      // ---------------------------------------------------------------
      await queueRow.getByRole("button", { name: "Match" }).click();
      await queueRow
        .getByLabel("Attribute to a license")
        .selectOption({ label: `${licensee} · $640` });
      // The amount arrives prefilled with the unattributed remainder.
      await expect(queueRow.getByLabel("Amount")).toHaveValue("448.00");
      await queueRow.getByRole("button", { name: "Attribute" }).click();

      // The queue lets go of the payment once nothing is left to attribute.
      await expect(queue.getByRole("row").filter({ hasText: reference })).toHaveCount(0, {
        timeout: 90_000,
      });

      // ---------------------------------------------------------------
      // Attribution moved nothing: the money had already arrived
      // ---------------------------------------------------------------
      await page.goto(at("/money"));
      expect(await metricMinor(page, "Net received")).toBe(netBefore + 44_800);
      // Scoped to this run's payment in the reconciliation queue: the queue may
      // hold other records, and the recent-payments table rightly keeps this
      // one, but nothing is left here to attribute on a fresh load either.
      await expect(
        page
          .getByRole("table", { name: "Payments with unattributed amounts" })
          .getByRole("row")
          .filter({ hasText: reference }),
      ).toHaveCount(0);
    } finally {
      await purgeMoneyRecords({ paymentReference: reference, licenseeName: licensee });
      await purgeApprovedShoot(fixture.shootId);
    }
  });
});
