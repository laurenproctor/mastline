import { expect, test, type Page } from "@playwright/test";
import {
  SEEDED,
  SEEDED_ASSET,
  SEEDED_SHOOT,
  SEEDED_WORKSPACE,
  at,
  collectPageErrors,
  createThrowawayWorkspace,
  deletePackage,
  deleteShoot,
  purgeWorkspace,
  refuseCookies,
  shootIdByTitle,
  signIn,
  type ThrowawayWorkspace,
} from "./helpers";
import { MARKETING_ROUTES } from "../src/lib/routes";
import { isPublicPath } from "../src/lib/workspace-routes";

/**
 * The URL decides which workspace a page reads from and writes to.
 *
 * Two failures are covered here, and they are the same mistake seen from two
 * sides.
 *
 * The first: building a package redirected to /<workspace>/dispatch/<packageId>
 * while the route is /<workspace>/dispatch/<shootId>. A package id read as a
 * shoot id finds no shoot, so the screen that the entire select-caption-package
 * sequence leads to answered 404. Nothing failed loudly; the flow just ended in
 * the wrong place.
 *
 * The second: internal links were written unscoped -- "/money", `/shoots/${id}`
 * -- and reached a workspace only because the middleware resolved them from the
 * active-workspace cookie. A cookie is one value for the whole browser, so with
 * two workspaces open in two tabs, a link on a page showing one of them could
 * lead into the other. That is the case a person clicking through by hand never
 * reproduces, which is why it is tested with two real tabs.
 */

/** The seeded submission, from supabase/seed.sql. */
const SEEDED_SUBMISSION = "a0000000-0000-0000-0000-00000000a001";

/** A package name goes into a RegExp; a stray character in it must not. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The package a test just built, so the workspace is left as it was found. */
let built: string | null = null;

/*
 * The banner is answered before anything is clicked. On a phone it covers the
 * foot of the page, which is exactly where "Build package" sits.
 */
test.beforeEach(async ({ page }) => {
  await refuseCookies(page.context());
});

test.afterEach(async () => {
  if (!built) return;
  const packageId = built;
  built = null;
  await deletePackage(packageId);
});

