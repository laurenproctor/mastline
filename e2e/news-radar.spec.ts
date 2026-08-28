import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { at, hasHorizontalOverflow, refuseCookies, signIn } from "./helpers";

/**
 * News Radar, driven through the real interface.
 *
 * The lifecycle and permission matrices live in tests/news-radar.test.ts,
 * where they can be asserted precisely. What is here is the part only a
 * browser can answer: that the two modes are addressable and switchable, that
 * a story can be entered by hand and lands as a private record, that watching
 * is one motion and dismissing is two, that a read-only colleague is offered
 * none of it, and that the screen holds together at every size ACCEPTANCE
 * names -- this file runs unchanged in the desktop, tablet, and mobile
 * projects.
 */

const EDITOR = "jordan@mastline.test";
const VIEWER = "vera@mastline.test";
const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";

/** Playwright does not load .env.local, and these tests need the service key. */
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
  if (!url || !key) throw new Error("No service role key: cannot arrange radar fixtures.");
  return { url, key };
}

/**
 * A story on the radar, arranged directly.
 *
 * Written with the service role the way a future ingestion pass would write
 * one; every decision in the tests below is made by clicking. The source URL
 * is unique per run because the table is unique on (organization, kind, URL).
 */
async function createStory(
  title: string,
  kind: "archive_match" | "shoot_opportunity",
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { url, key } = service();
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const response = await fetch(`${url}/rest/v1/opportunities`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      organization_id: ORG_A,
      opportunity_kind: kind,
      title,
      source_name: "Radar E2E Wire",
      source_url: `https://radar-e2e.example/${stamp}`,
      source_published_at: new Date().toISOString(),
      signal: "rising",
      suggestion_basis: { summary: "Arranged by the browser suite." },
      confidence: 0.66,
      ...overrides,
    }),
  });
  if (!response.ok) throw new Error(`Could not arrange a story: ${await response.text()}`);
  const [row] = (await response.json()) as { id: string }[];
  return row.id;
}

async function deleteStory(id: string): Promise<void> {
  const { url, key } = service();
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  await fetch(`${url}/rest/v1/activity_events?entity_id=eq.${id}`, { method: "DELETE", headers });
  await fetch(`${url}/rest/v1/opportunities?id=eq.${id}`, { method: "DELETE", headers });
}

/** Stories this run created through the form, found and removed by title. */
async function deleteStoriesTitled(prefix: string): Promise<void> {
  const { url, key } = service();
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const found = await fetch(
    `${url}/rest/v1/opportunities?title=like.${encodeURIComponent(`${prefix}%`)}&select=id`,
    { headers },
  );
  for (const row of (await found.json()) as { id: string }[]) await deleteStory(row.id);
}

test.beforeEach(async ({ context }) => {
  await refuseCookies(context);
});

