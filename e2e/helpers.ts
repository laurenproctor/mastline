import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { BrowserContext, Page } from "@playwright/test";

export const SEEDED = {
  owner: "marcus@mastline.test",
  editor: "jordan@mastline.test",
  viewer: "vera@mastline.test",
  password: "mastline-dev-password",
} as const;

export const SEEDED_SHOOT = "a0000000-0000-0000-0000-0000000000c1";
export const SEEDED_ASSET = "a0000000-0000-0000-0000-0000000000d1";

/**
 * The seeded workspace's address, from supabase/seed.sql.
 *
 * Every authenticated destination in these tests is written through `at()`
 * below rather than as a bare "/work". A bare path is served only by the
 * middleware's legacy redirect, which resolves it from the active-workspace
 * cookie -- so a suite written that way tests the compatibility layer while
 * appearing to test the application. The legacy redirect has a test of its own,
 * in workspace-routing.spec.ts, which is where it belongs.
 */
export const SEEDED_WORKSPACE = "marcus-hale-studio";

/**
 * Answer the cookie banner before the test starts.
 *
 * The banner is pinned to the bottom of the window and, on a 390px phone, sits
 * over the controls at the foot of a page -- Playwright reports it as
 * "intercepts pointer events" and the click never lands. The consent tests
 * exist to exercise that banner; every other test needs it out of the way, and
 * refusing is the honest way to do it: nothing is granted that a real visitor
 * would have had to agree to.
 */
export async function refuseCookies(context: BrowserContext): Promise<void> {
  await context.addCookies([
    { name: "ml_consent", value: "denied", url: "http://127.0.0.1:4100" },
    // A country the banner is not required to ask in, so it does not reappear.
    { name: "ml_country", value: "US", url: "http://127.0.0.1:4100" },
  ]);
}

/**
 * Accept optional analytics, for the one surface that has any.
 *
 * The recipient delivery page measures viewing time only where the visitor's
 * consent allows it, and with no geo header -- which is every local run -- the
 * gate treats the visitor as somebody who has to be asked. That is the right
 * default and it means a test of the measurement has to say yes first, exactly
 * as a recipient would.
 */
export async function acceptCookies(context: BrowserContext): Promise<void> {
  await context.addCookies([
    { name: "ml_consent", value: "granted", url: "http://127.0.0.1:4100" },
    { name: "ml_country", value: "US", url: "http://127.0.0.1:4100" },
  ]);
}

/** A path inside a workspace. `at("/work")` -> "/marcus-hale-studio/work". */
export function at(path: string, workspace: string = SEEDED_WORKSPACE): string {
  return `/${workspace}${path}`;
}

/**
 * Sign in through the real form, because that is a smoke test in itself.
 *
 * The destination is named explicitly. Signing in used to land on "/work" and
 * let the middleware choose a workspace, which is both the thing under repair
 * and ambiguous the moment an account has more than one membership -- as the
 * two-tab test's account deliberately does.
 */
export async function signIn(
  page: Page,
  email: string = SEEDED.owner,
  workspace: string = SEEDED_WORKSPACE,
): Promise<void> {
  const destination = at("/work", workspace);
  await page.goto(`/sign-in?next=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SEEDED.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(`**${destination}`, { timeout: 120_000 });
}

/**
 * Does the page scroll sideways?
 *
 * The most common responsive failure is a table or a grid that will not shrink,
 * and it is invisible to anything that only reads HTML.
 */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    // One pixel of tolerance for sub-pixel rounding.
    return doc.scrollWidth > doc.clientWidth + 1;
  });
}

/** Elements wider than the viewport, named so a failure says what to fix. */
export async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const guilty: string[] = [];
    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // Ignore anything that clips or scrolls on purpose, and anything inside
      // it. A wide table inside a scroller is the point, not a failure, and so
      // is a marquee that is deliberately wider than the window it runs in.
      // What matters is whether the page itself scrolls sideways, which
      // hasHorizontalOverflow answers.
      const clipped = (node: HTMLElement | null): boolean => {
        for (let el = node; el && el !== document.body; el = el.parentElement) {
          const overflowX = getComputedStyle(el).overflowX;
          if (
            overflowX === "auto" ||
            overflowX === "scroll" ||
            overflowX === "hidden" ||
            overflowX === "clip"
          ) {
            return true;
          }
        }
        return false;
      };
      if (clipped(element)) continue;
      if (box.right > width + 1) {
        const id = element.id ? `#${element.id}` : "";
        const cls =
          element.className && typeof element.className === "string"
            ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
            : "";
        guilty.push(
          `${element.tagName.toLowerCase()}${id}${cls} (right ${Math.round(box.right)} > ${width})`,
        );
      }
    }
    return [...new Set(guilty)].slice(0, 8);
  });
}

