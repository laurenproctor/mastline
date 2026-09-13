# Continuous integration

Every pull request into `main` runs `.github/workflows/ci.yml`. Two jobs, kept
separate so a red build names the thing that broke rather than "CI failed".

## Before `Verify` can pass — one prerequisite commit

**`npm run format:check` currently fails on 73 files that were already in the
repository**, none of them added by this branch: 62 under `src/`, 6 under
`tests/`, 4 under `e2e/`, and `.claude/settings.json`. Prettier is configured
and the `format` script exists, but the repository has never been formatted
repo-wide, so the check has never been run in anger.

That is a blocker for this workflow rather than a fault in it. The fix is one
mechanical commit, and it is deliberately **not** part of this branch: a
73-file reformat would swamp the diff that introduces the gates, and it would
conflict with every branch currently in flight. Land it on its own, when the
other branches are merged or at a quiet point:

```sh
npm run format
npm run format   # yes, twice — see below
npm run verify
```

**It genuinely needs two passes.** After one `npm run format`, `format:check`
still fails on `e2e/helpers.ts`: Prettier's output for that file is not a fixed
point in a single pass. A second run converges and the third is a no-op. A
one-pass formatting commit will leave CI red on one file and look like a
workflow bug.

The reformat was rehearsed on this branch and reverted. `npm run typecheck`,
`npm run lint`, and `npm run test` all still pass on the formatted tree
(51 files, 776 tests), so the change is mechanical.

Until that commit lands, expect `Verify` to fail at its first step. Everything
after it — types, lint, tests, build — passes today.

## What runs

### `Verify`

Node.js 22, dependencies from the lockfile with `npm ci`, then the same
commands the repository already documents in the README:

| Step | Command | What a failure means |
| --- | --- | --- |
| Check types | `npm run typecheck` | `tsc --noEmit`, strict. |
| Lint | `npm run lint` | ESLint, including the `eqeqeq` and unused-variable rules the money and status types depend on. |
| Unit tests | `npm run test` | Vitest. See the note on the database suites below. |
| Build | `npm run build` | The production Next.js build. |
| Check formatting | `npm run format:check` | Prettier would rewrite a file. Run `npm run format`. |

Formatting runs **last**, which is backwards for a check that takes four
seconds. It is deliberate and temporary: the step is red on files that predate
this workflow, and a failed step skips every step after it. First in the list,
it would hide whether types, lint, tests, and the build pass on a runner for as
long as the formatting commit takes to land. Move it back to the front once it
is green.

This is `npm run verify` with formatting added at the front, run as five named
steps instead of one, so the pull request shows which stage failed without
anyone opening the log.

**The database suites do not run here.** The tests under `tests/` need a local
Postgres and a seeded workspace, and `vitest.config.ts` makes them skip
themselves cleanly when the Supabase environment is absent — which it is on a
runner. So `Verify` covers the unit and component suites. Tenancy isolation,
the full loop, and the permission-to-policy agreement stay a local check
(`supabase start` then `npm run test`) and a pre-deploy one. CI proving the
schema *applies* is not the same as CI proving the schema *behaves*; do not
read a green build as the latter.

The browser suite (`npm run test:e2e`) is not part of `Verify`. It needs a
real stack, a production build and a server, so it has its own workflow
(`.github/workflows/e2e-suite.yml`) — which does now gate pull requests, in a
narrower shape than a dispatch.

**On a pull request: desktop alone, ~14 minutes.** Desktop runs every spec —
only layout and engine coverage lives in the other two projects — so it is the
job that answers "did this break the application". Of those 14 minutes, 10.6
are tests and the rest is `npm ci`, `supabase start`, `next build` and the
browser install.

**On a dispatch: all three projects, in parallel.** Run one before a release,
or on anything touching layout, navigation, the consent banner or the import
queue, which is what tablet and mobile exist to catch. Tablet adds 4.8 minutes
and mobile 6.9, both alongside desktop rather than after it.

The specs share one database and so cannot share a worker —
`playwright.config.ts` pins `workers: 1` — but they can share nothing at all
instead: each job starts its own Supabase stack, builds its own app and serves
its own `next start`. A run is as long as its slowest job rather than the sum
of three, and because the tag-based selection removes so much duplicated work,
the matrix costs *fewer* runner minutes than the old single sequential job.

This suite spent a long time with a reputation for flakiness that it turned
out not to deserve. The tests that failed repeatedly on a development machine
running three Supabase stacks at load average 16 pass on a quiet runner. Do
not diagnose a red browser suite from a local run; dispatch it and read the
runner.

**A test runs at one width unless it says otherwise.** Desktop runs every
spec; tablet and mobile run only what carries `@responsive`, and mobile also
what carries `@webkit`. Most of this suite proves things with no viewport
dimension — whether a split is 70/30, whether a token that was never issued
reveals anything — and running those three times answered the same question
three times. Tag a test when the width can change what it proves, or when the
engine can: the mobile project is the only WebKit one, and Playwright's WebKit
has no `navigator.storage`, which is why the import queue is tagged to reach
it.

**The seeded roles are signed in once**, by the `setup` project in
`e2e/auth.setup.ts`, which every viewport project declares as a dependency.
`signIn` in `e2e/helpers.ts` replays those cookies rather than driving the form
again, and falls back to the real form for any account or workspace it has no
saved session for. That setup project is also the suite's sign-in smoke test:
a broken sign-in screen fails the run there, by name, before a spec has run.

### `Migration integrity`

Three checks, cheapest first.

