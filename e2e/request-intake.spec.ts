import { expect, test } from "@playwright/test";
import {
  collectPageErrors,
  hasHorizontalOverflow,
  overflowingElements,
  putIntakeLinkFixture,
  removeIntakeLinkFixture,
} from "./helpers";

/**
 * A picture desk submitting a request from a phone.
 *
 * The whole point of an intake link is that the recipient has no account and no
 * software, so this runs with no session at all -- nothing here signs in, and
 * anything that required a session would be a bug rather than a setup step.
 */
test.describe("public request intake", () => {
  let fixture: { id: string; token: string };

  test.beforeEach(async () => {
    fixture = await putIntakeLinkFixture();
  });

  test.afterEach(async () => {
    await removeIntakeLinkFixture(fixture.id);
  });

  test("a desk fills the form in and gets a truthful confirmation", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(`/r/${fixture.token}`);

    // Who it is for, and who it was prepared for.
    await expect(page.getByRole("heading", { name: "Send a request" })).toBeVisible();
    await expect(page.getByText("Northstar Picture Desk").first()).toBeVisible();

    // The forwarding admission is on the page before anything is typed.
    await expect(page.getByText(/If this was forwarded to you/i)).toBeVisible();

    await page.getByLabel(/^Title/).fill("Departure from last night");
    await page.getByLabel(/What you need/).fill("Anything from the side door, wide and tight.");
    await page.getByLabel(/Your name/).fill("Sam on the desk");
    await page.getByRole("button", { name: /Send this request/i }).click();

    // The confirmation says a request exists and refuses to promise more.
    await expect(page.getByRole("heading", { name: /Your request is in/i })).toBeVisible();
    await expect(page.getByText(/REQ-/)).toBeVisible();
    await expect(page.getByText(/not a commitment to cover it/i)).toBeVisible();

    // And the form is gone: one link, one request.
    await expect(page.getByRole("button", { name: /Send this request/i })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("fits a phone without sideways scrolling", async ({ page }) => {
    await page.goto(`/r/${fixture.token}`);
    await expect(page.getByRole("heading", { name: "Send a request" })).toBeVisible();

    expect(await hasHorizontalOverflow(page), (await overflowingElements(page)).join(", ")).toBe(
      false,
    );

    // A control a thumb can hit, and a font size that does not make iOS Safari
    // zoom the viewport the moment the field is focused.
    const title = page.getByLabel(/^Title/);
    const box = await title.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);
    const fontSize = await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);

    const submit = page.getByRole("button", { name: /Send this request/i });
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("can be completed with the keyboard alone", async ({ page, browserName }) => {
    /*
     * Desktop only, and not because the form differs. WebKit follows the macOS
     * "Full Keyboard Access" setting, which is off by default, so Tab there
     * visits text fields and skips buttons and checkboxes. That is the
     * platform's behaviour and not something this page can or should override;
     * asserting it here would test the browser preference rather than the form.
     */
    test.skip(browserName === "webkit", "Tab order is a system preference in WebKit");

    await page.goto(`/r/${fixture.token}`);
    await page.getByLabel(/^Title/).focus();
    await page.keyboard.type("Departure from last night");
    // Every control between the title and the button is reachable by tabbing;
    // if any were not, this would never arrive.
    // Generous, because a datetime-local is several tab stops on its own.
    for (let hop = 0; hop < 120; hop += 1) {
      const onSubmit = await page.evaluate(
        () => document.activeElement?.getAttribute("type") === "submit",
      );
      if (onSubmit) break;
      await page.keyboard.press("Tab");
    }
    expect(await page.evaluate(() => document.activeElement?.getAttribute("type"))).toBe("submit");
  });

  test("says nothing useful about a link that is not open", async ({ page }) => {
    await page.goto("/r/thistokenneverexistedatallandispadded00");
    await expect(page.getByRole("heading", { name: /This link is not open/i })).toBeVisible();

    // Nothing about the workspace, the buyer, or whether the token ever existed.
    const body = (await page.textContent("body")) ?? "";
    expect(body).not.toContain("Northstar");
    expect(body).not.toContain("Marcus Hale Studio");
    expect(body).not.toMatch(/expired|revoked|withdrawn by/i);
  });

  test("exposes nothing of the workspace to a stranger", async ({ page }) => {
    await page.goto(`/r/${fixture.token}`);
    const body = (await page.textContent("body")) ?? "";
    for (const secret of ["Northline", "service_role", "eyJ", "supabase.co", "MH_0819"]) {
      expect(body, `leaked ${secret}`).not.toContain(secret);
    }
  });
});
