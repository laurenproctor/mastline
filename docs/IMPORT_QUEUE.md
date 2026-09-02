# Resumable field imports — how it works and how to rescue it

For whoever is on the other end of "my card dump stopped". Read the first two
sections before touching anything.

## What this feature promises, and what it does not

Three different things get confused, and only two of them are true.

| | Does it keep uploading? |
| --- | --- |
| Mastline open in a tab, you navigate elsewhere in the app | **Yes.** The queue is a module-level service, not a component. Navigation does not stop it. |
| Browser closed, or the tab closed, then reopened later | **It resumes**, from the offset the server confirms. It does not upload while closed. |
| Browser closed, laptop shut | **No. Nothing uploads.** There is no service worker and no Background Fetch. |

The interface says exactly this — "Uploads continue while Mastline is open in
this browser, and pick up where they left off next time you open it" — and it
must never be reworded into a promise of background uploading. A photographer
who closes a laptop believing the queue is running will lose an evening.

## The lifecycle

```
pending → staged → uploading → uploaded → finalizing → complete
                ↘ paused ↗   ↘ retrying ↗
                             ↘ failed / canceled
```

- **pending** — selected, no durable local copy yet.
- **staged** — the bytes are in the origin private file system. This survives a
  reload; it does not mean the server has anything.
- **uploading** — chunks in flight.
- **uploaded** — storage has the object. The local copy is now redundant but is
  kept until finalization is confirmed.
- **finalizing** — the server is creating the asset.
- **complete** — an asset exists. Terminal, enforced by a database trigger.
- **paused / retrying / failed / canceled** — the ways a run is interrupted.

The transition table is `src/lib/import-queue/state.ts` and is the only thing
allowed to move an item. The database enforces the three that must hold whatever
a client believes: `complete` is terminal, the storage path is fixed at
registration, and an import file holds at most one asset ever.

## Local storage on the photographer's machine

- **Queue records** live in IndexedDB, database `mastline-import-queue`, store
  `items`, keyed by `clientFileId`. Small JSON. Never blobs.
- **File bytes** live in the origin private file system under
  `mastline-imports/<organization_id>/<batch_id>/<client_file_id>`. The path is
  built from ids only — never from the filename, which in this product names a
  subject and a location.
- **The TUS session URL** is stored on the queue record, not only in the TUS
  client's own localStorage entry, so a resume survives site data being partly
  cleared.

Writes to a record are serialised per file. They were not, once, and a progress
write silently overwrote the session URL — which meant every reload restarted
its uploads from byte zero while looking exactly like a slow upload.

## The TUS upload

- Endpoint: `https://<project>.storage.supabase.co/storage/v1/upload/resumable`,
  derived from `NEXT_PUBLIC_SUPABASE_URL`. No project id is written down.
- Chunk size: **exactly 6 MiB** (`SUPABASE_TUS_CHUNK_SIZE`). Supabase requires
  it. Do not tune it.
- The first chunk travels with the creation `POST`
  (`uploadDataDuringCreation`), so a 12.5 MiB file is one POST and two PATCHes.
- Authorization is the signed-in user's access token. **No `x-upsert`**: an
  original is written once, to a path that cannot collide.
- `retryDelays` is deliberately empty and `onShouldRetry` returns false. Retry
  policy lives in the runner, once, where it can be bounded and shown.

### The 24-hour session

Supabase expires a resumable upload URL after about a day. The queue abandons a
session at **23 hours** rather than discovering the expiry as a 404. If the
server does reject a stored URL (404/410 while resuming) that is classified
`upload_session_expired`, the URL is dropped, and a fresh session starts
immediately — it is not counted as a failure of the file, and the operator is
not asked to do anything.

## Retry classifications

