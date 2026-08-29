-- The server learns what was meant to arrive, not only what did.
--
-- Until now an import existed in one place: React state in the browser tab the
-- photographer had open. The bytes went to a random staging key, the asset was
-- created on the way back, and nothing anywhere recorded that a file had been
-- selected at all. Close the tab, drive through a tunnel, or let a phone sleep
-- mid-card-dump and the queue is gone -- and because nothing recorded the
-- intent, nobody can tell the difference between forty files imported and
-- forty-one selected. The one place in this product where losing a file is
-- silent is the one place a record of intent was missing.
--
-- These two tables are that record. An import batch is a photographer saying
-- "these files belong to this shoot"; an import file is one of them, with a
-- storage location chosen once and never again.
--
-- Naming: the product calls it a workspace, the schema has always called it
-- organization_id, and this follows the schema. workspace_id would be a second
-- name for the column every policy in this database already keys on.
--
-- What this deliberately does NOT record
--
-- Per-byte progress. A row written on every chunk of a 60 MB RAW file is a
-- write amplification problem wearing a progress bar, and it buys nothing: the
-- only consumer of "37% of file nine" is the screen of the person watching it,
-- which is local. What lands here is lifecycle -- registered, uploaded,
-- finalized, failed -- the transitions somebody else would need to reconcile.
--
-- The state model
--
--   pending -> staged -> uploading -> uploaded -> finalizing -> complete
--
-- plus paused, retrying, failed, and canceled, which can be entered from most
-- of the run. The full transition table lives in src/lib/import-queue/state.ts
-- and is enforced there, because the queue is the thing that moves items and a
-- transition refused halfway through a card dump has to be a typed error rather
-- than a round trip. What the database enforces is the half that must hold
-- regardless of which client is talking to it and what it believes:
--
--   * complete is terminal
--   * the storage path is fixed at registration
--   * an import file has at most one asset, forever
--
-- Idempotency
--
-- Both registrations are idempotent by unique constraint rather than by a
-- read-then-write the application performs, because the case that matters is
-- two tabs, or a retry racing its own timeout, and a check followed by an
-- insert loses that race by construction.
--
--   * a batch is unique on (organization_id, idempotency_key)
--   * a file is unique on (import_batch_id, client_file_id)
--   * an asset belongs to at most one import file: unique on asset_id
--
-- ROLLBACK
--
--   begin;
--     drop table if exists public.import_files;
--     drop table if exists public.import_batches;
--     drop function if exists private.import_files_refresh_batch();
--     drop function if exists private.refresh_import_batch(uuid);
--     drop function if exists private.protect_import_file();
--     drop type if exists public.import_file_status;
--     drop type if exists public.import_batch_status;
--   commit;
--
--   Nothing else references these tables, and no asset, version, or activity
--   event depends on them: an import that has completed has already written its
--   asset, and the asset is the durable record. What is lost by rolling back is
--   the queue of imports that had not finished -- which is exactly what the
--   product had before this migration. Staged objects under <org>/_staging/
--   would be left with nothing pointing at them; list that prefix and remove it
--   before rolling back if the storage bill matters.

-- ---------------------------------------------------------------------------
-- Status vocabularies
--
-- These mirror src/lib/domain.ts one for one, like every other enum here.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'import_batch_status') then
    create type public.import_batch_status as enum (
      'pending','uploading','paused','complete','failed','canceled'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'import_file_status') then
    create type public.import_file_status as enum (
      'pending','staged','uploading','uploaded','finalizing','complete',
      'paused','retrying','failed','canceled'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The batch
-- ---------------------------------------------------------------------------

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- A batch is always for a shoot. Files chosen on the creation page, before a
  -- shoot exists, are staged rather than queued -- that path has no shoot to be
  -- resumable against, and inventing one would create a draft shoot every time
  -- somebody opened a file picker and changed their mind.
  shoot_id uuid not null references public.shoots(id) on delete cascade,
  created_by uuid not null references auth.users(id),

  -- Chosen by the client and stable across retries: a reload that re-registers
  -- the same batch must land on the batch it already made, not a second one.
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 128),

  status public.import_batch_status not null default 'pending',

  -- Derived from the files by trigger, never written by hand. A counter the
  -- application maintains is a counter that drifts the first time a request
  -- fails between the row and the count -- the same reasoning that removed
  -- assets.lifetime_earnings_minor in the initial migration.
  total_files integer not null default 0 check (total_files >= 0),
  completed_files integer not null default 0 check (completed_files >= 0),
  failed_files integer not null default 0 check (failed_files >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  check (completed_files + failed_files <= total_files),
  unique (organization_id, idempotency_key),
  -- Lets import_files carry a composite foreign key, so a file cannot be
  -- attached to a batch in another workspace even if a policy were wrong.
  unique (id, organization_id)
);

