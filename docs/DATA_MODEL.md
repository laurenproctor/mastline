# Data model and security contract

## Commercial graph

The asset is the canonical center, but it is not isolated:

- An opportunity may create one or more shoots.
- A shoot produces assets and costs.
- A dispatch package selects asset versions for one buyer profile.
- Approval creates a submission that preserves exactly what was sent.
- A submission may yield a license and expected revenue.
- A payment may cover several licenses/submissions; reconciliation allocates the amount.
- A rights match compares observed use with asset, submission, and license history.
- A later opportunity can reactivate archive assets.

## Core entities

| Entity | Purpose |
| --- | --- |
| organizations | Tenant/workspace and commercial owner context |
| memberships | Person-to-organization role and status |
| profiles | The readable face of an account: name, address, avatar key. Visible to people who share a workspace |
| buyers | Agencies, publishers, picture desks, and direct licensees |
| opportunities | News/tip/demand signals and suggested archive value |
| shoots | Brief, place/time, assignment, confidentiality, workflow state |
| assets | Canonical image/clip commercial record |
| asset_versions | Original and derived file objects, hashes, dimensions, metadata |
| packages | Selected asset versions and a buyer/delivery profile |
| submissions | Immutable-from-creation record of what was approved, and what became of it |
| submission_deliveries | One recipient-specific link: token, protected recipient fields, attribution snapshot, share and withdrawal |
| delivery_access_events | Append-only evidence: opened, accepted, downloaded, refused |
| delivery_acceptances | A recipient agreeing to the terms as they were shown |
| delivery_view_sessions | One viewing session on a link. Optional analytics, pseudonymous, prunable |
| delivery_asset_views | One photograph within one session: time visible and view count |
| delivery_engagement_totals | Durable per-link rollup that survives retention pruning |
| delivery_asset_engagement_totals | Durable per-photograph rollup |
| licenses | Rights/territory/media/term/fee context |
| payments | Expected/reported/received money record |
| payment_allocations | Many-to-many allocation of payments to licenses/submissions/assets |
| rights_matches | Observed uses, evidence, confidence, license check, triage |
| expenses | Shoot/asset-level operating costs |
| activity_events | Append-only audit and operational event stream |

## Status vocabulary

Statuses should be database enums or checked text, changed only by an explicit migration.

| Record | Values |
| --- | --- |
| Shoot | draft, scheduled, active, ingesting, preparing, ready, dispatched, completed, archived, cancelled |
| Asset | ingesting, active, restricted, archived, tombstoned |
| Package | draft, needs_review, ready, approved, sending, delivered, failed, recalled |
| Submission | queued, sent, delivered, failed, acknowledged, sold, no_sale, recalled |
| License | proposed, active, expired, cancelled, disputed |
| Payment | expected, invoiced, reported, partial, received, overdue, disputed, written_off |
| Rights match | new, reviewing, licensed, ignored, monitoring, escalated, resolved |

## Money

- Store integer minor units (`bigint`) and 3-character currency.
- Keep gross, deductions/commission, tax, Sales Engine share, photographer share, team splits, expenses, and net separately.
- Do not calculate the Sales Engine share from displayed net revenue. Calculate the 30% share only for a license generated inside Mastline, from the contractually defined sale base, and preserve all inputs.
- Payments are append/reconcile records; do not overwrite statement imports to make them agree.

## Tenancy and authorization

Every business table contains `organization_id`. Every query is organization-scoped. RLS is enabled on every exposed table, and explicit Data API grants are paired with RLS policies.

Initial roles:

- owner: all workspace control
- editor: shoot, asset, caption, package, and dispatch preparation
- dispatcher: package/submission delivery and status
- finance: revenue, payments, statements, exports
- rights_reviewer: evidence, license checks, and case routing
- viewer: read-only non-sensitive access

Do not authorize from user-editable metadata. Role truth lives in memberships (or secure app metadata refreshed from it). Sensitive source notes should move to a narrower table/policy before real data is used.

## Storage

Use private buckets:

- `originals`: immutable source files
- `derivatives`: previews and delivery files
- `evidence`: rights screenshots and evidence packages

