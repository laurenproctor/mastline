import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { at, hasHorizontalOverflow, refuseCookies, signIn } from "./helpers";

/**
 * News Radar, driven through the real interface.
 *
 * The lifecycle, atomicity, and permission matrices live in
 * tests/news-radar.test.ts, where they can be asserted precisely. What is
 * here is the part only a browser can answer: that the two modes are
 * addressable and switchable, that ONE manual entry surfaces the story in
 * both modes, that each path names itself and links to its sibling, that
 * watching is one motion and dismissing is two, that a read-only colleague is
 * offered none of it, and that the screen holds together at every size
 * ACCEPTANCE names -- this file runs unchanged in the desktop, tablet, and
 * mobile projects.
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

function serviceHeaders(): Record<string, string> {
  const { key } = service();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

interface StoryFixture {
  readonly signalId: string;
  readonly archiveId: string;
  readonly shootId: string;
}

/**
 * One canonical story with both evaluation paths, arranged directly the way a
 * future ingestion pass would write them; every decision in the tests below
 * is made by clicking. The source URL is unique per run because the signal is
 * unique on (organization, URL).
 */
async function createStory(
  title: string,
  overrides: { signal?: Record<string, unknown>; paths?: Record<string, unknown> } = {},
): Promise<StoryFixture> {
  const { url } = service();
  const headers = serviceHeaders();
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const signalResponse = await fetch(`${url}/rest/v1/news_signals`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      organization_id: ORG_A,
      title,
      source_name: "Radar E2E Wire",
      source_url: `https://radar-e2e.example/${stamp}`,
      source_published_at: new Date().toISOString(),
      ...overrides.signal,
    }),
  });
  if (!signalResponse.ok) {
    throw new Error(`Could not arrange a signal: ${await signalResponse.text()}`);
  }
  const [signal] = (await signalResponse.json()) as { id: string }[];

  const pathResponse = await fetch(`${url}/rest/v1/opportunities`, {
    method: "POST",
    headers,
    body: JSON.stringify(
      ["archive_match", "shoot_opportunity"].map((kind) => ({
        organization_id: ORG_A,
        news_signal_id: signal.id,
        opportunity_kind: kind,
        signal: "rising",
        suggestion_basis: { summary: "Arranged by the browser suite." },
        confidence: 0.66,
        ...overrides.paths,
      })),
    ),
  });
  if (!pathResponse.ok) {
    throw new Error(`Could not arrange the paths: ${await pathResponse.text()}`);
  }
  const paths = (await pathResponse.json()) as { id: string; opportunity_kind: string }[];

  return {
    signalId: signal.id,
    archiveId: paths.find((path) => path.opportunity_kind === "archive_match")!.id,
    shootId: paths.find((path) => path.opportunity_kind === "shoot_opportunity")!.id,
  };
}

/** Deleting the signal cascades its paths; events are removed for both. */
async function deleteStory(fixture: StoryFixture): Promise<void> {
  const { url } = service();
  const headers = serviceHeaders();
  for (const id of [fixture.signalId, fixture.archiveId, fixture.shootId]) {
    await fetch(`${url}/rest/v1/activity_events?entity_id=eq.${id}`, { method: "DELETE", headers });
  }
  await fetch(`${url}/rest/v1/news_signals?id=eq.${fixture.signalId}`, {
    method: "DELETE",
    headers,
  });
}

