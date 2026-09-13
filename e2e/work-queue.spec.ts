import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  SEEDED,
  SEEDED_WORKSPACE,
  at,
  collectPageErrors,
  createThrowawayWorkspace,
  hasHorizontalOverflow,
  overflowingElements,
  purgeWorkspace,
  refuseCookies,
  signIn,
} from "./helpers";

/**
 * The Work Queue on the Stage 4A surfaces: Next up, the filtered queue, the
 * active shoots, and recent activity. These check what parsing HTML cannot --
 * that the composition holds at the three required sizes, that the filters
 * are real links that keep the address honest, that nothing on the surface
 * leaks a delivery credential, and that a reader is offered nothing to write.
 */

const OWNER = "11111111-1111-1111-1111-111111111111";

/** Playwright does not load .env.local, and the nine-figure fixture needs the service key. */
function localEnv(name: string): string | undefined {
  try {
    return readFileSync(".env.local", "utf8")
      .match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]
      ?.trim()
      .replace(/^"|"$/g, "");
  } catch {
    return undefined;
  }
}

function service(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot arrange the payment fixture.");
  return { url, key };
}

test.beforeEach(async ({ context }) => {
  await refuseCookies(context);
});

test(
  "the work queue holds at this size without sideways scrolling",
  { tag: "@responsive" },
  async ({ page }) => {
    const errors = collectPageErrors(page);
    await signIn(page);

    await expect(page.getByRole("heading", { level: 1, name: "Work queue" })).toBeVisible();
    const overflowing = await overflowingElements(page);
    expect(overflowing, `work queue overflows: ${overflowing.join(", ")}`).toEqual([]);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toEqual([]);
  },
);

test("the composition renders each named region once, with one h1", async ({ page }) => {
  await signIn(page);

  await expect(page.locator("h1")).toHaveCount(1);
  for (const name of ["Next up", "Needs attention", "Active shoots", "Recent activity"]) {
    await expect(page.getByRole("region", { name })).toHaveCount(1);
  }
  await expect(page.getByRole("group", { name: "This period" })).toBeVisible();
  await expect(page.locator("[role='tab'], [role='tablist'], [aria-selected]")).toHaveCount(0);
});

test("the queue filters are links that keep the address and expose their state", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(at("/work?from=archive"));

  const filters = page.getByRole("navigation", { name: "Queue filters" });
  await expect(filters.getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "true");

  await filters.getByRole("link", { name: /^Money/ }).click();
  await page.waitForURL(`**/${SEEDED_WORKSPACE}/work?from=archive&queue=money`);

  const money = page
    .getByRole("navigation", { name: "Queue filters" })
    .getByRole("link", { name: /^Money/ });
  await expect(money).toHaveAttribute("aria-current", "true");
  await expect(
    page.getByRole("navigation", { name: "Queue filters" }).getByRole("link", { name: /^All/ }),
  ).toHaveAttribute("href", `/${SEEDED_WORKSPACE}/work?from=archive`);

  /*
   * The count on the link and the rows below it must agree: a chosen filter
   * shows everything it matches, so the visible list is the count's proof.
   */
  const advertised = Number(await money.locator(".ml-work-queue-filters__count").innerText());
  const rows = page.getByRole("list", { name: "Ranked queue" }).getByRole("listitem");
  if (advertised === 0) {
    await expect(rows).toHaveCount(0);
    await expect(page.getByText("Nothing in this part of the queue")).toBeVisible();
  } else {
    await expect(rows).toHaveCount(advertised);
    for (const badge of await rows.locator(".ml-badge").allInnerTexts()) {
      expect(badge.trim().toLowerCase()).toBe("money");
    }
  }
});

test("every row action stays inside the workspace and states its basis", async ({ page }) => {
  await signIn(page);

  const rows = page.getByRole("list", { name: "Ranked queue" }).getByRole("listitem");
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const href = await row.getByRole("link").first().getAttribute("href");
    expect(href?.startsWith(`/${SEEDED_WORKSPACE}/`), `${href} is not workspace-scoped`).toBe(true);
    expect((await row.locator(".ml-work-queue-basis").innerText()).trim().length).toBeGreaterThan(
      0,
    );
  }
});

test("a viewer is shown no write actions", async ({ page }) => {
  await signIn(page, SEEDED.viewer);

  await expect(page.getByRole("heading", { level: 1, name: "Work queue" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create shoot" })).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Active shoots" })
      .getByRole("link", { name: /Complete metadata|Review package|Create recipient link/ }),
  ).toHaveCount(0);
});

test("no delivery credential reaches the page", async ({ page }) => {
  await signIn(page);

  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"), (a) => a.getAttribute("href") ?? ""),
  );
  for (const href of hrefs) {
    expect(href.startsWith("/d/"), `${href} exposes a delivery link`).toBe(false);
  }
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/[A-Za-z0-9_-]{40,}/);
});

test("an empty workspace renders its calm states", async ({ page }) => {
  const errors = collectPageErrors(page);
  const workspace = await createThrowawayWorkspace(SEEDED.owner, "empty-queue");

  try {
    await signIn(page);
    await page.goto(at("/work", workspace.slug));

    await expect(page.getByRole("heading", { name: "Everything is up to date" })).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "No shoot is in progress" })).toBeVisible();
    // A new workspace already has its own creation on the record, so the
    // activity panel is present rather than empty.
    await expect(page.getByRole("region", { name: "Recent activity" })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await purgeWorkspace(workspace.id);
  }
});

test(
  "a nine-figure sum stays one intact figure on a phone",
  { tag: "@responsive" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the narrow layout is the point");
    const workspace = await createThrowawayWorkspace(SEEDED.owner, "nine-figures");
    const { url, key } = service();
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    const inserted = await fetch(`${url}/rest/v1/payments`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        organization_id: workspace.id,
        status: "received",
        source: "manual",
        gross_minor: 123456789012,
        net_minor: 123456789012,
        currency: "USD",
        received_at: new Date().toISOString(),
        created_by: OWNER,
      }),
    });
    if (!inserted.ok) throw new Error(`Could not arrange a payment: ${await inserted.text()}`);
    const [payment] = (await inserted.json()) as { id: string }[];

    try {
      await signIn(page);
      await page.goto(at("/work", workspace.slug));

      const value = page
        .getByRole("group", { name: "This period" })
        .locator(".ml-metric__value")
        .first();
      await expect(value).toHaveText("$1,234,567,890.12");

      // One line, nothing hidden inside its own box, nothing past the viewport.
      const facts = await value.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return {
          lines: range.getClientRects().length,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          right: element.getBoundingClientRect().right,
          viewport: document.documentElement.clientWidth,
        };
      });
      expect(facts.lines, "the figure broke across lines").toBe(1);
      expect(facts.scrollWidth).toBeLessThanOrEqual(facts.clientWidth + 1);
      expect(facts.right).toBeLessThanOrEqual(facts.viewport);
      expect(await hasHorizontalOverflow(page)).toBe(false);
    } finally {
      await fetch(`${url}/rest/v1/payments?id=eq.${payment.id}`, {
        method: "DELETE",
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      await purgeWorkspace(workspace.id);
    }
  },
);
