import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { SEEDED_ASSET, SEEDED_WORKSPACE, at, refuseCookies, signIn } from "./helpers";

/**
 * Rights triage, driven through the real interface.
 *
 * The seeded workspace has exactly one observed use, and this needs a match
 * that is NOT first in the queue -- so the spec arranges two of its own, older
 * than the seeded one so they sort below it, and removes them afterwards. They
 * are created with the service role because an observation is not something a
 * member records by hand; every decision below is made by clicking.
 *
 * The concurrency and permission matrices live in tests/rights-review.test.ts,
 * where they can be asserted precisely. What is here is the part only a browser
 * can answer: that a reviewer can find a match, that a consequential decision
 * takes two motions and a reason, that a blocked control says why, and that a
 * read-only colleague is not offered any of it.
 */

const RIGHTS_REVIEWER = "rhea@mastline.test";
const VIEWER = "vera@mastline.test";
const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";

const LEDGER = "Triage Fixture Ledger";
const GAZETTE = "Triage Fixture Gazette";

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
  if (!url || !key) throw new Error("No service role key: cannot arrange rights fixtures.");
  return { url, key };
}

/**
 * An observed use to triage.
 *
 * `last_observed_at` is deliberately older than the seeded match, because the
 * queue is ordered by it and the point of the first test is to select something
 * other than the top row. The source URL is unique per run: the table is unique
 * on (organization, asset, source URL), so a fixed one would work exactly once.
 */
async function createMatch(publisher: string, licenseCheck: string, observed: string) {
  const { url, key } = service();
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const response = await fetch(`${url}/rest/v1/rights_matches`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      organization_id: ORG_A,
      asset_id: SEEDED_ASSET,
      status: "new",
      source_url: `https://triage-e2e.example/${stamp}/${encodeURIComponent(publisher)}`,
      publisher_name: publisher,
      publisher_domain: "triage-e2e.example",
      page_title: `${publisher} ran the frame`,
      first_observed_at: observed,
      last_observed_at: observed,
      match_method: "Perceptual hash + crop tolerance",
      confidence: 0.8721,
      license_check: licenseCheck,
      evidence_bucket: "evidence",
      evidence_object_key: `${ORG_A}/rights/e2e-${stamp}.png`,
    }),
  });
  if (!response.ok) throw new Error(`Could not arrange a match: ${await response.text()}`);
  const [row] = (await response.json()) as { id: string; source_url: string }[];
  return row;
}

