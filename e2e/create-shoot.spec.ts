import { expect, test } from "@playwright/test";
import {
  SEEDED,
  SEEDED_WORKSPACE,
  assetsOnShoot,
  at,
  deleteShoot,
  hasHorizontalOverflow,
  overflowingElements,
  purgeShootWithAssets,
  refuseCookies,
  shootIdByTitle,
  signIn,
  testBudget,
} from "./helpers";

/**
 * Creating a shoot, in a browser, on one page.
 *
 * The flow this replaced was two screens: a brief here, "Create shoot and
 * review", and everything else on the next one. Confirmation belongs at the
 * point of consequence, and creating a private draft is not one -- so what this
 * checks is that the whole shoot can be described in one pass, that the button
 * says what it does, and that having pressed it the photographer is in the
 * shoot rather than at another gate.
 *
 * One test does upload a real file, because the half that cannot be checked
 * anywhere else is the browser's: hashing the bytes on this machine, staging
 * them before a shoot exists, and having them arrive as assets on the draft the
 * same submission created.
 */

/** A one-pixel JPEG, small enough to stage on every run. */
const PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

test.describe("create shoot", () => {
  /*
   * The consent banner sits at the bottom of the viewport until it is answered,
   * and on a phone that is over the end of any long form. Answering it is what
   * a real visitor does before working; the banner's own behaviour is tested in
   * consent.spec.ts.
   */
  test.beforeEach(async ({ page }) => {
    // A loaded host renders these pages in tens of seconds; the default
    // budget reports that stall as a failure. Assertions are unchanged.
    test.setTimeout(testBudget(180_000, 300_000));
    await refuseCookies(page.context());
  });

  test("describes a whole shoot on one page and lands in its workspace", async ({ page }) => {
    const title = `Browser draft ${Date.now()}`;
    await signIn(page, SEEDED.owner);

    try {
      await page.goto(at("/shoots/new"));
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Create shoot", {
        timeout: 60_000,
      });

      // Every part of the shoot is here at once. None of these is behind a
      // step, a modal, or a second screen.
      for (const heading of [
        "Shoot details",
        "Photographs",
        "Metadata",
        "Rights and usage",
        "Final review",
      ]) {
        await expect(page.getByRole("heading", { name: heading, level: 2 })).toBeVisible();
      }

      // The action is unavailable until the shoot has a subject, and says why.
      const create = page.getByRole("button", { name: "Create shoot" });
      await expect(create).toBeDisabled();

      await page.getByLabel("Subject or event").fill(title);
      await page.getByLabel("Credit line").fill("Marcus Hale / Marcus Hale Studio");
      await page.getByLabel("Copyright notice").fill("© 2026 Marcus Hale");
      await page.getByLabel("Usage restrictions").fill("Editorial use only");
      await page.getByLabel("Sensitive content").check();

      // Moving between sections is a scroll, so nothing typed is lost.
      await page.getByRole("link", { name: "Shoot details" }).click();
      await expect(page.getByLabel("Subject or event")).toHaveValue(title);
      await expect(page.getByLabel("Credit line")).toHaveValue("Marcus Hale / Marcus Hale Studio");

      await expect(create).toBeEnabled();
      await expect(page.getByText(/remain private until you choose to dispatch it/i)).toBeVisible();

      await create.click();
      await page.waitForURL(/\/shoots\/[0-9a-f-]{36}/, { timeout: 60_000 });

      // The confirmation is on the record, not on a screen between the two.
      expect(new URL(page.url()).pathname.startsWith(`/${SEEDED_WORKSPACE}/shoots/`)).toBe(true);
      await expect(page.getByText("Shoot created as a draft")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
      await expect(page.locator(".page-header .eyebrow")).toHaveText("Draft");
    } finally {
      const stray = await shootIdByTitle(title);
      if (stray) await deleteShoot(stray);
    }
  });

  test("stages a photograph before the shoot exists, and saves it with the draft", async ({
    page,
  }) => {
    const title = `With a frame ${Date.now()}`;
    let shootId: string | null = null;

    await signIn(page, SEEDED.owner);

    try {
      await page.goto(at("/shoots/new"));
      await page.getByLabel("Subject or event").fill(title);
      await page.getByLabel("Credit line").fill("Marcus Hale / Marcus Hale Studio");
      await page.getByLabel("Copyright notice").fill("© 2026 Marcus Hale");

      // The file is hashed and staged here, with no shoot to belong to yet.
      await page.getByLabel("Add photographs").setInputFiles({
        name: `MH_${Date.now()}.jpg`,
        mimeType: "image/jpeg",
        buffer: PIXEL_JPEG,
      });
      await expect(page.getByText(/1 of 1 ready/)).toBeVisible({ timeout: 60_000 });

      // Nothing is saved yet, and the review says which frame dispatch will ask
      // about -- without stopping the draft.
      await expect(page.getByText(/Nothing is saved until you create the shoot/)).toBeVisible();
      await expect(page.getByText(/1 of 1 photograph has no caption/)).toBeVisible();

      // A <summary> is a disclosure, not a button: it has no button role.
      await page.locator("summary", { hasText: /Metadata for MH_/ }).click();
      await page.getByLabel("Caption", { exact: true }).fill("Leaving the hotel.");

      await page.getByRole("button", { name: "Create shoot" }).click();
      await page.waitForURL(/\/shoots\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await expect(page.getByText("Shoot created as a draft")).toBeVisible();

      shootId = await shootIdByTitle(title);
      expect(shootId).not.toBeNull();

      // The frame is an asset on the draft, with the caption typed against it
      // and the credit the whole shoot shares. It is not selected: choosing what
      // goes to a buyer is a later decision on a later screen.
      const assets = await assetsOnShoot(shootId as string);
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({
        status: "active",
        caption: "Leaving the hotel.",
        credit_line: "Marcus Hale / Marcus Hale Studio",
        selected: false,
      });

      await expect(page.getByText("1 file")).toBeVisible();
    } finally {
      const stray = shootId ?? (await shootIdByTitle(title));
      if (stray) await purgeShootWithAssets(stray);
    }
  });

  test("an empty subject disables the action and says which section fixes it", async ({ page }) => {
    await signIn(page, SEEDED.owner);
    await page.goto(at("/shoots/new"));

    const create = page.getByRole("button", { name: "Create shoot" });
    await expect(create).toBeDisabled({ timeout: 60_000 });
    await expect(page.getByText("Give the shoot a subject or event.")).toBeVisible();

    // Whitespace is not a title, and the client agrees with the server about it.
    await page.getByLabel("Subject or event").fill("   ");
    await expect(create).toBeDisabled();
  });

  test("a brief the server refuses creates nothing and reports at the field", async ({ page }) => {
    const overlong = "x".repeat(201);
    await signIn(page, SEEDED.owner);

    try {
      await page.goto(at("/shoots/new"));

      // Length is checked server-side only, so this is the path that proves
      // validation still happens there rather than only in the browser.
      await page.getByLabel("Subject or event").fill(overlong);
      await page.getByRole("button", { name: "Create shoot" }).click();

      const field = page.getByLabel("Subject or event");
      await expect(page.getByText(/Keep this under 200 characters/)).toBeVisible();
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toBeFocused();

      // Still on the form, and no draft was written.
      expect(new URL(page.url()).pathname).toBe(at("/shoots/new"));
      expect(await shootIdByTitle(overlong)).toBeNull();
    } finally {
      const stray = await shootIdByTitle(overlong);
      if (stray) await deleteShoot(stray);
    }
  });

  test("holds its layout at every size, including a phone", async ({ page }) => {
    await signIn(page, SEEDED.owner);
    await page.goto(at("/shoots/new"));

    // The page grew from a brief to five sections, and a photographer captions
    // frames on a phone at the kerbside. It must not scroll sideways.
    const overflowing = await overflowingElements(page);
    expect(overflowing, `overflows: ${overflowing.join(", ")}`).toEqual([]);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("nothing on this page offers to send anything", async ({ page }) => {
    await signIn(page, SEEDED.owner);
    await page.goto(at("/shoots/new"));

    // Scoped to the form: the shell around it links to the dispatch section,
    // which is exactly where a send is supposed to be offered.
    const form = page.locator(".create-shoot form");
    for (const forbidden of [/dispatch/i, /publish/i, /send/i, /confirm/i, /submit/i]) {
      await expect(form.getByRole("button", { name: forbidden })).toHaveCount(0);
    }
    await expect(form.getByRole("button", { name: "Create shoot" })).toBeVisible();
  });
});
