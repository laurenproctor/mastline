import { expect, test } from "@playwright/test";
import {
  SEEDED,
  SEEDED_ASSET,
  clearDeliveryLinks,
  clearMfaFactors,
  freshTotp,
  putDeliveryFixture,
  removeDeliveryFixture,
  setWorkspaceMfaPolicy,
  SEEDED_SHOOT,
  collectPageErrors,
  hasHorizontalOverflow,
  overflowingElements,
  signIn,
} from "./helpers";

/**
 * The UI acceptance criteria from docs/ACCEPTANCE.md, checked in a browser.
 *
 * Everything here was previously "verified" by fetching HTML and stripping
 * tags, which can confirm words are present but says nothing about whether a
 * layout holds or focus is visible.
 */

test.describe("every documented route renders", () => {
  const PUBLIC_ROUTES = ["/welcome", "/pricing", "/sign-in", "/sign-up", "/reset-password"];
  const APP_ROUTES = [
    "/work",
    "/news",
    "/shoots",
    "/shoots/new",
    `/shoots/${SEEDED_SHOOT}`,
    `/dispatch/${SEEDED_SHOOT}`,
    "/submissions",
    "/money",
    "/rights",
    "/archive",
    "/settings",
  ];

  for (const route of PUBLIC_ROUTES) {
    test(`${route} loads without a console error`, async ({ page }) => {
      const errors = collectPageErrors(page);
      const response = await page.goto(route);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator("body")).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("signed in, every application route renders", async ({ page }) => {
    const errors = collectPageErrors(page);
    await signIn(page);

    for (const route of APP_ROUTES) {
      await page.goto(route);
      // The shell is the proof the page actually rendered rather than erroring.
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});

test.describe("layout holds at the required sizes", () => {
  test("public pages do not scroll sideways", async ({ page }) => {
    for (const route of ["/welcome", "/pricing", "/sign-in", "/sign-up"]) {
      await page.goto(route);
      const overflowing = await overflowingElements(page);
      expect(overflowing, `${route} overflows: ${overflowing.join(", ")}`).toEqual([]);
      expect(await hasHorizontalOverflow(page), `${route} scrolls sideways`).toBe(false);
    }
  });

  test("the work queue does not scroll sideways", async ({ page }) => {
    await signIn(page);
    await page.goto("/work");
    const overflowing = await overflowingElements(page);
    expect(overflowing, `work queue overflows: ${overflowing.join(", ")}`).toEqual([]);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("the shoot inspector does not scroll sideways", async ({ page }) => {
    await signIn(page);
    await page.goto(`/shoots/${SEEDED_SHOOT}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflowing = await overflowingElements(page);
    expect(overflowing, `shoot workspace overflows: ${overflowing.join(", ")}`).toEqual([]);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("money and archive do not scroll sideways", async ({ page }) => {
    await signIn(page);
    for (const route of ["/money", "/archive", "/settings"]) {
      await page.goto(route);
      const overflowing = await overflowingElements(page);
      expect(overflowing, `${route} overflows: ${overflowing.join(", ")}`).toEqual([]);
    }
  });
});

test.describe("navigation is reachable", () => {
  test("every primary destination is a link that works", async ({ page }) => {
    await signIn(page);
    const nav = page.getByRole("navigation", { name: "Primary" });

    for (const label of ["Work", "News radar", "Shoots", "Submissions", "Money", "Rights", "Archive"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("settings is reachable, including on a phone", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  });

  test("the active destination is marked for assistive technology", async ({ page }) => {
    await signIn(page);
    await page.goto("/money");
    await expect(page.locator('[aria-current="page"]')).toHaveText(/Money/);
  });
});

test.describe("pricing states the approved facts", () => {
  test("shows the annual prices and totals by default", async ({ page }) => {
    await page.goto("/pricing");

    await expect(page.getByRole("button", { name: /annual/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const price of ["49", "99", "279"]) {
      await expect(page.getByText(price, { exact: true }).first()).toBeVisible();
    }
    for (const total of ["$588 billed once a year", "$1,188 billed once a year", "$3,348 billed once a year"]) {
      await expect(page.getByText(total)).toBeVisible();
    }
    await expect(page.getByText("Save up to 18%")).toBeVisible();
  });

  test("the toggle changes every non-custom price and no feature", async ({ page }) => {
    await page.goto("/pricing");

    const proCard = page.locator("article").filter({ has: page.getByRole("heading", { name: "Pro" }) });
    const featuresBefore = await proCard.getByRole("listitem").allTextContents();

    await page.getByRole("button", { name: /^monthly$/i }).click();

    for (const price of ["59", "119", "339"]) {
      await expect(page.getByText(price, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Custom").first()).toBeVisible();
    await expect(page.getByText(/billed once a year/)).toHaveCount(0);

    expect(await proCard.getByRole("listitem").allTextContents()).toEqual(featuresBefore);
  });

  test("marks Pro most popular and never invents a trial duration", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("Most popular")).toHaveCount(1);

    // Scoped to the plan grid: the header and the mobile menu also offer to
    // start free, and this is a claim about what the four plans say.
    const plans = page.locator(".plans");
    await expect(plans.getByRole("link", { name: "Start free" })).toHaveCount(3);
    await expect(plans.getByRole("link", { name: "Contact Mastline" })).toHaveCount(1);

    const body = (await page.locator("body").innerText()).toLowerCase();
    const durations = [...body.matchAll(/(\d+)\s+days?\s+free/g)].map((match) => match[1]);
    expect(new Set(durations).size).toBeLessThanOrEqual(1);
  });
});

test.describe("status is never colour alone", () => {
  test("every badge carries words", async ({ page }) => {
    await signIn(page);
    for (const route of ["/work", "/money", "/submissions", "/shoots"]) {
      await page.goto(route);
      const badges = page.locator(".badge");
      const count = await badges.count();
      for (let index = 0; index < count; index += 1) {
        const text = (await badges.nth(index).innerText()).trim();
        expect(text.length, `a badge on ${route} has no text`).toBeGreaterThan(0);
      }
    }
  });

  test("a blocked dispatch check says the word, not just a colour", async ({ page }) => {
    await signIn(page);
    await page.goto(`/dispatch/${SEEDED_SHOOT}`);
    await expect(page.getByText("Blocked").first()).toBeVisible();
  });
});

test.describe("the seeded workspace shows real records", () => {
  test("the archive searches in the database and pages", async ({ page }) => {
    await signIn(page);
    await page.goto("/archive");
    await page.getByLabel(/Search the archive/i).fill("Avery Hart");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("heading", { name: /matches?$/ })).toBeVisible();
  });

  test("a malformed record id shows not found rather than an error", async ({ page }) => {
    await signIn(page);
    await page.goto("/assets/not-a-uuid");
    await expect(page.getByText(/does not exist in this workspace/i)).toBeVisible();
  });
});

test.describe("exporting the workspace", () => {
  /**
   * The settings screen promises "no vendor lock-in" and says confidential
   * source notes are excluded. Both are claims about a file nobody had ever
   * downloaded, so this checks the bytes rather than the wiring.
   */
  const EXPECTED_FILES = [
    "README.txt",
    "assets.csv",
    "asset_versions.csv",
    "caption_history.csv",
    "shoots.csv",
    "submissions.csv",
    "licenses.csv",
    "payments.csv",
    "allocations.csv",
    "activity.csv",
  ];

  test("an owner downloads the whole commercial record", async ({ page }) => {
    await signIn(page, SEEDED.owner);
    await page.goto("/settings");

    const link = page.getByRole("link", { name: "Export workspace" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/api/export");

    const response = await page.request.get("/api/export");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toContain("attachment");

    const body = await response.text();
    for (const file of EXPECTED_FILES) {
      expect(body, `${file} missing from the export`).toContain(`=== ${file} ===`);
    }

    // An export of nothing would satisfy every check above.
    expect(body).toContain("Avery Hart departs Hotel Chelsea");

    // Promised on the screen: confidential notes stay out of a bulk export.
    expect(body).not.toContain("Tip from hotel staff; do not attribute.");
    expect(body).not.toContain("Service entrance on 23rd");

    // Another workspace's record must never ride along.
    expect(body).not.toContain("Northline exclusive frame");
    expect(body).not.toContain("Northline confidential source");
  });

  test("an editor is refused, in the interface and at the route", async ({ page }) => {
    await signIn(page, SEEDED.editor);
    await page.goto("/settings");

    // The control is present but inert, so the capability is discoverable
    // without being usable.
    await expect(page.getByRole("link", { name: "Export workspace" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export workspace" })).toBeVisible();

    // The route is the boundary, not the absence of a link.
    const response = await page.request.get("/api/export");
    expect(response.status()).toBe(403);
    expect(await response.text()).toContain("cannot export");
  });
});

test.describe("editing the workspace", () => {
  const SEEDED_NAME = "Marcus Hale Studio";

  async function setWorkspaceName(page: import("@playwright/test").Page, value: string) {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Edit workspace" }).click();
    await page.getByLabel("Workspace name").fill(value);
    await page.getByRole("button", { name: "Save workspace" }).click();
  }

  test("an owner renames the workspace and it takes effect everywhere", async ({ page }) => {
    await signIn(page, SEEDED.owner);
    await page.goto("/settings");

    await page.getByRole("button", { name: "Edit workspace" }).click();
    await expect(page.getByLabel("Workspace name")).toHaveValue(SEEDED_NAME);
    await page.getByRole("button", { name: "Cancel" }).click();

    const renamed = "Hale Media Group";
    try {
      await setWorkspaceName(page, renamed);

      // A save redirects, so the confirmation arrives on a fresh render that
      // already shows the new name rather than a stale one.
      await expect(page.getByText("Workspace saved.")).toBeVisible();
      await expect(page.getByRole("heading", { level: 3, name: renamed })).toBeVisible();

      // The name lives in the shell, so a rename has to reach past this screen.
      // Attached rather than visible: the shell hides its identity block on a
      // phone, which is a layout decision this test has no business asserting.
      await page.goto("/work");
      await expect(page.getByText(renamed).first()).toBeAttached();
    } finally {
      // Leave the seeded workspace as it was found, whatever happened above.
      await setWorkspaceName(page, SEEDED_NAME);
      await expect(page.getByRole("heading", { level: 3, name: SEEDED_NAME })).toBeVisible();
    }
  });

  test("the timezone can be changed and is the one offered", async ({ page }) => {
    await signIn(page, SEEDED.owner);
    try {
      await page.goto("/settings");
      await page.getByRole("button", { name: "Edit workspace" }).click();
      await page.getByLabel("Timezone").selectOption("Europe/London");
      await page.getByRole("button", { name: "Save workspace" }).click();

      await expect(page.getByText("Workspace saved.")).toBeVisible();
      await expect(page.getByText("Europe/London").first()).toBeVisible();
    } finally {
      await page.goto("/settings");
      await page.getByRole("button", { name: "Edit workspace" }).click();
      await page.getByLabel("Timezone").selectOption("America/New_York");
      await page.getByRole("button", { name: "Save workspace" }).click();
      await expect(page.getByText("Workspace saved.")).toBeVisible();
    }
  });

  test("an empty name is refused with a sentence, not a constraint error", async ({ page }) => {
    await signIn(page, SEEDED.owner);
    await page.goto("/settings");

    await page.getByRole("button", { name: "Edit workspace" }).click();
    // Spaces defeat the required attribute, so the server-side check answers.
    await page.getByLabel("Workspace name").fill("   ");
    await page.getByRole("button", { name: "Save workspace" }).click();

    await expect(page.getByText("A workspace needs a name.")).toBeVisible();
    // A refusal does not redirect, and the real name is untouched.
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 3, name: SEEDED_NAME })).toBeVisible();
  });

  test("an editor cannot edit the workspace", async ({ page }) => {
    await signIn(page, SEEDED.editor);
    await page.goto("/settings");

    await expect(page.getByRole("button", { name: "Edit workspace" })).toHaveCount(0);
  });
});

test.describe("saving on the settings screen confirms itself", () => {
  /**
   * These actions used to call revalidatePath for the route they were invoked
   * from, which leaves the action's promise unresolved on the client: the write
   * lands and the server re-renders, but the form sits on "Saving..." for ever.
   * The buyer template hung on two of five attempts before the fix. Saving
   * twice here is deliberate -- once passed by luck often enough to hide it.
   */
  test("a buyer template saves and says so, repeatedly", async ({ page }) => {
    await signIn(page, SEEDED.owner);

    for (const attempt of [1, 2, 3]) {
      await page.goto("/settings");
      await page.getByRole("button", { name: "Edit template" }).first().click();
      // The seeded value, so the record ends as it started.
      await page.getByLabel("Desk or contact").first().fill("New York picture desk");
      await page.getByRole("button", { name: "Save", exact: true }).first().click();

      await expect(
        page.getByText("Buyer template saved."),
        `attempt ${attempt} did not confirm`,
      ).toBeVisible();
    }
  });
});

test.describe("a save is reflected on the screen that made it", () => {
  /**
   * A save has to show up on the screen that made it: caption a frame and its
   * warning badge clears, with no reload in between.
   *
   * This covers the behaviour a route-level loading.tsx used to break, but it
   * is not the guard for it -- that fault was intermittent, so this passes most
   * of the time even when it is present. The deterministic check lives in
   * tests/route-loading-boundary.test.ts, which asserts on the file tree.
   */
  const INCOMPLETE_ASSET = "a0000000-0000-0000-0000-0000000000d2";

  test("captioning a frame clears its warning without a reload", async ({ page }) => {
    await signIn(page, SEEDED.owner);
    await page.goto(`/shoots/${SEEDED_SHOOT}`);

    const warnings = page.getByRole("button", { name: /^Warnings / });
    const form = page.locator("form.inspector");
    const caption = form.getByLabel("Caption");
    await expect(warnings).toHaveText("Warnings 1");

    // End moves the sheet's focus to the last frame, which is the uncaptioned
    // one. Clicking the tile would toggle its selection instead, and the
    // warnings filter would empty out the moment the warning clears.
    await page.locator("[data-frame=true]").first().press("End");
    await expect(form.locator("input[name=assetId]")).toHaveValue(INCOMPLETE_ASSET);

    try {
      await caption.fill("A caption good enough to clear the warning.");
      await page.getByRole("button", { name: "Save metadata" }).click();
      await expect(page.getByText(/previous version is kept/)).toBeVisible();

      // The whole point: no reload between the save and this assertion.
      await expect(warnings).toHaveText("Warnings 0");
    } finally {
      // Focus has not moved, because this view lists every frame regardless of
      // its warnings. Put the frame back to its seeded, uncaptioned state.
      await expect(form.locator("input[name=assetId]")).toHaveValue(INCOMPLETE_ASSET);
      await caption.fill("");
      await page.getByRole("button", { name: "Save metadata" }).click();
      await expect(warnings).toHaveText("Warnings 1");
    }
  });
});

test.describe("the marketing site", () => {
  const MARKETING_ROUTES = [
    "/",
    "/product",
    "/how-it-works",
    "/pricing",
    "/trust",
    "/company",
    "/teams",
    "/commercial",
    "/editors",
    "/press",
    "/copyright",
    "/subjects",
    "/acceptable-use",
    "/privacy",
    "/terms",
    "/security",
    "/accessibility",
  ];

  test("every page renders, to a stranger, without a console error", async ({ page }) => {
    const errors = collectPageErrors(page);

    for (const route of MARKETING_ROUTES) {
      const response = await page.goto(route);
      expect(response?.status(), `${route} did not load`).toBeLessThan(400);
      // No session anywhere in this test: the marketing site must never send a
      // visitor who has not signed in to the sign-in screen.
      expect(page.url(), `${route} redirected`).toContain(route === "/" ? "/" : route);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      // The shared chrome is the proof the marketing layout wrapped the page.
      await expect(page.locator("header.nav")).toBeVisible();
      await expect(page.locator("footer")).toBeAttached();
    }
    expect(errors).toEqual([]);
  });

  test("no page scrolls sideways", async ({ page }) => {
    for (const route of ["/", "/pricing", "/product", "/commercial", "/press", "/terms"]) {
      await page.goto(route);
      expect(await hasHorizontalOverflow(page), `${route} scrolls sideways`).toBe(false);
      const overflowing = await overflowingElements(page);
      expect(overflowing, `${route} overflows: ${overflowing.join(", ")}`).toEqual([]);
    }
  });

  test("/welcome keeps working, and lands on the home page", async ({ page }) => {
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/$/);
  });

  test("every way in reaches real sign-up, not a mail client", async ({ page }) => {
    // The design captured this as a mailto: form. Sign-up exists and works, so
    // every "Start free" has to land on it.
    await page.goto("/");
    await page.getByRole("link", { name: "Start free" }).first().click();
    await expect(page).toHaveURL(/\/sign-up$/);
    await expect(page.getByRole("heading", { level: 1, name: "Start free" })).toBeVisible();

    // The old address still resolves rather than dead-ending.
    await page.goto("/early-access");
    await expect(page).toHaveURL(/\/sign-up$/);
  });

  test("sign in reaches the sign-in screen", async ({ page }) => {
    await page.goto("/");

    // The header keeps only the primary call to action on a phone; sign in
    // moves into the menu. Exercising both paths means this also proves the
    // burger works.
    const inHeader = page.locator(".nav .cta").getByRole("link", { name: "Sign in" });
    if (await inHeader.isVisible()) {
      await inHeader.click();
    } else {
      await page.getByRole("button", { name: /open menu/i }).click();
      await page.locator(".mobilemenu").getByRole("link", { name: "Sign in" }).click();
    }

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("no marketing link points at a mailto sign-up", async ({ page }) => {
    for (const route of ["/", "/pricing", "/product"]) {
      await page.goto(route);
      const mailtoCtas = page.locator('a[href^="mailto:"]', { hasText: /start free|sign up/i });
      await expect(mailtoCtas, `${route} still offers a mailto sign-up`).toHaveCount(0);
    }
  });

  test("the header marks where you are", async ({ page }) => {
    await page.goto("/pricing");
    const current = page.locator(".nav ul a[aria-current='page']");
    await expect(current).toHaveCount(2); // the header and the mobile menu
    await expect(current.first()).toHaveText("Pricing");
  });

  test("the archive demonstration resolves rather than staying blank", async ({ page }) => {
    // Its pitch card is hidden until a script finishes. If that never runs, a
    // whole panel of the home page is invisible and nothing says so.
    await page.goto("/");
    await page.locator("#rw").scrollIntoViewIfNeeded();
    await expect(page.locator(".rw-pitch")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#rw")).toHaveClass(/done/);
  });

  test("the split calculator divides a sale the way the product does", async ({ page }) => {
    await page.goto("/pricing");
    const range = page.locator("#pr-range");
    await range.evaluate((el: HTMLInputElement) => {
      el.value = "1000";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // 70/30, from the same module that splits a real licence.
    await expect(page.locator("#pr-you")).toHaveText("$700");
    await expect(page.locator("#pr-us")).toHaveText("$300");
  });
});

test.describe("two-factor authentication", () => {
  // Both sides: a previous interrupted run must not leak into this one, and
  // this one must not leak into anything that signs in afterwards.
  test.beforeEach(async () => clearMfaFactors(SEEDED.owner));
  test.afterEach(async () => clearMfaFactors(SEEDED.owner));

  /**
   * The whole round trip against real TOTP: enrol, sign out, sign in with the
   * password, get stopped, fail to walk around it, then get through with a code.
   *
   * It runs against the seeded owner and turns the factor back off in a finally,
   * because leaving it on would challenge every other test that signs in.
   */
  test("protects an account, and cannot be walked around", async ({ page }, testInfo) => {
    // Desktop only. A used code cannot be replayed, so this waits out two
    // 30-second windows, and what it proves -- that the challenge cannot be
    // skipped -- is the same at every width. The panel's layout at 390px is
    // covered by the layout tests.
    test.skip(testInfo.project.name !== "desktop", "viewport-independent and slow");
    test.setTimeout(180_000);

    await signIn(page, SEEDED.owner);
    await page.goto("/settings");

    await page.getByRole("button", { name: "Set up two-factor" }).click();
    const secret = (await page.locator(".mfa-secret code").innerText()).replace(/\s/g, "");
    expect(secret.length).toBeGreaterThan(15);

    let lastCode = await freshTotp(secret);
    await page.getByLabel("Code from your app").fill(lastCode);
    await page.getByRole("button", { name: "Confirm and turn on" }).click();

    // Enrolment hands over recovery codes, because that is the moment a way
    // back from a lost phone is needed.
    await expect(page.getByRole("group", { name: "Recovery codes" })).toBeVisible();
    await page.getByRole("link", { name: "I have saved them" }).click();
    await expect(page.getByRole("button", { name: "Turn off two-factor" })).toBeVisible();

    try {
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(/\/sign-in/);

      // The password alone now stops at the challenge.
      await page.getByLabel("Email").fill(SEEDED.owner);
      await page.getByLabel("Password").fill(SEEDED.password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(/\/sign-in\/verify/);

      // A second factor that could be skipped by typing an address would not be
      // one. This is the assertion the feature exists for.
      await page.goto("/work");
      await expect(page).toHaveURL(/\/sign-in\/verify/);
      await page.goto("/money");
      await expect(page).toHaveURL(/\/sign-in\/verify/);

      lastCode = await freshTotp(secret, lastCode);
      await page.getByLabel("Six-digit code").fill(lastCode);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForURL(/\/(work|money)/);
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    } finally {
      // Put the account back, whatever happened above.
      await page.goto("/settings");
      await page.getByRole("button", { name: "Turn off two-factor" }).click();
      const off = await freshTotp(secret, lastCode);
      await page.getByLabel("Current code").fill(off);
      await page.getByRole("button", { name: "Turn it off" }).click();
      await expect(page.getByText("Two-factor authentication is off.")).toBeVisible();
    }
  });

  test("a required policy stops work until a factor exists", async ({ page }) => {
    await setWorkspaceMfaPolicy(true);
    try {
      await page.goto("/sign-in");
      await page.getByLabel("Email").fill(SEEDED.owner);
      await page.getByLabel("Password").fill(SEEDED.password);
      await page.getByRole("button", { name: /sign in/i }).click();

      // The owner has no factor, so nothing behind the gate opens.
      await expect(page).toHaveURL(/secure-your-account/);
      await expect(page.getByRole("heading", { name: "Secure your account" })).toBeVisible();

      for (const route of ["/work", "/money", "/settings"]) {
        await page.goto(route);
        await expect(page, `${route} was reachable without a factor`).toHaveURL(
          /secure-your-account/,
        );
      }

      // An editor is outside the policy and works as normal. Signing out is
      // POST-only by design, so becoming a different visitor means dropping the
      // cookies rather than asking the server to do it.
      await page.context().clearCookies();
      await signIn(page, SEEDED.editor);
      await expect(page).toHaveURL(/\/work/);
    } finally {
      await setWorkspaceMfaPolicy(false);
    }
  });

  test("a recovery code gets you back in when the phone is gone", async ({ page }, testInfo) => {
    // Desktop only, for the same reason as the enrolment test: it waits out a
    // TOTP window and proves something with no layout dimension.
    test.skip(testInfo.project.name !== "desktop", "viewport-independent and slow");
    test.setTimeout(180_000);

    await signIn(page, SEEDED.owner);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Set up two-factor" }).click();
    const secret = (await page.locator(".mfa-secret code").innerText()).replace(/\s/g, "");
    await page.getByLabel("Code from your app").fill(await freshTotp(secret));
    await page.getByRole("button", { name: "Confirm and turn on" }).click();

    // The codes arrive with the factor, because that is the moment they are
    // needed later. They are shown once and never again.
    await expect(page.getByRole("group", { name: "Recovery codes" })).toBeVisible();
    const codes = await page.locator(".recovery-code-list code").allInnerTexts();
    expect(codes).toHaveLength(10);
    await page.getByRole("link", { name: "I have saved them" }).click();

    // The phone is gone: the secret is of no use, only the paper is.
    await page.context().clearCookies();
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(SEEDED.owner);
    await page.getByLabel("Password").fill(SEEDED.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/sign-in\/verify/);

    await page.getByRole("button", { name: /Lost your device/ }).click();
    await page.getByLabel("Recovery code").fill(codes[0]);
    await page.getByRole("button", { name: "Use this code" }).click();
    await page.waitForURL(/\/work/);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    // The factor came off, which is what let them in, so the account is back to
    // a password and an invitation to enrol again.
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Set up two-factor" })).toBeVisible();

    // And that code is spent.
    await page.context().clearCookies();
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(SEEDED.owner);
    await page.getByLabel("Password").fill(SEEDED.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    // No factor now, so there is no challenge at all.
    await page.waitForURL(/\/work/);
  });

  test("a wrong code changes nothing", async ({ page }) => {
    await signIn(page, SEEDED.owner);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Set up two-factor" }).click();
    await page.getByLabel("Code from your app").fill("000000");
    await page.getByRole("button", { name: "Confirm and turn on" }).click();

    await expect(page.getByText(/That code was not right/)).toBeVisible();
    // Nothing was turned on, so the account is exactly as it was.
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Set up two-factor" })).toBeVisible();
  });
});

test.describe("signing up asks for a name in two fields", () => {
  /**
   * One box forces a split later, and splitting on whitespace gets "van der
   * Berg" and "Ana Maria" wrong in opposite directions. Asking for the parts
   * means they are known rather than inferred.
   */
  test("offers first and last name, not one box", async ({ page }) => {
    await page.goto("/sign-up");

    await expect(page.getByLabel("First name")).toBeVisible();
    await expect(page.getByLabel("Last name")).toBeVisible();
    await expect(page.getByLabel("Your name")).toHaveCount(0);

    // The browser can fill these only if they say which half they are.
    await expect(page.getByLabel("First name")).toHaveAttribute("autocomplete", "given-name");
    await expect(page.getByLabel("Last name")).toHaveAttribute("autocomplete", "family-name");
  });

  test("neither part is required, so a name never blocks an account", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByLabel("First name")).not.toHaveAttribute("required", "");
    await expect(page.getByLabel("Last name")).not.toHaveAttribute("required", "");
    // Email and password still are.
    await expect(page.getByLabel("Email")).toHaveAttribute("required", "");
  });
});

test.describe("sending a package to a picture desk", () => {
  /**
   * docs/DECISIONS.md recorded the gap: "Mastline records a dispatch; it does
   * not yet transmit to a buyer's systems." This is the transmission, and the
   * point of it is that the recipient needs no account and the photographer can
   * see what they did.
   *
   * The seed creates a delivery version row without uploading any bytes, so a
   * download is correctly a 404 until the fixture stands a real file behind it.
   */
  const SEEDED_SUBMISSION = "a0000000-0000-0000-0000-00000000a001";

  test.beforeEach(async () => clearDeliveryLinks());
  test.afterEach(async () => clearDeliveryLinks());

  test("a desk with no account opens it, and the record shows what they did", async ({
    page,
    browser,
  }) => {
    const fixtureKey = await putDeliveryFixture();
    try {
      await signIn(page, SEEDED.owner);
      await page.goto(`/submissions/${SEEDED_SUBMISSION}`);

      await page.getByRole("button", { name: "Create a delivery link" }).click();
      await page.getByLabel("Recipient").fill("New York picture desk");
      await page.getByRole("button", { name: "Create the link" }).click();
      await expect(page.locator(".delivery-link-url code")).toBeVisible();

      const url = (await page.locator(".delivery-link-url code").first().innerText()).trim();
      const path = new URL(url).pathname;

      // A different browser context: no cookies, no session, nothing but the link.
      const desk = await browser.newContext();
      const deskPage = await desk.newPage();
      try {
        await deskPage.goto(path);
        await expect(deskPage.getByRole("heading", { level: 1 })).toContainText("Package");
        // No application shell: this is not the product, it is one page.
        await expect(deskPage.getByRole("navigation", { name: "Primary" })).toHaveCount(0);

        // The file follows the yes, so the terms are accepted first.
        await deskPage.getByLabel("Your name").fill("Dana Whitfield");
        await deskPage.getByRole("button", { name: "Accept these terms" }).click();
        await expect(deskPage.getByText(/Accepted by Dana Whitfield/)).toBeVisible();

        const download = deskPage.getByRole("link", { name: /Download full resolution/ }).first();
        const target = await download.getAttribute("href");
        const response = await deskPage.request.get(target ?? "");
        expect(response.status()).toBe(200);
        expect(response.headers()["content-type"]).toContain("image");
        expect((await response.body()).length).toBeGreaterThan(100);
      } finally {
        await desk.close();
      }

      // Back to the photographer: the record, which is the promise on /security.
      await page.reload();
      await expect(page.getByRole("cell", { name: "Opened" }).first()).toBeVisible();
      await expect(page.getByRole("cell", { name: /Accepted the terms/ })).toBeVisible();
      await expect(page.getByRole("cell", { name: "Downloaded a frame" })).toBeVisible();
    } finally {
      await removeDeliveryFixture(fixtureKey);
    }
  });

  test("the full file follows the yes, not the link", async ({ page, browser }) => {
    const fixtureKey = await putDeliveryFixture();
    try {
      await signIn(page, SEEDED.owner);
      await page.goto(`/submissions/${SEEDED_SUBMISSION}`);
      await page.getByRole("button", { name: "Create a delivery link" }).click();
      await page.getByLabel("Recipient").fill("New York picture desk");
      await page.getByRole("button", { name: "Create the link" }).click();
      const url = (await page.locator(".delivery-link-url code").first().innerText()).trim();
      const path = new URL(url).pathname;

      const desk = await browser.newContext();
      const deskPage = await desk.newPage();
      try {
        await deskPage.goto(path);

        // Before accepting: the frame can be judged, but not taken.
        await expect(deskPage.locator(".delivery-frame img").first()).toBeVisible();
        await expect(
          deskPage.getByRole("link", { name: /Download full resolution/ }),
        ).toHaveCount(0);

        const refused = await deskPage.request.get(`${path}/frame/${SEEDED_ASSET}`);
        expect(refused.status()).toBe(404);

        // Accepting is the hinge, and it asks who is doing it.
        await deskPage.getByLabel("Your name").fill("Dana Whitfield");
        await deskPage.getByRole("button", { name: "Accept these terms" }).click();
        await expect(deskPage.getByText(/Accepted by Dana Whitfield/)).toBeVisible();

        // After: the file is released.
        const allowed = await deskPage.request.get(`${path}/frame/${SEEDED_ASSET}`);
        expect(allowed.status()).toBe(200);
        expect(allowed.headers()["content-type"]).toContain("image");
      } finally {
        await desk.close();
      }

      // The photographer sees who said yes, and the refusal that came before it.
      await page.reload();
      await expect(page.getByText(/Dana Whitfield.*accepted on/)).toBeVisible();
      await expect(
        page.getByRole("cell", { name: /download before accepting the terms/ }),
      ).toBeVisible();

      // And the submission has reached the state it already had a name for.
      await expect(page.getByText("Acknowledged").first()).toBeVisible();
    } finally {
      await removeDeliveryFixture(fixtureKey);
    }
  });

  test("what a desk sees is marked with their own name", async ({ page, browser }) => {
    const fixtureKey = await putDeliveryFixture();
    try {
      await signIn(page, SEEDED.owner);
      await page.goto(`/submissions/${SEEDED_SUBMISSION}`);
      await page.getByRole("button", { name: "Create a delivery link" }).click();
      await page.getByLabel("Recipient").fill("O'Brien Picture Desk");
      await page.getByRole("button", { name: "Create the link" }).click();

      const url = (await page.locator(".delivery-link-url code").first().innerText()).trim();
      const path = new URL(url).pathname;

      const desk = await browser.newContext();
      const deskPage = await desk.newPage();
      try {
        await deskPage.goto(path);
        const image = deskPage.locator(".delivery-frame img").first();
        const source = await image.getAttribute("src");

        // The property that matters: the recipient is never handed a URL to the
        // stored file. Everything goes through the route that marks it.
        expect(source).toMatch(/^\/d\/[A-Za-z0-9_-]+\/preview\//);
        expect(source).not.toContain("supabase");
        expect(source).not.toContain("token=");

        const response = await deskPage.request.get(source ?? "");
        expect(response.status()).toBe(200);
        expect(response.headers()["content-type"]).toBe("image/jpeg");
        // Marking makes it bigger than the 1x1 fixture it came from, which is
        // the cheapest proof that something was actually composited.
        expect((await response.body()).length).toBeGreaterThan(300);
      } finally {
        await desk.close();
      }

      // Withdrawn: the marked preview stops being served too, not just the
      // page. Waiting for the badge first, or the request races the withdrawal.
      await page.getByRole("button", { name: "Withdraw this link" }).click();
      await expect(page.locator(".delivery-link .badge")).toHaveText("Withdrawn");

      const after = await page.request.get(`${path}/preview/${SEEDED_ASSET}`);
      expect(after.status()).toBe(404);
    } finally {
      await removeDeliveryFixture(fixtureKey);
    }
  });

  test("a withdrawn link stops opening, and the attempt is recorded", async ({ page, browser }) => {
    await signIn(page, SEEDED.owner);
    await page.goto(`/submissions/${SEEDED_SUBMISSION}`);
    await page.getByRole("button", { name: "Create a delivery link" }).click();
    await page.getByLabel("Recipient").fill("A desk that changed its mind");
    await page.getByRole("button", { name: "Create the link" }).click();

    const url = (await page.locator(".delivery-link-url code").first().innerText()).trim();
    const path = new URL(url).pathname;

    await page.getByRole("button", { name: "Withdraw this link" }).click();
    // Scoped to the link's own badge: the activity feed also says "withdrawn".
    await expect(page.locator(".delivery-link .badge")).toHaveText("Withdrawn");

    const desk = await browser.newContext();
    const deskPage = await desk.newPage();
    try {
      await deskPage.goto(path);
      await expect(deskPage.getByRole("heading", { level: 1 })).toContainText("not open");
      const withdrawnText = await deskPage.locator("main").innerText();

      // The property that matters: a withdrawn link and a token that was never
      // issued are indistinguishable. The page names both possibilities without
      // saying which, so a stranger learns nothing about a link they do not
      // hold.
      await deskPage.goto(`/d/${"q".repeat(43)}`);
      expect(await deskPage.locator("main").innerText()).toBe(withdrawnText);
    } finally {
      await desk.close();
    }

    await page.reload();
    await expect(page.getByRole("cell", { name: /Refused/ })).toBeVisible();
  });

  test("a token that was never issued reveals nothing", async ({ browser }) => {
    const desk = await browser.newContext();
    const deskPage = await desk.newPage();
    try {
      await deskPage.goto(`/d/${"z".repeat(43)}`);
      await expect(deskPage.getByRole("heading", { level: 1 })).toContainText("not open");
    } finally {
      await desk.close();
    }
  });
});

