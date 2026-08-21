# Mastline Claude Code Starter

Mastline is the business operating system for paparazzi: one connected workspace for opportunities, shoots, dispatch, submissions, rights, revenue, and archive activation.

This package is designed to be opened directly in Claude Code. It contains:

- A runnable Next.js UI scaffold for every established product screen
- The selected Mastline wordmark and prior screen references
- A product constitution in `CLAUDE.md`
- Screen-level behavior and acceptance criteria
- A normalized Supabase/Postgres starter schema with organization-scoped RLS
- An implementation sequence that prioritizes one complete operator loop
- Explicit open decisions so proposals are not mistaken for settled facts

## Start here

```bash
npm install
npm run dev
```

Then open `http://localhost:3000/work`. The interface reads from a typed, relational mock layer so the whole product can be reviewed before auth, storage, and database work are wired in.

Use Node.js 22 or later.

### Local database

The app needs a Supabase stack. Docker must be running.

```bash
supabase start           # first run pulls images
supabase db reset        # applies the migration and seeds two workspaces
cp .env.example .env.local
supabase status -o env   # copy ANON_KEY and SERVICE_ROLE_KEY into .env.local
```

This project runs on ports 55321-55329 rather than the Supabase defaults, so it
can coexist with another local Supabase project.

Seeded sign-ins, all with the password `mastline-dev-password`:

| Email | Workspace | Role |
| --- | --- | --- |
| marcus@mastline.test | Marcus Hale Studio | owner |
| jordan@mastline.test | Marcus Hale Studio | editor |
| dana@mastline.test | Marcus Hale Studio | dispatcher |
| felix@mastline.test | Marcus Hale Studio | finance |
| rhea@mastline.test | Marcus Hale Studio | rights_reviewer |
| vera@mastline.test | Marcus Hale Studio | viewer |
| nadia@northline.test | Northline Photo | owner |

Northline Photo exists so cross-workspace isolation can be proven rather than
assumed. The tests under `tests/` sign in as these users and attempt to reach
each other's records.

### Checks

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript, strict, no emit |
| `npm run lint` | ESLint (pinned to 9.x — see `eslint.config.mjs`) |
| `npm run test` | Vitest unit, component, and database tests |
| `npm run build` | Production build |
| `npm run verify` | All four, in order |

### Where the rules live

Business rules are centralized, not spread across components:

| Module | Owns |
| --- | --- |
| `src/lib/pricing.ts` | Plan prices, annual totals, the savings claim |
| `src/lib/sales-engine.ts` | The 70/30 split, rounding, and refund reversal |
| `src/lib/money.ts` | Integer minor units, arithmetic, formatting |
| `src/lib/domain.ts` | Entity types and status vocabularies (mirrors the schema enums) |
| `src/lib/permissions.ts` | Role capabilities, kept in step with the RLS policies |
| `src/lib/metadata-rules.ts` | What "complete enough" means; drives warnings and the dispatch gate |
| `src/lib/dispatch-rules.ts` | Whether a package is buyer-ready; gates approval |
| `src/lib/validation.ts` | Server Action input parsing |
| `src/lib/mock/queries.ts` | The remaining mock seam, replaced screen by screen |
| `src/lib/data/` | Real, database-backed queries |

No component hard-codes a price, a rate, or a monetary string.

### Security model

- Row level security is the authorization boundary, not the query filter.
  `tests/` proves it by signing in as real users and trying to cross workspaces.
- `src/lib/permissions.ts` only decides what the interface offers. The database
  decides what actually happens, and `tests/permissions-match-policies.test.ts`
  asserts the two agree for every role.
- Three private storage buckets keyed by `organization_id`. Nothing public.
- The service role key is read in exactly one module, which is `server-only`.
  `tests/secret-safety.test.ts` enforces that.
- Run the advisor rule set with:
  `psql "$DB_URL" -f supabase/checks/advisors.sql` — it prints rows only for
  problems.

## Core routes

| Route | Experience |
| --- | --- |
| `/work` | Daily action queue and business pulse |
| `/news` | News-to-archive opportunity monitor |
| `/shoots/new` | Fast shoot intake |
| `/shoots` | All shoots and their progress |
| `/shoots/sht_chelsea` | Shoot workspace |
| `/dispatch/sht_chelsea` | Buyer-ready package review |
| `/submissions` | All submissions |
| `/submissions/sub_bg_0820_441` | Submission system of record |
| `/assets/ast_chelsea_472` | Canonical asset record |
| `/rights` | Possible-use triage and evidence |
| `/money` | Revenue, receivables, and reconciliation |
| `/archive` | Commercial archive search |
| `/welcome` | Marketing homepage |
| `/pricing` | Final Solo, Pro, Studio, and Agency pricing with annual/monthly toggle |

## Product boundary

The launch product is not “AI for paparazzi.” It is a trustworthy commercial record that makes one live shoot materially easier from creation through payment. Intelligence is earned after the underlying record is reliable.

## Status

**Phase 0** — repository foundation, centralized business rules with tests,
accessibility fixes, and a typed relational mock layer.

**Phase 1** — the commercial graph as a migration with organization-scoped RLS,
three private storage buckets, Supabase Auth with SSR sessions, protected
routes, workspace switching, and the six-role permission matrix.

**Phase 2A** — shoot to selected asset. Create Shoot writes real records, files
import with a browser-computed SHA-256 into private storage, originals are
immutable, the contact sheet culls by keyboard, and metadata edits preserve
prior versions in an append-only log.

**Phase 2B** — dispatch to payment. Packages are built from a selection,
validated against the same metadata rules the contact sheet uses, and approved
behind a two-step human confirmation. Approval writes an immutable submission
holding exactly which asset versions went out and under which terms. Sales,
payments, and allocations connect back to the frame that earned them.

### The loop

`shoot → selects → package → dispatch review → submission → licence → payment → allocation`

Every step is a real database write and every one is covered by
`tests/full-loop.test.ts`, which carries a single frame from selection to
recorded earnings, each step performed as the role that would really do it.

Two things the database enforces rather than the application:

- A package cannot reach a shipped status without a recorded approval.
- A licence's two shares must reconstitute the sale base, and an externally
  generated licence may not carry a Mastline fee.

Mastline **records** a dispatch. It does not yet transmit to a buyer's SFTP or
portal — delivery integrations are Phase 3. The submission is still the
authoritative account of what was sent.

### How an import works

1. The browser hashes the file with WebCrypto before anything leaves the machine.
2. The bytes go to `originals/<organization_id>/_staging/<token>`.
3. `registerImport` creates the asset and its original version row.
4. Only then are the bytes promoted to their canonical key.

If step 3 fails the staged object is removed and nothing authoritative was
written. Objects under `_staging/` are the only ones in the originals bucket
that can be renamed or deleted; once promoted, an original is immutable.

JPEG, PNG, WebP, and AVIF get a browser-generated preview for the contact
sheet. RAW files are imported and hashed identically but have no preview until
a server-side decoder exists — which RAW formats are supported at launch is
still an open product decision.

Only News Radar still reads the mock layer, because there is no opportunity
source to read from yet; the first release uses manually entered stories. That
goes away in Phase 4.

Not yet built: delivery integrations, webhook retry, statement CSV import, and
rights triage actions. See `docs/IMPLEMENTATION_PLAN.md`.
