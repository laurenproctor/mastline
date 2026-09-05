import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { SEEDED_WORKSPACE, at, hasHorizontalOverflow, refuseCookies, signIn } from "./helpers";

/**
 * The requests inbox, driven through the real interface.
 *
 * The lifecycle matrix, the permission matrix and the concurrency behaviour all
 * live in tests/buyer-requests.test.ts, where they can be asserted precisely
 * against the real policies. What is here is the part only a browser can
 * answer: that somebody can record what a desk just told them and find it
 * again, that a closed request offers no way back, that the inbox does not
 * scroll sideways on a phone, and that a read-only colleague is not shown
 * controls they cannot use.
 *
 * The requests these create are removed with the service role afterwards --
 * `authenticated` has no delete grant on the table, deliberately, so there is
 * no way to do it by clicking and nor should there be.
 */

const VIEWER = "vera@mastline.test";
const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";

/** Playwright does not load .env.local, and cleanup needs the service key. */
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
  if (!url || !key) throw new Error("No service role key: cannot clean up request fixtures.");
  return { url, key };
}

async function deleteRequestsTitled(prefix: string): Promise<void> {
  const { url, key } = service();
  const response = await fetch(
    `${url}/rest/v1/buyer_requests?organization_id=eq.${ORG_A}&title=like.${encodeURIComponent(`${prefix}%`)}`,
    {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
    },
  );
  if (!response.ok) throw new Error(`Could not clean up requests: ${await response.text()}`);
}

const TITLE_PREFIX = "E2E request";

/** The seeded owner, from supabase/seed.sql. */
const OWNER = "11111111-1111-1111-1111-111111111111";

/**
 * A request sitting in the inbox, written directly.
 *
 * The seed carries no buyer requests at all, so the inbox is empty until a test
 * makes one -- and an empty inbox renders a sentence where the table would be,
 * with no labelled region to scroll inside. The phone layout test below was
 * carried by whichever sibling had run first and left a row behind. That held
 * only for as long as every test in this file ran in every project, which
 * stopped being true when the projects started selecting by tag: the phone test
 * is the only one here that runs on the phone, so it arrived at an empty inbox
 * and found nothing to measure.
 *
 * It makes its own row now. Written with the service role rather than through
 * the form because this is a fixture and not the thing under test -- recording
 * a request by hand is what "a photographer can record what a desk asked for"
 * above is for -- and titled with the prefix so afterAll takes it away again.
 */
