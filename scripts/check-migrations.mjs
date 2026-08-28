#!/usr/bin/env node
/**
 * Migration integrity checks.
 *
 * Two modes, both credential-free:
 *
 *   node scripts/check-migrations.mjs
 *     Static checks over supabase/migrations. Needs no database and no Docker,
 *     so it is the first thing CI runs and the cheapest thing to run locally.
 *
 *   node scripts/check-migrations.mjs --applied-json <file>
 *     Additionally asserts that the versions recorded in
 *     supabase_migrations.schema_migrations are exactly the versions on disk.
 *     The file is the JSON that `supabase db query --local` writes; see
 *     .github/workflows/ci.yml and docs/CI.md.
 *
 * Why the version prefix gets its own check: Supabase orders and de-duplicates
 * migrations by that 14-digit prefix alone. Two files sharing a prefix are one
 * migration as far as the history table is concerned, so the second one is
 * recorded as applied without ever running. That failure is silent on a fresh
 * database and permanent on an existing one.
 */
import { readdirSync, readFileSync } from "node:fs";

const MIGRATIONS_DIR = "supabase/migrations";

// YYYYMMDDHHMMSS, then lowercase words separated by single underscores.
const CONVENTION = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

const problems = [];
const out = (line) => process.stdout.write(`${line}\n`);

/** A version prefix has to be a real UTC calendar time, not just 14 digits. */
function isRealTimestamp(version) {
  const [year, month, day, hour, minute, second] = [
    version.slice(0, 4),
    version.slice(4, 6),
    version.slice(6, 8),
    version.slice(8, 10),
    version.slice(10, 12),
    version.slice(12, 14),
  ].map(Number);
  const when = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    when.getUTCFullYear() === year &&
    when.getUTCMonth() === month - 1 &&
    when.getUTCDate() === day &&
    when.getUTCHours() === hour &&
    when.getUTCMinutes() === minute &&
    when.getUTCSeconds() === second
  );
}

let entries;
try {
  entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
} catch {
  process.stderr.write(`${MIGRATIONS_DIR} could not be read. Run this from the repository root.\n`);
  process.exit(1);
}

const files = entries
  .filter((entry) => entry.isFile() && entry.name !== ".gitkeep")
  .map((entry) => entry.name)
  .sort();

if (files.length === 0) {
  problems.push(`${MIGRATIONS_DIR} holds no migrations.`);
}

// 1. Filenames follow the repository convention.
const conforming = [];
for (const name of files) {
  const match = CONVENTION.exec(name);
  if (!match) {
    problems.push(
      `${name} does not follow the convention <14-digit UTC timestamp>_<lower_snake_case>.sql`,
    );
    continue;
  }
  if (!isRealTimestamp(match[1])) {
    problems.push(`${name} carries ${match[1]}, which is not a real UTC timestamp.`);
    continue;
  }
  conforming.push({ name, version: match[1] });
}

// 2. No two migrations share a version prefix.
const byVersion = new Map();
for (const { name, version } of conforming) {
  const seen = byVersion.get(version);
  if (seen) {
    seen.push(name);
  } else {
    byVersion.set(version, [name]);
  }
}
for (const [version, names] of byVersion) {
  if (names.length > 1) {
    problems.push(
      `Version ${version} is claimed by ${names.length} migrations: ${names.join(", ")}. ` +
        `Supabase records one row per version, so all but one would be skipped.`,
    );
  }
}

// 3. Optionally, what the database actually applied matches what is on disk.
const appliedFlag = process.argv.indexOf("--applied-json");
if (appliedFlag !== -1) {
  const path = process.argv[appliedFlag + 1];
  if (!path) {
    process.stderr.write("--applied-json needs a file path.\n");
    process.exit(1);
  }

  let applied;
  try {
    const payload = JSON.parse(readFileSync(path, "utf8"));

    // `supabase db query --output-format json` has two shapes. Driven by an
    // agent it wraps the result: {boundary, rows, warning}. Anywhere else --
    // a CI runner, a plain terminal -- it emits the bare array. Accept both,
    // and refuse anything else rather than guessing.
    //
    // This is not hypothetical tidiness. The first version of this script read
    // `payload.rows ?? []`, which turned the bare array into "zero applied" and
    // failed the build for the wrong reason. Silently reading an unrecognised
    // payload as empty is the dangerous half: it happened to fail closed here,
    // but the same blindness could report a clean chain that was never run.
    const rows = Array.isArray(payload) ? payload : payload?.rows;
    if (!Array.isArray(rows)) {
      throw new Error(
        `expected an array of rows, or an object with a rows array, but got ` +
          `${payload === null ? "null" : typeof payload} with keys ` +
          `[${Object.keys(payload ?? {}).join(", ")}]`,
      );
    }

    applied = rows.map((row) => {
      if (row?.version === undefined) {
        throw new Error(`a row has no "version" column: ${JSON.stringify(row)}`);
      }
      return String(row.version);
    });

    // An empty history table is never a pass. If the chain really did apply
    // nothing, the per-version messages below would say so 30 times over; this
    // says it once, in the language of the thing that actually went wrong.
    if (applied.length === 0) {
      throw new Error(
        "the migration history table is empty. Either no migration was applied, " +
          "or this JSON did not come from the database the migrations went to.",
      );
    }
  } catch (error) {
    process.stderr.write(`Could not read applied versions from ${path}: ${error.message}\n`);
    process.exit(1);
  }

  const onDisk = new Set(byVersion.keys());
  const inDatabase = new Set(applied);

  for (const version of onDisk) {
    if (!inDatabase.has(version)) {
      problems.push(
        `Version ${version} is on disk but was not recorded as applied. ` +
          `The local migration chain did not initialize cleanly.`,
      );
    }
  }
  for (const version of inDatabase) {
    if (!onDisk.has(version)) {
      problems.push(`Version ${version} is recorded as applied but has no file on disk.`);
    }
  }

  out(`Applied ${inDatabase.size} migrations; ${onDisk.size} on disk.`);
}

if (problems.length > 0) {
  process.stderr.write(`Migration integrity: ${problems.length} problem(s).\n\n`);
  for (const problem of problems) {
    process.stderr.write(`  - ${problem}\n`);
  }
  process.stderr.write("\n");
  process.exit(1);
}

out(`Migration integrity: ${files.length} migrations, all well-formed and uniquely versioned.`);