comment on table public.import_batches is
  'One photographer''s selection of files for one shoot, recorded server-side so the queue survives the browser. Counters are maintained by trigger from import_files.';
comment on column public.import_batches.idempotency_key is
  'Stable per selection. Re-registering the same key returns the existing batch rather than creating a second one.';

-- ---------------------------------------------------------------------------
-- The file
-- ---------------------------------------------------------------------------

create table if not exists public.import_files (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- The client's own identifier for this file, stable across reloads. It is
  -- what makes registration idempotent and what names the local staged copy,
  -- so it is constrained to a shape that is safe in both a storage key and a
  -- filesystem path.
  client_file_id text not null
    check (client_file_id ~ '^[A-Za-z0-9_-]{1,64}$'),

  -- Kept exactly as the camera or card wrote it, separate from the storage
  -- path, which is sanitized and machine-chosen. Renaming a file to something
  -- a filesystem finds acceptable is not something to do to the operator's
  -- record of what they shot.
  original_filename text not null
    check (char_length(original_filename) between 1 and 255),
  byte_size bigint not null check (byte_size > 0),
  mime_type text not null check (char_length(mime_type) between 1 and 255),
  -- The filesystem's idea of when the file changed. A weak signal for capture
  -- time and treated as one: offered as a default the operator can correct,
  -- never asserted as EXIF truth.
  last_modified_at timestamptz,

  -- Where the bytes go. Deterministic, workspace-scoped, and collision-safe by
  -- construction: <organization_id>/_staging/<batch id>/<client_file_id>, and
  -- (batch, client_file_id) is unique. The _staging second segment is not
  -- decoration -- private.is_staging_object() keys on it, and it is what makes
  -- these objects renameable on promotion while a promoted original stays
  -- immutable. Fixed at registration by the trigger below.
  storage_bucket text not null default 'originals'
    check (storage_bucket in ('originals')),
  storage_path text not null,

  status public.import_file_status not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),

  -- A machine-readable reason and a sanitized sentence. Neither ever carries a
  -- signed URL, a token, or a raw provider payload: this row is readable by
  -- every member of the workspace.
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_.-]{1,64}$'),
  error_message text check (error_message is null or char_length(error_message) <= 500),

  -- The digest of the exact bytes on the photographer's machine, computed
  -- before anything left it. Recorded here so a resumed session can finalize a
  -- file it did not itself hash.
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),

  -- The asset this became. Set exactly once, by finalization.
  --
  -- on delete set null rather than restrict: a deliberate purge deletes assets,
  -- and a restrict here would abort it -- the same conflict between a cascade
  -- and a protective rule that FIX 1 fixed for asset_versions. The trigger
  -- below refuses to change this column, except while the purge flag is set.
  asset_id uuid references public.assets(id) on delete set null,

  uploaded_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A completed import has a finalization time. That it also has an asset is
  -- enforced by the trigger rather than here, because a purge legitimately
  -- clears asset_id on a completed row and a check constraint cannot be told
  -- about that.
  check (status <> 'complete' or finalized_at is not null),

  unique (import_batch_id, client_file_id),
  unique (organization_id, storage_path),
  foreign key (import_batch_id, organization_id)
    references public.import_batches (id, organization_id) on delete cascade
);