/** Is anything actually painted where focus is? */
export async function focusRingIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) return false;
    const style = getComputedStyle(active);
    const hasOutline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth || "0") > 0;
    const hasShadow = style.boxShadow !== "none" && style.boxShadow !== "";
    return hasOutline || hasShadow;
  });
}

/**
 * Collect real page errors, ignoring aborted RSC prefetches.
 *
 * Next prefetches the links in the nav. Navigating away kills those requests
 * mid-flight, and WebKit reports an aborted fetch as "Fetch API cannot load
 * <url> due to access control checks" -- same-origin, nothing to do with CORS.
 * It surfaces from Next's own router chunk, so there is nothing here to fix.
 *
 * Verified rather than assumed: a page left alone for five seconds raises none
 * of these, and every navigation test passes in WebKit. Only the `_rsc=`
 * prefetch URLs are ignored; anything else still fails the test.
 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    const text = `${error.name}: ${error.message}`;
    if (/[?&]_rsc=/.test(text)) return;
    errors.push(error.message);
  });
  return errors;
}

/**
 * A working TOTP code, so the two-factor tests exercise the real thing.
 *
 * RFC 6238 over RFC 4226: HMAC-SHA1 of the 30-second counter, dynamically
 * truncated to six digits. Written out rather than pulled in, because a
 * dependency for fifteen lines of well-specified arithmetic is a dependency to
 * keep patched for ever.
 */
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index === -1) throw new Error(`Not base32: ${character}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

/**
 * A code that has not been used yet.
 *
 * A verified code cannot be presented twice, so when the previous one is still
 * showing this waits for the next 30-second window rather than failing.
 */
export async function freshTotp(secret: string, previous?: string): Promise<string> {
  let code = totp(secret);
  while (previous && code === previous) {
    const msIntoWindow = Date.now() % 30_000;
    await new Promise((resolve) => setTimeout(resolve, 30_000 - msIntoWindow + 500));
    code = totp(secret);
  }
  return code;
}

/**
 * Remove every enrolled factor from an account.
 *
 * The two-factor test enrols against a shared seeded account. If its own
 * cleanup does not run -- a failed assertion, an interrupted run -- that account
 * is left demanding a code whose secret nothing knows, and every other test that
 * signs in is locked out for good. This is the way back, and it runs before the
 * test as well as after it.
 *
 * Service role, so it works regardless of what the account can currently do.
 * Reads .env.local directly because Playwright does not load it.
 */
function localEnv(name: string): string | undefined {
  try {
    const file = readFileSync(".env.local", "utf8");
    return file
      .match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]
      ?.trim()
      .replace(/^"|"$/g, "");
  } catch {
    return undefined;
  }
}

export async function clearMfaFactors(email: string): Promise<void> {
  await clearRecoveryCodes(email);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot reset two-factor state.");

  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const listed = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers });
  const { users } = (await listed.json()) as { users: { id: string; email?: string }[] };
  const user = users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
  if (!user) return;

  const detail = await fetch(`${url}/auth/v1/admin/users/${user.id}`, { headers });
  const { factors } = (await detail.json()) as { factors?: { id: string }[] };
  for (const factor of factors ?? []) {
    await fetch(`${url}/auth/v1/admin/users/${user.id}/factors/${factor.id}`, {
      method: "DELETE",
      headers,
    });
  }
}

/**
 * Drop every recovery code for an account.
 *
 * Enrolling issues a fresh set, so codes accumulate across runs and a stale one
 * from a previous run is a credential nothing is tracking. Cleared alongside the
 * factors, for the same reason.
 */
export async function clearRecoveryCodes(email: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot reset recovery codes.");

  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const listed = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers });
  const { users } = (await listed.json()) as { users: { id: string; email?: string }[] };
  const user = users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
  if (!user) return;

  await fetch(`${url}/rest/v1/mfa_recovery_codes?user_id=eq.${user.id}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=minimal" },
  });
}