The first path segment is `organization_id`; storage RLS must verify an active membership. Uploads are staged, hashed, and promoted after record creation. Do not use public URLs for originals or evidence. Use short-lived signed URLs from trusted server code.

## Resumable imports

A card dump is the one place in the product where losing a file is silent, so the server keeps a record of what was *meant* to arrive, not only what did.

- `import_batches`: one photographer's selection for one shoot. Unique on `(organization_id, idempotency_key)`, so re-registering the same selection lands on the batch it already made. `total_files`, `completed_files`, and `failed_files` are maintained by trigger from the files; they are never written by hand.
- `import_files`: one file in a batch. Unique on `(import_batch_id, client_file_id)`. The storage path is deterministic and immutable — `<organization_id>/_staging/<batch id>/<client_file_id>` — so a retry addresses the object it already uploaded. `asset_id` is written once by finalization and a partial unique index keeps an asset to one import file, forever.

The lifecycle is `pending → staged → uploading → uploaded → finalizing → complete`, plus `paused`, `retrying`, `failed`, and `canceled`. `staged` means the bytes are held locally in the origin private file system, not that they have reached the server.

The database enforces only what must hold whatever a client believes: `complete` is terminal, the storage path is fixed at registration, and an import file has at most one asset. The full transition table is `src/lib/import-queue/state.ts`.

These rows record lifecycle transitions, never per-byte progress. Fine-grained progress is local to the browser doing the uploading; a row written per chunk would be write amplification wearing a progress bar.

Finalization goes through `registerImport()`, so a file that arrives through the queue produces exactly the records the dropzone has always produced. A local staged copy may only be deleted once the server confirms three things about the same file: the object is in the bucket, finalization succeeded, and the asset record exists.

## Current Supabase constraints to respect

- New projects may not expose public tables to the Data API automatically. Use explicit grants and RLS together.
- Node.js 20 is no longer supported by current Supabase client libraries; this package requires Node.js 22+.
- Run Security and Performance Advisors after applying schema/storage changes.

Relevant official references: `https://supabase.com/docs/guides/database/postgres/row-level-security`, `https://supabase.com/docs/guides/api/securing-your-api`, and `https://supabase.com/docs/guides/storage/security/access-control`.


## The delivery lifecycle, and what each state actually means

Seven facts, each written by the thing that evidences it. They are separate
rows and separate timestamps on purpose: collapsing any two of them makes
Mastline assert something it cannot support. See `docs/DELIVERY_LINKS.md`.

| State | Package | Submission | Written by |
| --- | --- | --- | --- |
| Approved | `approved` | `queued`, `sent_at` null | An operator confirming approval |
| Link created | `approved` | `queued` | Creating a recipient link. Nothing moves |
| Shared | `sending` | `sent`, `sent_at` set | **Mark as shared** — a deliberate act |
| Opened | `delivered` | `delivered`, `delivered_at` set | The first valid open of a live link |
| Accepted | `delivered` | `acknowledged` | The visitor typing their own name |

`sent_at` and `delivered_at` are write-once. A second open, a repeated outcome,
or a provider re-reporting a delivery cannot move either.

### How legacy rows read

Nothing is backfilled and no history is invented.

* A delivery link created before this schema has `shared_at` null. That reads,
  correctly, as *created but never recorded as shared* — not as unshared. The
  interface offers **Mark as shared** on any live link that has no share
  timestamp, so an operator can record the truth if they know it.
* `custom_parameters` defaults to `{}` and `contact_reference` to null on
  existing rows: no attribution was captured, so none is claimed.
* Submissions approved under the old flow already carry `sent_at` and often
  `delivered_at` from the moment of approval. Those timestamps are left exactly
  as they are — rewriting them would be fabricating a history nobody recorded —
  and the write-once rule means nothing will move them now.
* No viewing sessions exist for any link created before the analytics tables, so
  every one of them reports **"the link was opened, but detailed viewing time
  was unavailable"** rather than zero engagement. That is the honest reading: no
  measurement was taken, which is not the same as nobody looking.
