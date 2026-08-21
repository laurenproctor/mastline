import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * There must be no route-level `loading.tsx` under src/app.
 *
 * A `loading.tsx` puts its whole subtree inside an implicit Suspense boundary.
 * With one present, two things broke across the application:
 *
 *  - A Server Action that called `revalidatePath` for the route it was invoked
 *    from left its promise unresolved on the client. The write landed and the
 *    server re-rendered in under 100ms, but the form sat on "Saving..." for
 *    ever. Measured at 15 hangs in 60 saves with the file, 0 in 60 without.
 *  - `router.refresh()` stopped reliably taking effect, which the contact sheet
 *    depends on after toggling selection or a rating.
 *
 * Both are silent: nothing is logged and the server looks healthy. That is why
 * this is asserted on the file tree rather than left to a browser test, where
 * an intermittent fault passes most of the time.
 *
 * If navigation feedback is wanted again, it needs a mechanism that does not
 * wrap a route in Suspense -- a pending state on the link itself, for instance.
 */
function loadingFilesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...loadingFilesUnder(path));
    } else if (/^loading\.(tsx|ts|jsx|js)$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

describe("route loading boundaries", () => {
  it("does not reintroduce a loading.tsx anywhere under src/app", () => {
    expect(loadingFilesUnder("src/app")).toEqual([]);
  });

  it("finds one when there is one, so the check cannot silently pass", () => {
    // Guards the guard: a walker that returned [] regardless would look clean.
    expect(loadingFilesUnder("tests/fixtures/app-with-loading")).toEqual([
      join("tests/fixtures/app-with-loading", "dashboard", "loading.tsx"),
    ]);
  });
});
