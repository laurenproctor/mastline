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
| news_signals | The canonical News Radar story: source facts owned once per workspace, deduplicated per organization on the source URL |
| opportunities | One evaluation path of a news signal — archive_match (may reactivate owned work) or shoot_opportunity (may justify a new shoot) — with its own labelled suggestion, window, and independent lifecycle |
| buyer_requests | One piece of inbound demand: who asked, what for, by when, on what terms, and what became of it |
| request_sensitive_notes | Source protection for a request. Owner and editor only, mirroring shoot_sensitive_notes |
| shoots | Brief, place/time, assignment, confidentiality, workflow state |
| assets | Canonical image/clip commercial record |
| asset_versions | Original and derived file objects, hashes, dimensions, metadata |
| packages | Selected asset versions and a buyer/delivery profile |
| submissions | Immutable-from-creation record of what was approved, and what became of it |
| submission_assets | **The authoritative approved-delivery record.** One row per approved frame: the exact version and storage object, and the editorial facts at approval. Append-only; written only by the approval transaction and once by the backfill |
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
| Opportunity | new, watching, pitching, acted, dismissed, expired — acted, dismissed, and expired are terminal; a dismissed or expired path is never treated as new again, and the other path of the same story is unaffected |
| Opportunity kind | archive_match, shoot_opportunity — two evaluation paths of one canonical news signal, unique per (signal, kind); the story itself exists once |
| Buyer request | draft, new, needs_clarification, qualified, matching, coverage_planned, preparing_response, submitted, negotiating, won, lost, expired, declined, cancelled |
| Shoot | draft, scheduled, active, ingesting, preparing, ready, dispatched, completed, archived, cancelled |
| Asset | ingesting, active, restricted, archived, tombstoned |
| Package | draft, needs_review, ready, approved, sending, delivered, failed, recalled |
| Submission | queued, sent, delivered, failed, acknowledged, sold, no_sale, recalled |
| License | proposed, active, expired, cancelled, disputed |
| Payment | expected, invoiced, reported, partial, received, overdue, disputed, written_off |
| Rights match | new, reviewing, licensed, ignored, monitoring, escalated, resolved |

## Buyer requests

A photographer's inbound demand, recorded by hand. A picture desk rings, texts,
or sends three lines of WhatsApp; without this the request exists in a phone and
nowhere else, so it is not on the work queue, cannot be assigned, and leaves no
trace when it is missed.

- `buyer_requests`. Unique on `(organization_id, idempotency_key)`, so a
  resubmitted capture lands on the request it already made rather than a
  duplicate. `reference` — `REQ-0828-4417` — is unique per workspace and is
  drawn and redrawn by the data layer until the database says one is free, the
  same way a dispatch reference is.
- Cross-workspace references are refused structurally rather than by policy.
  `(buyer_id, organization_id)` is a composite foreign key onto
  `buyers (id, organization_id)`, and `(organization_id, assigned_to)` is one
  onto the `memberships` primary key — so a request cannot point at another
  studio's buyer, or be assigned to somebody who is not in the room.
- `request_sensitive_notes` holds anything narrower than workspace-wide: a tip,
  an address, whoever passed it on. Owner and editor only. A boolean on the
  request would not have been a permission — the row still comes back over the
  Data API to anyone who can read the request.
- Roles: every active member reads. Owner, editor and dispatcher write. The
  dispatcher is included because they are the person a desk actually rings, and
  a role that can field the call but not write down what was said pushes the
  record back into the phone. `src/lib/permissions.ts` spends `request.read` and
  `request.write`, and `tests/permissions-match-policies.test.ts` probes the
  latter against the live policy.
- No delete grant for `authenticated`, and the default one is explicitly
  revoked. A request that came to nothing is recorded as declined or cancelled
  with a reason; making it disappear is how a workspace forgets that a desk
  asked three times and got no answer.

### What "not provided" means