async function deleteMatch(id: string): Promise<void> {
  const { url, key } = service();
  const response = await fetch(`${url}/rest/v1/rights_matches?id=eq.${id}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
  });
  if (!response.ok) throw new Error(`Could not clean up ${id}: ${await response.text()}`);
}

let ledger: { id: string; source_url: string };
let gazette: { id: string; source_url: string };

test.beforeAll(async () => {
  // Older than the seeded match (2026-08-20), so neither lands at the top.
  ledger = await createMatch(LEDGER, "no_linked_license_found", "2026-08-18T10:00:00Z");
  gazette = await createMatch(GAZETTE, "no_linked_license_found", "2026-08-17T10:00:00Z");
});

test.afterAll(async () => {
  // The activity events these decisions wrote are append-only and stay behind,
  // which is what an append-only history is for.
  if (ledger) await deleteMatch(ledger.id);
  if (gazette) await deleteMatch(gazette.id);
});

/** The "Human decision" card on the selected match. */
function decisionCard(page: import("@playwright/test").Page) {
  return page.locator(".side-card", {
    has: page.getByRole("heading", { name: "Human decision" }),
  });
}

test("a rights reviewer can select a match and record a defensible decision", async ({
  context,
  page,
}) => {
  await refuseCookies(context);
  await signIn(page, RIGHTS_REVIEWER);
  await page.goto(at("/rights"));

  // The fixture is not the top row, which is the whole reason it was arranged.
  const firstRow = page.locator("table.data-table tbody tr").first();
  await expect(firstRow).not.toContainText(LEDGER);

  const row = page.getByRole("row", { name: new RegExp(LEDGER) });
  await row.getByRole("link", { name: /select/i }).click();

  await expect(page).toHaveURL(new RegExp(`/${SEEDED_WORKSPACE}/rights\\?match=${ledger.id}`));
  await expect(page.getByRole("heading", { name: LEDGER })).toBeVisible();
  await expect(page.getByRole("link", { name: ledger.source_url })).toBeVisible();
  // The selection is announced, not only drawn.
  await expect(page.locator("tr[aria-current='true']")).toContainText(LEDGER);
  await expect(decisionCard(page)).toContainText("Not reviewed yet");

  // 3. Start review -------------------------------------------------------
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByRole("status")).toContainText(/internal review started/i);
  await expect(decisionCard(page)).toContainText("Reviewing");

  // 4. And it is really on the record, not just on the screen.
  await page.reload();
  await expect(decisionCard(page)).toContainText("Reviewing");
  await expect(decisionCard(page)).toContainText("rhea");

  // 5. Monitor, with a note ------------------------------------------------
  await expect(page.getByText(/starts no crawler, schedule, or automatic re-check/i)).toBeVisible();
  await page
    .getByLabel(/why this is being held/i)
    .fill("Waiting for the syndication list before deciding anything.");
  await page.getByRole("button", { name: /hold for monitoring/i }).click();

  await expect(page.getByRole("status")).toContainText(/nothing is scheduled/i);
  await expect(decisionCard(page)).toContainText("Monitoring");
  await expect(decisionCard(page)).toContainText("Waiting for the syndication list");
  await expect(decisionCard(page)).toContainText("rhea");
  // A review date and time, rather than the placeholder that stood there before.
  await expect(decisionCard(page)).not.toContainText("Not reviewed yet");
  await expect(decisionCard(page)).toContainText(/[A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2}/);

  // 6. Licensed is blocked, and says why -----------------------------------
  const licensed = page.getByRole("button", { name: "Mark licensed" });
  await expect(licensed).toBeDisabled();
  await expect(
    page.getByText("Link and verify the applicable license before marking this use as licensed."),
  ).toBeVisible();

  // 7. Ignoring needs a confirmation and a reason ---------------------------
  await page.getByRole("button", { name: /^Ignore this match$/ }).click();
  const confirm = page.getByRole("button", { name: /yes, ignore this match/i });
  await expect(confirm).toBeVisible();
  await expect(decisionCard(page)).toContainText("Monitoring");

  // Pressing it with no reason records nothing: the field is required.
  await confirm.click();
  await expect(decisionCard(page)).toContainText("Monitoring");
  const note = page.getByLabel(/why this is being set aside/i);
  await expect(note).toHaveJSProperty("validity.valueMissing", true);

  await note.fill("We shot this for them on assignment; the use is expected.");
  await confirm.click();

  await expect(page.getByRole("status")).toContainText(/remain on the record/i);
  await expect(decisionCard(page)).toContainText("Ignored");
  await expect(decisionCard(page)).toContainText("shot this for them on assignment");
  // Nothing was deleted: the observation and its evidence are still shown.
  await expect(page.getByRole("link", { name: ledger.source_url })).toBeVisible();
  await expect(page.getByText("Captured and stored privately")).toBeVisible();
});

test("an unusable match id selects nothing and says nothing about elsewhere", async ({
  context,
  page,
}) => {
  await refuseCookies(context);
  await signIn(page, RIGHTS_REVIEWER);

  await page.goto(`${at("/rights")}?match=00000000-0000-4000-8000-000000000000`);
  // Scoped to the queue: Next's own route announcer is also an alert region.
  const queue = page.locator(".panel", {
    has: page.getByRole("heading", { name: "Match queue" }),
  });
  await expect(queue.getByRole("alert")).toContainText(/not in this workspace/i);
  await expect(page.getByRole("heading", { name: "Selected match" })).toHaveCount(0);
});

test("a viewer can read a match but is offered no triage controls", async ({ context, page }) => {
  await refuseCookies(context);
  await signIn(page, VIEWER);
  await page.goto(`${at("/rights")}?match=${gazette.id}`);

  // Everything recorded about the use is readable.
  await expect(page.getByRole("heading", { name: GAZETTE })).toBeVisible();
  await expect(page.getByRole("link", { name: gazette.source_url })).toBeVisible();
  await expect(page.getByText("Perceptual hash + crop tolerance").first()).toBeVisible();

  await expect(page.getByText(/read-only for your role/i)).toBeVisible();
  for (const label of ["Start review", "Hold for monitoring", "Ignore this match", "Mark licensed"]) {
    await expect(page.getByRole("button", { name: label })).toHaveCount(0);
  }
});
