import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Password recovery, end to end, against the real auth server and a real
 * mailbox.
 *
 * Nothing here is mocked. A reset is asked for through the form, the message is
 * read out of the local mail catcher, the link in it is followed the way a
 * browser follows it, and the new password is then used to sign in. That is the
 * only way to catch what this flow was actually doing wrong: every screen
 * rendered correctly while the session the password form depended on was never
 * being created at all.
 *
 * Each test makes its own throwaway account and deletes it afterwards. The
 * seeded accounts are deliberately untouched -- the local stack is shared with
 * every other test file and, on this machine, with concurrent work in other
 * worktrees, so changing marcus@mastline.test's password would break runs that
 * have nothing to do with this feature. A fresh account per test also sidesteps
 * the auth server's one-second minimum between reset emails to the same user.
 */

/**
 * Answer the cookie banner for the origin these tests actually run against.
 *
 * e2e/helpers.ts has `refuseCookies`, but it pins the cookies to
 * http://127.0.0.1:4100, and this suite has to be runnable on another port:
 * 4100 may already be held by a Playwright server from a different branch, and
 * `reuseExistingServer` would then quietly point the run at somebody else's
 * build. Setting the same two cookies against the configured baseURL keeps the
 * suite honest wherever it is pointed. Refusing, not accepting -- nothing is
 * granted that a real visitor would have had to agree to.
 */
async function refuseCookiesAt(context: BrowserContext): Promise<void> {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  // Both loopback names, because one test reaches the same server as
  // localhost to prove the emailed link does not follow the request's host.
  for (const url of new Set([origin, origin.replace("127.0.0.1", "localhost")])) {
    await context.addCookies([
      { name: "ml_consent", value: "denied", url },
      { name: "ml_country", value: "US", url },
    ]);
  }
}

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? localEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

/** The local mail catcher the Supabase CLI runs (Mailpit). */
const MAIL = process.env.MAILPIT_URL ?? "http://127.0.0.1:55324";

const OLD_PASSWORD = "old-mastline-password-1";
const NEW_PASSWORD = "new-mastline-password-2";

function admin(): { apikey: string; Authorization: string } {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("No Supabase URL or service role key: cannot manage a throwaway account.");
  }
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}

interface Throwaway {
  readonly id: string;
  readonly email: string;
}

/**
 * An account that exists only for one test.
 *
 * `email_confirm` is set so the account is usable immediately: an unconfirmed
 * address would change what the auth server does with a recovery request and
 * the test would be measuring the wrong thing.
 */
async function createAccount(label: string): Promise<Throwaway> {
  const email = `recovery-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@mastline.test`;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...admin(), "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: OLD_PASSWORD, email_confirm: true }),
  });
  if (!response.ok) throw new Error(`Could not create ${email}: ${await response.text()}`);
  const { id } = (await response.json()) as { id: string };
  return { id, email };
}

async function deleteAccount(account: Throwaway | undefined): Promise<void> {
  if (!account) return;
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${account.id}`, {
    method: "DELETE",
    headers: admin(),
  });
}

/** Every message the mail catcher is holding for one address, newest first. */
async function messagesFor(address: string): Promise<{ ID: string }[]> {
  const response = await fetch(
    `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  );
  if (!response.ok) {
    throw new Error(
      `The local mail catcher did not answer (${response.status}). Is \`supabase start\` running?`,
    );
  }
  const { messages } = (await response.json()) as { messages?: { ID: string }[] };
  return messages ?? [];
}

/**
 * Wait for a reset email and hand back the link inside it.
 *
 * Polled rather than slept on: delivery is usually immediate but the assertion
 * that matters is "a message arrived", and a fixed wait either makes every run
 * slower or makes a slow one flaky.
 */
async function waitForResetLink(address: string, seen: Set<string> = new Set()): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const fresh = (await messagesFor(address)).filter((message) => !seen.has(message.ID));
    if (fresh.length > 0) {
      seen.add(fresh[0].ID);
      const detail = (await (await fetch(`${MAIL}/api/v1/message/${fresh[0].ID}`)).json()) as {
        HTML?: string;
        Text?: string;
      };
      const body = detail.HTML || detail.Text || "";
      const href = body.match(/href="([^"]+)"/)?.[1];
      if (!href) throw new Error(`The reset email to ${address} carried no link.`);
      return href.replace(/&amp;/g, "&");
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`No reset email reached ${address} within 15s.`);
}