| Code | Retried? | Meaning |
| --- | --- | --- |
| `offline` | yes, 5 s, and immediately when the connection returns | no connection |
| `timeout` | yes, backoff | 60 s with no progress; the session is kept |
| `server_unavailable` | yes, backoff (or `Retry-After`) | 5xx, 429, dropped connection |
| `authentication_expired` | yes, after one token refresh | 401, or a 403 mentioning the JWT |
| `upload_session_expired` | yes, immediately, new session | 404/410 on a stored upload URL |
| `authorization_denied` | **no** | RLS or role refusal |
| `quota_exceeded` | **no** | 507, or no room on the device |
| `unsupported_file` | **no** | 413/415 |
| `object_conflict` | **no** | something is already at that path; reconciled, not overwritten |
| `file_missing` | **no** | the local copy is gone; only the operator can fix it |

Backoff is full-jitter exponential: 1 s base, ×2, 60 s ceiling, with a floor of a
quarter of the ceiling. Six attempts, then the file waits for a person. A
`Retry-After` header overrides the backoff, capped at five minutes. The schedule
is persisted, so a reload does not reset a wait.

## Finalization, and recovering from a failure in it

After TUS reports success the queue does **not** trust it. It asks the server
whether the object is in the bucket at the registered size, and only then
finalizes. Finalization claims the row with a conditional update, calls
`registerImport()` — the same function the rest of the product uses — and writes
the asset id back. A repeat returns the existing asset.

An upload that succeeded but did not finalize is safe and recoverable: the bytes
are in storage and the row says `uploaded`. Retrying finalizes; it never
re-uploads. A finalization failure is classified too — the commonest is *this
frame is already on this shoot*, which is terminal and says so in words, because
retrying it re-runs the whole upload for nothing.

The staged local copy is deleted only when the server confirms all three of:
the object exists, finalization succeeded, and the asset record exists.

## Browser limitations

- **No background uploading.** See the table at the top.
- **Safari before 17** offers an OPFS handle but no `createWritable()` on the
  main thread. Staging fails; the file still uploads in that tab, and the queue
  says recovery cannot be guaranteed rather than pretending.
- **No Web Locks** (older Safari): a renewable localStorage lease is used
  instead — owner, 15 s expiry, renewed every 5 s, so a crashed tab stalls one
  file for fifteen seconds rather than forever.
- **No BroadcastChannel**: tabs stop telling each other about changes. Uploads
  are still not duplicated, because the lock is separate from the messaging.
- **No IndexedDB** (some private windows): the queue runs in memory for the life
  of the tab and reports every item as unrecoverable, which is true.
- **`navigator.storage.estimate()` may omit the quota.** An unknown quota is
  treated as *not enough*, never as enough.

## Inspecting a stuck batch

Everything below is read-only and workspace-scoped. Run as the service role.

```sql
-- What is outstanding, oldest first.
select b.id as batch, b.status, b.total_files, b.completed_files, b.failed_files,
       f.client_file_id, f.original_filename, f.status, f.attempt_count,
       f.error_code, f.error_message, f.updated_at
from public.import_files f
join public.import_batches b on b.id = f.import_batch_id
where f.organization_id = :org
  and f.status not in ('complete', 'canceled')
order by f.updated_at;
```

Read the row's `status` first:

- `pending` with no `attempt_count` — never registered, or waiting for a
  connection. Nothing is wrong.
- `retrying` with an `error_code` — working as designed. `attempt_count` says
  how long it has been going.
- `uploading` / `finalizing` and `updated_at` is old — the tab that owned it is
  gone. **This recovers itself**: the next tab to open the shoot takes the
  cross-tab lock and reclaims it. No manual action.
- `failed` with `authorization_denied`, `quota_exceeded`, `unsupported_file` —
  needs a person to change something. Retrying will not help.
- `uploaded` with no `asset_id` — the bytes are safe in storage; only the record
  is missing. Opening the shoot finalizes it without re-uploading.

## Recovering without creating duplicates

The safe operations, in order of preference:

1. **Open the shoot in Mastline.** Reconciliation runs on its own: it registers
   anything unregistered, reclaims anything stranded, verifies what is already
   in storage, and finalizes what is ready. This is idempotent and is the
   intended route.
2. **Press Retry** on a failed row, or *Retry failed* for the batch.
3. **Select the file again** where the row says *File needed*. The record, its
   storage path, and its server row are unchanged; only the bytes are re-added.

Never do these:

