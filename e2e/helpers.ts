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
  await page.waitForURL(`**${destination}`, { timeout: 20_000 });
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

  // package_assets restricts the package row, so the members go first.
  const members = await fetch(`${url}/rest/v1/package_assets?package_id=eq.${packageId}`, {
    method: "DELETE",
    headers,
  });
  if (!members.ok) throw new Error(`Could not clear the package: ${await members.text()}`);

  const removed = await fetch(`${url}/rest/v1/packages?id=eq.${packageId}`, {
    method: "DELETE",
    headers,
  });
  if (!removed.ok) throw new Error(`Could not delete the package: ${await removed.text()}`);
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
  { id: string; status: string; caption: string | null; credit_line: string | null; selected: boolean }[]
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
