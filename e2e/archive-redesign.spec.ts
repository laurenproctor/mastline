import { type Page, expect as baseExpect, test } from "@playwright/test";
import {
  SEEDED,
  at,
  createThrowawayWorkspace,
  focusRingIsVisible,
  localEnv,
  overflowingElements,
  purgeWorkspace,
  refuseCookies,
  signIn,
} from "./helpers";

/**
 * The redesigned archive.
 *
 * These check the things the redesign promised and the things it must not have
 * broken: that search still happens in the database with the same reach, that
 * the three commercial filters still mean what they meant, that every link
 * stays inside the workspace, that the import action stays behind the same
 * permission, and that the layout holds at the three sizes ACCEPTANCE names.
 *
 * Every project in playwright.config.ts runs this file, so the overflow and
 * keyboard checks are exercised at 1440, 1024 and 390 wide without a loop.
 */

const ARCHIVE = at("/archive");
const QUOTED_QUERY = "“Avery Hart”";

/*
 * A click here is a server round trip: the page is rendered from the database
 * on every navigation. On a quiet machine that is a fraction of a second; on a
 * loaded one it is not, and an assertion that gives up at five seconds reports
 * the load rather than the archive. Thirty seconds costs nothing when the
 * answer is right and only delays the report when it is wrong.
 */
const expect = baseExpect.configure({ timeout: 30_000 });

/**
 * Go somewhere inside the workspace, and mean it.
 *
 * On a loaded machine the local auth service can answer a session lookup with
 * a timeout, and the app then bounces the request through /sign-in and back to
 * the work queue. That is an environment failure, not an archive one, so a
 * navigation that lands anywhere but where it was sent is tried again. Every
 * assertion still has to hold once it lands.
 */
async function open(page: Page, route: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto(route);
    const landed = new URL(page.url());
    if (`${landed.pathname}${landed.search}` === route) return;
    await page.waitForTimeout(2_000);
  }
  throw new Error(`Could not reach ${route}; landed on ${page.url()}`);
}

test.beforeEach(async ({ context }) => refuseCookies(context));

