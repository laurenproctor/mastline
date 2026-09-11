import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { at, hasHorizontalOverflow, refuseCookies, signIn, testBudget } from "./helpers";

/**
 * News Radar evaluation, driven through the real interface.
 *
 * The scoring rules, the constraints, and the permission matrix live in
 * src/lib/news-radar-evaluation.test.ts and tests/news-radar-evaluation.test.ts.
 * What is here is what only a browser can answer: that context is recorded
 * through the editor and shows in its own register, that Evaluate is an
 * explicit action whose result is drawn with its state and its reasons, that
 * the honest states read as such, that a read-only colleague is offered none
 * of it, and that the screen holds at every size ACCEPTANCE names -- this
 * file runs unchanged in the desktop, tablet, and mobile projects.
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
 * A story about the seeded photographs' subject, both paths, no context yet.
 * Arranged through the Data API as the service role, the way an ingestion
 * pass would write it; every decision below is made by clicking.
 */
async function createStory(title: string): Promise<StoryFixture> {
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
      source_url: `https://radar-evaluation-e2e.example/${stamp}`,
      source_published_at: new Date().toISOString(),
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
        confidence: 0.5,
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

/** Deleting the signal cascades its paths, context, evaluations, matches and briefs. */
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

/** Record people and a location through the editor, as the signed-in person. */
async function recordContext(
  page: import("@playwright/test").Page,
  values: { people?: string; location?: string; eventStartsAt?: string },
): Promise<void> {
  if (values.people !== undefined)
    await page.getByLabel("People", { exact: true }).fill(values.people);
  if (values.location !== undefined) await page.getByLabel("Location name").fill(values.location);
  if (values.eventStartsAt !== undefined) {
    await page.getByLabel("Event starts").fill(values.eventStartsAt);
  }
  await page.getByRole("button", { name: "Save context" }).click();
  await expect(page.getByText("Context saved.", { exact: false })).toBeVisible({ timeout: 60_000 });
}

test.beforeEach(async ({ context }) => {
  await refuseCookies(context);
  // The evaluator reads every photograph the workspace owns; on a loaded
  // host that is tens of seconds, and the default budget reports the stall
  // as a failure. The assertions themselves are unchanged.
  test.setTimeout(testBudget(180_000, 300_000));
});

test("the archive path evaluates to ranked real photographs with reasons and readiness facts", async ({
  page,
}) => {
  const fixture = await createStory(`Radar eval archive ${Date.now()}`);
  try {
    await signIn(page);
    await page.goto(at(`/news/${fixture.archiveId}`));

    // Nothing has run, and the screen says so rather than showing anything.
    await expect(page.getByText("Not evaluated").first()).toBeVisible();
    await expect(page.getByText("Never run. Nothing runs on its own.")).toBeVisible();
    // The handoff region below says why there is nothing to act on yet.
    await expect(
      page.getByText("Nothing to select from until the archive evaluation has run", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Create draft package" })).toHaveCount(0);

    await recordContext(page, { people: "Avery Hart", location: "Hotel Chelsea" });
    // The person's entry sits in its own register, labelled as theirs.
    await expect(page.getByText("Person · Entered by a person")).toBeVisible();

    await page.getByRole("button", { name: "Evaluate" }).click();
    await expect(page.getByText("Evaluated.", { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Ready").first()).toBeVisible();

    // The seeded frames of Avery Hart are the matches; the street-style frame is not.
    // The rank also appears on the handoff's selection card below; the
    // evaluation list's copy is the first in the document.
    await expect(page.getByText("#1").first()).toBeVisible();
    // The headline also appears on the handoff selection card below.
    await expect(page.getByText("Avery Hart departs Hotel Chelsea").first()).toBeVisible();
    await expect(page.getByText("Street style outside the Mercer")).toHaveCount(0);
    await expect(
      page.getByText(/matches a subject on the photograph: Avery Hart/).first(),
    ).toBeVisible();
    await expect(page.getByText("Usage restriction recorded").first()).toBeVisible();
    await expect(page.getByText("Copyright information recorded").first()).toBeVisible();
    // No derivative object exists in storage for the seeded rows: said plainly.
    await expect(page.getByText("Preview unavailable").first()).toBeVisible();
    // The handoff region now offers selection -- empty, with the action held
    // until something is explicitly selected. Creating stays two steps away.
    await expect(page.getByRole("complementary", { name: "Selection summary" })).toContainText(
      "0 photographs",
    );
    await expect(page.getByRole("button", { name: "Review selection" }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: "Create draft package" })).toHaveCount(0);

    // The same evaluator over the same input writes nothing, and says so.
    await page.getByRole("button", { name: "Re-evaluate" }).click();
    await expect(page.getByText("Nothing to recompute", { exact: false })).toBeVisible({
      timeout: 60_000,
    });
  } finally {
    await deleteStory(fixture);
  }
});

test("the shoot path needs context until where and when are recorded, then briefs with labelled suggestions", async ({
  page,
}) => {
  const fixture = await createStory(`Radar eval shoot ${Date.now()}`);
  try {
    await signIn(page, EDITOR);
    await page.goto(at(`/news/${fixture.shootId}`));

    await page.getByRole("button", { name: "Evaluate" }).click();
    await expect(page.getByText("Evaluated.", { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Needs context").first()).toBeVisible();
    // "Still to confirm" lists the gaps; "What is known" states the same
    // absence in its own words, so the first match is the list entry.
    await expect(page.getByText("Event time: none recorded").first()).toBeVisible();
    await expect(page.getByText("Location: none recorded").first()).toBeVisible();
    await expect(
      page.getByText("Nothing to suggest: no people or location are recorded.").first(),
    ).toBeVisible();

    await recordContext(page, {
      people: "Avery Hart",
      location: "Hotel Chelsea",
      eventStartsAt: "2036-01-01T18:00",
    });
    await page.getByRole("button", { name: "Re-evaluate" }).click();
    await expect(page.getByText("Evaluated.", { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Ready").first()).toBeVisible();
    // Suggestions also appear, still labelled, in the handoff region below.
    await expect(page.getByText("Suggested angle").first()).toBeVisible();
    await expect(page.getByText("Avery Hart at Hotel Chelsea").first()).toBeVisible();
    await expect(page.getByText("Suggested shot").first()).toBeVisible();
    // The appearance caveat is also repeated by the handoff region below.
    await expect(
      page.getByText(/a recorded name is not a confirmed appearance/).first(),
    ).toBeVisible();
    // The handoff region offers the review of the brief; creating is behind
    // an explicit confirmation step and never on this screen's first click.
    await expect(page.getByRole("button", { name: "Review the draft" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create draft shoot" })).toHaveCount(0);
  } finally {
    await deleteStory(fixture);
  }
});

test("a suggestion from the headline is labelled, and recorded only when a person adds it", async ({
  page,
}) => {
  const fixture = await createStory(`Radar eval ${Date.now()} Avery Hart departs Hotel Chelsea`);
  try {
    await signIn(page, EDITOR);
    await page.goto(at(`/news/${fixture.archiveId}`));

    const row = page.locator("text=Suggested person · Capitalised phrase in the headline").first();
    await expect(row).toBeVisible();
    await page.getByRole("button", { name: "Add as person" }).first().click();
    await expect(page.getByText("Suggestion recorded as a fact", { exact: false })).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByText("Person · Suggested, then accepted", { exact: false }),
    ).toBeVisible();
  } finally {
    await deleteStory(fixture);
  }
});

test("a read-only role reads the evaluation and is offered no controls", async ({ page }) => {
  const fixture = await createStory(`Radar eval viewer ${Date.now()}`);
  try {
    await signIn(page, VIEWER);
    await page.goto(at(`/news/${fixture.archiveId}`));
    await expect(page.getByText("Structured context", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /Evaluate/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save context" })).toHaveCount(0);
    await expect(page.getByText("Running the evaluator needs an owner or editor.")).toBeVisible();
    await expect(
      page.getByText("Recording context needs an owner or editor.", { exact: false }),
    ).toBeVisible();
  } finally {
    await deleteStory(fixture);
  }
});

test(
  "the evaluated detail screen holds at this project's viewport without sideways scroll",
  { tag: "@responsive" },
  async ({ page }, testInfo) => {
    const fixture = await createStory(`Radar eval layout ${Date.now()}`);
    try {
      await signIn(page);
      await page.goto(at(`/news/${fixture.archiveId}`));
      await recordContext(page, { people: "Avery Hart", location: "Hotel Chelsea" });
      await page.getByRole("button", { name: "Evaluate" }).click();
      await expect(page.getByText("Evaluated.", { exact: false })).toBeVisible({ timeout: 60_000 });

      for (const path of [`/news/${fixture.archiveId}`, `/news/${fixture.shootId}`]) {
        await page.goto(at(path));
        await page.waitForLoadState("networkidle");
        expect(await hasHorizontalOverflow(page), `${path} scrolls sideways`).toBe(false);
        if (process.env.NEWS_RADAR_SHOTS) {
          const which = path.endsWith(fixture.archiveId) ? "archive" : "shoot";
          await page.screenshot({
            path: `${process.env.NEWS_RADAR_SHOTS}/${which}-${testInfo.project.name}.png`,
            fullPage: true,
          });
        }
      }
    } finally {
      await deleteStory(fixture);
    }
  },
);