- Do **not** re-import the same files as a new batch to "make sure". It is safe
  in the sense that nothing is overwritten — the second attempt fails on the
  canonical object key — but it produces a batch of failed rows and confuses the
  next person.
- Do **not** `update import_files set status = 'complete'`. A trigger refuses it
  without an asset, and it would be a lie if it did not.
- Do **not** delete a completed import row to force a re-import. The asset is
  the record; the import row is how it got there.

## Cleaning up abandoned data

**Records.** `select public.prune_abandoned_imports(7);` — service role only.
Removes `failed` and `canceled` import files untouched for the retention window,
and any batch left holding nothing. It never touches a completed import or one
holding an asset. **Nothing schedules this**, exactly like
`prune_delivery_analytics`; run it by hand or add it to whatever scheduled task
this project eventually grows. Monthly is ample.

**Staged objects.** A completed import's bytes were moved to their canonical key,
so nothing is left behind. A cancelled one is removed by the browser that
cancelled it. The residue is a tab that died mid-upload, which leaves an object
under `originals/<org>/_staging/<batch>/<file>`. To find them, list that prefix
and compare against `import_files.storage_path` for rows that are `complete` or
absent. Remove nothing that belongs to a row still outstanding: that is somebody
mid-import.

## Metrics

Client events go to Vercel Analytics — the collector this application already
has — and carry only ids, a size bucket, an attempt number, a duration, a
normalised error code, whether the upload resumed, and the connection state.
Never a filename, a byte count, a URL, or a token. The event names are in
`src/lib/import-queue/telemetry.ts`.

| Question | Where | How |
| --- | --- | --- |
| Upload completion rate | analytics | `import_file_completed` ÷ `import_file_staged` |
| Median upload duration | analytics | median `durationMs` on `upload_completed`, split by `sizeBucket` |
| Reload-recovery rate | analytics | `import_recovered_after_reload` ÷ `import_batch_created` |
| Retry rate | SQL | see below |
| Failures by code | SQL | see below |
| Files uploaded more than once | SQL | see below |
| Uploaded but not finalized | SQL | see below |
| Abandoned batches | SQL | see below |

```sql
-- Retry rate and files that were sent more than once.
select count(*) filter (where attempt_count > 1)::numeric / nullif(count(*), 0) as retry_rate,
       count(*) filter (where attempt_count > 1) as retried_files
from public.import_files
where created_at > now() - interval '30 days';

-- Failures by normalised code.
select error_code, count(*)
from public.import_files
where status = 'failed' and created_at > now() - interval '30 days'
group by error_code order by count(*) desc;

-- Uploaded, never finalized. Each of these is a recoverable frame.
select organization_id, id, original_filename, updated_at
from public.import_files
where status = 'uploaded' and asset_id is null
  and updated_at < now() - interval '1 hour';

-- Abandoned batches: nothing completed, nothing touched for a day.
select b.id, b.organization_id, b.shoot_id, b.total_files, b.failed_files, b.updated_at
from public.import_batches b
where b.status in ('pending', 'uploading', 'failed')
  and b.completed_files = 0
  and b.updated_at < now() - interval '1 day';
```

## Environment

Nothing new. The queue uses what is already configured:

- `NEXT_PUBLIC_SUPABASE_URL` — the upload endpoint is derived from it.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the browser client.
- No service-role key is involved anywhere in the import path, in the browser or
  on the server. Storage policies and RLS are the authorization boundary.

## Testing locally

```bash
npx supabase start                 # local Postgres, storage, auth
npm run test                       # unit + database suites
npm run build                      # the e2e suite runs against a production build
npx next start -p 4200 &
E2E_BASE_URL=http://127.0.0.1:4200 npx playwright test e2e/import-queue.spec.ts --project=desktop
```

Pin `E2E_BASE_URL`. Without it Playwright will reuse whatever is already on port
4100, which on a machine with more than one checkout is a different branch's
build.

The browser suite injects faults by intercepting the storage requests
(`page.route`), so it needs no broken server and never touches a hosted project.
The unit suite replaces the browser APIs and the TUS client with doubles in
`src/lib/import-queue/testing.ts`; those doubles are part of the adapter
contract, not scaffolding.
