import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

/**
 * The sitemap, discovered from the filesystem rather than hand-listed.
 *
 * A hand-kept array is wrong the first time somebody adds a page and forgets to
 * come back here, so this walks the (marketing) route group instead and treats
 * whatever is on disk as the truth. Adding a marketing page is enough; the
 * sitemap picks it up on the next build.
 *
 * Only the marketing group is walked, and that is the point: the signed-in
 * application, the auth screens, and the tokenised delivery links must never
 * appear here. Being outside the group is what keeps them out, so a public page
 * belongs inside it. tests/sitemap.test.ts fails if a new public page is added
 * somewhere else.
 */

const MARKETING_DIR = join(process.cwd(), "src", "app", "(marketing)");

/** Runs at build time, when the source tree this reads is still present. */
export const dynamic = "force-static";

function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

function isPrivateFolder(segment: string): boolean {
  return segment.startsWith("_");
}

function isDynamicSegment(segment: string): boolean {
  return segment.includes("[");
}

/**
 * A page whose whole body is a redirect is not a destination, and listing it
 * would point search engines at a 308. /welcome is the standing example.
 */
function isRedirectOnly(pageFile: string): boolean {
  const source = readFileSync(pageFile, "utf8");
  return /\b(permanentRedirect|redirect)\s*\(/.test(source) && !/<[A-Za-z]/.test(source);
}

function collectRoutes(dir: string, segments: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const routes: string[] = [];

  if (entries.some((e) => e.isFile() && e.name === "page.tsx")) {
    if (!isRedirectOnly(join(dir, "page.tsx"))) {
      routes.push(`/${segments.join("/")}`.replace(/\/+$/, "") || "/");
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (isPrivateFolder(entry.name) || isDynamicSegment(entry.name)) continue;

    routes.push(
      ...collectRoutes(
        join(dir, entry.name),
        isRouteGroup(entry.name) ? segments : [...segments, entry.name],
      ),
    );
  }

  return routes;
}

/**
 * Priority is a hint search engines mostly ignore, but where it is read the
 * ordering should be ours: the home page, then what somebody is deciding with,
 * then the policies they read once.
 */
const POLICY_ROUTES = new Set([
  "/privacy",
  "/terms",
  "/security",
  "/accessibility",
  "/acceptable-use",
  "/copyright",
]);

function priorityFor(route: string): number {
  if (route === "/") return 1;
  if (POLICY_ROUTES.has(route)) return 0.3;
  return 0.7;
}

/**
 * lastModified is deliberately absent. The honest source would be the commit
 * that last touched each page, and Vercel builds from a shallow clone where
 * every file carries the same checkout time -- so the only value available is
 * "the last deploy", for every page at once. Google ignores a lastmod it does
 * not trust, and stamping all forty URLs with one identical date is how you
 * earn that. Better to say nothing than to say something false.
 */
export function marketingRoutes(): string[] {
  return collectRoutes(MARKETING_DIR).sort((a, b) =>
    a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b),
  );
}

export default function sitemap(): MetadataRoute.Sitemap {
  return marketingRoutes().map((route) => ({
    url: absoluteUrl(route),
    changeFrequency: route === "/" ? "weekly" : "monthly",
    priority: priorityFor(route),
  }));
}
