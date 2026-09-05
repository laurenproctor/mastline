import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  PREAUTHENTICATED,
  SEEDED_WORKSPACE,
  at,
  authStatePath,
  signInThroughForm,
} from "./helpers";

/**
 * Sign the seeded roles in once, so the suite does not sign them in 111 times.
 *
 * Every spec used to drive the sign-in form at the top of every test: a page
 * load, a fill, a POST to GoTrue and a redirect, repeated for each of the three
 * viewport projects. None of that was testing the form. It is done here
 * instead, once per role, and `signIn` in helpers.ts replays the cookies.
 *
 * This is also the suite's sign-in smoke test, and a better one than the
 * incidental coverage it replaces. It drives the real form against the real
 * auth server, and it is a dependency of every browser project -- so a broken
 * sign-in screen fails the run here, by name, before a single spec has run and
 * reported a confusing timeout somewhere else.
 *
 * The MFA specs in acceptance.spec.ts still type into the form themselves,
 * because being stopped at the challenge is the thing they are proving.
 */
for (const email of PREAUTHENTICATED) {
  setup(`authenticate ${email}`, async ({ page }) => {
    mkdirSync(path.dirname(authStatePath(email)), { recursive: true });

    await signInThroughForm(page, email);

    // The workspace, not merely a redirect away from /sign-in: a session that
    // cannot open the seeded workspace is not one worth saving, and finding
    // that out here is far cheaper than in every spec that replays it.
    await expect(page).toHaveURL(new RegExp(`${at("/work", SEEDED_WORKSPACE)}$`));
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    await page.context().storageState({ path: authStatePath(email) });
  });
}