1. **`node scripts/check-migrations.mjs`** — no database, no Docker, answers in
   under a second. It fails when a filename does not match
   `<14-digit UTC timestamp>_<lower_snake_case>.sql`, when the timestamp is not
   a real UTC calendar time, or when **two migrations share a version prefix**.

   That last one is the reason this script exists. Supabase orders and
   de-duplicates migrations by the 14-digit prefix alone, and the history table
   holds one row per version. Two files claiming `20260828093000` are one
   migration as far as the CLI is concerned: the second is recorded as applied
   without its DDL ever running. The database is then wrong in a way that looks
   right, on a fresh checkout and permanently on an existing one.

2. **`supabase db start`** — starts local Postgres on the runner, applies all
   migrations in order against an empty database, then loads
   `supabase/seed.sql`. A migration that cannot apply fails the step. So does a
   seed that no longer matches the schema, which is worth knowing but will be
   reported under this heading.

3. **The history table is read back and compared to the files on disk.**
   `supabase db query --local` dumps
   `supabase_migrations.schema_migrations` as JSON and
   `check-migrations.mjs --applied-json` asserts the two sets are equal, in both
   directions. Step 2 exiting zero says the CLI reported success; this step says
   every version on disk is genuinely recorded, and nothing is recorded that has
   no file.

   **`--agent no` on that query is load-bearing.** With `--output-format json`
   the CLI has two output shapes: driven by an agent it wraps the result as
   `{boundary, rows, warning}`, and everywhere else it emits the bare array.
   Without the flag, the shape depends on who is running the command — which is
   how the first run of this job went red. The rehearsal had been done inside an
   agent session, so it only ever saw the wrapped shape; the runner sent the
   bare array, the parser read it as zero applied migrations, and the job
   reported a clean 30-migration chain as a total failure to apply.

   `check-migrations.mjs` now accepts both shapes and, more importantly,
   **refuses a payload it does not recognise** instead of reading it as empty.
   An empty history table is also an explicit failure rather than 30 identical
   complaints. The silent-empty reading was the real defect: it failed closed
   this time, but nothing about it guaranteed that.

Then the stack is stopped, with `if: always()` so a failure earlier in the job
still tears it down.

Both scripts run locally exactly as they do in CI:

```sh
node scripts/check-migrations.mjs
```

The Docker half is reproducible locally too, but `supabase db start` in this
repository targets project `Mastline` on ports 55321–55329. If you already have
the development stack up, running it will act on **that** stack and
`supabase stop --no-backup` will discard its data. To rehearse the job without
touching your working database, copy `supabase/` elsewhere, change `project_id`
and the ports in the copy's `config.toml`, and run the CLI against it with
`--workdir`.

## What CI deliberately does not do

- **No credentials.** No `SUPABASE_ACCESS_TOKEN`, no project ref, no database
  password, no Stripe or Anthropic key. Nothing in either job can reach the
  hosted project.
- **No `supabase link`, no `supabase db push`.** Applying a migration to
  production stays a deliberate manual act; `docs/DEPLOY.md` owns that procedure
  and `supabase migration list --linked` remains the check before a deploy that
  touches data.
- **No writes of any kind.** Workflow permissions are `contents: read`. The
  workflow does not comment on pull requests, move labels, publish, or deploy.
  Vercel's own GitHub integration handles preview and production deploys and is
  untouched by this file.

## Pinning

Every third-party action is pinned to a full commit SHA with the tag in a
trailing comment, so a moved tag cannot change what runs:

| Action | Version | SHA |
| --- | --- | --- |
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` |
| `supabase/setup-cli` | v3.0.0 | `46f7f98c7f948ad727d22c1e67fab04c223a0520` |

The Supabase CLI is pinned to **2.101.0** via the action's `version` input,
rather than left to default to `latest`. The CLI is what applies the migrations,
so an unannounced change to it would otherwise surface as a mystery red build on
an unrelated pull request. 2.101.0 is the version these checks were proven
against. Bumping it is a normal pull request: change the one line, and the
migration job proves the new version still applies the chain.

To move any of these, resolve the tag to its SHA before editing:

```sh
gh api repos/actions/checkout/tags --jq '.[] | "\(.name) \(.commit.sha)"' | head
```

## A note on Node 22

CI runs Node.js 22, the floor in `package.json`'s `engines`. The Vercel project
builds on Node 24.x and local development is currently on 24 as well. That gap
is intentional — it catches a change that quietly needs a newer runtime — but it
means CI is not a byte-for-byte rehearsal of the production build. If the two
ever need to match, change this file and `.github/workflows/ci.yml` together so
the reason stays recorded.

## Branch protection — still to be set by hand

**None of this is enforced yet.** The workflow only reports. Turning these into
merge gates is a repository setting on GitHub, and it is deliberately not
automated: the checks must be observed green on a real pull request first,
because a required check that has never run blocks every merge indefinitely.

Once the formatting commit above has landed and a pull request shows both
jobs green, on
`github.com/laurenproctor/mastline` → **Settings → Rules → Rulesets** (or
**Settings → Branches** for the older branch-protection UI), add a ruleset
targeting `main`:

1. **Require a pull request before merging.** Merging straight to `main`
   bypasses a `pull_request`-triggered workflow entirely, so without this the
   gates are optional in practice.
2. **Require status checks to pass**, and select both by name:
   - `Verify`
   - `Migration integrity`

   These are the `name:` values on the jobs, not the file name. Renaming a job
   silently drops its gate — the old name stays required, never reports, and
   the new one is not required. Rename and update the ruleset together.
3. **Require branches to be up to date before merging.** Two pull requests can
   each be green alone and broken together; this is what catches it. Expect
   more re-runs on a busy day.
4. **Block force pushes** to `main`.
5. Leave **Do not allow bypassing the above settings** off, or on with the
   administrator exception, as preferred — but if bypass is allowed, the gates
   are a convention rather than a control. Prefer it on.

Do not require the browser suite or the database suites. Neither runs in CI, so
requiring them would block every merge.
