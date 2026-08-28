import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sitemap, { marketingRoutes } from "@/app/sitemap";
import { PROTECTED_ROUTES, isProtected } from "@/lib/routes";

/**
 * The sitemap generates itself from the (marketing) directory, so it cannot
 * fall behind a page added inside that directory. What it can fall behind is a
 * public page added somewhere else -- the way /welcome once was -- which would
 * simply never be listed, silently.
 *
 * So this test does not re-check the generator against itself. It checks the
 * assumption the generator rests on: that every routable top-level segment in
 * the app is accounted for, as marketing, as gated, or as a deliberate
 * exclusion named below. A new top-level page fails here until somebody says
 * which of the three it is.
 */

const APP_DIR = join(process.cwd(), "src", "app");

/** Top-level routes that are public but deliberately not indexed. */
const EXCLUDED_FROM_SITEMAP: Record<string, string> = {
  "(marketing)": "the group the sitemap is generated from",
  welcome: "permanent redirect to /",
  login: "permanent redirect to /sign-in",
  signup: "permanent redirect to /sign-up",
  "sign-in": "auth screen, a dead end in search results",
  "sign-up": "auth screen, a dead end in search results",
  "reset-password": "auth screen, reached from an emailed link",
  auth: "OAuth callback handlers, no page",
  d: "tokenised delivery links, not public documents",
  r: "tokenised request-intake links, private to one buyer and not public documents",
  api: "machine surface, no page",
  "[workspace]": "the workspace-scoped application, gated on its second segment",
};

function topLevelSegments(): string[] {
  return readdirSync(APP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("_"));
}

describe("sitemap", () => {
  it("lists the marketing pages, home first", () => {
    const routes = marketingRoutes();

    expect(routes[0]).toBe("/");
    expect(routes).toContain("/pricing");
    expect(routes).toContain("/product");
    expect(routes).toContain("/how-it-works");
    expect(routes.length).toBeGreaterThan(10);
  });

  it("emits absolute URLs with no duplicates", () => {
    const urls = sitemap().map((entry) => entry.url);

    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\//);
    }
  });

  it("never lists a gated route", () => {
    for (const route of marketingRoutes()) {
      expect(isProtected(route), `${route} is gated but listed in the sitemap`).toBe(false);
    }
  });

  it("never lists a dynamic or tokenised route", () => {
    for (const route of marketingRoutes()) {
      expect(route, "dynamic segments cannot be enumerated for a sitemap").not.toContain("[");
      expect(route.startsWith("/d/"), "delivery links are not public documents").toBe(false);
    }
  });

  it("accounts for every top-level route in the app", () => {
    const listed = new Set(marketingRoutes());

    for (const segment of topLevelSegments()) {
      if (segment in EXCLUDED_FROM_SITEMAP) continue;
      if (PROTECTED_ROUTES.includes(`/${segment}`)) continue;

      expect.fail(
        `/${segment} is neither gated, in the sitemap, nor in EXCLUDED_FROM_SITEMAP. ` +
          `If it is a public page, move it into src/app/(marketing)/ so it is indexed. ` +
          `If it is not, add it to EXCLUDED_FROM_SITEMAP with the reason.`,
      );
    }

    expect(listed.has("/")).toBe(true);
  });
});