/**
 * Put the seeded workspace's two-factor policy back to optional.
 *
 * Turning the policy on with no factor enrolled deliberately locks an owner out
 * of everything except the enrolment page -- that is the feature. It also means
 * a test that switches it on and then fails would lock every later test out of
 * the workspace, so this is the way back, and it runs on both sides.
 */
export async function setWorkspaceMfaPolicy(required: boolean): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot reset the two-factor policy.");

  const response = await fetch(`${url}/rest/v1/organizations?slug=like.marcus*`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ require_mfa: required }),
  });
  if (!response.ok) throw new Error(`Could not set the policy: ${await response.text()}`);
}

/**
 * Put a real file behind an asset version, and take it away again.
 *
 * The seed creates version rows but uploads no bytes, so a download is
 * correctly a 404 until something is actually stored. The delivery test needs
 * one real file to prove the whole path rather than most of it.
 */
export async function putDeliveryFixture(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot place the delivery fixture.");

  // Ask where the file belongs rather than assuming the path. The layout is the
  // seed's business, and guessing it once already cost a confusing 404.
  const lookup = await fetch(
    `${url}/rest/v1/asset_versions?version_kind=eq.delivery&select=object_key&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const rows = (await lookup.json()) as { object_key: string }[];
  const objectKey = rows[0]?.object_key;
  if (!objectKey) throw new Error("The seed has no delivery version to stand a fixture behind.");

  // A 1x1 JPEG: genuinely decodable, so the content type is not a fiction.
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  );

  // Upsert rather than insert: an earlier run may have left one, and the
  // storage API reports that as an HTTP 400 carrying a 409 in its body, which
  // is easy to mistake for a real failure.
  const response = await fetch(`${url}/storage/v1/object/derivatives/${objectKey}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: jpeg,
  });
  if (!response.ok) {
    throw new Error(`Could not place the fixture: ${await response.text()}`);
  }
  return objectKey;
}

export async function removeDeliveryFixture(objectKey: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  await fetch(`${url}/storage/v1/object/derivatives/${objectKey}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key}` },
  });
}

/**
 * Withdraw and delete every delivery link, so a run starts and ends clean.
 *
 * The response is checked. It was not, and the call had been returning 403 for
 * want of an execute grant, so this cleanup quietly did nothing: links and
 * acceptances piled up until the selectors in the delivery tests matched
 * several elements and failed on strict mode. A cleanup that cannot report its
 * own failure hides the state it was meant to remove, so a bad status here is
 * an error rather than a shrug.
 */
export async function clearDeliveryLinks(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot reset delivery links.");
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" };
  // The events and acceptances reference the links and are append-only, so this
  // needs the purge flag the database exposes for exactly this. Acceptances go
  // with the links they belong to, by cascade.
  const response = await fetch(`${url}/rest/v1/rpc/purge_delivery_links`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(
      `Could not clear delivery links (HTTP ${response.status}): ${await response.text()}`,
    );
  }
}

/**
 * A throwaway second workspace for the account that signs in.
 *
 * The two-tab test needs one person in two workspaces, and the seed gives every
 * account exactly one. Rather than editing a seeded fixture -- which would leak
 * into the tenancy tests if a run were interrupted -- this makes a workspace of
 * its own through the real creation path and purges it afterwards.
 *
 * The address is unique per run because an address is never released: a fixed
 * one would work once and refuse for ever after.
 */
export interface ThrowawayWorkspace {
  readonly id: string;
  readonly slug: string;
}

async function accessTokenFor(email: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? localEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("No Supabase URL or anon key: cannot sign in for fixtures.");

  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: SEEDED.password }),
  });
  if (!response.ok) throw new Error(`Could not sign in as ${email}: ${await response.text()}`);
  const { access_token: token } = (await response.json()) as { access_token?: string };
  if (!token) throw new Error(`No access token for ${email}.`);
  return token;
}

export async function createThrowawayWorkspace(
  email: string = SEEDED.owner,
  prefix = "second-desk",
): Promise<ThrowawayWorkspace> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? localEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("No Supabase URL or anon key: cannot create a workspace.");

  const token = await accessTokenFor(email);
  const slug = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const response = await fetch(`${url}/rest/v1/rpc/create_workspace`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_name: "Second Desk",
      workspace_slug: slug,
      // Without this the function hands back the workspace this owner already
      // has, which would defeat the entire point of the test.
      allow_additional: true,
    }),
  });
  if (!response.ok) throw new Error(`Could not create ${slug}: ${await response.text()}`);

  const id = (await response.json()) as string;
  return { id, slug };
}

