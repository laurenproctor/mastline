import { expect, test } from "@playwright/test";
import { SEEDED, at, signIn } from "./helpers";

/**
 * Setting a profile photo.
 *
 * The interesting part is not that a file input accepts a file; it is that the
 * face survives a reload, which means it went into a private bucket and came
 * back out through a signed URL that row level security agreed to mint.
 */

/**
 * An 8x6 red PNG: small enough to inline, and a real enough file that
 * createImageBitmap will decode it. Deliberately not square, so the centre-crop
 * has something to actually do.
 */
const RED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWO4o6GBFTEMpAQAngY4QYsZ38YAAAAASUVORK5CYII=",
  "base64",
);

test.describe("a profile photo", () => {
  test("goes on, survives a reload, and comes off", async ({ page }) => {
    await signIn(page, SEEDED.owner);
    await page.goto(at("/settings"));

    const panel = page.getByRole("heading", { name: "Your photo" });
    await expect(panel).toBeVisible();

    // Before: the initials, not an image.
    const photo = page.locator(".profile-photo img.avatar");
    await expect(photo).toHaveCount(0);

    await page.locator('input[type="file"]').setInputFiles({
      name: "face.png",
      mimeType: "image/png",
      buffer: RED_PNG,
    });

    await expect(photo).toBeVisible({ timeout: 20_000 });

    try {
      // The real assertion: after a reload the src is a signed URL from the
      // avatars bucket, not the object URL the browser made a moment ago.
      await page.reload();
      await expect(photo).toBeVisible({ timeout: 20_000 });
      const src = await photo.getAttribute("src");
      expect(src).toContain("/storage/v1/object/sign/avatars/");

      // And the browser can actually fetch it.
      const fetched = await page.request.get(src!);
      expect(fetched.status()).toBe(200);

      // It follows the person into the sidebar.
      await page.goto(at("/work"));
      await expect(page.locator(".ml-sidebar img.avatar")).toBeVisible();
    } finally {
      // Put the account back however the assertions went: a face left behind
      // would change what every later run of this file starts from.
      await page.goto(at("/settings"));
      await page.getByRole("button", { name: "Remove" }).click();
      await expect(page.locator(".profile-photo img.avatar")).toHaveCount(0);
    }
  });

  test("refuses a file that is not an image it can read", async ({ page }) => {
    await signIn(page, SEEDED.owner);
    await page.goto(at("/settings"));

    await page.locator('input[type="file"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a photograph"),
    });

    // .auth-error rather than the alert role: Next's route announcer also
    // carries role="alert", so the role selector matches two elements.
    await expect(page.locator(".auth-error")).toContainText("JPEG, PNG, or WebP");
    await expect(page.locator(".profile-photo img.avatar")).toHaveCount(0);
  });
});
