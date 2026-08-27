import { expect, test } from "@playwright/test";
import { SEEDED, signIn } from "./helpers";

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

  /**
   * The panel exists because the banner's own copy offers it. "You can accept,
   * reject, or manage these optional cookies" is a promise of a third path, and
   * a consent notice that names a control it does not have is the one claim
   * here worth failing a build over.
   */
  test("manage opens a panel that states every category", async ({ page }) => {
    await visitFrom(page, "DE");
    await page.getByTestId("consent-manage").click();

    await expect(page.getByRole("heading", { name: "Choose what to allow" })).toBeVisible();
    await expect(page.getByText("Essential", { exact: true })).toBeVisible();
    await expect(page.getByText("Always on")).toBeVisible();
    await expect(page.getByTestId("consent-toggle-analytics")).toBeVisible();
  });

  test("essential is stated rather than offered, and analytics starts off", async ({ page }) => {
    await visitFrom(page, "DE");
    await page.getByTestId("consent-manage").click();

    // Nothing pre-ticked: an unmade choice must not read as consent.
    await expect(page.getByTestId("consent-toggle-analytics")).not.toBeChecked();
    // Essential has no switch at all, so there is nothing to fail to turn off.
    await expect(page.getByTestId("consent-toggle-essential")).toHaveCount(0);
  });

  test("saving with analytics on grants it", async ({ page }) => {
    await visitFrom(page, "FR");
    await page.getByTestId("consent-manage").click();
    await page.getByTestId("consent-toggle-analytics").check();
    await page.getByTestId("consent-save").click();

    await expect(banner(page)).toBeHidden();

    const granted = await page.evaluate(() =>
      (window.dataLayer ?? []).some((entry: unknown) =>
        Array.isArray(entry) && entry[0] === "consent" && entry[1] === "update"
          ? (entry[2] as Record<string, string>).analytics_storage === "granted"
          : false,
      ),
    );
    expect(granted).toBe(true);

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "ml_consent")?.value).toBe("granted");
  });

  test("saving with analytics untouched refuses it", async ({ page }) => {
    await visitFrom(page, "FR");
    await page.getByTestId("consent-manage").click();
    await page.getByTestId("consent-save").click();

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

  /**
   * Escape goes back to the summary, and records nothing. Letting it dismiss
   * the banner would leave no stored choice while looking to the visitor like
   * one was made.
   */
  test("escape leaves the panel without deciding", async ({ page }) => {
    await visitFrom(page, "FR");
    await page.getByTestId("consent-manage").click();
    await expect(page.getByRole("heading", { name: "Choose what to allow" })).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("heading", { name: "Choose what to allow" })).toBeHidden();
    await expect(banner(page)).toBeVisible();
    await expect(page.getByTestId("consent-accept")).toBeVisible();

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "ml_consent")).toBeUndefined();
  });

  /**
   * Clarity is the reason the panel exists in the shape it does.
   *
   * It used to be fired by the Google Tag Manager container on `gtm.js` with no
   * consent settings on the tag, so a visitor in France who pressed Refuse
   * still loaded it and still had `_clck`, `_clsk`, and Microsoft's own cookies
   * written. It is loaded from the application now, behind this gate. The test
   * watches for the request rather than the cookie because the cookie is
   * Microsoft's to name and the request is the thing that must not happen.
   */
  test("clarity does not load until analytics is turned on", async ({ page }) => {
    const clarityRequests: string[] = [];
    page.on("request", (request) => {
      const host = new URL(request.url()).hostname;
      if (host.endsWith("clarity.ms")) clarityRequests.push(host);
    });

    await visitFrom(page, "FR");
    await page.getByTestId("consent-reject").click();
    await page.waitForTimeout(1_500);

    expect(clarityRequests, "Clarity loaded for a visitor who refused").toEqual([]);
    expect(await page.locator("#ms-clarity").count()).toBe(0);
  });

  test("clarity loads once analytics is turned on", async ({ page }) => {
    await visitFrom(page, "FR");
    await page.getByTestId("consent-manage").click();
    await page.getByTestId("consent-toggle-analytics").check();
    await page.getByTestId("consent-save").click();

    // The tag goes in without a navigation, because a yes that only takes
    // effect on the next page reads as the button not working.
    await expect(page.locator("#ms-clarity")).toHaveCount(1);
    await expect(page.locator("#ms-clarity")).toHaveAttribute("src", /clarity\.ms\/tag\//);
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

test.describe("the banner and the application share a viewport", () => {
  /**
   * The banner is fixed to the bottom of the viewport. The application shell
   * pins Sign out to the bottom of the viewport too, and the banner is above
   * it, so for a while the button could not be clicked at all: not a slow
   * click, an impossible one, for every visitor in the EEA, the UK, or
   * Switzerland and everyone whose country could not be resolved.
   *
   * It is asserted here rather than left to the two-factor test, where it
   * surfaced only as a three-minute timeout with no stated cause.
   *
   * A pinned control is the case that matters: anything in the page can be
   * scrolled out from under a bottom-anchored banner, and a pinned one never
   * can.
   */
  test("a pinned control is still clickable while a choice is outstanding", async ({ page }) => {
    await page.context().clearCookies();
    await page
      .context()
      .addCookies([{ name: "ml_country", value: "FR", url: "http://127.0.0.1:4100" }]);

    await signIn(page, SEEDED.owner);
    await expect(banner(page)).toBeVisible();

    // The layout reserves the banner's measured height, so the button clears it.
    const signOut = page.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();

    const covered = await signOut.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return top ? !element.contains(top) && !top.contains(element) : true;
    });
    expect(covered, "the consent banner is covering Sign out").toBe(false);

    // The trial click is the same actionability check a real click makes, and
    // it fails fast rather than hanging for the whole test budget.
    await signOut.click({ trial: true, timeout: 5_000 });
  });

  /**
   * The panel is several times the summary's height, so it is the case most
   * likely to reach back over a pinned control. The inset is measured from the
   * same element either way, which is what makes this hold.
   */
  test("the preferences panel reserves its height too", async ({ page }) => {
    await page.context().clearCookies();
    await page
      .context()
      .addCookies([{ name: "ml_country", value: "FR", url: "http://127.0.0.1:4100" }]);

    await signIn(page, SEEDED.owner);
    await page.getByTestId("consent-manage").click();
    await expect(page.getByRole("heading", { name: "Choose what to allow" })).toBeVisible();

    // The sidebar scrolls when the panel leaves it less room than its content
    // needs, so reaching the control can mean scrolling to it -- which is what
    // a real click does too. What must not happen is the panel sitting on top
    // of it once it is in view.
    const signOut = page.getByRole("button", { name: "Sign out" });
    await signOut.scrollIntoViewIfNeeded();

    const covered = await signOut.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return top ? !element.contains(top) && !top.contains(element) : true;
    });
    expect(covered, "the preferences panel is covering Sign out").toBe(false);

    await signOut.click({ trial: true, timeout: 5_000 });
  });
});
