/**
 * @vitest-environment node
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { WORKSPACE_SECTIONS } from "../src/lib/routes";

/**
 * No authenticated screen may write an unscoped path.
 *
 * The two-tab bug was never a single wrong link. It was a habit: paths like
 * "/money" and `/shoots/${id}` were written everywhere, reached the right
 * workspace only because the middleware guessed one from the active-workspace
 * cookie, and were therefore wrong exactly when two workspaces were open at
 * once -- the case nobody clicks through by hand.
 *
 * Fixing the links found today does not stop the next one being written, so
 * this reads the source and fails on the shape rather than on any particular
 * occurrence.
 *
 * It parses with the TypeScript scanner rather than grepping, because a grep
 * cannot tell a path in a link from a path in the sentence explaining why that
 * path is wrong -- and this file's own comments would have failed it.
 */

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

/**
 * Files that may legitimately name a path with no workspace in it.
 *
 * Each entry is a reason, and each is checked to still exist: an allowlist that
 * outlives the file it excuses is how a guard quietly stops guarding.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  // The classification lists themselves. These strings are data about routes,
  // not destinations anybody navigates to.
  "src/lib/routes.ts": "the route classification lists, and DEFAULT_SIGNED_IN_PATH",

  // The legacy compatibility layer. Its whole job is to receive an unscoped
  // path and answer with a scoped one, so it necessarily names them.
  "src/middleware.ts": "the legacy redirect that keeps old bookmarks working",

  // Sign-in happens before a workspace is known -- somebody may be a member of
  // several, or of none yet -- so the post-sign-in destination is the legacy
  // path, resolved by the middleware once there is a session to resolve it
  // with. This is the one place that reaching for the cookie is correct.
  "src/app/sign-in/page.tsx": "the default destination before a workspace is known",
  "src/app/sign-in/verify/page.tsx": "the default destination before a workspace is known",

  // Both render outside any route's params. They read the workspace from the
  // URL through usePathname() and only fall back to a legacy path when there
  // is none to read -- a mistyped marketing URL, or a static prerender.
  "src/app/not-found.tsx": "the fallback when the URL names no workspace",
  "src/components/error-state.tsx": "the fallback when the URL names no workspace",
};

/** The sections plus the one nested area, longest first so /work/commercial wins. */
const SECTIONS = [...WORKSPACE_SECTIONS, "work/commercial"].sort((a, b) => b.length - a.length);

function looksUnscoped(value: string): string | null {
  for (const section of SECTIONS) {
    if (value === `/${section}`) return section;
    // "/shoots/", "/shoots?", "/shoots#" -- but not "/shootsomething".
    if (/^[/?#]/.test(value.slice(section.length + 1)) && value.startsWith(`/${section}`)) {
      return section;
    }
  }
  return null;
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    found.push(full);
  }
  return found;
}

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly value: string;
  readonly section: string;
}

/**
 * Every string in a file that begins a path, comments excluded.
 *
 * A template literal is judged on its head: `/shoots/${id}` starts "/shoots/"
 * and is unscoped, while `/${slug}/shoots/${id}` starts "/" and is not.
 */
function offencesIn(file: string): Offence[] {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offences: Offence[] = [];

  const record = (value: string, position: number) => {
    const section = looksUnscoped(value);
    if (!section) return;
    offences.push({
      file: relative(ROOT, file),
      line: source.getLineAndCharacterOfPosition(position).line + 1,
      value,
      section,
    });
  };

  const walk = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      record(node.text, node.getStart(source));
    } else if (ts.isTemplateExpression(node)) {
      record(node.head.text, node.getStart(source));
    }
    ts.forEachChild(node, walk);
  };

  walk(source);
  return offences;
}

describe("authenticated links carry a workspace", () => {
  const files = sourceFiles(SRC);

  it("finds source to read", () => {
    // A scanner that silently reads nothing passes for ever.
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no unscoped application path outside the documented exceptions", () => {
    const offences = files
      .filter((file) => !(relative(ROOT, file) in ALLOWED))
      .flatMap(offencesIn);

    const rendered = offences.map(
      (offence) => `${offence.file}:${offence.line} → ${JSON.stringify(offence.value)}`,
    );

    expect(
      rendered,
      [
        "These paths reach a workspace only through the active-workspace cookie,",
        "which is global to the browser and therefore wrong whenever two",
        "workspaces are open at once. Build them with workspaceRoutes(canonicalSlug)",
        "from src/lib/workspace-routes.ts instead.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("keeps its allowlist honest", () => {
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(() => statSync(join(ROOT, file)), `${file} is allowlisted for: ${reason}`).not.toThrow();
      // An allowlisted file that no longer contains an unscoped path does not
      // need excusing, and leaving it listed hides the next one.
      expect(offencesIn(join(ROOT, file)).length, `${file} no longer needs its exception`)
        .toBeGreaterThan(0);
    }
  });

  /**
   * The scanner has to actually catch things. This proves it on the exact shapes
   * that were wrong, so a refactor that quietly makes it match nothing fails.
   */
  it("catches the shapes this guard exists for", () => {
    expect(looksUnscoped("/money")).toBe("money");
    expect(looksUnscoped("/shoots/")).toBe("shoots");
    expect(looksUnscoped("/dispatch/abc")).toBe("dispatch");
    expect(looksUnscoped("/settings?saved=buyer")).toBe("settings");
    expect(looksUnscoped("/work/commercial")).toBe("work/commercial");
    expect(looksUnscoped("/work#top")).toBe("work");
  });

  it("does not flag a scoped path or a public one", () => {
    expect(looksUnscoped("/")).toBe(null);
    expect(looksUnscoped("/hale-studio/money")).toBe(null);
    expect(looksUnscoped("/d/token")).toBe(null);
    expect(looksUnscoped("/sign-in")).toBe(null);
    expect(looksUnscoped("/auth/sign-out")).toBe(null);
    expect(looksUnscoped("/api/workspaces/x/export")).toBe(null);
    expect(looksUnscoped("/welcome")).toBe(null);
    // Not a section, just a word that starts like one.
    expect(looksUnscoped("/workflows")).toBe(null);
    expect(looksUnscoped("/moneyed")).toBe(null);
  });
});
