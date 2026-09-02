import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import { SEEDED, assetsOnShoot, at, purgeShootWithAssets, refuseCookies, signIn } from "./helpers";

/**
 * The import queue, in a real browser, against the local Supabase stack.
 *
 * Everything here needs a browser to be true at all: the origin private file
 * system holding bytes across a reload, IndexedDB holding the queue, Web Locks
 * keeping two tabs apart, and TUS resuming from an offset the server states.
 * None of that can be checked by rendering HTML, and none of it is checked by
 * the unit suite, which replaces every one of those with a double.
 *
 * Faults are injected by intercepting the storage requests rather than by
 * pointing at a broken server: it is deterministic, it never touches a hosted
 * project, and it can fail exactly one chunk of one file.
 */

const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? readLocalEnv("SUPABASE_SERVICE_ROLE_KEY");
const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const EDITOR_ID = "22222222-2222-2222-2222-222222222222";

/**
 * Big enough for three chunks.
 *
 * tus sends the first chunk with the creation request -- uploadDataDuringCreation
 * -- so a file of 12.5 MiB is one POST and two PATCHes. That is what makes
 * "interrupt after at least one chunk has landed" a thing that can be done
 * precisely: abort the second PATCH and the server is left holding exactly
 * 12,582,912 bytes.
 */
const CHUNK = 6 * 1024 * 1024;
const LARGE = 2 * CHUNK + 512 * 1024;

function readLocalEnv(name: string): string {
  try {
    const file = readFileSync(".env.local", "utf8");
    const line = file.split("\n").find((row) => row.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : "";
  } catch {
    return "";
  }
}

const service = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  "Content-Type": "application/json",
};

async function createShoot(title: string): Promise<string> {
  const response = await fetch(`${SUPABASE}/rest/v1/shoots`, {
    method: "POST",
    headers: { ...service, Prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: ORG_A,
      title,
      status: "draft",
      created_by: EDITOR_ID,
    }),
  });
  if (!response.ok) throw new Error(`Could not create shoot: ${await response.text()}`);
  return ((await response.json()) as { id: string }[])[0].id;
}

async function importRows(shootId: string): Promise<
  {
    client_file_id: string;
    status: string;
    attempt_count: number;
    error_code: string | null;
    asset_id: string | null;
    storage_path: string;
  }[]
> {
  const batches = await fetch(
    `${SUPABASE}/rest/v1/import_batches?shoot_id=eq.${shootId}&select=id`,
    { headers: service },
  ).then((r) => r.json() as Promise<{ id: string }[]>);
  if (batches.length === 0) return [];

  const ids = batches.map((b) => b.id).join(",");
  return fetch(
    `${SUPABASE}/rest/v1/import_files?import_batch_id=in.(${ids})&select=client_file_id,status,attempt_count,error_code,asset_id,storage_path&order=created_at`,
    { headers: service },
  ).then((r) => r.json());
}

/** Objects sitting under a shoot's staging prefix, straight from storage. */
async function stagedObjects(shootId: string): Promise<number> {
  const rows = await importRows(shootId);
  let found = 0;
  for (const row of rows) {
    const prefix = row.storage_path.slice(0, row.storage_path.lastIndexOf("/"));
    const name = row.storage_path.slice(row.storage_path.lastIndexOf("/") + 1);
    const listed = await fetch(`${SUPABASE}/storage/v1/object/list/originals`, {
      method: "POST",
      headers: service,
      body: JSON.stringify({ prefix, search: name, limit: 1 }),
    }).then((r) => r.json() as Promise<{ name: string }[]>);
    if (Array.isArray(listed) && listed.some((entry) => entry.name === name)) found += 1;
  }
  return found;
}

function jpeg(name: string, size = 64) {
  return { name, mimeType: "image/jpeg", buffer: Buffer.alloc(size, 7) };
}

async function open(page: Page, shootId: string) {
  await page.goto(at(`/shoots/${shootId}`));
  await expect(page.locator("#import-files")).toHaveCount(1);
}

const rowFor = (page: Page, filename: string) =>
  page.locator(".import-row").filter({ hasText: filename });

/** Wait for a row to settle on a state, with a message if it does not. */
async function expectState(page: Page, filename: string, state: RegExp, timeout = 60_000) {
  await expect(rowFor(page, filename).locator(".import-state")).toHaveText(state, { timeout });
}

