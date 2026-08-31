#!/usr/bin/env node
/**
 * Prove the built preview function carries sharp's native pair.
 *
 * `next build` writes a trace per route naming every file that route's
 * function ships with. Sharp's binary (`@img/sharp-linux-x64/lib/*.node`) is
 * found by `require` and traced on its own; the libvips shared library it
 * links against (`@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.*`) is found
 * by the dynamic linker and is not -- which is how production came to ship a
 * binary without its library. next.config.ts adds it back for this route;
 * this script fails the build check if it ever goes missing again.
 *
 * Run after `next build` on a Linux x64 glibc host (the CI runner, Vercel's
 * build). On any other platform the packages are not installed and the
 * check reports that it cannot apply rather than pretending to pass.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const TRACE = join(ROOT, ".next/server/app/d/[token]/preview/[assetId]/route.js.nft.json");
const BINARY_DIR = "node_modules/@img/sharp-linux-x64/lib";
const LIBVIPS_DIR = "node_modules/@img/sharp-libvips-linux-x64/lib";

const out = (line) => process.stdout.write(`${line}\n`);

if (!existsSync(TRACE)) {
  process.stderr.write(`No trace at ${relative(ROOT, TRACE)}. Run \`next build\` first.\n`);
  process.exit(1);
}

const linuxInstalled = existsSync(join(ROOT, LIBVIPS_DIR)) && existsSync(join(ROOT, BINARY_DIR));
if (!linuxInstalled) {
  out(
    `Preview trace check: the linux-x64 sharp packages are not installed on this host (${process.platform}/${process.arch}), so the check does not apply here. It runs on the Linux CI runner.`,
  );
  process.exit(process.env.REQUIRE_LINUX_SHARP ? 1 : 0);
}

const trace = JSON.parse(readFileSync(TRACE, "utf8"));
const files = trace.files.map((entry) => relative(ROOT, resolve(dirname(TRACE), entry)));

const binaries = files.filter((f) => f.startsWith(BINARY_DIR) && f.endsWith(".node"));
const libraries = files.filter((f) => f.startsWith(LIBVIPS_DIR) && /libvips-cpp\.so/.test(f));

const problems = [];
if (binaries.length === 0) problems.push(`no sharp binary from ${BINARY_DIR} is traced`);
if (libraries.length === 0)
  problems.push(`no libvips shared library from ${LIBVIPS_DIR} is traced`);

// The pair must agree: the binary's libvips version is the one the library provides.
const binaryPkg = JSON.parse(readFileSync(join(ROOT, BINARY_DIR, "../package.json"), "utf8"));
const libvipsPkg = JSON.parse(readFileSync(join(ROOT, LIBVIPS_DIR, "../package.json"), "utf8"));
const wanted = binaryPkg.optionalDependencies?.["@img/sharp-libvips-linux-x64"];
if (wanted && wanted !== libvipsPkg.version) {
  problems.push(
    `@img/sharp-linux-x64 ${binaryPkg.version} wants libvips ${wanted} but ${libvipsPkg.version} is installed`,
  );
}

out(`Preview trace: ${files.length} files.`);
for (const f of [...binaries, ...libraries]) out(`  traced: ${f}`);
out(`  sharp-linux-x64 ${binaryPkg.version} ↔ sharp-libvips-linux-x64 ${libvipsPkg.version}`);

if (problems.length > 0) {
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.exit(1);
}
out("Preview trace check: the preview function ships sharp's binary and its libvips library.");