test.describe("the archive", () => {
  test("renders for a valid workspace with its search as the way in", async ({ page }) => {
    await signIn(page);
    await open(page, ARCHIVE);

    await expect(page.getByRole("heading", { level: 1, name: "Archive" })).toBeVisible();
    await expect(page.getByText("Commercial memory", { exact: true })).toBeVisible();
    const search = page.getByLabel(/Search the archive/i);
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute("placeholder", "Search your archive…");
    await expect(page.getByRole("button", { name: "Search" })).toBeVisible();

    // The three commercial states, and nothing else, as persistent filters.
    const filters = page.getByRole("navigation", { name: "Commercial state" });
    await expect(filters.getByRole("link")).toHaveCount(3);
    await expect(filters.getByRole("link", { name: "All assets" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    // The rail states facts the workspace holds.
    const insights = page.getByRole("complementary", { name: "Archive insights" });
    await expect(insights.getByText("Total assets", { exact: true })).toBeVisible();
    await expect(insights.getByText("Has earned", { exact: true })).toBeVisible();
    await expect(insights.getByText("No recorded sale", { exact: true })).toBeVisible();
  });

  test("searches in the database with the reach it had", async ({ page }) => {
    await signIn(page);
    await open(page, ARCHIVE);

    // By a named subject, as before.
    await page.getByLabel(/Search the archive/i).fill("Avery Hart");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/[?&]q=Avery\+Hart/);
    await expect(page.getByRole("heading", { name: /\bmatch(es)?$/ })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Avery Hart departs Hotel Chelsea" }).first(),
    ).toBeVisible();

    // By a place, which the search document also carries.
    await page.getByLabel(/Search the archive/i).fill("Mercer");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("link", { name: /Street style outside the Mercer/ })).toBeVisible();
  });

  test("the commercial filters keep their meaning", async ({ page }) => {
    await signIn(page);
    await open(page, ARCHIVE);
    const filters = page.getByRole("navigation", { name: "Commercial state" });

    await filters.getByRole("link", { name: "Has earned" }).click();
    await expect(page).toHaveURL(/[?&]filter=earning/);
    await expect(filters.getByRole("link", { name: "Has earned" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    const earningCards = page.locator("article[data-commercial]");
    expect(await earningCards.count()).toBeGreaterThan(0);
    for (const kind of await earningCards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-commercial")),
    )) {
      expect(kind).toBe("earned");
    }

    await filters.getByRole("link", { name: "No recorded sale" }).click();
    await expect(page).toHaveURL(/[?&]filter=unsold/);
    const unsoldCards = page.locator("article[data-commercial]");
    expect(await unsoldCards.count()).toBeGreaterThan(0);
    for (const kind of await unsoldCards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-commercial")),
    )) {
      expect(kind).not.toBe("earned");
    }

    await filters.getByRole("link", { name: "All assets" }).click();
    await expect(page).not.toHaveURL(/filter=/);
    await expect(filters.getByRole("link", { name: "All assets" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("every asset link stays inside the workspace", async ({ page }) => {
    await signIn(page);
    await open(page, ARCHIVE);
    const hrefs = await page
      .locator("article[data-commercial] h3 a")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(new RegExp(`^${at("/assets/")}[0-9a-f-]{36}$`));
    }
  });

  test("import a shoot keeps its route, and stays behind its permission", async ({ page }) => {
    await signIn(page);
    await open(page, ARCHIVE);
    await expect(page.getByRole("link", { name: "Import a shoot" })).toHaveAttribute(
      "href",
      at("/shoots/new"),
    );

    // A viewer may not write a shoot, so is not offered the button that would fail.
    await page.context().clearCookies();
    await refuseCookies(page.context());
    await signIn(page, SEEDED.viewer);
    await open(page, ARCHIVE);
    await expect(page.getByRole("heading", { level: 1, name: "Archive" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Import a shoot" })).toHaveCount(0);
  });

  test("active constraints are shown as chips that can be removed one at a time", async ({
    page,
  }) => {
    await signIn(page);
    await open(page, `${ARCHIVE}?q=Avery+Hart&filter=earning`);

    const chips = page.getByRole("group", { name: "Active filters" });
    await expect(chips.getByText(QUOTED_QUERY)).toBeVisible();
    await expect(chips.getByText("Has earned")).toBeVisible();
    await expect(page.getByRole("heading", { name: /\bmatch(es)?$/ })).toBeVisible();

    // Drop just the filter: the query survives.
    await chips.getByRole("link", { name: "Remove Has earned" }).click();
    await expect(page).toHaveURL(/[?&]q=Avery\+Hart/);
    await expect(page).not.toHaveURL(/filter=/);
    await expect(chips.getByText("Has earned")).toHaveCount(0);
    await expect(page.getByLabel(/Search the archive/i)).toHaveValue("Avery Hart");

    // Drop the query too: nothing narrows the results and the row goes away.
    await chips.getByRole("link", { name: `Remove ${QUOTED_QUERY}` }).click();
    await expect(page).toHaveURL(new RegExp(`${ARCHIVE}$`));
    await expect(page.getByRole("group", { name: "Active filters" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /assets?$/ })).toBeVisible();
  });

  test("clear all drops every constraint at once", async ({ page }) => {
    await signIn(page);
    await open(page, `${ARCHIVE}?q=Avery+Hart&filter=earning`);
    await page.getByRole("link", { name: "Clear all" }).click();
    await expect(page).toHaveURL(new RegExp(`${ARCHIVE}$`));
    await expect(page.getByRole("group", { name: "Active filters" })).toHaveCount(0);
  });

  test("results are ordered newest capture first, and say so", async ({ page }) => {
    await signIn(page);
    await open(page, ARCHIVE);
    await expect(page.getByText(/Sort:\s*Newest captured/)).toBeVisible();

    const captured = await page
      .locator("article[data-commercial] time")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("datetime") ?? ""));
    expect(captured.length).toBeGreaterThan(1);
    for (let i = 1; i < captured.length; i += 1) {
      expect(Date.parse(captured[i])).toBeLessThanOrEqual(Date.parse(captured[i - 1]));
    }
  });

  test("the list view shows the same records as a table", async ({ page }) => {
    await signIn(page);
    await open(page, ARCHIVE);
    const gridTitles = await page
      .locator("article[data-commercial] h3 a")
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()));

    await page.getByRole("link", { name: "List view" }).click();
    await expect(page).toHaveURL(/[?&]view=list/);
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Earned" })).toBeVisible();
    const listTitles = await table
      .locator("tbody a")
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()));
    expect(listTitles).toEqual(gridTitles);
  });

  test("zero results say so without pretending the archive is empty", async ({ page }) => {
    await signIn(page);
    await open(page, `${ARCHIVE}?q=zeppelin&filter=earning`);

    await expect(page.getByRole("heading", { name: "Nothing matches" })).toBeVisible();
    await expect(page.getByText("The photographs are still here")).toBeVisible();
    await expect(page.getByRole("heading", { name: "0 matches" })).toBeVisible();
    // The rail still reports the archive the search did not find anything in.
    await expect(page.getByRole("complementary", { name: "Archive insights" })).toBeVisible();

    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/[?&]q=zeppelin/);
    await expect(page).not.toHaveURL(/filter=/);
    await page.getByRole("link", { name: "Clear search" }).click();
    await expect(page).toHaveURL(new RegExp(`${ARCHIVE}$`));
    expect(await page.locator("article[data-commercial]").count()).toBeGreaterThan(0);
  });

  test(
    "does not scroll sideways, before or after a search",
    { tag: "@responsive" },
    async ({ page }) => {
      await signIn(page);
      for (const route of [
        ARCHIVE,
        `${ARCHIVE}?q=Avery+Hart&filter=earning`,
        `${ARCHIVE}?view=list`,
      ]) {
        await open(page, route);
        await expect(page.getByRole("heading", { level: 1, name: "Archive" })).toBeVisible();
        const overflowing = await overflowingElements(page);
        expect(overflowing, `${route} overflows: ${overflowing.join(", ")}`).toEqual([]);
      }
    },
  );

  test(
    "search and filters work from the keyboard, with focus visible",
    { tag: "@responsive" },
    async ({ page, isMobile }) => {
      test.skip(Boolean(isMobile), "Keyboard focus is a desktop and tablet concern.");
      await signIn(page);
      await open(page, ARCHIVE);

      // "/" puts the cursor in the field from anywhere.
      await page.locator("body").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("/");
      await expect(page.getByLabel(/Search the archive/i)).toBeFocused();
      expect(await focusRingIsVisible(page)).toBe(true);
      await page.keyboard.type("Avery Hart");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/[?&]q=Avery\+Hart/);

      // Tab to a commercial filter and activate it.
      const filter = page.getByRole("link", { name: "Has earned" }).first();
      await filter.focus();
      expect(await focusRingIsVisible(page)).toBe(true);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/[?&]filter=earning/);

      // A card is one stop in the tab order, and shows where it is.
      const card = page.locator("article[data-commercial] h3 a").first();
      await card.focus();
      await expect(card).toBeFocused();
    },
  );

  test("renders no private storage key or delivery token", async ({ page }) => {
    await signIn(page);
    await open(page, ARCHIVE);
    const html = await page.content();
    // Originals are never referenced from the archive; previews, when present,
    // are signed derivative links minted for this page only.
    expect(html).not.toMatch(/\/originals\//);
    expect(html).not.toMatch(/\/d\/[A-Za-z0-9_-]{16,}/);
    expect(html).not.toMatch(/service_role/);
    // Read the key the way the helpers do: on a runner it lives only in
    // .env.local. The single-space fallback matched every page ever rendered.
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
    expect(serviceKey, "the service key must be known, or this test checks nothing").toBeTruthy();
    expect(html).not.toContain(serviceKey as string);
  });
});

test.describe("an empty archive", () => {
  let workspace: { id: string; slug: string } | undefined;

  test.beforeAll(async () => {
    workspace = await createThrowawayWorkspace(SEEDED.owner, "empty-archive");
  });

  test.afterAll(async () => {
    if (workspace) await purgeWorkspace(workspace.id);
  });

  test(
    "says there are no photographs, and offers the import",
    { tag: "@responsive" },
    async ({ page }) => {
      if (!workspace) throw new Error("No throwaway workspace.");
      await signIn(page, SEEDED.owner, workspace.slug);
      await open(page, at("/archive", workspace.slug));

      await expect(page.getByRole("heading", { name: "No photographs yet" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Import a shoot" }).first()).toHaveAttribute(
        "href",
        at("/shoots/new", workspace.slug),
      );
      // Nothing to search or count yet, so neither control is drawn.
      await expect(page.getByLabel(/Search the archive/i)).toHaveCount(0);
      await expect(page.getByRole("complementary", { name: "Archive insights" })).toHaveCount(0);
      expect(await overflowingElements(page)).toEqual([]);
    },
  );
});
