# Implementation plan

## Phase 0 — Establish the repository

1. Install dependencies with Node.js 22+ and commit the generated lockfile.
2. Add linting, formatting, unit tests, and browser smoke tests.
3. Verify every included route renders at desktop and mobile widths.
4. Confirm the light editorial direction and selected wordmark with the founder.
5. Record exact dependency versions and the initial architecture decision record.

Gate: clean typecheck/build and navigable mock application.

## Phase 1 — Tenancy, auth, and private storage

1. Create a Supabase project and initialize the CLI in the repository.
2. Use `supabase migration new initial_commercial_graph`; do not invent migration timestamps.
3. Adapt `supabase/schema/initial.sql` into the generated migration.
4. Apply locally, seed two organizations, and prove cross-organization isolation.
5. Add Supabase Auth SSR, protected app routes, workspace selection, and roles.
6. Create private originals/derivatives/evidence buckets and RLS policies.
7. Run Supabase Security and Performance Advisors.

Gate: a user can access only their active workspaces and private test files; isolation tests pass.

## Phase 2 — First complete loop

Build vertically, replacing mocks only for the active slice:

1. Create Shoot (brief-first)
2. Asset upload/import, hash, and immutable original record
3. Selects and metadata completion
4. Package creation and validation
5. Human approval and Submission Record
6. Record outcome, license, expected revenue, and payment
7. Connected history on Work, Shoot, Submission, Asset, and Money

Gate: one live operator completes one real shoot through recorded payment materially faster than their current method.

## Phase 3 — Operational hardening

- Failed delivery retry and idempotency
- Bulk metadata, keyboard actions, and mobile review
- Buyer/delivery templates
- Statement CSV import and reconciliation
- Exports, backups, retention, observability, and support diagnostics
- Permission test matrix for owner/editor/dispatcher/finance/rights/viewer

Gate: repeated live shoots complete without support intervention or data repair.

## Phase 4 — Revenue intelligence

- Manual story entry before live news feeds
- Archive match suggestions with evidence/confidence
- Buyer-fit and package builder
- Rights evidence capture and license-check triage
- Net profit, splits, expenses, and revenue analytics

Gate: the intelligence layer creates measurable incremental revenue or time savings without reducing trust.

## Phase 5 — Direct sales and scale

Only after merchant-of-record, tax, refunds, payout timing, chargebacks, and 70/30 fee-base questions are settled:

- Direct buyer checkout/licensing
- Photographer payout ledger
- Platform fee and refund accounting
- Agency-wide reporting, workload, approvals, and governance

## Work not authorized by this plan

- Autonomous legal demands or takedowns
- Unreviewed buyer outreach
- Broad surveillance/scraping without documented legal and operational review
- Facial identification as an unquestioned fact
- Public access to originals, confidential notes, or evidence
- Production deployment or external service creation without the user’s authorization