export async function purgeWorkspace(organizationId: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot purge the workspace.");

  const response = await fetch(`${url}/rest/v1/rpc/purge_organization_admin`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ target_org: organizationId }),
  });
  if (!response.ok) {
    throw new Error(`Could not purge ${organizationId}: ${await response.text()}`);
  }
}

/** Delete a package created by a test, so a run does not accumulate them. */
export async function deletePackage(packageId: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot clean up the package.");
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" };

  /*
   * The contents of an approved package are frozen, so deleting package_assets
   * directly is refused for exactly the packages a dispatch test creates.
   * `purge_package_admin` is the audited way through: service role only, and it
   * raises the purge flag rather than working around the trigger.
   */
  const purged = await fetch(`${url}/rest/v1/rpc/purge_package_admin`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ target_package: packageId }),
  });
  if (!purged.ok) {
    throw new Error(`Could not purge the package (HTTP ${purged.status}): ${await purged.text()}`);
  }
}

/**
 * Remove a shoot a test created.
 *
 * Only safe for a shoot with nothing hanging off it -- which is what these
 * tests make. A seeded shoot with assets and packages needs the purge routines,
 * and this deliberately cannot reach one: the delete is refused rather than
 * cascading through a commercial record.
 */
export async function deleteShoot(shootId: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot clean up the shoot.");
  const response = await fetch(`${url}/rest/v1/shoots?id=eq.${shootId}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
  });
  if (!response.ok) throw new Error(`Could not delete shoot ${shootId}: ${await response.text()}`);
}

/** The assets on a shoot: id and the fields the creation flow should have set. */
export async function assetsOnShoot(shootId: string): Promise<
  {
    id: string;
    status: string;
    caption: string | null;
    credit_line: string | null;
    selected: boolean;
  }[]
> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot read assets.");
  const response = await fetch(
    `${url}/rest/v1/assets?shoot_id=eq.${shootId}&select=id,status,caption,credit_line,selected`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  return (await response.json()) as Awaited<ReturnType<typeof assetsOnShoot>>;
}

/**
 * Remove a shoot that has files on it.
 *
 * asset_versions is append-only and the shoot's delete is refused while an
 * asset points at it, so the assets go first and through the audited RPC --
 * the same route tests/helpers/supabase.ts takes. Failures are surfaced rather
 * than swallowed: a test that leaves rows behind changes what the next run
 * starts from.
 */
export async function purgeShootWithAssets(shootId: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot clean up the shoot.");

  for (const asset of await assetsOnShoot(shootId)) {
    const purged = await fetch(`${url}/rest/v1/rpc/purge_asset_admin`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target_asset: asset.id }),
    });
    if (!purged.ok) {
      throw new Error(`Could not purge asset ${asset.id}: ${await purged.text()}`);
    }
  }

  await deleteShoot(shootId);
}

/** The id of a shoot with a given title, or null. */
export async function shootIdByTitle(title: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot read shoots.");
  const response = await fetch(
    `${url}/rest/v1/shoots?title=eq.${encodeURIComponent(title)}&select=id,organization_id`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const rows = (await response.json()) as { id: string }[];
  return rows[0]?.id ?? null;
}

/**
 * A shoot with one complete, selected frame and a package ready to approve.
 *
 * The seeded workspace deliberately has no approvable package: package 01 is
 * already approved and package 02 carries an uncaptioned frame so the dispatch
 * gate has a genuine reason to block. Both of those are the right fixtures for
 * what they test and neither can be approved through the interface, so a test
 * that needs to press "Approve package" has to bring its own.
 */
export async function createApprovablePackage(label: string): Promise<{
  shootId: string;
  packageId: string;
  assetIds: string[];
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot build a package.");
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
  const OWNER = "11111111-1111-1111-1111-111111111111";
  const BUYER = "a0000000-0000-0000-0000-0000000000b1";

  async function post<T>(table: string, body: unknown): Promise<T> {
    const response = await fetch(`${url}/rest/v1/${table}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Could not insert into ${table}: ${await response.text()}`);
    }
    return ((await response.json()) as T[])[0];
  }

  const shoot = await post<{ id: string }>("shoots", {
    organization_id: ORG,
    title: `${label} ${Date.now()}`,
    status: "preparing",
    starts_at: new Date(Date.now() - 1_800_000).toISOString(),
    created_by: OWNER,
  });

  const assetIds: string[] = [];
  const members: unknown[] = [];
  for (let index = 0; index < 2; index += 1) {
    const asset = await post<{ id: string }>("assets", {
      organization_id: ORG,
      shoot_id: shoot.id,
      status: "active",
      canonical_filename: `E2E_${label}_${index}`,
      captured_at: new Date(Date.now() - 1_800_000).toISOString(),
      headline: `${label} frame ${index}`,
      caption: `A caption for ${label} frame ${index}, long enough to pass the dispatch gate.`,
      credit_line: "Mastline test",
      // Caption, credit, copyright, and capture time are the four the dispatch
      // gate blocks on. A fixture missing one of them is a fixture that cannot
      // be approved, which is a slow way to discover the rule.
      copyright_notice: "© 2026 Marcus Hale",
      selected: true,
      created_by: OWNER,
    });
    assetIds.push(asset.id);

    const version = await post<{ id: string }>("asset_versions", {
      organization_id: ORG,
      asset_id: asset.id,
      version_kind: "original",
      storage_bucket: "originals",
      object_key: `${ORG}/${shoot.id}/${label}_${index}.arw`,
      // Unique per frame per run: an original is written once and the hash is
      // part of what makes it identifiable.
      sha256: `${Date.now().toString(16)}${index}`.padEnd(64, "a").slice(0, 64),
      bytes: 1000,
      mime_type: "image/x-sony-arw",
      created_by: OWNER,
    });

    members.push({
      organization_id: ORG,
      asset_id: asset.id,
      asset_version_id: version.id,
      position: index,
    });
  }

  const pkg = await post<{ id: string }>("packages", {
    organization_id: ORG,
    shoot_id: shoot.id,
    buyer_id: BUYER,
    name: `${label} package`,
    status: "ready",
    delivery_method: "SFTP",
    proposed_terms: "Non-exclusive agency distribution; photographer retains copyright.",
    restrictions: "Editorial use only.",
    created_by: OWNER,
  });

  const attach = await fetch(`${url}/rest/v1/package_assets`, {
    method: "POST",
    headers,
    body: JSON.stringify(members.map((member) => ({ ...(member as object), package_id: pkg.id }))),
  });
  if (!attach.ok) throw new Error(`Could not fill the package: ${await attach.text()}`);

  return { shootId: shoot.id, packageId: pkg.id, assetIds };
}

/**
 * What the analytics rollups hold for a link, by the recipient it was made for.
 *
 * Read straight from the durable totals rather than scraped off the screen,
 * because the assertion that matters most is that a number did NOT move while
 * the tab was hidden, and "the page still says about 12 seconds" is a weaker
 * form of that than the stored figure being unchanged.
 */
export async function engagementForRecipient(recipientLabel: string): Promise<{
  deliveryId: string;
  activeVisibleMs: number;
  sessionCount: number;
  visitorCount: number;
  assetRows: number;
} | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot read engagement.");
  const auth = { apikey: key, Authorization: `Bearer ${key}` };

  const links = await fetch(
    `${url}/rest/v1/submission_deliveries?recipient_label=eq.${encodeURIComponent(recipientLabel)}&select=id`,
    { headers: auth },
  );
  const rows = (await links.json()) as { id: string }[];
  const deliveryId = rows[0]?.id;
  if (!deliveryId) return null;

  const totals = await fetch(
    `${url}/rest/v1/delivery_engagement_totals?delivery_id=eq.${deliveryId}&select=active_visible_ms,session_count,visitor_count`,
    { headers: auth },
  );
  const total = (
    (await totals.json()) as {
      active_visible_ms: number;
      session_count: number;
      visitor_count: number;
    }[]
  )[0];

  const assets = await fetch(
    `${url}/rest/v1/delivery_asset_engagement_totals?delivery_id=eq.${deliveryId}&select=asset_id`,
    { headers: auth },
  );
  const assetRows = ((await assets.json()) as unknown[]).length;

  return {
    deliveryId,
    activeVisibleMs: Number(total?.active_visible_ms ?? 0),
    sessionCount: Number(total?.session_count ?? 0),
    visitorCount: Number(total?.visitor_count ?? 0),
    assetRows,
  };
}

/**
 * A package whose approved objects genuinely exist in storage.
 *
 * `createApprovablePackage` builds frames with an original only, which is
 * right for the approval screen and useless for a download: the seed uploads
 * no bytes, and a RAW original has no browser preview. This one gives every
 * frame a delivery JPEG, stands the 1x1 fixture behind it, and points the
 * package at that version -- so the exact object the approval freezes is one
 * a recipient can preview and take.
 */
export async function createApprovablePackageWithFiles(label: string): Promise<{
  shootId: string;
  packageId: string;
  frames: { assetId: string; deliveryVersionId: string; deliveryKey: string }[];
  objectKeys: string[];
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot build a package.");
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
  const OWNER = "11111111-1111-1111-1111-111111111111";
  const BUYER = "a0000000-0000-0000-0000-0000000000b1";

  async function post<T>(table: string, body: unknown): Promise<T> {
    const response = await fetch(`${url}/rest/v1/${table}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Could not insert into ${table}: ${await response.text()}`);
    }
    return ((await response.json()) as T[])[0];
  }

  const shoot = await post<{ id: string }>("shoots", {
    organization_id: ORG,
    title: `${label} ${Date.now()}`,
    status: "preparing",
    starts_at: new Date(Date.now() - 1_800_000).toISOString(),
    created_by: OWNER,
  });

  const frames: { assetId: string; deliveryVersionId: string; deliveryKey: string }[] = [];
  const members: unknown[] = [];
  const objectKeys: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const asset = await post<{ id: string }>("assets", {
      organization_id: ORG,
      shoot_id: shoot.id,
      status: "active",
      canonical_filename: `E2E_${label}_${index}`,
      captured_at: new Date(Date.now() - 1_800_000).toISOString(),
      headline: `${label} frame ${index}`,
      caption: `The approved caption for ${label} frame ${index}.`,
      subjects: ["Avery Hart"],
      credit_line: "Mastline test",
      copyright_notice: "© 2026 Marcus Hale",
      selected: true,
      created_by: OWNER,
    });

    const stamp = `${Date.now().toString(16)}${index}`;
    await post<{ id: string }>("asset_versions", {
      organization_id: ORG,
      asset_id: asset.id,
      version_kind: "original",
      storage_bucket: "originals",
      object_key: `${ORG}/${shoot.id}/${label}_${index}.arw`,
      sha256: `${stamp}a`.padEnd(64, "a").slice(0, 64),
      bytes: 1000,
      mime_type: "image/x-sony-arw",
      created_by: OWNER,
    });

    const deliveryKey = `${ORG}/${shoot.id}/${label}_${index}_delivery.jpg`;
    const delivery = await post<{ id: string }>("asset_versions", {
      organization_id: ORG,
      asset_id: asset.id,
      version_kind: "delivery",
      storage_bucket: "derivatives",
      object_key: deliveryKey,
      sha256: `${stamp}b`.padEnd(64, "b").slice(0, 64),
      bytes: 500,
      mime_type: "image/jpeg",
      created_by: OWNER,
    });
    await putObject(deliveryKey);
    objectKeys.push(deliveryKey);

    frames.push({ assetId: asset.id, deliveryVersionId: delivery.id, deliveryKey });
    members.push({
      organization_id: ORG,
      asset_id: asset.id,
      asset_version_id: delivery.id,
      position: index,
    });
  }

  const pkg = await post<{ id: string }>("packages", {
    organization_id: ORG,
    shoot_id: shoot.id,
    buyer_id: BUYER,
    name: `${label} package`,
    status: "ready",
    delivery_method: "SFTP",
    proposed_terms: "Non-exclusive agency distribution; photographer retains copyright.",
    restrictions: "Editorial use only.",
    created_by: OWNER,
  });

  const attach = await fetch(`${url}/rest/v1/package_assets`, {
    method: "POST",
    headers,
    body: JSON.stringify(members.map((member) => ({ ...(member as object), package_id: pkg.id }))),
  });
  if (!attach.ok) throw new Error(`Could not fill the package: ${await attach.text()}`);

  return { shootId: shoot.id, packageId: pkg.id, frames, objectKeys };
}

/** The 1x1 JPEG fixture, placed at an exact key in the derivatives bucket. */
export async function putObject(objectKey: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot place a fixture.");
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  );
  const response = await fetch(`${url}/storage/v1/object/derivatives/${objectKey}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: jpeg,
  });
  if (!response.ok) throw new Error(`Could not place ${objectKey}: ${await response.text()}`);
}

