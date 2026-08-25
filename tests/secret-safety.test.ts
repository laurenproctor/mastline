/**
 * @vitest-environment node
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards against leaking privileged credentials into the browser.
 *
 * A build-output scan is the definitive check and runs in CI against .next.
 * These source-level rules catch the mistake earlier, at the point someone
 * writes the import.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC).map((path) => ({
  path: relative(process.cwd(), path),
  source: readFileSync(path, "utf8"),
}));

const CLIENT_FILES = FILES.filter(
  (file) => /^\s*["']use client["']/m.test(file.source) && !file.path.includes(".test."),
);

describe("the service role key", () => {
  it("is only read in one place", () => {
    const readers = FILES.filter(
      (file) => file.source.includes("SUPABASE_SERVICE_ROLE_KEY") && !file.path.includes(".test."),
    ).map((file) => file.path);
    expect(readers).toEqual(["src/lib/supabase/env.ts"]);
  });

  it("is never referenced by a client component", () => {
    for (const file of CLIENT_FILES) {
      expect(file.source, `${file.path} reads the service role key`).not.toContain(
        "SUPABASE_SERVICE_ROLE_KEY",
      );
    }
  });

  it("is never given a NEXT_PUBLIC_ prefix", () => {
    for (const file of FILES) {
      expect(file.source, file.path).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE/);
      expect(file.source, file.path).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SECRET/);
    }
  });
});

describe("privileged modules are server-pinned", () => {
  it.each(["src/lib/supabase/admin.ts", "src/lib/auth.ts"])("%s imports server-only", (target) => {
    const file = FILES.find((candidate) => candidate.path === target);
    expect(file, `${target} is missing`).toBeDefined();
    expect(file!.source).toMatch(/import\s+["']server-only["']/);
  });

  it("no client component imports the admin client", () => {
    for (const file of CLIENT_FILES) {
      expect(file.source, `${file.path} imports the admin client`).not.toMatch(/supabase\/admin/);
    }
  });

  it("no client component imports the auth helpers", () => {
    for (const file of CLIENT_FILES) {
      expect(file.source, `${file.path} imports lib/auth`).not.toMatch(
        /from\s+["']@\/lib\/auth["']/,
      );
    }
  });
});

describe("no credential is committed in source", () => {
  it("contains no literal Supabase service JWT", () => {
    for (const file of FILES) {
      // Service-role JWTs carry this role claim segment.
      expect(file.source, file.path).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    }
  });

  it("keeps the seeded development password out of application code", () => {
    const appFiles = FILES.filter(
      (file) => !file.path.includes(".test.") && !file.path.includes("/sign-in/page"),
    );
    for (const file of appFiles) {
      expect(file.source, file.path).not.toContain("mastline-dev-password");
    }
  });
});
