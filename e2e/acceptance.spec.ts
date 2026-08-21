import { expect, test } from "@playwright/test";
import {
  SEEDED,
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
  const PUBLIC_ROUTES = ["/welcome", "/pricing", "/login", "/signup", "/reset-password"];
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
    for (const route of ["/welcome", "/pricing", "/login", "/signup"]) {
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
    await expect(page.getByRole("button", { name: "Start free" })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Talk to us" })).toHaveCount(1);

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
