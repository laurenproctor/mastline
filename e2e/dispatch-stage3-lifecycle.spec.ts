import { expect, test } from "@playwright/test";
import {
  SEEDED,
  SEEDED_SHOOT,
  SEEDED_WORKSPACE,
  at,
  clearDeliveryLinks,
  createApprovablePackageWithFiles,
  hasHorizontalOverflow,
  purgeApprovedShoot,
  refuseCookies,
  signIn,
} from "./helpers";

/**
 * The dispatch screen after two changes landed together: the Stage 3 route
 * tabs, and a lifecycle strip that is read from the record instead of fixed
 * at "Review & approve". Each has its own suite; this one proves they hold
 * at the same time, on the same page, at every width.
 */
const SEEDED_PACKAGE_01 = "a0000000-0000-0000-0000-0000000000f1";
const SEEDED_PACKAGE_02 = "a0000000-0000-0000-0000-0000000000f2";

test.describe("Stage 3 tabs and the factual lifecycle, together", () => {
  test.beforeEach(async ({ context }) => refuseCookies(context));

  test("the route tabs and the lifecycle strip render side by side, and moving tabs keeps the workspace", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(at(`/dispatch/${SEEDED_SHOOT}`));

    // One h1, and it is the review.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: "Package review" })).toBeVisible();

    // Stage 3: the tabs are a navigation landmark of links, marked once.
    const tabs = page.getByRole("navigation", { name: "Packages on this shoot" });
    await expect(tabs).toBeVisible();
    await expect(tabs).toHaveClass(/\bml-tabs\b/);
    const links = tabs.getByRole("link");
    expect(await links.count()).toBe(2);
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(tabs.locator('[aria-selected], [role="tab"], [role="tablist"]')).toHaveCount(0);

    // No legacy package-tab styling came back with the merge: every tab is
    // the design-system link and nothing else.
    for (const link of await links.all()) {
      expect((await link.getAttribute("class")) ?? "").toBe("ml-tab");
    }
    expect(await page.locator('[class*="packageTabOn"]').count()).toBe(0);

    // The current tab is drawn as current, not merely marked.
    const drawn = await tabs.evaluate((nav) =>
      Array.from(nav.querySelectorAll("a")).map((el) => ({
        current: el.getAttribute("aria-current"),
        color: getComputedStyle(el).color,
        underline: Number(getComputedStyle(el, "::after").opacity),
      })),
    );
    const current = drawn.filter((tab) => tab.current === "page");
    const others = drawn.filter((tab) => tab.current === null);
    expect(current).toHaveLength(1);
    expect(others).toHaveLength(1);
    expect(current[0].underline).toBe(1);
    expect(others[0].underline).toBe(0);
    expect(current[0].color).not.toBe(others[0].color);

    // The factual lifecycle, beside the tabs. With no package named the page
    // reviews the one that still needs work: Package 02, which is under review.
    const stages = page.getByRole("list", { name: "Package lifecycle" });
    await expect(stages).toBeVisible();
    await expect(stages.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(stages.locator('[aria-current="step"]')).toContainText("Review & approve");
    await expect(tabs.locator('[aria-current="page"]')).toContainText("Package 02");

    // Follow the other tab: the mark moves, the URL names that package inside
    // the canonical workspace, and the strip re-reads the record -- Package 01
    // was opened by a recipient, so it is past the link stage.
    await tabs.getByRole("link", { name: /Package 01/ }).click();
    await page.waitForURL(/\/dispatch\/.*package=/);
    const url = new URL(page.url());
    expect(url.pathname).toBe(`/${SEEDED_WORKSPACE}/dispatch/${SEEDED_SHOOT}`);
    expect(url.searchParams.get("package")).toBe(SEEDED_PACKAGE_01);
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(tabs.locator('[aria-current="page"]')).toContainText("Package 01");
    await expect(stages.locator('[aria-current="step"]')).toHaveText(/Shared \/ awaiting outcome/);
    await expect(page.getByText("A recipient has opened a link to this package")).toBeVisible();
    // ...and it does not say the package was sent by Mastline.
    await expect(page.getByText(/This package has been sent/)).toHaveCount(0);

    // Back to the package under review by tab, not by typing a URL.
    await tabs.getByRole("link", { name: /Package 02/ }).click();
    await page.waitForURL(new RegExp(`package=${SEEDED_PACKAGE_02}`));
    await expect(stages.locator('[aria-current="step"]')).toContainText("Review & approve");

    // Nothing scrolls sideways at this width.
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("an approved package says create a link, then that a link exists and was not shared", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const label = `STAGE3${testInfo.project.name}`;
    const recipient = `Stage 3 desk ${testInfo.project.name} ${Date.now()}`;
    const fixture = await createApprovablePackageWithFiles(label);
    await clearDeliveryLinks();

    try {
      await signIn(page);
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}`));
      const stages = page.getByRole("list", { name: "Package lifecycle" });
      await expect(stages.locator('[aria-current="step"]')).toContainText("Review & approve");

      await page.getByRole("button", { name: "Approve package" }).click();
      await page.getByRole("button", { name: "Yes, approve this package" }).click();
      await page.waitForURL(/\/submissions\//);
      const submissionId = page.url().split("/submissions/")[1].split(/[?#]/)[0];

      // Approved is not sent: the next stage is a link, and none exists.
      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}`));
      await expect(stages.locator('[aria-current="step"]')).toContainText("Create recipient link");
      await expect(page.locator("[data-lifecycle-detail]")).toHaveText(
        "Approved and frozen. No recipient link has been created yet.",
      );
      await expect(page.getByText(/Nothing has been sent/)).toBeVisible();
      await expect(page.getByText(/has been sent to/)).toHaveCount(0);
      expect(await hasHorizontalOverflow(page)).toBe(false);

      // A link is made and not shared. The strip stays at the link stage and
      // says a link exists; it does not say the package left.
      await page.goto(at(`/submissions/${submissionId}`));
      await page.getByRole("button", { name: "Create a delivery link" }).click();
      const createForm = page.locator("form.delivery-create-form");
      await createForm.getByLabel("Recipient", { exact: true }).fill(recipient);
      await createForm.getByRole("button", { name: "Create the link" }).click();
      const link = page.locator(".delivery-link").filter({ hasText: recipient });
      const url = (await link.locator(".delivery-link-url code").innerText()).trim();
      const token = new URL(url).pathname.split("/d/")[1];

      await page.goto(at(`/dispatch/${fixture.shootId}?package=${fixture.packageId}`));
      await expect(stages.locator('[aria-current="step"]')).toContainText("Create recipient link");
      await expect(page.locator("[data-lifecycle-detail]")).toHaveText(
        "A recipient link exists and has not been marked as shared. Nothing has left Mastline.",
      );
      await expect(
        page.getByText(/is marked shared|has been sent to|This package has been sent/),
      ).toHaveCount(0);

      // The authenticated screen carries neither the token nor an object key.
      const html = await page.content();
      expect(html).not.toContain(token);
      for (const key of fixture.objectKeys) expect(html).not.toContain(key);
      expect(await hasHorizontalOverflow(page)).toBe(false);
    } finally {
      await clearDeliveryLinks();
      await purgeApprovedShoot(fixture.shootId, fixture.objectKeys).catch(() => undefined);
    }
  });

  test("a viewer sees the tabs and the lifecycle, and no way to change anything", async ({
    page,
  }) => {
    await signIn(page, SEEDED.viewer);
    await page.goto(at(`/dispatch/${SEEDED_SHOOT}`));

    const tabs = page.getByRole("navigation", { name: "Packages on this shoot" });
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(
      page.getByRole("list", { name: "Package lifecycle" }).locator('[aria-current="step"]'),
    ).toHaveCount(1);

    // No write action for a viewer: not the approval, not the package form,
    // not a frame fix. The role is told why in words.
    await expect(page.getByRole("button", { name: "Approve package" })).toHaveCount(0);
    await expect(page.getByText("Edit package details")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Fix/ })).toHaveCount(0);
    await expect(page.getByText("Approval needs a dispatcher")).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
