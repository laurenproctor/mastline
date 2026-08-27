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
| `src/lib/statement-import.ts` | CSV reading and statement matching |
| `src/lib/export.ts` | Workspace export |
| `src/lib/webhook.ts` | Signature verification and payload parsing |
| `src/lib/subscription.ts` | Trial state, storage limits, and what a workspace is told |
| `src/lib/onboarding.ts` | Onboarding vocabularies, flow version, and Sales Engine terms version |
| `src/lib/billing.ts` | Subscription lifecycle, grace window, plan-change rules |
| `src/lib/billing/provider.ts` | The provider contract; Stripe sits behind it |
| `src/lib/data/archive.ts` | Archive search, paged, executed in the database |
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
| `/work/commercial` | Commercial opportunity review queue |
| `/work/commercial/julian-cross-soho` | Product matching, brand-pitch, and Shop-the-Look prototype |
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

**Phase 3** — operational hardening. Failed deliveries are logged, explained,
and retryable. Inbound delivery webhooks are signature-verified and idempotent.
Agency statements import from CSV and reconcile line by line. The whole
workspace exports as CSV. Bulk metadata, buyer delivery templates.

### Webhooks

`POST /api/webhooks/delivery/<provider>` with an `x-mastline-signature` header
carrying the HMAC-SHA256 of the raw body. Configure `WEBHOOK_SECRET_DEFAULT` or
a per-provider `WEBHOOK_SECRET_<PROVIDER>`; with neither set the endpoint
refuses every request rather than accepting unverified writes.

Each event is claimed by its provider event id before anything is processed, so
a provider retry answers `duplicate` and changes nothing. This is the only
route under `/api` that does not require a session, and it is not
unauthenticated — the signature is the credential.

### Statement import

Drop an agency CSV on the money screen. Common column names are recognised, the
original row is stored exactly as it arrived, and each line is matched against
your submissions with a stated basis. Nothing becomes money until a person
confirms the line. Re-importing the same file is reported as a duplicate rather
than doubling the revenue.

### Export

`GET /api/export` returns every asset record with its file hashes and object
keys, caption history, shoots, submissions, licences, payments, allocations,
and the full activity record as CSV. Money appears twice: integer minor units
as the authoritative figure, and a decimal for spreadsheets. Confidential source
notes are deliberately excluded. Owner and finance roles only.

**Onboarding** — sign-up, workspace creation, member invites, password reset,
and the trial with its storage cap and read-only expiry, enforced by the
database rather than only the interface.

### Getting in

| Route | Who |
| --- | --- |
| `/sign-up` | A new photographer creates an account |
| `/onboarding` | Signed in with no workspace yet: name your studio |
| `/reset-password` | Request a link; `/reset-password/update` sets the new password |
| `/sign-in` | Everyone else |

A new account lands on a 30-day Pro trial with 25 GB of storage and no card.
When the trial ends the workspace becomes **read-only**: everything stays
readable and the export keeps working; importing, dispatching, and recording
stop. That is enforced by a trigger on every table that represents doing work,
so a Server Action nobody remembered to guard cannot write into a lapsed
workspace. `past_due` still writes — a card that failed on Tuesday should not
stop a photographer working a story on Wednesday.

**Conversion** — a trialing workspace can start paying. Stripe sits behind a
provider interface, so the lifecycle rules are testable without it and the
provider is swappable.

### How billing behaves

- Attaching a card during a trial lifts the storage cap immediately but does
  **not** end the trial or bring the charge forward. The first charge lands when
  the 30 days do.
- A failed renewal keeps the workspace working for **14 days**, then read-only.
  Writability is derived from the recorded date, so nothing has to run nightly
  and nothing can fall behind.
- A downgrade applies at the end of the period already paid for, and warns first
  if it would strand stored work or people.
- Plan, status, and provider identifiers can only be written by
  `apply_billing_state`, which is service-role only. A workspace owner cannot
  grant themselves a plan; the database refuses it.
- `POST /api/webhooks/billing` verifies a Stripe signature with a timestamp
  tolerance, then claims the event id before acting, so a provider retry cannot
  apply a payment twice.

Without `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` the endpoints refuse
every request and the interface says billing is unavailable rather than offering
a checkout that cannot work.

### Resilience and cost

- Every route has an error boundary and a loading skeleton. A failed query
  shows what happened, promises the records are unaffected, and offers a retry —
  rather than Next's default error page.
- A malformed record id is a **404, not an error**. Someone editing a URL is not
  a system failure.
- The work queue issues a **fixed number of queries** whatever the size of the
  workspace. It used to be roughly `3 + 4N` with N shoots, on the page an
  operator opens every morning. `tests/work-queue-performance.test.ts` counts
  the round trips and fails if that regresses.
- Archive search runs **in the database**, against a generated `tsvector`
  column, paged, with signed preview URLs minted only for the page being
  viewed. It used to fetch every asset and filter in JavaScript.

Only News Radar still reads the mock layer, because there is no opportunity
source to read from yet; the first release uses manually entered stories. That
goes away in Phase 4.

Not yet built: outbound delivery to a buyer's systems (Mastline records a
dispatch, it does not transmit), and rights triage actions. See
`docs/IMPLEMENTATION_PLAN.md`.
