# Mastline Product Constitution for Claude Code

Read this file before editing the repository. Also read all files in `docs/` that apply to the current phase.

## Mission

Build the business operating system for paparazzi and independent celebrity/news photographers.

Core promise: **From assignment to payment, keep every shoot, image, submission, and dollar in one place.**

Longer purpose: turn a stream of urgent moments into a durable commercial asset and give independent visual journalists more ownership over the economics of their work.

## Product thesis

Every image needs a commercial memory:

1. Where did it come from?
2. Where did it go?
3. What did it earn?
4. How may it be used?
5. When is it valuable again?

The connected lifecycle is:

`Opportunity → Shoot → Asset → Submission → License or usage → Payment → Archive match or recovery`

Screens are views into this shared record. Do not create separate data islands per screen.

## Launch user

Independent professionals and teams of 2–10 people producing meaningful volume through informal combinations of texts, memory cards, editing software, agency portals, email, and spreadsheets.

## Non-negotiable product principles

- **Speed under pressure.** Common actions need keyboard and bulk paths. Mobile review matters.
- **One fact entered once.** Inherit shoot facts into assets, packages, and submissions; allow explicit overrides with history.
- **Originals are immutable.** Preserve original bytes, checksums, capture metadata, import history, edits, and derivatives.
- **Commercial memory is canonical.** A sale must connect back to a submission, asset, shoot, and counterparty when known.
- **Revenue is visible.** Expected, reported, received, overdue, deducted, split, and net are distinct states.
- **Automation is accountable.** Follow `suggest → explain → confirm`. Show basis, confidence, evidence, and the human decision point.
- **Consequential actions require review.** Never auto-send a dispatch, invoice, legal escalation, takedown request, or buyer communication.
- **Jurisdiction humility.** Store facts and route review. Never present a universal legal conclusion about copyright, privacy, publicity, or licensing.
- **Source protection.** Confidential tips, locations, and identities need narrow visibility and audit history.
- **Exportability.** The photographer must be able to export their assets, metadata, financial records, and history.

## Scope order

Build one complete loop before broadening the surface:

1. Create shoot
2. Import assets and preserve originals
3. Select and caption
4. Validate and approve dispatch
5. Record submission and outcome
6. Connect a sale/payment

Do not connect live news ingestion, automated rights enforcement, or a photo marketplace until this loop works with a live operator.

The UI routes for later layers are included so the system can be evaluated holistically; they are not permission to build all integrations at once.

## Architecture

- Next.js App Router, TypeScript, React Server Components by default
- Node.js 22+
- Supabase Postgres, Auth, and private Storage
- Organization-scoped tenancy from day one
- Server Actions for trusted application mutations; Route Handlers for webhooks and external integrations
- No service/secret key in client code
- Private buckets for originals, derivatives, and rights evidence
- Append-only activity events for consequential record changes
- Money stored as integer minor units plus ISO currency
- UTC timestamps in the database; render in the workspace timezone

The starter is intentionally mock-first. Replace mock modules screen by screen only after the schema, auth, RLS, and storage contract exist.

## Working protocol

For every task:

1. State the phase and acceptance criteria being addressed.
2. Inspect existing code and related docs before editing.
3. Make the smallest coherent change.
4. Preserve existing design language unless a design change is explicitly requested.
5. Add or update tests for business rules.
6. Run typecheck, targeted tests, and build when dependencies allow.
7. Report changed files, evidence of verification, and unresolved decisions.

Ask before:

- Changing the canonical entities or status vocabularies
- Adding a third-party dependency or managed service
- Sending external messages or creating production resources
- Changing finalized plan prices, limits, or billing presentation
- Automating a consequential action
- Changing the 70/30 direct-sale economics

## UI language

- Dense, calm, editorial, operational
- Warm off-white surfaces, black ink, electric blue action signal, restrained acid/amber/red states
- Serif display headlines; highly legible sans-serif interface copy
- Tables for commercial facts; panels for decisions; color never carries meaning alone
- Prefer direct verbs: Import, Continue, Review, Reconcile, Approve, Send, Record
- Avoid generic dashboard ornament and vanity charts

Use the selected wordmark in `public/mastline-wordmark.png`. The former Pressmark screenshots in `docs/reference-screens/` are visual references; the product name is Mastline.

## Business model facts

Final subscription pricing:

| Plan | Annual billing | Monthly billing | Included scale |
| --- | --- | --- | --- |
| Solo | $49/month, charged as $588/year | $59/month | 1 photographer; 250 GB |
| Pro | $99/month, charged as $1,188/year | $119/month | Archive intelligence; 1 TB |
| Studio | $279/month, charged as $3,348/year | $339/month | Up to 5 people; 5 TB shared |
| Agency | Custom | Custom | Custom team, migration, API, permissions, support, storage |

- Pro is the most popular plan.
- Paid plans include the optional Mastline Sales Engine.
- Sales Engine licenses pay 70% to the photographer and 30% to Mastline. The share applies only to licenses generated inside Mastline.
- “Start free” is approved pricing-page language, but the trial duration and conversion mechanics remain unresolved. Do not invent them.
- The annual prices save approximately 16.8%–17.7% versus paying monthly for twelve months. Use “Save up to 18%” unless the underlying prices change.
- Possible later fees remain storage overages, a rights-recovery service, and separately packaged premium automation only if clearly disclosed.

## Definition of done for the first vertical slice

A seeded user can create a shoot, attach private test assets, select assets, complete required metadata, approve a dispatch, record the submission, record a sale/payment, and see the connected history on the shoot, submission, asset, and money screens. Another organization cannot read or mutate any of those records.
