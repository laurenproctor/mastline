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

### Checks

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript, strict, no emit |
| `npm run lint` | ESLint (pinned to 9.x — see `eslint.config.mjs`) |
| `npm run test` | Vitest unit and component tests |
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
| `src/lib/mock/queries.ts` | The data-access seam that Supabase will replace |

No component hard-codes a price, a rate, or a monetary string.

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

Phase 0 is complete: repository foundation, centralized business rules with tests, accessibility fixes, and a typed relational mock layer. Entity routes resolve real records and return 404 for unknown ids.

Not yet built: authentication, the database, private storage, and every write path. Buttons for unimplemented actions are marked `aria-disabled` rather than silently doing nothing. See `docs/IMPLEMENTATION_PLAN.md`.