comment on table public.import_files is
  'One file in an import batch. Records lifecycle transitions, never per-byte progress: fine-grained progress is local to the browser doing the uploading.';
comment on column public.import_files.storage_path is
  'Deterministic and immutable: <organization_id>/_staging/<batch id>/<client_file_id>. Promotion to the canonical original key happens at finalization.';
comment on column public.import_files.asset_id is
  'The asset this import became. Written once by finalization; a repeated finalization returns this rather than creating a second asset.';

-- An asset belongs to at most one import file. This is the constraint behind
-- "finalization creates the asset exactly once": two concurrent finalizations
-- of the same file cannot both record their asset, so the second is a conflict
-- rather than a duplicate nobody notices.
create unique index if not exists import_files_asset_once_idx
  on public.import_files (asset_id)
  where asset_id is not null;

-- ---------------------------------------------------------------------------
-- Indexes
--
-- The questions this table is asked: what is still outstanding in this
-- workspace (recovery), what is outstanding in this batch (the queue screen),
-- and which batches belong to this shoot.
-- ---------------------------------------------------------------------------

create index if not exists import_batches_workspace_idx
  on public.import_batches (organization_id, status, created_at desc);
create index if not exists import_batches_shoot_idx
  on public.import_batches (shoot_id, created_at desc);
create index if not exists import_batches_created_by_idx
  on public.import_batches (created_by);

create index if not exists import_files_batch_idx
  on public.import_files (import_batch_id, status);
-- Partial: reconciliation only ever asks about work that has not landed, and a
-- workspace with a hundred thousand completed imports should not pay for them
-- on every startup sweep.
create index if not exists import_files_outstanding_idx
  on public.import_files (organization_id, updated_at desc)
  where status not in ('complete', 'canceled');

-- ---------------------------------------------------------------------------
-- What the database enforces about the lifecycle
-- ---------------------------------------------------------------------------

