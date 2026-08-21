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
routes, workspace switching, and the six-role permission matrix. Settings reads
real workspace data.

Not yet built: the write paths. Shoots, assets, dispatch, submissions, and money
still read the mock layer and are replaced in Phase 2. Actions that are not
wired up are marked `aria-disabled` rather than silently doing nothing. See
`docs/IMPLEMENTATION_PLAN.md`.
