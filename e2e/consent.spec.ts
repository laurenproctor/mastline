import { expect, test } from "@playwright/test";

/**
 * The consent banner, which nothing that only reads HTML can check.
 *
 * It is client-rendered, it decides from a cookie the edge sets, and what it
 * does on a click is push onto dataLayer. All three only exist in a browser.
 *
 * The country cookie is set directly rather than by sending the geo header,
 * because next start is not Vercel and never sets it -- the header path is
 * covered by the middleware's own behaviour, and what matters here is what the
 * banner does once the cookie exists.
 */

async function visitFrom(
  page: import("@playwright/test").Page,
  country: string,
  path = "/pricing",
) {
  await page
    .context()
    .addCookies([{ name: "ml_country", value: country, url: "http://127.0.0.1:4100" }]);
  await page.goto(path);
}

const banner = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: /cookies and measurement/i });

test.describe("consent banner", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test("asks a visitor in the EEA", async ({ page }) => {
    await visitFrom(page, "FR");
    await expect(banner(page)).toBeVisible();
  });

  test("asks a visitor in the UK", async ({ page }) => {
    await visitFrom(page, "GB");
    await expect(banner(page)).toBeVisible();
  });

  test("leaves a visitor outside those regions alone", async ({ page }) => {
    await visitFrom(page, "US");
    await expect(banner(page)).toBeHidden();
  });

  test("offers refusing exactly as prominently as accepting", async ({ page }) => {
    await visitFrom(page, "DE");

    const refuse = await page.getByTestId("consent-reject").boundingBox();
    const accept = await page.getByTestId("consent-accept").boundingBox();

    expect(refuse).not.toBeNull();
    expect(accept).not.toBeNull();
    // Same height and within a few pixels of the same width: neither choice is
    // made easier to reach than the other.
    expect(Math.abs(refuse!.height - accept!.height)).toBeLessThan(2);
    expect(Math.abs(refuse!.width - accept!.width)).toBeLessThan(12);
  });

  test("reports acceptance to the tag and remembers it", async ({ page }) => {
    await visitFrom(page, "FR");
    await page.getByTestId("consent-accept").click();

    await expect(banner(page)).toBeHidden();

    const update = await page.evaluate(() =>
      (window.dataLayer ?? []).some((entry: unknown) =>
        Array.isArray(entry) && entry[0] === "consent" && entry[1] === "update"
          ? (entry[2] as Record<string, string>).analytics_storage === "granted"
          : false,
      ),
    );
    expect(update).toBe(true);

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "ml_consent")?.value).toBe("granted");

    // The choice survives a reload, and is not asked again.
    await page.reload();
    await expect(banner(page)).toBeHidden();
  });

  test("reports refusal, and does not ask again", async ({ page }) => {
    await visitFrom(page, "FR");
    await page.getByTestId("consent-reject").click();

    const denied = await page.evaluate(() =>
      (window.dataLayer ?? []).some((entry: unknown) =>
        Array.isArray(entry) && entry[0] === "consent" && entry[1] === "update"
          ? (entry[2] as Record<string, string>).analytics_storage === "denied"
          : false,
      ),
    );
    expect(denied).toBe(true);

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "ml_consent")?.value).toBe("denied");

    await page.reload();
    await expect(banner(page)).toBeHidden();
  });

  test("can be reopened from the footer, so a choice can be withdrawn", async ({ page }) => {
    await visitFrom(page, "FR");
    await page.getByTestId("consent-accept").click();
    await expect(banner(page)).toBeHidden();

    await page.getByRole("button", { name: /cookie choices/i }).click();
    await expect(banner(page)).toBeVisible();
  });
});