Most commercial columns are nullable and stay null. A desk that said nothing
about territory has not asked for worldwide; one that mentioned no money has not
offered zero. Budget is the sharp case, so it carries `budget_disclosed`
alongside `budget_min_minor`/`budget_max_minor` and two check constraints:
figures cannot exist without a disclosure, and a disclosure cannot be claimed
without at least one figure. A **disclosed zero** — "we have no money for this,
send it anyway" — is a real thing a desk says, and it is a different row from a
budget nobody mentioned.

### The lifecycle

The transition table is `src/lib/requests.ts`. The database enforces the half
that must hold whatever a client believes: identity is fixed at creation, a
closed request cannot move at all, and `lost`/`declined` cannot be recorded
without a reason. `qualified_at` and `closed_at` are stamped by trigger and are
write-once.

Two states need explaining, and both are in `docs/DECISIONS.md`:

- **`won` is in the enum and unreachable.** Winning means connecting the request
  to a license, and that connection is Phase 2. Offering it now would let
  somebody record a win that points at no money.
- **Nothing expires by itself.** There is no scheduler, so a passing deadline is
  rendered as a derived "Past deadline" at read time and never written back.
  `expired` is a transition somebody performs.
## News Radar: one signal, two paths

`one news signal → archive opportunity path + shoot opportunity path`

- `news_signals` owns the source facts (title, source name/URL, publication
  time, summary) exactly once per story, per workspace. Typed by an operator
  today; written by an ingestion pass later. Lifecycle decisions never edit
  them, and there is no second copy to drift: the legacy source columns on
  `opportunities` were dropped, not deprecated, because the table had never
  been written by application code and a column that still accepts writes is
  how two copies diverge.
- `opportunities` is one evaluation path per kind — `archive_match` or
  `shoot_opportunity` — unique per (signal, kind), referencing the signal
  through a composite foreign key on (news_signal_id, organization_id), so a
  path in one workspace can never reference a signal in another whatever the
  application does.
- One manual entry creates the signal and BOTH paths atomically, through the
  SECURITY INVOKER function `create_news_story` (empty search path, execute
  revoked from PUBLIC and anon, granted to authenticated only). Authorship is
  `auth.uid()` inside the database; the insert policy pins `created_by` to the
  caller and the update grant is column-scoped to the source facts, so
  authorship can be neither forged nor rewritten. `created_by` is nullable
  (machine and historical rows) and `ON DELETE SET NULL`: history outlives its
  author.
- Repeating an organization/source-URL is answered with the existing records
  ("duplicate"), not a second signal or pair of paths. Different workspaces
  may hold the same URL.
- Each path carries labelled inference — `signal`, `confidence`,
  `suggestion_basis` (jsonb with a human-readable `summary`; a check refuses a
  confidence with an empty basis) — and an independent lifecycle: `status`,
  `dismissal_reason` (dismissed rows only, enforced), `acted_at` (acted rows
  only, enforced). Dismissing one path does not touch the other.
- Deliberately absent: a news-provider model, provider identifiers, and any
  matched-asset storage. Archive matching will add a relational
  opportunity-assets table; asset ids never go into `suggestion_basis`.
- Live ingestion, archive matching, and the story-to-shoot handoff are not
  built. Nothing on the radar contacts anyone or creates anything by itself.

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

`prune_abandoned_imports(retain_days)` clears failed and cancelled import records, service role only, and never touches a completed import. Nothing schedules it — see `docs/IMPORT_QUEUE.md`, which is the operator runbook for a stuck or interrupted card dump.

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

## The approved-frame record

`submission_assets` is what a recipient link renders and downloads. Nothing on
the recipient surface reads a live asset, the current package membership, or
whichever derivative is preferred today.

- One row per approved frame, unique on `(submission_id, position)` and
  `(submission_id, asset_id)`.
- Four composite foreign keys keep every row inside one workspace:
  `(organization_id, submission_id)` → submissions,
  `(organization_id, asset_id)` → assets, and
  `(organization_id, asset_id, asset_version_id)` and
  `(organization_id, asset_id, preview_asset_version_id)` → asset_versions, so
  a version of another asset or another organization is refused by Postgres
  whatever the application does.