test.describe("building a package lands on the dispatch review", () => {
  test("the redirect names the shoot and carries the package as a query", async ({ page }) => {
    const errors = collectPageErrors(page);
    await signIn(page);

    await page.goto(at(`/shoots/${SEEDED_SHOOT}`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // The shoot is seeded with selected, active frames, so the form is offered.
    await page.getByRole("button", { name: "Build package" }).click();
    const name = `Routing check ${Date.now()}`;
    await page.getByLabel("Package name").fill(name);
    await page.getByRole("button", { name: "Build and review" }).click();

    // The whole defect, stated as a URL. It used to be
    // /<workspace>/dispatch/<packageId>, which is a 404.
    await page.waitForURL(/\/dispatch\//, { timeout: 20_000 });
    const url = new URL(page.url());

    // 1. The workspace is in the address.
    expect(url.pathname.startsWith(`/${SEEDED_WORKSPACE}/`), url.pathname).toBe(true);

    // 2. The dynamic segment is the SHOOT.
    expect(url.pathname).toBe(`/${SEEDED_WORKSPACE}/dispatch/${SEEDED_SHOOT}`);

    // 3. The new package rides in the query, which is what the page reads.
    const packageId = url.searchParams.get("package");
    expect(packageId, "no ?package= on the dispatch URL").toBeTruthy();
    built = packageId;
    expect(packageId).not.toBe(SEEDED_SHOOT);

    // 4. The review screen rendered, rather than the not-found page.
    await expect(page.getByRole("heading", { level: 1, name: "Dispatch review" })).toBeVisible();
    await expect(page.getByText(/does not exist in this workspace/i)).toHaveCount(0);

    /*
     * 5. And it is reviewing the package that was just built, not some other
     *    package on the same shoot. The seed already puts two there, and the
     *    page falls back to "the first one that still needs work" when no
     *    package is named -- so without this the 404 fix could be declared
     *    working by a screen showing the wrong package.
     */
    await expect(page.locator(".page-header")).toContainText(name);
    const tabs = page.getByRole("navigation", { name: "Packages on this shoot" });
    await expect(tabs.getByRole("link", { name: new RegExp(escapeRegExp(name)) })).toHaveAttribute(
      "aria-current",
      "page",
    );

    expect(errors).toEqual([]);
  });

  test("reloading the dispatch URL still shows the same package", async ({ page }) => {
    await signIn(page);
    await page.goto(at(`/shoots/${SEEDED_SHOOT}`));

    await page.getByRole("button", { name: "Build package" }).click();
    const name = `Reload check ${Date.now()}`;
    await page.getByLabel("Package name").fill(name);
    await page.getByRole("button", { name: "Build and review" }).click();
    await page.waitForURL(/\/dispatch\//, { timeout: 20_000 });

    built = new URL(page.url()).searchParams.get("package");

    // A destination that only works once is not a destination. This is what a
    // pasted link, a bookmark, or a back button does.
    const response = await page.reload();
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1, name: "Dispatch review" })).toBeVisible();
    await expect(page.locator(".page-header")).toContainText(name);
  });
});

/**
 * Two workspaces, two tabs, one browser.
 *
 * The seed gives every account exactly one workspace, so this makes a second
 * one through the real creation path and takes it away afterwards. That is
 * deliberate: adding a membership to a seeded organization would leak into the
 * tenancy tests if a run were interrupted.
 */
test.describe("two workspaces open at once", () => {
  let second: ThrowawayWorkspace;

  test.beforeAll(async () => {
    second = await createThrowawayWorkspace(SEEDED.owner);
  });

  test.afterAll(async () => {
    if (second) await purgeWorkspace(second.id);
  });

  /** Every href on the page that points at this site, as pathnames. */
  async function internalPaths(page: Page): Promise<string[]> {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
        .map((anchor) => anchor.getAttribute("href") ?? "")
        .filter((href) => href.startsWith("/")),
    );
  }

  /**
   * Which links on a screen belong to the application rather than to the public
   * surface.
   *
   * The classification comes from src/lib/routes.ts rather than from a list
   * written here, so this cannot quietly disagree with what the middleware
   * believes. A delivery link, sign-out, the export endpoint and the consent
   * banner's link to the privacy notice are all correct without a workspace and
   * are not failures -- and the privacy notice is exactly the one this would
   * have got wrong if the list had been written by hand, because the banner
   * renders inside the application shell.
   */
  function applicationLinks(paths: readonly string[]): string[] {
    return paths.filter((path) => {
      const bare = path.split(/[?#]/)[0];
      if (bare === "" || bare === "/") return false;
      if (isPublicPath(bare)) return false;
      return !MARKETING_ROUTES.includes(bare);
    });
  }

  test("every link on a page in workspace A stays in workspace A", async ({ browser }) => {
    const context = await browser.newContext();
    await refuseCookies(context);
    const tabA = await context.newPage();
    const tabB = await context.newPage();

    try {
      await signIn(tabA, SEEDED.owner, SEEDED_WORKSPACE);

      /*
       * Tab B switches workspaces, which is what sets the hint cookie. The
       * cookie is shared by the whole context -- that is the entire problem --
       * so from this point on it points at the second workspace while tab A is
       * still showing the first.
       */
      await tabB.goto(at("/work"));
      await tabB.getByLabel("Workspace").selectOption({ label: "Second Desk" });
      await tabB.getByRole("button", { name: "Switch" }).click();
      await tabB.waitForURL(`**${at("/work", second.slug)}`, { timeout: 20_000 });

      /*
       * What matters is that tab B is now showing the second workspace, which
       * the waitForURL above has established. The hint cookie is recorded
       * rather than asserted: it is httpOnly and Secure, so whether the browser
       * stores it at all depends on the origin the tests happen to run against
       * -- and asserting it would contradict the very thing this test exists to
       * prove, which is that nothing downstream depends on its value.
       */
      const hint = (await context.cookies()).find((cookie) => cookie.name === "mastline-workspace");
      test.info().annotations.push({
        type: "workspace hint cookie",
        description: hint?.value ?? "not stored by this browser",
      });

      /*
       * Back to tab A, and walk the screens the photographer actually uses --
       * including the two record screens, which are where the cross-links
       * between shoot, asset, submission and money all live.
       */
      const screens = [
        at("/work"),
        at(`/shoots/${SEEDED_SHOOT}`),
        at(`/assets/${SEEDED_ASSET}`),
        at("/submissions"),
        at(`/submissions/${SEEDED_SUBMISSION}`),
        at(`/dispatch/${SEEDED_SHOOT}`),
        at("/archive"),
        at("/money"),
      ];

      for (const screen of screens) {
        await tabA.goto(screen);
        await expect(tabA.getByRole("heading", { level: 1 }), screen).toBeVisible();

        const links = applicationLinks(await internalPaths(tabA));
        expect(links.length, `${screen} rendered no application links`).toBeGreaterThan(0);

        for (const link of links) {
          expect(
            link.startsWith(`/${SEEDED_WORKSPACE}/`) || link === `/${SEEDED_WORKSPACE}`,
            `${screen} links to ${link}, which is outside ${SEEDED_WORKSPACE}`,
          ).toBe(true);
        }
      }

      /*
       * Following one is the proof that the href was not merely well formed.
       * The work queue's first row is a real record in workspace A.
       */
      await tabA.goto(at("/work"));
      const firstAction = tabA.locator(".row-action").first();
      if (await firstAction.count()) {
        await firstAction.click();
        await tabA.waitForURL(new RegExp(`/${SEEDED_WORKSPACE}/`));
        expect(new URL(tabA.url()).pathname.startsWith(`/${SEEDED_WORKSPACE}/`)).toBe(true);
      }
    } finally {
      await context.close();
    }
  });

  test("a write from each tab lands in the workspace that tab's URL names", async ({ browser }) => {
    const context = await browser.newContext();
    await refuseCookies(context);
    const tabA = await context.newPage();
    const tabB = await context.newPage();

    const stamp = Date.now();
    const titleA = `Tab A shoot ${stamp}`;
    const titleB = `Tab B shoot ${stamp}`;

    try {
      await signIn(tabA, SEEDED.owner, SEEDED_WORKSPACE);

      /*
       * Tab B switches to the second workspace, which moves the hint cookie for
       * the whole browser -- tab A included. Tab A then writes anyway, which is
       * the case that used to land a record in the wrong studio.
       */
      await tabB.goto(at("/work"));
      await tabB.getByLabel("Workspace").selectOption({ label: "Second Desk" });
      await tabB.getByRole("button", { name: "Switch" }).click();
      await tabB.waitForURL(`**${at("/work", second.slug)}`, { timeout: 20_000 });
      await tabB.goto(at("/shoots/new", second.slug));
      await expect(tabB.getByRole("heading", { level: 1 })).toBeVisible();

      // Tab A writes first, with the cookie pointing away from it.
      await tabA.goto(at("/shoots/new"));
      await tabA.getByLabel("Subject or event").fill(titleA);
      await tabA.getByRole("button", { name: "Create shoot" }).click();
      await tabA.waitForURL(/\/shoots\//, { timeout: 20_000 });

      expect(
        new URL(tabA.url()).pathname.startsWith(`/${SEEDED_WORKSPACE}/shoots/`),
        `tab A landed on ${tabA.url()}`,
      ).toBe(true);

      // Tab B writes second, into the other workspace.
      await tabB.getByLabel("Subject or event").fill(titleB);
      await tabB.getByRole("button", { name: "Create shoot" }).click();
      await tabB.waitForURL(/\/shoots\//, { timeout: 20_000 });

      expect(
        new URL(tabB.url()).pathname.startsWith(`/${second.slug}/shoots/`),
        `tab B landed on ${tabB.url()}`,
      ).toBe(true);

      // And each record is where its tab said it would be, read back from the
      // list rather than inferred from the redirect.
      await tabA.goto(at("/shoots"));
      await expect(tabA.getByText(titleA)).toBeVisible();
      await expect(tabA.getByText(titleB)).toHaveCount(0);

      await tabB.goto(at("/shoots", second.slug));
      await expect(tabB.getByText(titleB)).toBeVisible();
      await expect(tabB.getByText(titleA)).toHaveCount(0);
    } finally {
      await context.close();
      // The shoot in the seeded workspace would otherwise accumulate one per
      // run. The one in the throwaway workspace goes with it.
      const strayA = await shootIdByTitle(titleA);
      if (strayA) await deleteShoot(strayA);
    }
  });
});

/**
 * The legacy paths, tested on their own.
 *
 * These are kept for bookmarks and links already shared, and they still work.
 * What they must not do is stand in for the application's own navigation --
 * which is why every other test in this suite addresses a workspace directly.
 * If these were mixed in with the scoped tests, a regression that reverted a
 * link to "/money" would pass.
 */
test.describe("legacy paths still answer", () => {
  test("an old bookmark is redirected into the workspace", async ({ page }) => {
    await signIn(page);

    for (const [legacy, expected] of [
      ["/work", at("/work")],
      ["/money", at("/money")],
      [`/shoots/${SEEDED_SHOOT}`, at(`/shoots/${SEEDED_SHOOT}`)],
    ] as const) {
      const response = await page.goto(legacy);
      expect(response?.status(), legacy).toBeLessThan(400);
      expect(new URL(page.url()).pathname, `${legacy} did not redirect`).toBe(expected);
    }
  });

  test("a legacy link keeps its query", async ({ page }) => {
    await signIn(page);
    await page.goto(`/archive?q=Avery+Hart&filter=all`);
    const url = new URL(page.url());
    expect(url.pathname).toBe(at("/archive"));
    expect(url.searchParams.get("q")).toBe("Avery Hart");
  });
});