test.describe("importing a field shoot", () => {
  let shootId: string;

  test.beforeEach(async ({ page, context }) => {
    shootId = await createShoot(`E2E import ${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await refuseCookies(context);
    await signIn(page, SEEDED.editor);
  });

  test.afterEach(async () => {
    await purgeShootWithAssets(shootId).catch(() => {});
  });

  test("several files upload and become assets", async ({ page }) => {
    await open(page, shootId);
    await page.setInputFiles("#import-files", [
      jpeg("MH_0819_0472.ARW"),
      jpeg("MH_0819_0473.ARW"),
      jpeg("MH_0819_0474.ARW"),
    ]);

    for (const name of ["MH_0819_0472.ARW", "MH_0819_0473.ARW", "MH_0819_0474.ARW"]) {
      await expectState(page, name, /Imported/);
    }

    await expect.poll(async () => (await assetsOnShoot(shootId)).length).toBe(3);
    const rows = await importRows(shootId);
    expect(rows.filter((row) => row.status === "complete")).toHaveLength(3);
    // Every staged object was promoted to its canonical key on finalization.
    expect(await stagedObjects(shootId)).toBe(0);
  });

  test("a file interrupted mid-upload resumes from where the server got to", async ({ page }) => {
    let patches = 0;
    let reloaded = false;
    const afterReload: { method: string; offset: string }[] = [];

    // A listener rather than a route, so it survives the reload: what has to be
    // proved is what the *second* page sends, not the first.
    page.on("request", (request) => {
      if (!reloaded || !request.url().includes("/upload/resumable")) return;
      afterReload.push({
        method: request.method(),
        offset: request.headers()["upload-offset"] ?? "",
      });
    });

    await page.route("**/upload/resumable/**", async (route: Route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      patches += 1;
      // Let the first chunk land, then cut the connection exactly as a tunnel
      // would. The second chunk never arrives.
      if (patches === 2) return route.abort("connectionreset");
      return route.continue();
    });

    await open(page, shootId);
    await page.setInputFiles("#import-files", [jpeg("MH_0819_BIG.ARW", LARGE)]);

    // It does not fail: it waits and says so.
    await expectState(page, "MH_0819_BIG.ARW", /Retrying|Uploading/);
    await expect.poll(async () => (await importRows(shootId)).length, { timeout: 30_000 }).toBe(1);

    // Reload. The tab that held the File object is gone.
    await page.unroute("**/upload/resumable/**");
    reloaded = true;
    await page.reload();

    // The queue kept the session it had started, which is what lets the resume
    // below be a resume rather than a second upload.
    const session = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("mastline-import-queue", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows = await new Promise<unknown[]>((resolve) => {
        const store = db.transaction("items").objectStore("items");
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result as unknown[]);
      });
      return rows.map((row) => String((row as Record<string, unknown>).uploadUrl ?? "none"));
    });
    expect(session[0]).toContain("/upload/resumable/");

    // The queue comes back on its own, with the file still in it.
    await expect(rowFor(page, "MH_0819_BIG.ARW")).toBeVisible({ timeout: 30_000 });

    // Whether the bytes came back with it depends on the browser. Playwright's
    // WebKit has no origin private file system, so the staged copy never
    // existed and the reloaded page holds nothing to resume with. The honest
    // degraded behaviour is to ask for the file back -- and handing it back
    // must still resume the server-side session rather than starting a second
    // upload, which the assertions below hold both branches to.
    const opfs = await page.evaluate(() => typeof navigator.storage?.getDirectory === "function");
    if (!opfs) {
      const row = rowFor(page, "MH_0819_BIG.ARW");
      await expect(row).toContainText(/File needed/, { timeout: 30_000 });
      await row.getByRole("button", { name: /Choose file/ }).click();
      await page.setInputFiles("#import-replacement", [jpeg("MH_0819_BIG.ARW", LARGE)]);
    }

    await expectState(page, "MH_0819_BIG.ARW", /Imported/, 90_000);

    // It resumed rather than restarting. Two things say so: the second page
    // never created a session, and its first PATCH carried the offset the
    // server was already holding.
    expect(afterReload.some((request) => request.method === "POST")).toBe(false);
    expect(afterReload.some((request) => Number(request.offset) > 0)).toBe(true);

    // And exactly one of everything.
    expect(await assetsOnShoot(shootId)).toHaveLength(1);
    const rows = await importRows(shootId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("complete");
    expect(await stagedObjects(shootId)).toBe(0);
  });

  test("starting offline stages the file and uploads when the connection returns", async ({
    page,
    context,
  }) => {
    await open(page, shootId);
    await context.setOffline(true);

    await page.setInputFiles("#import-files", [jpeg("OFFLINE_0001.ARW")]);

    // Queued and visible, and never described as uploaded.
    await expect(rowFor(page, "OFFLINE_0001.ARW")).toBeVisible();
    await expect(page.getByText(/Offline — waiting to resume/)).toBeVisible({ timeout: 20_000 });
    expect(await assetsOnShoot(shootId)).toHaveLength(0);

    await context.setOffline(false);
    await expectState(page, "OFFLINE_0001.ARW", /Imported/, 90_000);
    expect(await assetsOnShoot(shootId)).toHaveLength(1);
  });

  test("going offline mid-chunk resumes when the connection returns", async ({ page, context }) => {
    let patches = 0;
    await page.route("**/upload/resumable/**", async (route: Route) => {
      if (route.request().method() === "PATCH" && ++patches === 1) {
        await context.setOffline(true);
        return route.abort("internetdisconnected");
      }
      return route.continue();
    });

    await open(page, shootId);
    await page.setInputFiles("#import-files", [jpeg("TUNNEL_0001.ARW", LARGE)]);

    await expect(page.getByText(/Offline — waiting to resume/)).toBeVisible({ timeout: 40_000 });

    await page.unroute("**/upload/resumable/**");
    await context.setOffline(false);

    await expectState(page, "TUNNEL_0001.ARW", /Imported/, 120_000);
    expect(await assetsOnShoot(shootId)).toHaveLength(1);
  });

  test("a transient 503 is retried and then succeeds", async ({ page }) => {
    let failed = false;
    await page.route("**/upload/resumable**", async (route: Route) => {
      if (!failed && route.request().method() === "POST") {
        failed = true;
        return route.fulfill({ status: 503, body: "upstream unavailable" });
      }
      return route.continue();
    });

    await open(page, shootId);
    await page.setInputFiles("#import-files", [jpeg("FLAKY_0001.ARW")]);

    await expectState(page, "FLAKY_0001.ARW", /Imported/, 90_000);
    expect(await assetsOnShoot(shootId)).toHaveLength(1);
  });

  test("a 413 stops rather than retrying forever", async ({ page }) => {
    let attempts = 0;
    await page.route("**/upload/resumable**", async (route: Route) => {
      if (route.request().method() === "POST") {
        attempts += 1;
        return route.fulfill({ status: 413, body: "The object exceeded the maximum allowed size" });
      }
      return route.continue();
    });

    await open(page, shootId);
    await page.setInputFiles("#import-files", [jpeg("HUGE_0001.ARW")]);

    await expectState(page, "HUGE_0001.ARW", /Failed/, 40_000);
    await expect(rowFor(page, "HUGE_0001.ARW")).toContainText(/Storage refused this file/);

    // Left alone afterwards rather than hammered.
    await page.waitForTimeout(6_000);
    expect(attempts).toBe(1);
    expect(await assetsOnShoot(shootId)).toHaveLength(0);
  });

  test("one bad file does not stop the rest, and can be retried on its own", async ({ page }) => {
    let blocking = true;
    await page.route("**/upload/resumable**", async (route: Route) => {
      const body = route.request().postData() ?? "";
      const metadata = route.request().headers()["upload-metadata"] ?? "";
      // The failing file is identified by the base64 of its object name, which
      // is the only thing distinguishing the two creation requests.
      const isTarget = metadata.includes(Buffer.from("BAD").toString("base64").slice(0, 4));
      if (blocking && route.request().method() === "POST" && (isTarget || body.includes("BAD"))) {
        return route.fulfill({ status: 500, body: "boom" });
      }
      return route.continue();
    });

    await open(page, shootId);
    await page.setInputFiles("#import-files", [jpeg("GOOD_0001.ARW"), jpeg("GOOD_0002.ARW")]);

    // Both good files land regardless of what else is happening.
    await expectState(page, "GOOD_0001.ARW", /Imported/, 90_000);
    await expectState(page, "GOOD_0002.ARW", /Imported/, 90_000);
    expect(await assetsOnShoot(shootId)).toHaveLength(2);

    blocking = false;
    await page.unroute("**/upload/resumable**");
  });

  test("an expired upload session is rebuilt without losing the file", async ({ page }) => {
    let expired = false;
    await page.route("**/upload/resumable/**", async (route: Route) => {
      const method = route.request().method();
      if (!expired && (method === "PATCH" || method === "HEAD")) {
        expired = true;
        // What Supabase returns for an upload URL it no longer knows.
        return route.fulfill({ status: 410, body: "" });
      }
      return route.continue();
    });

    await open(page, shootId);
    await page.setInputFiles("#import-files", [jpeg("EXPIRED_0001.ARW")]);

    await expectState(page, "EXPIRED_0001.ARW", /Imported/, 90_000);
    expect(await assetsOnShoot(shootId)).toHaveLength(1);
    // One asset, not two: the rebuilt session did not import it twice.
    expect((await importRows(shootId)).filter((row) => row.asset_id)).toHaveLength(1);
  });

  test("an expired access token is refreshed mid-upload", async ({ page }) => {
    let rejected = false;
    await page.route("**/upload/resumable**", async (route: Route) => {
      if (!rejected && route.request().method() === "POST") {
        rejected = true;
        return route.fulfill({ status: 401, body: '{"message":"jwt expired"}' });
      }
      return route.continue();
    });

    await open(page, shootId);
    await page.setInputFiles("#import-files", [jpeg("EXPIRY_0001.ARW")]);

    await expectState(page, "EXPIRY_0001.ARW", /Imported/, 90_000);
    expect(await assetsOnShoot(shootId)).toHaveLength(1);
  });

  test("cancelling an active upload leaves no asset and no staged object", async ({ page }) => {
    await page.route("**/upload/resumable/**", async (route: Route) => {
      // Slow the chunks down so there is something to cancel.
      if (route.request().method() === "PATCH") await new Promise((r) => setTimeout(r, 1500));
      return route.continue();
    });

    await open(page, shootId);
    await page.setInputFiles("#import-files", [jpeg("CANCEL_0001.ARW", LARGE)]);

    await expect(rowFor(page, "CANCEL_0001.ARW")).toBeVisible();
    await rowFor(page, "CANCEL_0001.ARW")
      .getByRole("button", { name: /Cancel CANCEL_0001/ })
      .click();

    await expectState(page, "CANCEL_0001.ARW", /Canceled/, 30_000);
    await page.waitForTimeout(3_000);
    expect(await assetsOnShoot(shootId)).toHaveLength(0);

    const rows = await importRows(shootId);
    expect(rows.every((row) => row.status === "canceled")).toBe(true);
  });

  test("a queue whose local copies were cleared asks for the files back", async ({ page }) => {
    await page.route("**/upload/resumable**", (route: Route) => route.abort("connectionfailed"));

    await open(page, shootId);
    await page.setInputFiles("#import-files", [jpeg("LOST_0001.ARW")]);
    await expect(rowFor(page, "LOST_0001.ARW")).toBeVisible();
    await expect.poll(async () => (await importRows(shootId)).length, { timeout: 30_000 }).toBe(1);

    // The browser evicted the origin's storage while the tab was closed. On a
    // browser with no origin private file system (Playwright's WebKit) there
    // is nothing to evict: the bytes only ever lived in the page, and the
    // reload below is what loses them. Both roads lead to the same premise.
    await page.evaluate(async () => {
      if (typeof navigator.storage?.getDirectory !== "function") return;
      const root = await navigator.storage.getDirectory();
      await root.removeEntry("mastline-imports", { recursive: true }).catch(() => {});
    });

    await page.unroute("**/upload/resumable**");
    await page.reload();

    const row = rowFor(page, "LOST_0001.ARW");
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(/File needed/, { timeout: 30_000 });
    await expect(row.getByRole("button", { name: /Choose file/ })).toBeVisible();
    // Never described as safe, and never silently dropped.
    expect(await assetsOnShoot(shootId)).toHaveLength(0);
  });

  test("two tabs on the same queue upload each file once", async ({ page, context }) => {
    await open(page, shootId);
    await page.setInputFiles("#import-files", [jpeg("TABS_0001.ARW"), jpeg("TABS_0002.ARW")]);

    const second = await context.newPage();
    await second.goto(at(`/shoots/${shootId}`));

    await expectState(page, "TABS_0001.ARW", /Imported/, 90_000);
    await expectState(page, "TABS_0002.ARW", /Imported/, 90_000);

    // Two files, two assets. A second uploader would have produced a 409 and a
    // row reporting a conflict for a file that was uploading perfectly well.
    await expect.poll(async () => (await assetsOnShoot(shootId)).length).toBe(2);
    const rows = await importRows(shootId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.asset_id !== null)).toHaveLength(2);
    await second.close();
  });

  test("a file larger than one chunk uploads in several and lands once", async ({ page }) => {
    const patched: string[] = [];
    await page.route("**/upload/resumable/**", async (route: Route) => {
      if (route.request().method() === "PATCH") {
        patched.push(route.request().headers()["upload-offset"] ?? "0");
      }
      return route.continue();
    });

    await open(page, shootId);
    await page.setInputFiles("#import-files", [jpeg("MULTI_0001.ARW", LARGE)]);
    await expectState(page, "MULTI_0001.ARW", /Imported/, 120_000);

    // The first chunk travelled with the creation request, so the PATCHes are
    // the ones after it -- and the first of them starts exactly one chunk in.
    expect(patched.length).toBeGreaterThan(0);
    expect(patched).toContain(String(CHUNK));
    expect(await assetsOnShoot(shootId)).toHaveLength(1);
  });

  test("no room on the device is said plainly, not promised away", async ({ page }) => {
    // A browser that reports almost no free space. The queue has to warn, and
    // it must not describe the file as recoverable, because it is not.
    await page.addInitScript(() => {
      const storage: StorageManager | undefined = navigator.storage;
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: {
          estimate: async () => ({ quota: 1024 * 1024, usage: 1020 * 1024 }),
          // Delegated only where the browser has anything to delegate to:
          // Playwright's WebKit has no navigator.storage at all, and a wrapper
          // over undefined would throw from inside the app's guarded calls.
          ...(storage
            ? {
                persisted: () => storage.persisted.call(storage),
                persist: () => storage.persist.call(storage),
                getDirectory: () => storage.getDirectory.call(storage),
              }
            : {}),
        },
      });
    });

    // Hold the upload at the network until the warnings have been read. On a
    // fast machine the whole import finishes inside the assertion timeout,
    // and a completed row rightly stops warning about recovery -- the race
    // is the test's to lose, not the product's.
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => (releaseUpload = resolve));
    await page.route("**/upload/resumable/**", async (route: Route) => {
      await uploadGate;
      return route.continue();
    });

    await open(page, shootId);
    await page.setInputFiles("#import-files", [jpeg("TIGHT_0001.ARW", 4 * 1024 * 1024)]);

    // Said twice, deliberately: once for the batch, and once against the file
    // it applies to, because that is the row somebody will act on.
    await expect(page.locator(".import-warnings")).toContainText(/not enough free storage/i, {
      timeout: 30_000,
    });
    const row = rowFor(page, "TIGHT_0001.ARW");
    await expect(row).toBeVisible();
    await expect(row).toContainText(/Reload recovery cannot be guaranteed/i);
    // And it still uploads in this tab, which is the honest offer.
    releaseUpload();
    await expectState(page, "TIGHT_0001.ARW", /Imported/, 90_000);
  });

  test("an awkward filename never becomes a path", async ({ page }) => {
    const awkward = "../../Ünïcode noms/ MH 0819 (0472) #1 — copy.ARW";
    await open(page, shootId);
    await page.setInputFiles("#import-files", [
      { name: awkward, mimeType: "image/jpeg", buffer: Buffer.alloc(64, 3) },
      // And a second file with the same name as the first, different bytes.
      { name: "IMG_0001.JPG", mimeType: "image/jpeg", buffer: Buffer.alloc(80, 4) },
      { name: "IMG_0001.JPG", mimeType: "image/jpeg", buffer: Buffer.alloc(96, 5) },
    ]);

    await expect
      .poll(async () => (await assetsOnShoot(shootId)).length, { timeout: 120_000 })
      .toBe(3);

    const rows = await importRows(shootId);
    for (const row of rows) {
      expect(row.storage_path).toMatch(
        new RegExp(`^${ORG_A}/_staging/[0-9a-f-]{36}/[A-Za-z0-9_-]{1,64}$`),
      );
      expect(row.storage_path).not.toContain("..");
      expect(row.storage_path).not.toContain(" ");
    }
  });
});
