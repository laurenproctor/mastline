/**
 * @vitest-environment node
 */
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The News Radar evaluation branch was built beside two protected
 * workstreams -- the dashboard design system and immutable dispatch -- and
 * must not touch their files. This test reads the branch's own diff against
 * `origin/main` (committed and uncommitted) and fails on any protected path.
 *
 * Needs no database. It skips itself when the repository has no
 * `origin/main` to compare against (a shallow CI checkout), and it is empty
 * by construction once the branch has merged.
 */

const PROTECTED_PREFIXES = [
  "src/app/globals.css",
  "src/styles/",
  "src/components/app-shell.tsx",
  "src/components/app-shell.test.tsx",
  "src/components/page-header.tsx",
  "src/components/page-header.test.tsx",
  "src/components/primitives.tsx",
  "docs/design/",
  "src/app/[workspace]/dispatch/",
  "src/app/[workspace]/submissions/",
  "src/app/d/",
  "src/app/[workspace]/assets/[assetId]/page.tsx",
  "src/app/[workspace]/shoots/[shootId]/page.tsx",
  "src/components/asset-inspector.tsx",
  "src/lib/data/packages.ts",
  "src/lib/data/submissions.ts",
  "src/lib/data/delivery-links.ts",
  "src/lib/delivery-download.ts",
  "src/lib/dispatch-lifecycle.ts",
  "supabase/seed.sql",
  "e2e/helpers.ts",
  "docs/DELIVERY_LINKS.md",
  "docs/DEPLOY.md",
  "docs/DATA_MODEL.md",
  "docs/DECISIONS.md",
  "src/lib/data/assets.ts",
  "src/components/metadata-panel.tsx",
  "src/lib/data/asset-metadata.ts",
  "src/lib/asset-metadata.ts",
  "src/app/[workspace]/news/page.tsx",
];

function git(command: string): string | undefined {
  try {
    return execSync(`git ${command}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

function changedFiles(): readonly string[] | undefined {
  const base = git("merge-base origin/main HEAD")?.trim();
  if (!base) return undefined;
  const committed = git(`diff --name-only ${base} HEAD`) ?? "";
  const working = git("status --porcelain --untracked-files=all") ?? "";
  const workingPaths = working
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((path) => (path.includes(" -> ") ? path.split(" -> ")[1] : path));
  return [...new Set([...committed.split("\n").filter(Boolean), ...workingPaths])].sort();
}

describe("News Radar evaluation stays off the protected surfaces", () => {
  const files = changedFiles();
  const itIf = files ? it : it.skip;

  itIf("changes no design-system, immutable-dispatch, or metadata file", () => {
    const touched = (files ?? []).filter((path) =>
      PROTECTED_PREFIXES.some((prefix) =>
        prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix,
      ),
    );
    expect(touched).toEqual([]);
  });
});