async function createRequest(subject: string): Promise<void> {
  const { url, key } = service();
  const stamp = Date.now();
  const response = await fetch(`${url}/rest/v1/buyer_requests`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      organization_id: ORG_A,
      created_by: OWNER,
      idempotency_key: `e2e-inbox-${stamp}`,
      reference: `E2E-${stamp}`,
      title: `${TITLE_PREFIX} — ${subject}`,
      brief: "Rang asking what we have from last night.",
      received_via: "phone",
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not create a request fixture: ${await response.text()}`);
  }
}

test.afterAll(async () => {
  // The activity events these wrote are append-only and stay behind, which is
  // what an append-only history is for.
  await deleteRequestsTitled(TITLE_PREFIX);
});

test(
  "Requests sits between News radar and Shoots in the navigation",
  { tag: "@responsive" },
  async ({ context, page }) => {
    await refuseCookies(context);
    await signIn(page);

    const nav = page.getByRole("navigation", { name: "Primary" });
    const labels = await nav.getByRole("link").allInnerTexts();
    const trimmed = labels.map((label) => label.trim());

    expect(trimmed.indexOf("Requests")).toBe(trimmed.indexOf("News radar") + 1);
    expect(trimmed.indexOf("Shoots")).toBe(trimmed.indexOf("Requests") + 1);

    await nav.getByRole("link", { name: "Requests" }).click();
    // The canonical, workspace-scoped address -- not a bare /requests served by
    // the middleware's legacy redirect.
    await expect(page).toHaveURL(new RegExp(`/${SEEDED_WORKSPACE}/requests$`));
    await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
  },
);

test("a photographer can record what a desk asked for and find it again", async ({
  context,
  page,
}) => {
  await refuseCookies(context);
  await signIn(page);
  await page.goto(at("/requests/new"));

  const title = `${TITLE_PREFIX} — Chelsea departure`;
  await page.getByLabel(/^title/i).fill(title);
  await page.getByLabel(/^brief$/i).fill("Rang at 6am asking what we have from last night.");
  await page.getByLabel(/how it arrived/i).selectOption("phone");

  // Saving must never claim to have contacted anybody.
  await expect(
    page.getByText(/no message, file, or notification reaches the buyer/i),
  ).toBeVisible();

  await page.getByRole("button", { name: /^record request$/i }).click();

  await expect(page).toHaveURL(new RegExp(`/${SEEDED_WORKSPACE}/requests/[0-9a-f-]{36}`));
  await expect(page.getByRole("status")).toContainText(/nothing was sent to the buyer/i);
  // Twice on the page: as the header description, and in the history entry the
  // creation wrote. Either one is proof it landed.
  await expect(page.getByText(title).first()).toBeVisible();

  // A reference somebody can read down a phone.
  await expect(page.getByText(/REQ-\d{4}-\d{4}/).first()).toBeVisible();

  // Every term the desk did not mention reads as unstated, not as a default.
  await expect(page.getByText("Not provided").first()).toBeVisible();

  await page.goto(at("/requests"));
  await expect(page.getByRole("row", { name: new RegExp(title) })).toBeVisible();
});

test("a request closed as declined offers no way back", async ({ context, page }) => {
  await refuseCookies(context);
  await signIn(page);
  await page.goto(at("/requests/new"));

  const title = `${TITLE_PREFIX} — declined`;
  await page.getByLabel(/^title/i).fill(title);
  await page.getByRole("button", { name: /^record request$/i }).click();
  await expect(page).toHaveURL(new RegExp(`/${SEEDED_WORKSPACE}/requests/[0-9a-f-]{36}`));

  await page.getByLabel(/move this request to/i).selectOption("declined");

  // Two things a closing decision must ask for before it is recorded.
  const reason = page.getByLabel(/^reason/i);
  await expect(reason).toHaveAttribute("required", "");
  await expect(page.getByText(/you turned it down/i)).toBeVisible();

  await reason.fill("Not a story we cover.");
  await page.getByLabel(/cannot be reopened/i).check();
  await page.getByRole("button", { name: /^record$/i }).click();

  await expect(page.getByRole("status")).toContainText(/declined/i);
  await expect(page.getByText(/cannot be reopened/i)).toBeVisible();
  // No control at all, rather than one that would be refused.
  await expect(page.getByLabel(/move this request to/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /save changes/i })).toHaveCount(0);
});

test("a past-deadline request says so in words, not only in colour", async ({ context, page }) => {
  await refuseCookies(context);
  await signIn(page);
  await page.goto(at("/requests/new"));

  const title = `${TITLE_PREFIX} — overdue`;
  await page.getByLabel(/^title/i).fill(title);
  await page.getByLabel(/response deadline/i).fill("2020-01-01T09:00");
  await page.getByRole("button", { name: /^record request$/i }).click();
  await expect(page).toHaveURL(new RegExp(`/${SEEDED_WORKSPACE}/requests/[0-9a-f-]{36}`));

  await expect(page.getByText("Past deadline").first()).toBeVisible();

  await page.goto(at("/requests"));
  const row = page.getByRole("row", { name: new RegExp(title) });
  await expect(row).toContainText("Past deadline");
  // Nothing moved it to Expired. There is no scheduler, so a passing deadline
  // is a derived fact, not a status somebody's clock wrote.
  await expect(row).toContainText("New");
});

test("a read-only colleague can read the inbox and is offered no controls", async ({
  context,
  page,
}) => {
  await refuseCookies(context);
  await signIn(page, VIEWER);
  await page.goto(at("/requests"));

  await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
  await expect(page.getByRole("link", { name: /record a request/i })).toHaveCount(0);
});

test(
  "the inbox does not scroll sideways on a phone",
  { tag: "@responsive" },
  async ({ context, page }) => {
    test.skip(test.info().project.name !== "mobile", "The phone viewport is the question here.");

    // A row of its own, because there is a table to measure only if the inbox
    // has something in it. See createRequest.
    await createRequest("Chelsea departure at dawn");

    await refuseCookies(context);
    await signIn(page);
    await page.goto(at("/requests"));

    await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
    // A wide table is allowed to scroll inside its own labelled region; the page
    // behind it is not.
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await expect(page.getByRole("region", { name: "Requests" })).toBeVisible();
  },
);
