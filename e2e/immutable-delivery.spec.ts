import { expect, test } from "@playwright/test";
import {
  SEEDED,
  addLaterDerivative,
  approvedFrames,
  at,
  clearDeliveryLinks,
  createApprovablePackageWithFiles,
  downloadedAssetIds,
  purgeApprovedShoot,
  refuseCookies,
  rewriteAssetCaption,
  signIn,
} from "./helpers";

/**
 * The exact photographs and editorial information approved by the photographer
 * must be exactly what the recipient later sees and downloads.
 *
 * Approve a package, make a link, then do the two things that used to change
 * what the desk received -- rewrite the caption, make a newer derivative -- and
 * open the link as a stranger. The caption is the approved one, the order is
 * the approved one, and the file authorised for download is the approved
 * object, not the newer one. Then withdraw the link and confirm it is gone.
 */
test.describe("what was approved is what the recipient gets", () => {
  test.beforeEach(async ({ context }) => {
    await refuseCookies(context);
    await clearDeliveryLinks();
  });
  test.afterEach(async () => clearDeliveryLinks());

  test("survives a caption edit and a newer derivative, and closes when withdrawn", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    const label = `IMMUTABLE${testInfo.project.name}`;
    const recipient = `Immutable desk ${testInfo.project.name} ${Date.now()}`;
    const fixture = await createApprovablePackageWithFiles(label);
    const [first, second] = fixture.frames;
    const objectKeys = [...fixture.objectKeys];

    try {
      await signIn(page, SEEDED.owner);

      // ---------------------------------------------------------------
      // 1–2. Open the prepared package and approve it
      // ---------------------------------------------------------------
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}`));
      await expect(page.getByRole("heading", { name: "Every check passes" })).toBeVisible();
      // Under review, and the strip says so from the record.
      await expect(page.locator('[aria-current="step"]')).toContainText("Review & approve");

      await page.getByRole("button", { name: "Approve package" }).click();
      await page.getByRole("button", { name: "Yes, approve this package" }).click();
      await page.waitForURL(/\/submissions\//);
      const submissionId = page.url().split("/submissions/")[1].split(/[?#]/)[0];

      // ---------------------------------------------------------------
      // 3. The snapshot exists, in the record and on the screen
      // ---------------------------------------------------------------
      const frames = await approvedFrames(submissionId);
      expect(frames.map((frame) => frame.asset_id)).toEqual([first.assetId, second.assetId]);
      expect(frames.map((frame) => frame.asset_version_id)).toEqual([
        first.deliveryVersionId,
        second.deliveryVersionId,
      ]);
      expect(frames[0].object_key_snapshot).toBe(first.deliveryKey);
      expect(frames[0].caption_snapshot).toBe(`The approved caption for ${label} frame 0.`);
      expect(frames.every((frame) => frame.snapshot_origin === "approval")).toBe(true);

      await expect(page.locator("[data-approved-frame]")).toHaveCount(2);
      await expect(
        page.getByText(`The approved caption for ${label} frame 0.`).first(),
      ).toBeVisible();
      // The evidence is legible: provenance, the approved file, and its digest.
      const firstRow = page.locator(`[data-approved-frame="${first.assetId}"]`);
      await expect(firstRow).toContainText("At approval");
      await expect(firstRow).toContainText("Delivery");
      await expect(firstRow).toContainText("SHA-256");
      await expect(firstRow).toContainText("People: Avery Hart");
      await expect(page.locator("[data-unresolved-frame]")).toHaveCount(0);

      // ...and the dispatch strip has moved on: approved is not sent.
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}`));
      await expect(page.locator('[aria-current="step"]')).toContainText("Create recipient link");

      // ---------------------------------------------------------------
      // 4. A recipient link
      // ---------------------------------------------------------------
      await page.goto(at(`/submissions/${submissionId}`));
      await page.getByRole("button", { name: "Create a delivery link" }).click();
      const createForm = page.locator("form.delivery-create-form");
      await createForm.getByLabel("Recipient", { exact: true }).fill(recipient);
      await createForm.getByRole("button", { name: "Create the link" }).click();
      const link = page.locator(".delivery-link").filter({ hasText: recipient });
      const url = (await link.locator(".delivery-link-url code").innerText()).trim();
      const path = new URL(url).pathname;
      const token = path.split("/d/")[1];

      // The lifecycle strip reads the link: created is not shared, and the
      // screen says so rather than inventing a send.
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}`));
      await expect(page.locator('[aria-current="step"]')).toContainText("Create recipient link");
      await expect(page.locator("[data-lifecycle-detail]")).toHaveText(
        "A recipient link exists and has not been marked as shared. Nothing has left Mastline.",
      );

      // Neither the token nor a private object key appears on an authenticated
      // overview page. The only place the token is rendered is the recipient
      // URL on the submission itself, and the object key appears nowhere.
      for (const overview of ["/submissions", "/work", `/dispatch/${fixture.shootId}`]) {
        await page.goto(at(overview));
        const html = await page.content();
        expect(html, `${overview} must not carry the delivery token`).not.toContain(token);
        expect(html, `${overview} must not carry an object key`).not.toContain(first.deliveryKey);
      }
      await page.goto(at(`/submissions/${submissionId}`));
      expect(await page.content()).not.toContain(first.deliveryKey);

      // ---------------------------------------------------------------
      // 5–6. The photographer edits the caption and makes a newer derivative
      // ---------------------------------------------------------------
      await rewriteAssetCaption(first.assetId, {
        caption: "A caption rewritten after approval.",
        headline: "Rewritten headline",
      });
      const laterKey = `aaaaaaaa-0000-0000-0000-000000000001/${fixture.shootId}/${label}_0_later.jpg`;
      await addLaterDerivative(first.assetId, laterKey);
      objectKeys.push(laterKey);

      // The photographer's own screens read the live asset...
      await page.goto(at(`/assets/${first.assetId}`));
      await expect(page.getByText("A caption rewritten after approval.").first()).toBeVisible();
      // ...and say the edit does not reach the approved submission.
      await expect(page.getByText(/never changes an approved submission/)).toBeVisible();

      // ---------------------------------------------------------------
      // 7–8. A signed-out desk opens the link: the approved words, in order
      // ---------------------------------------------------------------
      const desk = await browser.newContext();
      const deskPage = await desk.newPage();
      try {
        await deskPage.goto(path);
        // The title is the package name, frozen at approval.
        await expect(deskPage.getByRole("heading", { level: 1 })).toHaveText(`${label} package`);

        const shown = deskPage.locator("[data-asset-id]");
        await expect(shown).toHaveCount(2);
        expect(
          await shown.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-asset-id"))),
        ).toEqual([first.assetId, second.assetId]);

        const firstFrame = shown.first();
        await expect(firstFrame).toContainText(`The approved caption for ${label} frame 0.`);
        await expect(firstFrame).toContainText(`${label} frame 0`);
        // People, as recorded by the photographer at approval.
        await expect(firstFrame.locator("[data-people]")).toHaveText("Avery Hart");
        await expect(deskPage.getByText("A caption rewritten after approval.")).toHaveCount(0);
        await expect(deskPage.getByText("Rewritten headline")).toHaveCount(0);
        // No storage location on the recipient page either.
        expect(await deskPage.content()).not.toContain(first.deliveryKey);

        // The preview is served through the route, from the approved object.
        const preview = await deskPage.request.get(
          (await firstFrame.locator("img").getAttribute("src")) ?? "",
        );
        expect(preview.status()).toBe(200);
        expect(preview.headers()["content-type"]).toBe("image/jpeg");

        // ---------------------------------------------------------------
        // 9–11. Accept, download, and prove which object was authorised
        // ---------------------------------------------------------------
        await deskPage.getByLabel("Name", { exact: true }).fill("Dana Whitfield");
        await deskPage.getByRole("button", { name: "Accept these terms" }).click();
        await expect(deskPage.getByText(/Accepted by Dana Whitfield/)).toBeVisible();

        const download = firstFrame.getByRole("link", { name: /Download full resolution/ });
        const target = (await download.getAttribute("href")) ?? "";
        const redirect = await deskPage.request.get(target, { maxRedirects: 0 });
        expect(redirect.status()).toBe(303);
        const location = redirect.headers()["location"] ?? "";
        // The exact approved object, and not the derivative made afterwards.
        expect(location).toContain(first.deliveryKey);
        expect(location).not.toContain(laterKey);
        // The recipient never sees a storage URL on the page itself.
        expect(target).toMatch(/^\/d\/[A-Za-z0-9_-]+\/frame\//);

        const file = await deskPage.request.get(target);
        expect(file.status()).toBe(200);
        expect(file.headers()["content-type"]).toContain("image");

        // Two requests, two recorded downloads, both of the approved frame:
        // the record says what happened, not what was intended.
        expect(await downloadedAssetIds(recipient)).toEqual([first.assetId, first.assetId]);
      } finally {
        await desk.close();
      }

      // ---------------------------------------------------------------
      // 12. The photographer sees the download
      // ---------------------------------------------------------------
      await page.goto(at(`/submissions/${submissionId}`));
      await expect(
        page.getByRole("cell", { name: "A frame was downloaded" }).first(),
      ).toBeVisible();
      // The approved record on their screen still carries the approved caption.
      await expect(
        page.getByText(`The approved caption for ${label} frame 0.`).first(),
      ).toBeVisible();

      // ---------------------------------------------------------------
      // 13–14. Withdraw, and the link no longer opens
      // ---------------------------------------------------------------
      const made = page.locator(".delivery-link").filter({ hasText: recipient });
      await made.getByRole("button", { name: "Withdraw this link" }).click();
      await expect(
        page.locator(".delivery-link").filter({ hasText: recipient }).locator(".badge"),
      ).toHaveText("Withdrawn");

      const after = await browser.newContext();
      const afterPage = await after.newPage();
      try {
        await afterPage.goto(path);
        await expect(afterPage.getByRole("heading", { level: 1 })).toContainText("not open");
        expect((await afterPage.request.get(`${path}/frame/${first.assetId}`)).status()).toBe(404);
        expect((await afterPage.request.get(`${path}/preview/${first.assetId}`)).status()).toBe(
          404,
        );
      } finally {
        await after.close();
      }
    } finally {
      await clearDeliveryLinks();
      await purgeApprovedShoot(fixture.shootId, objectKeys).catch(() => undefined);
    }
  });
});
