/**
 * @vitest-environment node
 */
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * A branch stays off the protected surfaces.
 *
 * Written first for the News Radar evaluation branch, which was built beside
 * two protected workstreams -- the dashboard design system and immutable
 * dispatch -- and it applies to every branch since: the test reads the
 * branch's own diff against `origin/main` (committed and uncommitted) and
 * fails on any protected path.
 *
 * One file under `src/styles/` is the exception, and only under a contract.
 * `mastline-dashboard-screens.css` exists so a screen can carry the few rules
 * no primitive owns without reaching into `globals.css` or the canonical
 * sheets. A branch may add rules there, but every selector it adds must be
 * namespaced to a screen (`.ml-<screen>-<part>`), built only from `ml-`
 * classes, with no bare element and no generic name -- so the file cannot
 * quietly become a second global stylesheet.
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

/** The one stylesheet a screen may extend, exactly. */
export const SCREENS_STYLESHEET = "src/styles/mastline-dashboard-screens.css";

/** A screen-namespaced class: `.ml-` plus at least two words, e.g. `.ml-work-queue-filters`. */
const SCREEN_CLASS = /^\.ml-[a-z0-9]+(?:-[a-z0-9]+)+(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?$/;
/** Any design-system class, with optional pseudo-classes and attribute parts. */
const ML_COMPOUND = /^\.ml-[a-z0-9_-]+(?:\.ml-[a-z0-9_-]+)*(?::[a-z-]+(?:\([^)]*\))?|\[[^\]]+\])*$/;
const GENERIC =
  /^\.(card|panel|table|row|header|footer|empty|status|list|button|badge|field|item|title|wrapper|container)\b/;

/** Protected paths among the files a branch changes. */
export function protectedTouches(files: readonly string[]): readonly string[] {
  return files.filter(
    (path) =>
      path !== SCREENS_STYLESHEET &&
      PROTECTED_PREFIXES.some((prefix) =>
        prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix,
      ),
  );
}

/**
 * Why a selector may not be added to the screens stylesheet, or null when it
 * may. The first compound names the screen; every compound is an ml- class.
 */
export function screenSelectorProblem(selector: string): string | null {
  const trimmed = selector.trim();
  if (!trimmed || trimmed.startsWith("@")) return null;
  const compounds = trimmed.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  const [first] = compounds;
  const firstClass = first.replace(/(?::[a-z-]+(?:\([^)]*\))?|\[[^\]]+\])+$/, "");
  if (!SCREEN_CLASS.test(firstClass)) {
    return `${selector}: must begin with a screen-namespaced class such as .ml-work-queue-filters`;
  }
  for (const compound of compounds) {
    if (/^[a-z][a-z0-9]*/.test(compound)) return `${selector}: styles a bare element (${compound})`;
    if (GENERIC.test(compound)) return `${selector}: uses a generic name (${compound})`;
    if (!ML_COMPOUND.test(compound)) {
      return `${selector}: ${compound} is not built from ml- classes`;
    }
  }
  return null;
}

function git(command: string): string | undefined {
  try {
    return execSync(`git ${command}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

function mergeBase(): string | undefined {
  return git("merge-base origin/main HEAD")?.trim() || undefined;
}

function changedFiles(base: string): readonly string[] {
  const committed = git(`diff --name-only ${base} HEAD`) ?? "";
  const working = git("status --porcelain --untracked-files=all") ?? "";
  const workingPaths = working
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((path) => (path.includes(" -> ") ? path.split(" -> ")[1] : path));
  return [...new Set([...committed.split("\n").filter(Boolean), ...workingPaths])].sort();
}

/** The selectors a branch adds to a file: the `+` lines that open a rule. */
function addedSelectors(base: string, file: string): readonly string[] {
  const diff = `${git(`diff ${base} -- "${file}"`) ?? ""}\n${git(`diff -- "${file}"`) ?? ""}`;
  return diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1).trim())
    .filter((line) => line.endsWith("{") && !line.startsWith("@"))
    .flatMap((line) =>
      line
        .slice(0, -1)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    );
}

describe("a branch stays off the protected surfaces", () => {
  const base = mergeBase();
  const itIf = base ? it : it.skip;

  itIf("changes no design-system, immutable-dispatch, or metadata file", () => {
    expect(protectedTouches(changedFiles(base!))).toEqual([]);
  });

  itIf("adds only screen-namespaced rules to the dashboard screens stylesheet", () => {
    const problems = addedSelectors(base!, SCREENS_STYLESHEET)
      .map(screenSelectorProblem)
      .filter((problem): problem is string => problem !== null);
    expect(problems).toEqual([]);
  });
});

describe("the guard's contract", () => {
  it("admits only the screens stylesheet under src/styles, and nothing else protected", () => {
    expect(protectedTouches([SCREENS_STYLESHEET])).toEqual([]);
    expect(protectedTouches(["src/styles/work-queue.css"])).toEqual(["src/styles/work-queue.css"]);
    expect(protectedTouches(["src/styles/mastline-dashboard-surfaces.css"])).toHaveLength(1);
    expect(protectedTouches(["src/app/globals.css"])).toEqual(["src/app/globals.css"]);
    expect(protectedTouches(["src/components/app-shell.tsx"])).toHaveLength(1);
    expect(protectedTouches(["docs/design/anything.md"])).toHaveLength(1);
    expect(
      protectedTouches(["src/app/[workspace]/work/page.tsx", "docs/verification/x.png"]),
    ).toEqual([]);
  });

  it("accepts selectors namespaced to a screen and built from ml- classes", () => {
    for (const selector of [
      ".ml-work-queue-filters",
      ".ml-work-queue-filters__count",
      ".ml-work-queue-pulse .ml-metric__value",
      ".ml-work-queue-shoot:focus-visible",
      ".ml-work-queue-filters .ml-filter-chip[aria-current]",
      ".ml-work-queue-basis, .ml-work-queue-pulse__foot",
    ]) {
      for (const part of selector.split(",")) expect(screenSelectorProblem(part)).toBeNull();
    }
  });

  it("rejects generic, bare-element, unnamespaced, and primitive-first selectors", () => {
    for (const selector of [
      ".card",
      ".row",
      ".header",
      "h2",
      "table th",
      ".work-queue-filters",
      ".ml-filters",
      ".ml-text-link.rights-source-url",
      ".ml-metric__value",
      ".ml-work-queue-shoot h3",
      ".ml-work-queue-filters .button",
    ]) {
      expect(screenSelectorProblem(selector), selector).not.toBeNull();
    }
  });
});