/** Ask for a reset link through the real form, optionally under another origin. */
async function requestReset(page: Page, address: string, origin = ""): Promise<void> {
  await page.goto(`${origin}/reset-password`);
  await page.getByLabel("Email").fill(address);
  await page.getByRole("button", { name: /send link/i }).click();
  await expect(page.getByRole("heading", { name: /check the inbox/i })).toBeVisible();
}

/**
 * Where the auth server sends a browser that follows the emailed link.
 *
 * Fetched rather than navigated so the redirect can be inspected before the
 * application sees it. This is what proves which protocol is in play: the
 * destination carries `?code=`, not a token hash and not a fragment.
 */
async function followLink(link: string): Promise<URL> {
  const response = await fetch(link, { redirect: "manual" });
  const location = response.headers.get("location");
  if (!location) throw new Error(`The auth server did not redirect (${response.status}).`);
  return new URL(location);
}

async function signInThrough(page: Page, address: string, password: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
}

/** A refresh token for an account, obtained the way a signed-in device holds one. */
async function refreshTokenFor(address: string, password: string): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ email: address, password }),
  });
  if (!response.ok) throw new Error(`Could not sign in as ${address}: ${await response.text()}`);
  const { refresh_token: token } = (await response.json()) as { refresh_token: string };
  return token;
}

async function refreshStillWorks(token: string): Promise<boolean> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: ANON_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: token }),
  });
  return response.ok;
}

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await refuseCookiesAt(context);
  return context.newPage();
}