/** Stories this run created through the form, found and removed by title. */
async function deleteStoriesTitled(prefix: string): Promise<void> {
  const { url } = service();
  const headers = serviceHeaders();
  const found = await fetch(
    `${url}/rest/v1/news_signals?title=like.${encodeURIComponent(`${prefix}%`)}&select=id`,
    { headers },
  );
  for (const row of (await found.json()) as { id: string }[]) {
    const paths = await fetch(
      `${url}/rest/v1/opportunities?news_signal_id=eq.${row.id}&select=id`,
      { headers },
    );
    for (const path of (await paths.json()) as { id: string }[]) {
      await fetch(`${url}/rest/v1/activity_events?entity_id=eq.${path.id}`, {
        method: "DELETE",
        headers,
      });
    }
    await fetch(`${url}/rest/v1/activity_events?entity_id=eq.${row.id}`, {
      method: "DELETE",
      headers,
    });
    await fetch(`${url}/rest/v1/news_signals?id=eq.${row.id}`, { method: "DELETE", headers });
  }
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

test("one manual entry puts the story in both modes", async ({ page }) => {
  const title = `Radar E2E entry ${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  try {
    await signIn(page, EDITOR);
    await page.goto(at("/news?mode=shoot"));
    await page.getByRole("link", { name: "Add story" }).click();
    await page.waitForURL("**/news/new**");

    // There is no archive-or-shoot choice: the form says one entry feeds both.
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByText("One entry, two evaluations", { exact: false })).toBeVisible();

    await page.getByLabel(/Story headline/).fill(title);
    await page.getByLabel(/Source name/).fill("Radar E2E Wire");
    await page.getByRole("button", { name: "Add story" }).click();

    // Opened from the shoot mode, entry lands on the shoot path of the new
    // record, saying exactly what did and did not happen.
    await expect(page.getByText("Story added to the radar — once", { exact: false })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Nobody was contacted/)).toBeVisible();
    await expect(page.getByText("Shoot opportunity path", { exact: false }).first()).toBeVisible();

    // The same story is on both modes of the queue.
    await page.goto(at("/news?mode=shoot"));
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await page.goto(at("/news?mode=archive"));
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
  const fixture = await createStory(`Radar E2E watch ${Date.now()}`);
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
    await deleteStory(fixture);
  }
});

test("dismissing one path takes two motions and leaves the other path standing", async ({
  page,
}) => {
  const fixture = await createStory(`Radar E2E dismiss ${Date.now()}`);
  try {
    await signIn(page);
    await page.goto(at(`/news/${fixture.shootId}`));

    await page.getByRole("button", { name: "Dismiss" }).click();
    // The first motion arms the decision; nothing is recorded yet.
    await expect(page.getByText("Dismissing is final.")).toBeVisible();
    await page
      .getByLabel(/Why this is being set aside/)
      .fill("Covered by the agency pool already.");
    await page.getByRole("button", { name: "Confirm dismiss" }).click();

    await expect(page.getByText("Set aside.", { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Covered by the agency pool already.")).toBeVisible();
    // This path is closed...
    await expect(page.getByRole("button", { name: "Watch" })).toHaveCount(0);

    // ...and the same story's archive path is exactly where it stood.
    await page.getByRole("link", { name: "View the archive evaluation" }).click();
    await page.waitForURL(`**/news/${fixture.archiveId}`);
    await expect(page.getByText("Archive match path", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Watch" })).toBeVisible();
  } finally {
    await deleteStory(fixture);
  }
});

test("each path names itself and links to the other evaluation of the same story", async ({
  page,
}) => {
  const fixture = await createStory(`Radar E2E sibling ${Date.now()}`);
  try {
    await signIn(page);
    await page.goto(at(`/news/${fixture.archiveId}`));
    await expect(page.getByText("Archive match path", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("shared by both paths", { exact: false })).toBeVisible();

    await page.getByRole("link", { name: "View the shoot evaluation" }).click();
    await page.waitForURL(`**/news/${fixture.shootId}`);
    await expect(page.getByText("Shoot opportunity path", { exact: false }).first()).toBeVisible();
    // The canonical facts travelled with it: same headline, same source.
    await expect(page.getByText("Radar E2E sibling", { exact: false }).first()).toBeVisible();
  } finally {
    await deleteStory(fixture);
  }
});

test("the detail screen states its suggestion, its window, and what is not built", async ({
  page,
}) => {
  const fixture = await createStory(`Radar E2E detail ${Date.now()}`, {
    paths: { window_closes_at: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString() },
  });
  try {
    await signIn(page);
    await page.goto(at(`/news/${fixture.archiveId}`));

    await expect(page.getByText("66% · suggested")).toBeVisible();
    await expect(page.getByText("Arranged by the browser suite.")).toBeVisible();
    await expect(page.getByText(/\d+ days? left/).first()).toBeVisible();
    // The match region says nothing has run, and the handoff region says why
    // there is nothing to act on yet.
    await expect(page.getByText("Never run. Nothing runs on its own.")).toBeVisible();
    await expect(
      page.getByText("Nothing to select from until the archive evaluation has run", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Create draft package" })).toHaveCount(0);
  } finally {
    await deleteStory(fixture);
  }
});

test("a read-only role reads everything and is offered nothing", async ({ page }) => {
  const fixture = await createStory(`Radar E2E viewer ${Date.now()}`);
  try {
    await signIn(page, VIEWER);
    await page.goto(at("/news"));

    // The queue is readable, the controls are absent rather than broken.
    await expect(page.getByRole("link", { name: /Radar E2E viewer/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add story" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Watch" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);

    await page.goto(at(`/news/${fixture.archiveId}`));
    await expect(page.getByText("Read-only for your role")).toBeVisible();

    // The entry route itself says why, rather than showing a doomed form.
    await page.goto(at("/news/new"));
    await expect(page.getByText(/can read the radar but not add stories/)).toBeVisible();
  } finally {
    await deleteStory(fixture);
  }
});

test("the radar holds at this project's viewport without sideways scroll", async ({ page }) => {
  const fixture = await createStory(`Radar E2E layout ${Date.now()}`);
  try {
    await signIn(page);
    for (const path of ["/news", "/news?mode=shoot", `/news/${fixture.archiveId}`, "/news/new"]) {
      await page.goto(at(path));
      await page.waitForLoadState("networkidle");
      expect(await hasHorizontalOverflow(page), `${path} scrolls sideways`).toBe(false);
    }
  } finally {
    await deleteStory(fixture);
  }
});
