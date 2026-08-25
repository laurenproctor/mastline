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
| submissions | Immutable factual record of outbound delivery |
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

## Current Supabase constraints to respect

- New projects may not expose public tables to the Data API automatically. Use explicit grants and RLS together.
- Node.js 20 is no longer supported by current Supabase client libraries; this package requires Node.js 22+.
- Run Security and Performance Advisors after applying schema/storage changes.

Relevant official references: `https://supabase.com/docs/guides/database/postgres/row-level-security`, `https://supabase.com/docs/guides/api/securing-your-api`, and `https://supabase.com/docs/guides/storage/security/access-control`.