- `version_kind_snapshot`, `storage_bucket_snapshot`, `object_key_snapshot`,
  `sha256_snapshot`, `mime_type_snapshot`, `bytes_snapshot`, `width_snapshot`,
  and `height_snapshot` name the exact approved object. A `before insert`
  trigger checks every one of them against the version row, so a snapshot
  cannot name a valid version and a different file.
- `preview_asset_version_id`, `preview_storage_bucket_snapshot`,
  `preview_object_key_snapshot`, `preview_sha256_snapshot`, and
  `preview_mime_type_snapshot` name the preview derivative the reviewer was
  shown at approval -- the earliest `preview` version of the asset, which is
  what the review screen renders. All five are set or all five are null; the
  trigger checks them against the version row and requires the kind to be
  `preview`. Null means no preview existed at approval, and the recipient
  preview is then rendered from the approved object itself or not at all.
- `filename_snapshot`, `headline_snapshot`, `caption_snapshot`,
  `people_snapshot` (from `assets.subjects`, the operator-entered "People"),
  `credit_line_snapshot`, `copyright_notice_snapshot`,
  `copyright_owner_snapshot`, `captured_at_snapshot`, `location_snapshot`,
  and `usage_restrictions_snapshot` are the editorial facts at approval.
  Location and usage restrictions are frozen for the internal record; the
  recipient page does not show them.
- `snapshot_origin` is `approval` for rows the approval transaction wrote and
  `legacy_backfill` for rows migration `20260830130000` reconstructed. See
  the legacy note below. `created_at` is the snapshot timestamp: the approval
  instant for `approval` rows, the migration run for `legacy_backfill` rows.
- Immutable: the same append-only trigger the caption history and the activity
  log use refuses updates and deletes except under the purge flag.
- RLS enabled and forced. Members read their workspace's rows through
  `submission_assets_select`; there is no insert, update, or delete policy and
  `authenticated` holds only `select`. `service_role` holds `select, insert,
  delete` for trusted server code and fixtures; the triggers still apply to it.
  `anon` holds nothing. A recipient reaches these rows only through the
  delivery functions.

### Approval is one transaction

`public.approve_package(target_package, recipient_label, follow_up_at)` is
`security definer` with an empty search path, executable by `authenticated`
only, and decides inside itself what the policies would have decided: the
caller must be a member of the package's workspace (otherwise "could not be
found", the same answer a stranger gets) and hold `owner` or `dispatcher`. It
then, in one transaction: locks the package `for update`; locks and reads the
membership once; verifies every version belongs to its asset in this
workspace and no frame is restricted or tombstoned; marks the package
`approved`; inserts the submission with `delivery_manifest` built from that
same read; inserts one `submission_assets` row per frame from that same read;
and writes the `package.approved` event. Any failure unwinds all of it. The
`package_assets` trigger takes a share lock on the parent package, so a
membership change cannot slip in behind an approval in flight.

`delivery_manifest` remains as a summary and compatibility record for the
existing readers and the export. Two service-role checks keep it honest:
`public.submission_snapshot_drift_admin()` lists any submission with a
snapshot row its manifest does not account for (must always be empty), and
`public.submission_snapshot_gaps_admin()` lists every manifest entry with no
snapshot row, one row per missing frame.

### Legacy submissions

Submissions approved before the record existed were backfilled by the
migration, one manifest entry at a time, from the version ids frozen in their
manifests, using each version's real bucket, key, digest, and size, and the
editorial metadata **as it stood at migration time**. That metadata is not
provably what a recipient saw at the original approval, which is why those
rows carry `snapshot_origin = 'legacy_backfill'` and the submission screen
says so. No preview identity is invented for them; their recipient preview is
rendered from the approved object or not at all.

A manifest entry that did not resolve to a version of its own asset in its own
workspace fails closed for that entry alone: no row is written for it, no
substitute is chosen, the submission keeps its record and its other frames,
and `submission_snapshot_gaps_admin()` lists the entry. A recipient link on
such a submission shows the frames that froze and cannot show, preview, or
download the one that did not; the submission screen names it as "Not
deliverable". `public.backfill_submission_assets_admin()` (service role) runs
the same backfill again for any submission that still has no rows, and is
idempotent.