test("the two modes are prominent, addressable, and switchable", async ({ page }) => {
  await signIn(page);
  await page.goto(at("/news"));

  const archiveTab = page.getByRole("link", { name: /Archive Matches/ });
  const shootTab = page.getByRole("link", { name: /Shoot Opportunities/ });
  await expect(archiveTab).toBeVisible();
  await expect(shootTab).toBeVisible();
  // Without a mode in the address, the radar opens on Archive Matches.
  await expect(archiveTab).toHaveAttribute("aria-current", "page");

  await shootTab.click();
  await page.waitForURL("**/news?mode=shoot");
  await expect(page.getByRole("link", { name: /Shoot Opportunities/ })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // The mode is URL state: arriving on the address restores the mode.
  await page.goto(at("/news?mode=shoot"));
  await expect(page.getByRole("link", { name: /Shoot Opportunities/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("a story entered by hand becomes a private record on the right mode", async ({ page }) => {
  const title = `Radar E2E entry ${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  try {
    await signIn(page, EDITOR);
    await page.goto(at("/news"));
    await page.getByRole("link", { name: "Add story" }).click();
    await page.waitForURL("**/news/new**");

    await page.getByRole("radio", { name: /Shoot opportunity/ }).check();
    await page.getByLabel(/Story headline/).fill(title);
    await page.getByLabel(/Source name/).fill("Radar E2E Wire");
    await page.getByRole("button", { name: "Add story" }).click();

    // Entry lands on the new record, saying exactly what did and did not happen.
    await expect(page.getByText("Story added to the radar")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/nobody was contacted/)).toBeVisible();

    // And the record is on the shoot mode of the queue.
    await page.goto(at("/news?mode=shoot"));
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  } finally {
    await deleteStoriesTitled("Radar E2E entry ");
  }
});

test("the headline is required before anything is written", async ({ page }) => {
  await signIn(page, EDITOR);
  await page.goto(at("/news/new"));
  // The browser blocks the empty submit -- the field is marked required and
  // announced as such -- and the page goes nowhere. The server repeats the
  // same rule for anything that bypasses the form; that copy is unit-tested.
  const headline = page.getByLabel(/Story headline/);
  await expect(headline).toHaveAttribute("required", "");
  await page.getByRole("button", { name: "Add story" }).click();
  await expect(page).toHaveURL(/\/news\/new/);
  expect(await headline.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(
    true,
  );
});

test("watching is one motion from the queue", async ({ page }) => {
  const id = await createStory(`Radar E2E watch ${Date.now()}`, "archive_match");
  try {
    await signIn(page);
    await page.goto(at("/news"));
    const row = page.getByRole("row").filter({ hasText: "Radar E2E watch" });
    await row.getByRole("button", { name: "Watch" }).click();

    await expect(page.getByText("Held on watch.", { exact: false })).toBeVisible({
      timeout: 15_000,
    });
    await expect(row.getByText("Watching")).toBeVisible();
  } finally {
    await deleteStory(id);
  }
});

test("dismissing takes two motions and keeps the reason on the record", async ({ page }) => {
  const id = await createStory(`Radar E2E dismiss ${Date.now()}`, "shoot_opportunity");
  try {
    await signIn(page);
    await page.goto(at(`/news/${id}`));

    await page.getByRole("button", { name: "Dismiss" }).click();
    // The first motion arms the decision; nothing is recorded yet.
    await expect(page.getByText("Dismissing is final.")).toBeVisible();
    await page
      .getByLabel(/Why this is being set aside/)
      .fill("Covered by the agency pool already.");
    await page.getByRole("button", { name: "Confirm dismiss" }).click();

    await expect(page.getByText("Set aside.", { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Covered by the agency pool already.")).toBeVisible();
    // A dismissed opportunity is not offered another decision.
    await expect(page.getByRole("button", { name: "Watch" })).toHaveCount(0);
  } finally {
    await deleteStory(id);
  }
});

test("the detail screen states its suggestion, its window, and what is not built", async ({
  page,
}) => {
  const id = await createStory(`Radar E2E detail ${Date.now()}`, "archive_match", {
    window_closes_at: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
  });
  try {
    await signIn(page);
    await page.goto(at(`/news/${id}`));

    await expect(page.getByText("66% · suggested")).toBeVisible();
    await expect(page.getByText("Arranged by the browser suite.")).toBeVisible();
    await expect(page.getByText(/\d+ days? left/).first()).toBeVisible();
    // The future asset-match region is honest and its action is inert.
    await expect(
      page.getByText("Archive matching is not built yet", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Build package" })).toBeDisabled();
  } finally {
    await deleteStory(id);
  }
});

test("a read-only role reads everything and is offered nothing", async ({ page }) => {
  const id = await createStory(`Radar E2E viewer ${Date.now()}`, "archive_match");
  try {
    await signIn(page, VIEWER);
    await page.goto(at("/news"));

    // The queue is readable, the controls are absent rather than broken.
    await expect(page.getByRole("link", { name: /Radar E2E viewer/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add story" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Watch" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);

    await page.goto(at(`/news/${id}`));
    await expect(page.getByText("Read-only for your role")).toBeVisible();

    // The entry route itself says why, rather than showing a doomed form.
    await page.goto(at("/news/new"));
    await expect(page.getByText(/can read the radar but not add stories/)).toBeVisible();
  } finally {
    await deleteStory(id);
  }
});

test("the radar holds at this project's viewport without sideways scroll", async ({ page }) => {
  const id = await createStory(`Radar E2E layout ${Date.now()}`, "archive_match");
  try {
    await signIn(page);
    for (const path of ["/news", "/news?mode=shoot", `/news/${id}`, "/news/new"]) {
      await page.goto(at(path));
      await page.waitForLoadState("networkidle");
      expect(await hasHorizontalOverflow(page), `${path} scrolls sideways`).toBe(false);
    }
  } finally {
    await deleteStory(id);
  }
});
