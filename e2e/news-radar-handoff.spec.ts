import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { at, hasHorizontalOverflow, refuseCookies, signIn, testBudget } from "./helpers";

/**
 * News Radar handoffs, driven through the real interface.
 *
 * The rules, the constraints and the permission matrix live in
 * src/lib/news-radar-handoff.test.ts and tests/news-radar-handoff.test.ts.
 * What is here is what only a browser can answer: that a person selects
 * matched photographs one by one, reads a confirmation that says exactly
 * what will and will not happen, creates one draft package and lands in the
 * existing package review; that a brief's facts are confirmed one by one and
 * suggestions stay labelled; that a repeat is answered with the same draft;
 * that a re-evaluation between loading and confirming is refused; that the
 * keyboard reaches every control; and that the screen holds at every size --
 * this file runs unchanged in the desktop, tablet and mobile projects.
 */

const EDITOR = "jordan@mastline.test";
const VIEWER = "vera@mastline.test";
const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER_A = "11111111-1111-1111-1111-111111111111";
const SEEDED_SHOOT = "a0000000-0000-0000-0000-0000000000c1";

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
  if (!url || !key) throw new Error("No service role key: cannot arrange handoff fixtures.");
  return { url, key };
}

function headers(): Record<string, string> {
  const { key } = service();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function rest<T>(path: string, init: RequestInit): Promise<T> {
  const { url } = service();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

interface Fixture {
  readonly signalId: string;
  readonly archiveId: string;
  readonly shootPathId: string;
  readonly assetIds: string[];
  readonly title: string;
  /** Unique per fixture, so an abandoned fixture can never collide with or match a later one. */
  readonly person: string;
  readonly venue: string;
}

/** Fixtures whose test never reached its own cleanup (a timeout abandons the body). */
const pending: Fixture[] = [];

test.afterEach(async () => {
  while (pending.length > 0) {
    const leftover = pending.pop()!;
    try {
      await cleanUp(leftover);
    } catch {
      // Reported by the next run's arrangement if it truly stuck.
    }
  }
});

/**
 * A story about two fixture photographs on the seeded shoot, with context
 * recorded, arranged through the Data API as the service role. Evaluating
 * is done by clicking, so the result is the one the screen shows.
 */
async function arrange(label: string): Promise<Fixture> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const PERSON = `Handoff Person ${label} ${stamp}`;
  const VENUE = `Handoff Hall ${label} ${stamp}`;
  const title = `${PERSON} at ${VENUE}`;
  const assetIds: string[] = [];
  for (const [index, name] of ["A", "B"].entries()) {
    const [asset] = await rest<{ id: string }[]>("assets", {
      method: "POST",
      body: JSON.stringify({
        organization_id: ORG_A,
        shoot_id: SEEDED_SHOOT,
        created_by: OWNER_A,
        status: "active",
        canonical_filename: `HANDOFF_E2E_${name}_${stamp}`,
        headline: `${PERSON} ${index === 0 ? "arrives at" : "leaves"} ${VENUE}`,
        caption: `${PERSON} photographed at ${VENUE}.`,
        subjects: [PERSON],
        keywords: [`handoff-e2e-${stamp}`],
        location_name: VENUE,
        captured_at: "2026-08-20T10:00:00.000Z",
        copyright_notice: "© 2026 Fixture",
        credit_line: "Fixture / Mastline",
      }),
    });
    assetIds.push(asset.id);
    await rest("asset_versions", {
      method: "POST",
      body: JSON.stringify({
        organization_id: ORG_A,
        asset_id: asset.id,
        version_kind: "original",
        storage_bucket: "originals",
        object_key: `${ORG_A}/${SEEDED_SHOOT}/HANDOFF_E2E_${name}_${stamp}.arw`,
        sha256: stamp
          .replace(/\D/g, "")
          .padEnd(64, "a")
          .slice(0, 64)
          .replace(/a/g, index === 0 ? "b" : "c"),
        bytes: 1,
        mime_type: "image/x-sony-arw",
        created_by: OWNER_A,
      }),
    });
  }
  const [signal] = await rest<{ id: string }[]>("news_signals", {
    method: "POST",
    body: JSON.stringify({
      organization_id: ORG_A,
      title,
      source_name: "Handoff E2E Wire",
      source_url: `https://handoff-e2e.example/${stamp}`,
      source_published_at: new Date().toISOString(),
    }),
  });
  const paths = await rest<{ id: string; opportunity_kind: string }[]>("opportunities", {
    method: "POST",
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
  await rest("news_signal_context", {
    method: "POST",
    body: JSON.stringify({
      news_signal_id: signal.id,
      organization_id: ORG_A,
      location_name: VENUE,
      event_starts_at: "2026-09-12T15:00:00.000Z",
    }),
  });
  await rest("news_signal_entities", {
    method: "POST",
    body: JSON.stringify([
      { organization_id: ORG_A, news_signal_id: signal.id, entity_kind: "person", value: PERSON },
      {
        organization_id: ORG_A,
        news_signal_id: signal.id,
        entity_kind: "keyword",
        value: `handoff-e2e-${stamp}`,
      },
    ]),
  });
  const fixture: Fixture = {
    signalId: signal.id,
    archiveId: paths.find((path) => path.opportunity_kind === "archive_match")!.id,
    shootPathId: paths.find((path) => path.opportunity_kind === "shoot_opportunity")!.id,
    assetIds,
    title,
    person: PERSON,
    venue: VENUE,
  };
  pending.push(fixture);
  return fixture;
}

/** Everything the fixture and the handoffs made, in foreign-key order. */
async function cleanUp(fixture: Fixture): Promise<void> {
  const index = pending.indexOf(fixture);
  if (index !== -1) pending.splice(index, 1);
  const packages = await rest<{ id: string }[]>(
    `packages?organization_id=eq.${ORG_A}&name=eq.${encodeURIComponent(fixture.title)}&select=id`,
    { method: "GET" },
  );
  for (const pkg of packages) {
    await rest(`package_assets?package_id=eq.${pkg.id}`, { method: "DELETE" });
  }
  await rest(
    `opportunity_handoffs?opportunity_id=in.(${fixture.archiveId},${fixture.shootPathId})`,
    { method: "DELETE" },
  );
  for (const pkg of packages) await rest(`packages?id=eq.${pkg.id}`, { method: "DELETE" });
  await rest(`shoots?opportunity_id=eq.${fixture.shootPathId}`, { method: "DELETE" });
  await rest(`news_signals?id=eq.${fixture.signalId}`, { method: "DELETE" });
  // Versions are append-only; the audited purge routine is the one way through.
  for (const assetId of fixture.assetIds) {
    await rest("rpc/purge_asset_admin", {
      method: "POST",
      body: JSON.stringify({ target_asset: assetId }),
    });
  }
}

/**
 * Evaluate the path through the interface, as arrangement.
 *
 * A loaded host makes the evaluation write fail with a classified code now
 * and then (the gateway resets the connection; the screen says "Evaluation
 * failed" and keeps the previous result). A person would press Re-evaluate;
 * so does this, up to twice, and only for that visible failure -- anything
 * else stays a failure of the test.
 */
async function evaluate(page: Page, opportunityId: string): Promise<void> {
  await page.goto(at(`/news/${opportunityId}`));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // A transient read failure renders the standard boundary; recover first.
    const boundary = page.getByRole("button", { name: "Try again" });
    if (await boundary.isVisible().catch(() => false)) await boundary.click();
    await page
      .getByRole("button", { name: /^(Evaluate|Re-evaluate)$/ })
      .first()
      .click();
    const outcome = page
      .getByRole("status")
      .filter({ hasText: /Evaluated|Nothing to recompute|Evaluation failed/ });
    try {
      await expect(outcome.first()).toBeVisible({ timeout: 60_000 });
    } catch {
      // No answer at all within the allowance: reload and try again rather
      // than reporting the stall as the journey's failure.
      await page.goto(at(`/news/${opportunityId}`));
      continue;
    }
    if ((await outcome.first().textContent())?.includes("Evaluation failed")) continue;
    return;
  }
  throw new Error("The evaluation kept failing; see the server log.");
}

/**
 * Settle the page after an action that may have landed on the error boundary.
 *
 * A transient read failure during the revalidated re-render shows the app's
 * standard "That page did not load" boundary. The recovery a person takes is
 * "Try again", and the handoff's idempotency answers the re-render with the
 * record that was made. Returns "status" when the in-place result rendered,
 * "recovered" when the boundary path was taken.
 *
 * A REFUSAL is a third possibility: the action can answer with a classified
 * outcome (stale evaluation, invalid selection, failed) rendered as an
 * in-place alert -- neither the status nor the boundary. Waiting past it
 * turned a named refusal into a silent two-minute timeout, so instead it
 * fails the journey immediately, with the refusal's own words in the error.
 */
async function settleAfterCreate(
  page: Page,
  status: ReturnType<Page["getByRole"]>,
  handedOffText: string,
): Promise<"status" | "recovered"> {
  const boundary = page.getByRole("button", { name: "Try again" });
  // Scoped to main and required to say something: the framework keeps an
  // always-present, usually empty route-announcer alert at the top of the
  // page, and an unscoped role=alert would satisfy this union on sight.
  const refusal = page.getByRole("main").getByRole("alert").filter({ hasText: /\S/ });
  await expect(status.or(boundary).or(refusal).first()).toBeVisible({ timeout: 120_000 });
  if (await status.isVisible().catch(() => false)) return "status";
  if (!(await boundary.isVisible().catch(() => false))) {
    throw new Error(`The handoff was refused: ${await refusal.first().innerText()}`);
  }
  await boundary.click();
  await expect(page.getByText(handedOffText)).toBeVisible({ timeout: 120_000 });
  return "recovered";
}

/**
 * Click a create button whose success replaces or renames it.
 *
 * Trace-proven on the runner: the click dispatches, the action's POST lands
 * within a second, and the success re-render swaps the button for the result
 * (or renames it to "Creating draft…") while Playwright is still verifying
 * the click -- which then retries forever against a button that no longer
 * exists, even though the draft was created. The click gets a short leash,
 * and the caller asserts the OUTCOME, which is the journey's contract; a
 * click that truly never landed surfaces there instead.
 */
async function clickCreate(button: ReturnType<Page["getByRole"]>): Promise<void> {
  await button.click({ timeout: 15_000 }).catch(() => {});
}

test.describe("News Radar handoffs", () => {
  // One worker runs these in order, and each test arranges and removes its
  // own story on the seeded shoot -- so a stalled first test must not void
  // the rest (no serial mode). The allowance is for the evaluator, which
  // reads every photograph the workspace owns and signs previews; on a
  // loaded host that is tens of seconds, and a tighter budget reports the
  // stall as a failure.
  test.describe.configure({ timeout: testBudget(240_000, 420_000) });

  test.beforeEach(async ({ context }) => {
    await refuseCookies(context);
  });

  test("archive: select → confirm → one draft package, idempotent, in the package review", async ({
    page,
  }) => {
    const fixture = await arrange("archive");
    try {
      await signIn(page, EDITOR);
      await evaluate(page, fixture.archiveId);

      const region = page.getByRole("form", { name: "Build a draft package from the matches" });
      await expect(region).toBeVisible();
      expect(await hasHorizontalOverflow(page)).toBe(false);

      // Nothing is pre-selected; the summary says so and the button is held.
      const summary = page.getByRole("complementary", { name: "Selection summary" });
      await expect(summary).toContainText("0 photographs");
      await expect(summary.getByRole("button", { name: "Review selection" })).toBeDisabled();

      // Select both fixture frames by their labels (the seeded frame may also match).
      for (const headline of [
        `${fixture.person} arrives at ${fixture.venue}`,
        `${fixture.person} leaves ${fixture.venue}`,
      ]) {
        await region.getByRole("checkbox", { name: headline }).check();
      }
      await expect(summary).toContainText("2 photographs");
      await expect(summary).toContainText("draft package");
      await expect(summary).toContainText("No recipient is contacted");

      await summary.getByRole("button", { name: "Review selection" }).click();
      const confirmation = region.getByText("What will be created").locator("..");
      await expect(confirmation).toContainText("2 photographs");
      await expect(confirmation).toContainText(fixture.title);
      await expect(confirmation).toContainText("draft package");
      await expect(confirmation).toContainText("No recipient will be contacted");
      await expect(confirmation).toContainText("no delivery link");
      await expect(confirmation).toContainText("must still be reviewed");
      expect(await hasHorizontalOverflow(page)).toBe(false);

      await clickCreate(summary.getByRole("button", { name: "Create draft package" }));
      const created = page.getByRole("status").filter({ hasText: "Draft package created" });
      const outcome = await settleAfterCreate(page, created, "Handed off to a draft package");
      if (outcome === "status") {
        await expect(created).toContainText("still a draft");
        await expect(created).not.toContainText(/sold|assigned|congratulations/i);
      }

      // The record: one package, needs_review, unapproved, exactly the two frames, one handoff.
      const packages = await rest<
        { id: string; status: string; approved_at: string | null; shoot_id: string }[]
      >(
        `packages?organization_id=eq.${ORG_A}&name=eq.${encodeURIComponent(fixture.title)}&select=id,status,approved_at,shoot_id`,
        { method: "GET" },
      );
      expect(packages).toHaveLength(1);
      expect(packages[0]).toMatchObject({
        status: "needs_review",
        approved_at: null,
        shoot_id: SEEDED_SHOOT,
      });
      const members = await rest<{ asset_id: string }[]>(
        `package_assets?package_id=eq.${packages[0].id}&select=asset_id&order=position`,
        { method: "GET" },
      );
      expect(members.map((m) => m.asset_id).sort()).toEqual([...fixture.assetIds].sort());
      const submissions = await rest<unknown[]>(
        `submissions?package_id=eq.${packages[0].id}&select=id`,
        { method: "GET" },
      );
      expect(submissions).toHaveLength(0);

      // Continue lands in the existing package review, addressed by shoot and package.
      await page.getByRole("link", { name: "Continue in the package review" }).click();
      await expect(page).toHaveURL(
        new RegExp(`/dispatch/${SEEDED_SHOOT}\\?package=${packages[0].id}`),
      );
      await expect(page.getByText(fixture.title).first()).toBeVisible();

      // Back on the path: already handed off, nothing new is offered, one link to continue.
      await page.goto(at(`/news/${fixture.archiveId}`));
      await expect(page.getByText("Handed off to a draft package")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Continue in the package review" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Create draft package" })).toHaveCount(0);
      await expect(page.getByText("Acted", { exact: true }).first()).toBeVisible();
      const handoffs = await rest<unknown[]>(
        `opportunity_handoffs?opportunity_id=eq.${fixture.archiveId}&select=id`,
        { method: "GET" },
      );
      expect(handoffs).toHaveLength(1);
    } finally {
      await cleanUp(fixture);
    }
  });

  test("archive: a re-evaluation between loading and confirming is refused", async ({ page }) => {
    const fixture = await arrange("stale");
    try {
      await signIn(page, EDITOR);
      await evaluate(page, fixture.archiveId);
      const region = page.getByRole("form", { name: "Build a draft package from the matches" });
      await region
        .getByRole("checkbox", { name: `${fixture.person} arrives at ${fixture.venue}` })
        .check();
      const summary = page.getByRole("complementary", { name: "Selection summary" });
      await summary.getByRole("button", { name: "Review selection" }).click();

      // Meanwhile the story gains a keyword and is re-evaluated elsewhere.
      await rest("news_signal_entities", {
        method: "POST",
        body: JSON.stringify({
          organization_id: ORG_A,
          news_signal_id: fixture.signalId,
          entity_kind: "keyword",
          value: "arrival",
        }),
      });
      const other = await page.context().newPage();
      await evaluate(other, fixture.archiveId);
      await other.close();

      await clickCreate(summary.getByRole("button", { name: "Create draft package" }));
      const alert = page
        .getByRole("alert")
        .filter({ hasText: "Re-evaluated since you loaded this page" });
      const boundary = page.getByRole("button", { name: "Try again" });
      await expect(alert.or(boundary).first()).toBeVisible({ timeout: 120_000 });
      if (await alert.isVisible().catch(() => false)) {
        await expect(alert.getByRole("link", { name: "Reload the current result" })).toBeVisible();
      } else {
        // The re-render fell on the boundary; recovery must show the path
        // NOT handed off -- the stale confirmation created nothing.
        await boundary.click();
        await expect(
          page.getByRole("form", { name: "Build a draft package from the matches" }),
        ).toBeVisible({ timeout: 120_000 });
      }
      const packages = await rest<unknown[]>(
        `packages?organization_id=eq.${ORG_A}&name=eq.${encodeURIComponent(fixture.title)}&select=id`,
        { method: "GET" },
      );
      expect(packages).toHaveLength(0);
    } finally {
      await cleanUp(fixture);
    }
  });

  test("shoot: confirm facts one by one → one draft shoot, suggestions stay suggestions, idempotent", async ({
    page,
  }) => {
    const fixture = await arrange("shoot");
    try {
      await signIn(page, EDITOR);
      await evaluate(page, fixture.shootPathId);

      const region = page.getByRole("form", { name: "Create a draft shoot from this brief" });
      await expect(region).toBeVisible();
      expect(await hasHorizontalOverflow(page)).toBe(false);

      // Four registers, apart.
      for (const heading of [
        "Recorded facts",
        "Needs confirmation",
        "Suggestions — not facts",
        "Will be added to the draft",
      ]) {
        await expect(region.getByRole("heading", { name: heading })).toBeVisible();
      }
      await expect(region.getByRole("region", { name: "Recorded facts" })).toContainText(
        fixture.venue,
      );
      await expect(
        region.getByRole("region", { name: "Will be added to the draft" }),
      ).toContainText("Location: not confirmed");

      // Confirm the location and the time zone, one person, and copy one suggestion.
      await region.getByRole("checkbox", { name: "Confirm the location" }).check();
      await region.getByRole("checkbox", { name: "Confirm the time zone" }).check();
      // exact: the suggestion checkboxes' labels embed the person's name.
      await region.getByRole("checkbox", { name: fixture.person, exact: true }).check();
      const suggestion = region.getByRole("checkbox", { name: /^Suggested (angle|shot)/ }).first();
      await suggestion.check();
      const willAdd = region.getByRole("region", { name: "Will be added to the draft" });
      await expect(willAdd).toContainText(`Location: ${fixture.venue}`);
      await expect(willAdd).toContainText("Event time: not confirmed");
      await expect(willAdd).toContainText(`People expected (confirmed): ${fixture.person}`);
      await expect(willAdd).toContainText("labelled as suggestions");

      const summary = page.getByRole("complementary", { name: "Confirmation summary" });
      await summary.getByRole("button", { name: "Review the draft" }).click();
      await expect(region).toContainText("What will be created");
      await expect(region).toContainText(
        "No package, recipient, submission, delivery link or buyer record is created",
      );
      await expect(region).toContainText("Will remain unconfirmed on the draft");
      await expect(region).toContainText("Event time (recorded, not confirmed)");
      expect(await hasHorizontalOverflow(page)).toBe(false);

      await clickCreate(summary.getByRole("button", { name: "Create draft shoot" }));
      const created = page.getByRole("status").filter({ hasText: "Draft shoot created" });
      const outcome = await settleAfterCreate(page, created, "Handed off to a draft shoot");
      if (outcome === "status") await expect(created).toContainText("still a draft");

      const shoots = await rest<
        {
          id: string;
          status: string;
          location_name: string | null;
          starts_at: string | null;
          timezone: string | null;
          notes: string | null;
          story_angle: string | null;
        }[]
      >(
        `shoots?opportunity_id=eq.${fixture.shootPathId}&select=id,status,location_name,starts_at,timezone,notes,story_angle`,
        { method: "GET" },
      );
      expect(shoots).toHaveLength(1);
      expect(shoots[0]).toMatchObject({
        status: "draft",
        location_name: fixture.venue,
        starts_at: null,
        story_angle: null,
      });
      expect(shoots[0].timezone).toBeTruthy();
      expect(shoots[0].notes).toContain(
        `People expected (confirmed by the photographer): ${fixture.person}`,
      );
      expect(shoots[0].notes).toMatch(/News Radar suggestion/);
      const packages = await rest<unknown[]>(`packages?shoot_id=eq.${shoots[0].id}&select=id`, {
        method: "GET",
      });
      expect(packages).toHaveLength(0);

      await page.getByRole("link", { name: "Continue in the shoot" }).click();
      await expect(page).toHaveURL(new RegExp(`/shoots/${shoots[0].id}`));

      // Back on the path: handed off, the same shoot, nothing new offered.
      await page.goto(at(`/news/${fixture.shootPathId}`));
      await expect(page.getByText("Handed off to a draft shoot")).toBeVisible();
      await expect(page.getByRole("button", { name: "Create draft shoot" })).toHaveCount(0);
      const again = await rest<unknown[]>(
        `shoots?opportunity_id=eq.${fixture.shootPathId}&select=id`,
        { method: "GET" },
      );
      expect(again).toHaveLength(1);
    } finally {
      await cleanUp(fixture);
    }
  });

  test("keyboard reaches selection and confirmation; a viewer is offered neither", async ({
    page,
  }) => {
    const fixture = await arrange("keyboard");
    try {
      await signIn(page, EDITOR);
      await evaluate(page, fixture.archiveId);
      const region = page.getByRole("form", { name: "Build a draft package from the matches" });
      const box = region.getByRole("checkbox", {
        name: `${fixture.person} arrives at ${fixture.venue}`,
      });
      await box.focus();
      await page.keyboard.press("Space");
      await expect(box).toBeChecked();
      const summary = page.getByRole("complementary", { name: "Selection summary" });
      await summary.getByRole("button", { name: "Review selection" }).focus();
      await page.keyboard.press("Enter");
      await expect(region).toContainText("What will be created", { timeout: 60_000 });
      await summary.getByRole("button", { name: "Back to selection" }).focus();
      await page.keyboard.press("Enter");
      // The step transition re-renders the cards; give it the stall allowance.
      await expect(box).toBeChecked({ timeout: 60_000 });

      await page.context().clearCookies();
      await signIn(page, VIEWER);
      await page.goto(at(`/news/${fixture.archiveId}`));
      await expect(page.getByText("needs an owner or editor").first()).toBeVisible();
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Create draft/ })).toHaveCount(0);
    } finally {
      await cleanUp(fixture);
    }
  });
});