/** Rewrite an asset's editorial fields directly, as an operator's later edit would. */
export async function rewriteAssetCaption(
  assetId: string,
  patch: { caption: string; headline?: string },
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot edit the asset.");
  const response = await fetch(`${url}/rest/v1/assets?id=eq.${assetId}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`Could not edit the asset: ${await response.text()}`);
}

/** A delivery derivative made after approval, with real bytes behind it. */
export async function addLaterDerivative(assetId: string, objectKey: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot add a derivative.");
  const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
  const response = await fetch(`${url}/rest/v1/asset_versions`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      organization_id: ORG,
      asset_id: assetId,
      version_kind: "delivery",
      storage_bucket: "derivatives",
      object_key: objectKey,
      sha256: `${Date.now().toString(16)}c`.padEnd(64, "c").slice(0, 64),
      bytes: 600,
      mime_type: "image/jpeg",
      created_by: "11111111-1111-1111-1111-111111111111",
    }),
  });
  if (!response.ok) throw new Error(`Could not add the derivative: ${await response.text()}`);
  await putObject(objectKey);
  return ((await response.json()) as { id: string }[])[0].id;
}

/** The approved-frame record for a submission, straight from the table. */
export async function approvedFrames(submissionId: string): Promise<
  {
    asset_id: string;
    asset_version_id: string;
    position: number;
    caption_snapshot: string | null;
    object_key_snapshot: string;
    snapshot_origin: string;
  }[]
> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot read the snapshot.");
  const response = await fetch(
    `${url}/rest/v1/submission_assets?submission_id=eq.${submissionId}&select=asset_id,asset_version_id,position,caption_snapshot,object_key_snapshot,snapshot_origin&order=position`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  return (await response.json()) as {
    asset_id: string;
    asset_version_id: string;
    position: number;
    caption_snapshot: string | null;
    object_key_snapshot: string;
    snapshot_origin: string;
  }[];
}

/** Download events recorded for a recipient link, by the frame downloaded. */
export async function downloadedAssetIds(recipientLabel: string): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot read the access record.");
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  const links = await fetch(
    `${url}/rest/v1/submission_deliveries?recipient_label=eq.${encodeURIComponent(recipientLabel)}&select=id`,
    { headers: auth },
  );
  const deliveryId = ((await links.json()) as { id: string }[])[0]?.id;
  if (!deliveryId) return [];
  const events = await fetch(
    `${url}/rest/v1/delivery_access_events?delivery_id=eq.${deliveryId}&kind=eq.downloaded&select=asset_id`,
    { headers: auth },
  );
  return ((await events.json()) as { asset_id: string }[]).map((event) => event.asset_id);
}

/**
 * Unwind a shoot whose package was approved.
 *
 * `purgeShootWithAssets` cannot: an approved package restricts the asset
 * purge through its submission and its frozen membership. Order follows the
 * foreign keys -- submissions, assets, packages, shoot -- through the audited
 * purge routines, and the fixture objects are removed from storage last.
 */
export async function purgeApprovedShoot(
  shootId: string,
  objectKeys: string[] = [],
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("No service role key: cannot clean up the shoot.");
  const auth = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  async function rpc(name: string, body: unknown) {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${name} failed: ${await response.text()}`);
  }

  const packages = (await (
    await fetch(`${url}/rest/v1/packages?shoot_id=eq.${shootId}&select=id`, { headers: auth })
  ).json()) as { id: string }[];

  for (const pkg of packages) {
    const submissions = (await (
      await fetch(`${url}/rest/v1/submissions?package_id=eq.${pkg.id}&select=id`, {
        headers: auth,
      })
    ).json()) as { id: string }[];
    for (const submission of submissions) {
      await rpc("purge_submission_admin", { target_submission: submission.id });
    }
  }

  for (const asset of await assetsOnShoot(shootId)) {
    await rpc("purge_asset_admin", { target_asset: asset.id });
  }
  for (const pkg of packages) {
    await rpc("purge_package_admin", { target_package: pkg.id });
  }
  await deleteShoot(shootId);

  for (const objectKey of objectKeys) {
    await fetch(`${url}/storage/v1/object/derivatives/${objectKey}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${key}` },
    });
  }
}