test.describe("password recovery", () => {
  let account: Throwaway | undefined;

  test.beforeEach(async ({ context }) => {
    await refuseCookiesAt(context);
  });

  test.afterEach(async () => {
    await deleteAccount(account);
    account = undefined;
  });

  test("the response is the same whether or not the address has an account", async ({ page }) => {
    account = await createAccount("neutral");

    await requestReset(page, account.email);
    const known = await page.locator(".gate-sent").innerText();

    const unknown = `absent-${Date.now()}@mastline.test`;
    await requestReset(page, unknown);
    const stranger = await page.locator(".gate-sent").innerText();

    // Byte for byte, including the heading and the note under it.
    expect(stranger).toBe(known);

    // And the screen is not the only channel: an address with no account must
    // not receive a message either.
    expect(await messagesFor(unknown)).toHaveLength(0);
  });

  test("the emailed destination comes from configuration, not from the request", async ({
    page,
  }) => {
    account = await createAccount("origin");
    const configured = new URL(test.info().project.use.baseURL!).origin;

    await requestReset(page, account.email);
    const seen = new Set<string>();
    const first = await waitForResetLink(account.email, seen);

    expect(
      new URL(first).searchParams.get("redirect_to"),
      "The emailed link points somewhere this test cannot follow. The application must be built " +
        `with NEXT_PUBLIC_SITE_URL=${configured} so its canonical origin matches the origin the ` +
        "browser tests run against.",
    ).toBe(`${configured}/auth/recovery`);

    // The auth server allows one reset email per account per second.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    /*
     * The same server, asked again under a different name.
     *
     * localhost:4200 and 127.0.0.1:4200 are one process, but a request to each
     * arrives with a different Host and a different Origin -- and those two
     * headers are precisely what the previous implementation built the emailed
     * link out of. If it still did, this request would put `http://localhost:`
     * in the mail; the auth server does not carry that name on its allow list
     * and would substitute the site URL. Neither outcome is the address below,
     * so this fails the day the destination goes back to being caller-supplied.
     *
     * Spoofing X-Forwarded-Host would be the more direct statement of the same
     * idea and cannot be made here: Next refuses a Server Action whose
     * forwarded host disagrees with its origin, so the request never reaches
     * the code under test. Two names for one loopback interface is the version
     * of the experiment that actually runs.
     */
    await requestReset(page, account.email, configured.replace("127.0.0.1", "localhost"));
    const second = await waitForResetLink(account.email, seen);
    expect(new URL(second).searchParams.get("redirect_to")).toBe(`${configured}/auth/recovery`);
  });

  test("a link establishes a recovery session, sets a new password, and ends every session", async ({
    page,
    browser,
  }) => {
    account = await createAccount("happy");

    // A session that already exists when the reset happens: this is the one a
    // stolen password would be holding, and it has to die.
    const obsolete = await refreshTokenFor(account.email, OLD_PASSWORD);
    expect(await refreshStillWorks(obsolete)).toBe(true);

    await requestReset(page, account.email);
    const link = await waitForResetLink(account.email);

    // The protocol actually in use: an authorization code in the query string.
    const landing = await followLink(link);
    expect(landing.pathname).toBe("/auth/recovery");
    expect(landing.searchParams.get("code")).toBeTruthy();
    expect(landing.searchParams.get("token_hash")).toBeNull();
    expect(landing.hash).toBe("");

    // Follow it as a browser does, all the way through the exchange.
    await page.goto(landing.toString());
    await expect(page).toHaveURL(/\/reset-password\/update$/);
    await expect(page.getByRole("heading", { name: /choose a new one/i })).toBeVisible();

    // The credential does not survive into the address bar of the page it lands on.
    expect(page.url()).not.toContain("code=");

    await page.getByLabel(/^New password/).fill(NEW_PASSWORD);
    await page.getByLabel(/^Confirm new password/).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: /update password/i }).click();

    // Success leaves the screen that required the recovery session, because the
    // change ends that session. The confirmation is served without one.
    await expect(page).toHaveURL(/\/reset-password\?updated=1$/);
    await expect(page.getByRole("heading", { name: /password updated/i })).toBeVisible();

    // The policy: every session, everywhere. The one that predated the reset...
    expect(await refreshStillWorks(obsolete)).toBe(false);

    // ...and the recovery session itself, in this very browser.
    await page.goto("/reset-password/update");
    await expect(page).toHaveURL(/\/reset-password\?link=invalid$/);

    // The new password works.
    const signedIn = await freshPage(browser);
    await signInThrough(signedIn, account.email, NEW_PASSWORD);
    await expect(signedIn).not.toHaveURL(/\/sign-in/, { timeout: 20_000 });

    // The old one does not.
    const refused = await freshPage(browser);
    await signInThrough(refused, account.email, OLD_PASSWORD);
    await expect(refused.locator("p.gate-error")).toBeVisible();
    await expect(refused).toHaveURL(/\/sign-in/);
  });

  test("a link cannot be used twice", async ({ page, browser }) => {
    account = await createAccount("replay");

    await requestReset(page, account.email);
    const link = await waitForResetLink(account.email);

    const first = await followLink(link);
    expect(first.searchParams.get("code")).toBeTruthy();
    await page.goto(first.toString());
    await expect(page).toHaveURL(/\/reset-password\/update$/);

    /*
     * The second attempt is refused by the auth server before the application
     * is involved: the link comes back with error parameters and no code. The
     * route has to recognise that shape rather than looking only for a missing
     * code.
     */
    const second = await followLink(link);
    expect(second.searchParams.get("code")).toBeNull();
    expect(second.searchParams.get("error")).toBe("access_denied");

    const other = await freshPage(browser);
    await other.goto(second.toString());
    // Not anchored: the auth server repeats its error in the fragment as well
    // as the query, and the browser carries the fragment through the redirect.
    // It holds no secret -- the error text and nothing else.
    await expect(other).toHaveURL(/\/reset-password\?link=invalid/);
    await expect(other.locator("p.gate-error")).toContainText(/cannot be used/i);
  });

  test("a malformed, absent, or foreign code is refused", async ({ page }) => {
    for (const query of [
      "?code=not-a-real-authorization-code",
      "?code=",
      "",
      "?error=access_denied&error_code=otp_expired",
    ]) {
      await page.goto(`/auth/recovery${query}`);
      await expect(page, `/auth/recovery${query} should have been refused`).toHaveURL(
        /\/reset-password\?link=invalid$/,
      );
    }
  });

  test("the password screen is not served without a recovery session", async ({ page }) => {
    await page.goto("/reset-password/update");
    await expect(page).toHaveURL(/\/reset-password\?link=invalid$/);
    // Scoped to the notice: Next's route announcer is also role="alert".
    await expect(page.locator("p.gate-error")).toBeVisible();
  });

  test("the recovery route is not cached", async ({ page }) => {
    const response = await page.request.get("/auth/recovery?code=irrelevant", {
      maxRedirects: 0,
    });
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
});