create or replace function private.protect_import_file()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- A deliberate purge is the one path that may unwind any of this, and it is
  -- the same flag every other protective trigger in this schema honours.
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.import_batch_id is distinct from old.import_batch_id
     or new.client_file_id is distinct from old.client_file_id
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path then
    raise exception 'The storage location of an import file is fixed at registration.'
      using errcode = 'restrict_violation';
  end if;

  if old.asset_id is not null and new.asset_id is distinct from old.asset_id then
    raise exception 'Import file % is already finalized as asset %.', old.id, old.asset_id
      using errcode = 'unique_violation';
  end if;

  if old.status = 'complete' and new.status is distinct from old.status then
    raise exception 'A completed import cannot be reopened.'
      using errcode = 'restrict_violation';
  end if;

  if new.status = 'complete' and new.asset_id is null then
    raise exception 'An import is only complete once it has an asset.'
      using errcode = 'not_null_violation';
  end if;

  -- Two lifecycle timestamps, stamped where they are evidenced rather than
  -- trusted from whichever client claimed them.
  if new.status = 'uploaded' and old.status is distinct from 'uploaded' then
    new.uploaded_at := coalesce(new.uploaded_at, now());
  end if;
  if new.status = 'complete' and old.status is distinct from 'complete' then
    new.finalized_at := coalesce(new.finalized_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists import_files_protect on public.import_files;
create trigger import_files_protect
before update on public.import_files
for each row execute function private.protect_import_file();

-- A brand new row may not claim to be finished.
create or replace function private.protect_new_import_file()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return new;
  end if;
  if new.status = 'complete' and new.asset_id is null then
    raise exception 'An import is only complete once it has an asset.'
      using errcode = 'not_null_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists import_files_protect_insert on public.import_files;
create trigger import_files_protect_insert
before insert on public.import_files
for each row execute function private.protect_new_import_file();

-- ---------------------------------------------------------------------------
-- Batch counters, derived
--
-- security definer because this runs from a cascade as well as from an
-- ordinary insert, and a count that depends on who happened to trigger it is
-- not a count. RLS still decides who may read or write the rows themselves.
-- ---------------------------------------------------------------------------

create or replace function private.refresh_import_batch(target_batch uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  totals record;
  current_status public.import_batch_status;
  next_status public.import_batch_status;
begin
  select status into current_status from public.import_batches where id = target_batch;
  -- The batch is being deleted underneath us; there is nothing to keep in step.
  if not found then return; end if;

  select
    count(*)::int                                                as total,
    count(*) filter (where status = 'complete')::int             as completed,
    count(*) filter (where status = 'failed')::int               as failed,
    count(*) filter (where status = 'canceled')::int             as canceled,
    count(*) filter (
      where status not in ('complete','failed','canceled')
    )::int                                                       as outstanding,
    count(*) filter (
      where status in ('staged','uploading','uploaded','finalizing','retrying')
    )::int                                                       as started
  into totals
  from public.import_files
  where import_batch_id = target_batch;

  -- paused and canceled are decisions a person made about the whole batch. The
  -- counters follow the files; the status does not overrule the operator.
  if current_status in ('paused','canceled') then
    next_status := current_status;
  elsif totals.total = 0 then
    next_status := 'pending';
  elsif totals.canceled = totals.total then
    next_status := 'canceled';
  elsif totals.outstanding > 0 then
    next_status := case when totals.started > 0 then 'uploading' else 'pending' end;
  elsif totals.failed > 0 then
    next_status := 'failed';
  else
    next_status := 'complete';
  end if;

  update public.import_batches set
    total_files     = totals.total,
    completed_files = totals.completed,
    failed_files    = totals.failed,
    status          = next_status,
    completed_at    = case
                        when next_status = 'complete' then coalesce(completed_at, now())
                        else null
                      end
  where id = target_batch;
end;
$$;

create or replace function private.import_files_refresh_batch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.refresh_import_batch(old.import_batch_id);
    return old;
  end if;
  perform private.refresh_import_batch(new.import_batch_id);
  return new;
end;
$$;

drop trigger if exists import_files_refresh_batch on public.import_files;
create trigger import_files_refresh_batch
after insert or update or delete on public.import_files
for each row execute function private.import_files_refresh_batch();

revoke all on function private.refresh_import_batch(uuid) from public;
revoke all on function private.import_files_refresh_batch() from public;
revoke all on function private.protect_import_file() from public;
revoke all on function private.protect_new_import_file() from public;

-- updated_at, like every other table that has one.
drop trigger if exists set_updated_at on public.import_batches;
create trigger set_updated_at before update on public.import_batches
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at on public.import_files;
create trigger set_updated_at before update on public.import_files
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Read for every active member, write for the roles that may write assets.
-- Importing is an asset write and nothing else: these mirror assets_write, and
-- src/lib/permissions.ts already spends asset.write on the import path.
-- ---------------------------------------------------------------------------

alter table public.import_batches enable row level security;
alter table public.import_files enable row level security;

drop policy if exists import_batches_select on public.import_batches;
create policy import_batches_select on public.import_batches
  for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists import_batches_write on public.import_batches;
create policy import_batches_write on public.import_batches
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

drop policy if exists import_files_select on public.import_files;
create policy import_files_select on public.import_files
  for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists import_files_write on public.import_files;
create policy import_files_write on public.import_files
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

-- ---------------------------------------------------------------------------
-- Data API grants
--
-- Explicit for both roles. The current Supabase image grants no DML on a new
-- public table to anybody, so silence here would mean 42501 for every caller --
-- authenticated and service_role alike. See
-- 20260825170000_service_role_data_api_grants.sql.
--
-- delete is granted because abandoning an import is a real thing an operator
-- does, and the row for a canceled file has no reason to be kept. What delete
-- can never reach is the asset: an import file points at its asset, not the
-- other way round, and removing the pointer removes nothing of the archive.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.import_batches to authenticated;
grant select, insert, update, delete on public.import_files to authenticated;
grant select, insert, update, delete on public.import_batches to service_role;
grant select, insert, update, delete on public.import_files to service_role;

-- Unchanged, and repeated so a later default cannot quietly reopen it.
revoke all on public.import_batches from anon;
revoke all on public.import_files from anon;
revoke all on all tables in schema public from anon;
