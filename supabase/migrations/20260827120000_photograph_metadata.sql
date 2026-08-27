-- Photograph metadata: a structured record per frame, and a durable queue that
-- fills it in.
--
-- Until now a frame carried a handful of loose columns on `assets` -- headline,
-- caption, subjects, keywords, credit, copyright -- and the AI suggestion
-- feature wrote none of them. It returned a draft to the browser and forgot it
-- the moment the tab closed. That was the right shape for a first pass and the
-- wrong shape for everything the metadata is meant to feed: discovery,
-- submissions, licensing records, rights matching, archive monetisation. None
-- of those can read a value that was never stored, and none of them may read a
-- value a person has not confirmed.
--
-- So this migration adds two tables.
--
--   public.asset_metadata      one current record per photograph
--   public.asset_metadata_jobs the durable queue that generates it
--
-- WHY A SEPARATE TABLE RATHER THAN MORE COLUMNS ON `assets`
--
-- `assets` is the commercial identity of a frame: what it is, where its bytes
-- are, whether it is selected, what it has earned. Metadata is a different
-- lifecycle -- generated, reviewed, confirmed, regenerated -- with its own
-- status, its own provenance, and its own concurrency. Bolting forty nullable
-- columns and a generation state machine onto `assets` would make every read of
-- the contact sheet carry them, and would put a machine's guesses in the same
-- row as the record they must never silently become.
--
-- The columns that already exist on `assets` are NOT duplicated here. Caption,
-- credit, copyright and usage restrictions remain the asset's own, because they
-- are what a dispatch actually sends and they already have an append-only
-- revision log. This table holds the structured editorial and technical detail
-- that had nowhere to live, and the confirmation that gates it.
--
-- WHY TYPED COLUMNS RATHER THAN ONE JSONB BLOB
--
-- Every field here is something the product is specified to filter, match, or
-- report on: city, camera, capture time, brands, keywords, sensitivity, embargo.
-- A jsonb blob would make each of those a functional index or a sequential scan
-- later. jsonb is used for exactly two things -- per-field confidence and the
-- preserved generated values -- neither of which is ever a filter.
--
-- Arrays are `text[]` rather than the `jsonb` used on `assets.keywords`. That is
-- a deliberate departure: these are the columns the archive will search, and
-- `text[] @> array[...]` with a GIN index is the query that has to be fast.
--
-- WHY A JOB TABLE RATHER THAN A HOSTED QUEUE
--
-- CLAUDE.md requires asking before adding a managed service, and this does not
-- need one. Generation is a single model call per frame; the volume is a card
-- dump, not a firehose. A Postgres table with FOR UPDATE SKIP LOCKED gives
-- durability across a deploy, a partial unique index gives duplicate protection,
-- and a lease with an expiry gives crash recovery. What it does not give is a
-- worker that runs on its own; that is the trade-off, and it is handled in the
-- application by draining after the enqueueing request has responded, plus a
-- sweep endpoint for anything a crashed invocation left behind.
--
-- ROLLBACK
--
--   begin;
--     drop trigger if exists assets_cancel_metadata_jobs on public.assets;
--     drop function if exists private.cancel_metadata_jobs_for_tombstone();
--     drop trigger if exists asset_metadata_protect_confirmed on public.asset_metadata;
--     drop function if exists private.protect_confirmed_metadata();
--     drop trigger if exists set_updated_at on public.asset_metadata;
--     drop trigger if exists set_updated_at on public.asset_metadata_jobs;
--     drop function if exists public.claim_metadata_jobs_admin(integer, integer);
--     drop function if exists public.complete_metadata_job_admin(uuid, uuid, text, text, text, integer);
--     drop table if exists public.asset_metadata_jobs;
--     drop table if exists public.asset_metadata;
--     drop type if exists public.metadata_job_status;
--     drop type if exists public.metadata_generation_status;
--   commit;
--
--   Dropping asset_metadata discards confirmed editorial metadata and the
--   extracted technical record. The originals are untouched -- nothing here
--   owns bytes -- so a re-run repopulates the technical half from the files and
--   leaves the editorial half to be generated and confirmed again.

-- ---------------------------------------------------------------------------
-- Vocabularies
--
-- Real enums rather than text + check, matching how every other status in this
-- schema is declared, because these are read by the interface as a state
-- machine and a typo in a status is not a thing to discover at render time.
-- src/lib/domain.ts mirrors both, one for one.
-- ---------------------------------------------------------------------------

create type public.metadata_generation_status as enum (
  'not_generated',
  'queued',
  'processing',
  'needs_review',
  'confirmed',
  'failed'
);

comment on type public.metadata_generation_status is
  'Where a photograph''s metadata stands. needs_review means values exist and a person has not yet accepted them; confirmed is the only state a dispatch may use.';

create type public.metadata_job_status as enum (
  'queued',
  'processing',
  'succeeded',
  'failed',
  'cancelled'
);

-- ---------------------------------------------------------------------------
-- The metadata record
-- ---------------------------------------------------------------------------

create table public.asset_metadata (
  -- The asset IS the key. One current record per photograph: history lives in
  -- activity events and in generated_values, not in a second row nobody can
  -- tell apart from the first.
  asset_id uuid primary key references public.assets(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Generation state ------------------------------------------------------
  generation_status public.metadata_generation_status not null default 'not_generated',
  generation_attempts integer not null default 0 check (generation_attempts >= 0),
  generation_requested_at timestamptz,
  generated_at timestamptz,
  -- Sanitised. A provider's raw error can carry a request id, a key prefix, or
  -- a prompt echo, and none of those belong on a screen.
  failure_code text check (failure_code is null or char_length(failure_code) <= 64),
  failure_detail text check (failure_detail is null or char_length(failure_detail) <= 500),

  ai_model text,
  ai_model_version text,
  overall_confidence numeric(5,4) check (overall_confidence is null or overall_confidence between 0 and 1),
  -- Per-field confidence, keyed by the same field names the interface uses.
  -- Never filtered on, so jsonb is the honest shape.
  field_confidence jsonb not null default '{}'::jsonb,
  -- What the model actually proposed, kept whatever the photographer does to
  -- the live columns afterwards. This is the audit trail for "the machine said
  -- X and a person changed it to Y".
  generated_values jsonb not null default '{}'::jsonb,

  -- Technical and source metadata ------------------------------------------
  --
  -- Read from the file. Never written by the model: a guess about which lens
  -- was on the body is not a fact, and would be indistinguishable from one.
  original_filename text,
  mime_type text,
  file_bytes bigint check (file_bytes is null or file_bytes > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  orientation smallint check (orientation is null or orientation between 1 and 8),
  captured_at timestamptz,
  camera_make text,
  camera_model text,
  lens text,
  focal_length_mm numeric(8,2) check (focal_length_mm is null or focal_length_mm > 0),
  aperture_f numeric(6,2) check (aperture_f is null or aperture_f > 0),
  -- Held as written, "1/250" or "2.5", because that is what a photographer
  -- reads. The seconds column is what a query sorts on.
  shutter_speed text,
  shutter_speed_seconds numeric(12,6) check (shutter_speed_seconds is null or shutter_speed_seconds > 0),
  iso integer check (iso is null or iso > 0),
  gps_latitude numeric(9,6) check (gps_latitude is null or gps_latitude between -90 and 90),
  gps_longitude numeric(9,6) check (gps_longitude is null or gps_longitude between -180 and 180),
  gps_altitude_m numeric(9,2),
  color_profile text,
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'),
  technical_extracted_at timestamptz,
  -- 'exif' when tags were read from the file, 'file' when only the container
  -- facts were available, 'none' when nothing could be read at all.
  technical_source text check (technical_source is null or technical_source in ('exif','file','none')),
  -- Anything the parser recognised but this table has no column for.
  technical_raw jsonb not null default '{}'::jsonb,

  -- Editorial metadata ------------------------------------------------------
  headline text check (headline is null or char_length(headline) <= 200),
  editorial_caption text check (editorial_caption is null or char_length(editorial_caption) <= 2000),
  alt_text text check (alt_text is null or char_length(alt_text) <= 500),
  subjects text[] not null default '{}',
  event_name text,
  venue text,
  city text,
  region text,
  country text,
  scene text,
  objects text[] not null default '{}',
  clothing text[] not null default '{}',
  brands text[] not null default '{}',
  keywords text[] not null default '{}',
  content_category text check (
    content_category is null or content_category in (
      'candid','red_carpet','event','sport','performance','portrait',
      'street','news','travel','arrival_departure','other'
    )
  ),
  quality_estimate text check (
    quality_estimate is null or quality_estimate in ('unusable','low','acceptable','good','excellent')
  ),
  -- The model may raise this. It may not clear it.
  sensitivity text not null default 'none' check (sensitivity in ('none','review','sensitive')),
  photographer_notes text check (photographer_notes is null or char_length(photographer_notes) <= 2000),

  -- Rights and verification -------------------------------------------------
  --
  -- Photographer-entered facts, every one of them. A trigger below refuses any
  -- generation write that touches this block, so the model cannot decide that a
  -- release exists or that a frame is clear for commercial use.
  editorial_use_only boolean not null default true,
  commercial_use_eligible text not null default 'unknown' check (
    commercial_use_eligible in ('unknown','not_eligible','eligible_with_release','eligible')
  ),
  model_release_status text not null default 'unknown' check (
    model_release_status in ('unknown','not_required','not_obtained','obtained')
  ),
  property_release_status text not null default 'unknown' check (
    property_release_status in ('unknown','not_required','not_obtained','obtained')
  ),
  embargo_until timestamptz,
  sensitive_or_minor boolean not null default false,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),

  -- Provenance and concurrency ---------------------------------------------
  --
  -- Which fields a person typed or deliberately cleared. Two jobs at once: it
  -- tells the interface what to label as entered rather than inherited, and it
  -- tells generation what it may not touch.
  manual_overrides text[] not null default '{}',
  metadata_source text not null default 'inherited' check (
    metadata_source in ('inherited','ai_generated','manual','mixed')
  ),
  -- Optimistic concurrency. Two tabs on the same frame is the ordinary case in
  -- this product -- an inspector and a record screen -- and last-write-wins on
  -- a caption that is about to reach a buyer is not acceptable.
  version integer not null default 1 check (version > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Confirmation is a stamp or it is nothing. Without this a row could claim to
  -- be confirmed with nobody's name against it, which is the single fact the
  -- dispatch gate depends on.
  constraint asset_metadata_confirmation_stamped check (
    (generation_status = 'confirmed') = (confirmed_at is not null and confirmed_by is not null)
  ),
  -- A failure explains itself, and stops explaining itself once it is not one.
  constraint asset_metadata_failure_scoped check (
    generation_status = 'failed' or (failure_code is null and failure_detail is null)
  ),
  -- A model attribution only makes sense once a model has run.
  constraint asset_metadata_model_scoped check (
    (generated_at is not null) or (ai_model is null and overall_confidence is null)
  )
);

comment on table public.asset_metadata is
  'One structured metadata record per photograph: technical facts read from the file, editorial detail proposed by a model or typed by hand, and the rights fields only a person may set.';
comment on column public.asset_metadata.generated_values is
  'What the model proposed, preserved regardless of what the photographer did to the live columns afterwards.';
comment on column public.asset_metadata.manual_overrides is
  'Field names a person typed or deliberately cleared. Generation never writes these, and inheritance stops flowing into them.';
comment on column public.asset_metadata.version is
  'Bumped on every save. A save carrying a stale version is refused rather than silently overwriting a newer edit.';

-- ---------------------------------------------------------------------------
-- The job queue
-- ---------------------------------------------------------------------------

create table public.asset_metadata_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  status public.metadata_job_status not null default 'queued',
  -- Why this job exists, so a sweep can tell an upload apart from a person
  -- pressing Retry.
  reason text not null default 'upload' check (reason in ('upload','manual','retry','bulk')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  -- The lease. A worker that dies mid-frame leaves locked_until in the past,
  -- and the next claim takes the job back rather than leaving it stuck in
  -- processing forever.
  locked_at timestamptz,
  locked_until timestamptz,
  lock_token uuid,
  requested_by uuid references auth.users(id),
  failure_code text check (failure_code is null or char_length(failure_code) <= 64),
  failure_detail text check (failure_detail is null or char_length(failure_detail) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint asset_metadata_jobs_lease_paired check (
    (status = 'processing') = (lock_token is not null and locked_until is not null)
  ),
  constraint asset_metadata_jobs_finished_paired check (
    (status in ('succeeded','failed','cancelled')) = (finished_at is not null)
  )
);

comment on table public.asset_metadata_jobs is
  'Durable queue for metadata generation. Claimed with FOR UPDATE SKIP LOCKED under a lease, so a crashed worker releases its frame instead of stranding it.';

-- At most one live job per photograph, ever. This is what makes a double click
-- on Generate, or an upload racing a manual request, cost one model call
-- instead of two -- and it is enforced here rather than in the application,
-- because two application instances cannot see each other.
create unique index asset_metadata_jobs_one_live_idx
  on public.asset_metadata_jobs(asset_id)
  where status in ('queued','processing');

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index asset_metadata_org_status_idx
  on public.asset_metadata(organization_id, generation_status);
-- The review sweep: everything on one shoot that still needs a person.
create index asset_metadata_org_unconfirmed_idx
  on public.asset_metadata(organization_id, updated_at desc)
  where generation_status <> 'confirmed';
create index asset_metadata_org_captured_idx
  on public.asset_metadata(organization_id, captured_at desc nulls last);
create index asset_metadata_org_city_idx
  on public.asset_metadata(organization_id, country, region, city);
create index asset_metadata_confirmed_by_idx
  on public.asset_metadata(confirmed_by) where confirmed_by is not null;
-- Archive search. These are the three arrays a desk actually queries.
create index asset_metadata_keywords_idx on public.asset_metadata using gin (keywords);
create index asset_metadata_subjects_idx on public.asset_metadata using gin (subjects);
create index asset_metadata_brands_idx on public.asset_metadata using gin (brands);

-- The claim query's index: queued and due, or leased and expired.
create index asset_metadata_jobs_runnable_idx
  on public.asset_metadata_jobs(run_after)
  where status in ('queued','processing');
create index asset_metadata_jobs_org_idx
  on public.asset_metadata_jobs(organization_id, created_at desc);
create index asset_metadata_jobs_asset_idx
  on public.asset_metadata_jobs(asset_id, created_at desc);
create index asset_metadata_jobs_requested_by_idx
  on public.asset_metadata_jobs(requested_by) where requested_by is not null;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger set_updated_at
  before update on public.asset_metadata
  for each row execute function private.set_updated_at();

create trigger set_updated_at
  before update on public.asset_metadata_jobs
  for each row execute function private.set_updated_at();

/*
 * What a generation write may not do.
 *
 * The application merges generated values against manual_overrides and against
 * confirmation before writing, and that merge is tested. This trigger exists
 * because the worker runs with the service role, which bypasses row level
 * security entirely -- so the one rule that must not depend on the worker being
 * correct is repeated where the worker cannot reach around it.
 *
 * A generation write is recognised by `generated_at` moving forward. Two things
 * are then refused outright:
 *
 *   1. Changing any editorial value on a row a person has confirmed. A
 *      confirmed caption is a fact somebody put their name to; a later model
 *      run may propose against it, and generated_values is where the proposal
 *      goes.
 *   2. Changing any rights value, ever, confirmed or not. Whether a release
 *      exists is not observable from a photograph, and a machine that could
 *      write it here would eventually write it wrong.
 */
create or replace function private.protect_confirmed_metadata()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.generated_at is distinct from old.generated_at and new.generated_at is not null then

    if new.editorial_use_only is distinct from old.editorial_use_only
       or new.commercial_use_eligible is distinct from old.commercial_use_eligible
       or new.model_release_status is distinct from old.model_release_status
       or new.property_release_status is distinct from old.property_release_status
       or new.embargo_until is distinct from old.embargo_until
       or new.sensitive_or_minor is distinct from old.sensitive_or_minor
       or new.confirmed_at is distinct from old.confirmed_at
       or new.confirmed_by is distinct from old.confirmed_by
    then
      raise exception
        'Generated metadata may not set rights, releases, or confirmation. Those are photographer-entered facts.'
        using errcode = 'restrict_violation';
    end if;

    if old.confirmed_at is not null and (
         new.headline is distinct from old.headline
      or new.editorial_caption is distinct from old.editorial_caption
      or new.alt_text is distinct from old.alt_text
      or new.subjects is distinct from old.subjects
      or new.event_name is distinct from old.event_name
      or new.venue is distinct from old.venue
      or new.city is distinct from old.city
      or new.region is distinct from old.region
      or new.country is distinct from old.country
      or new.scene is distinct from old.scene
      or new.objects is distinct from old.objects
      or new.clothing is distinct from old.clothing
      or new.brands is distinct from old.brands
      or new.keywords is distinct from old.keywords
      or new.content_category is distinct from old.content_category
      or new.photographer_notes is distinct from old.photographer_notes
    ) then
      raise exception
        'This metadata is confirmed. A later generation may be recorded but may not overwrite it.'
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger asset_metadata_protect_confirmed
  before update on public.asset_metadata
  for each row execute function private.protect_confirmed_metadata();

/*
 * A tombstoned frame stops being generated.
 *
 * Without this a card of rejects keeps a queue of model calls alive against
 * files nobody is going to send. The worker also re-reads the asset before it
 * spends anything, so a frame tombstoned mid-flight is dropped there too; this
 * is the cheaper half of the same rule.
 */
create or replace function private.cancel_metadata_jobs_for_tombstone()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.asset_metadata_jobs
     set status = 'cancelled',
         finished_at = now(),
         lock_token = null,
         locked_until = null,
         failure_code = 'asset_tombstoned',
         failure_detail = 'The photograph was removed before this ran.'
   where asset_id = new.id
     and status in ('queued','processing');
  return new;
end;
$$;

create trigger assets_cancel_metadata_jobs
  after update of status on public.assets
  for each row
  when (new.status = 'tombstoned' and old.status is distinct from 'tombstoned')
  execute function private.cancel_metadata_jobs_for_tombstone();

-- ---------------------------------------------------------------------------
-- Claiming and completing work
--
-- Both are security definer and reachable only with the service role. The
-- worker has no user session -- it runs after a response has been flushed, or
-- from a swept cron request -- so it cannot satisfy a policy, and it must not
-- be able to reach anything else either. That is why these are two narrow
-- functions rather than a table grant.
-- ---------------------------------------------------------------------------

create or replace function public.claim_metadata_jobs_admin(
  batch_size integer default 3,
  lease_seconds integer default 300
)
returns setof public.asset_metadata_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimable as (
    select j.id
      from public.asset_metadata_jobs j
     where (j.status = 'queued' and j.run_after <= now())
        or (j.status = 'processing' and j.locked_until < now())
     order by j.run_after asc
     limit greatest(1, least(coalesce(batch_size, 3), 25))
     -- SKIP LOCKED is the whole point: two workers claiming at once take
     -- different rows instead of one waiting on the other's transaction.
     for update skip locked
  )
  update public.asset_metadata_jobs j
     set status = 'processing',
         attempts = j.attempts + 1,
         locked_at = now(),
         locked_until = now() + make_interval(secs => greatest(30, least(coalesce(lease_seconds, 300), 900))),
         lock_token = gen_random_uuid(),
         started_at = coalesce(j.started_at, now()),
         finished_at = null
    from claimable c
   where j.id = c.id
  returning j.*;
end;
$$;

comment on function public.claim_metadata_jobs_admin(integer, integer) is
  'Atomically lease up to batch_size runnable jobs. Also reclaims jobs whose lease expired, which is how a crashed worker''s frame gets picked up again.';

/*
 * Finish a job, or hand it back for another attempt.
 *
 * The lock token is checked, not decorative. A worker that stalled past its
 * lease has had its job reclaimed by someone else; letting it write the outcome
 * anyway would overwrite a run that is still going. A stale caller gets null
 * and is expected to stop.
 */
create or replace function public.complete_metadata_job_admin(
  target_job uuid,
  token uuid,
  outcome text,
  code text default null,
  detail text default null,
  retry_in_seconds integer default null
)
returns public.asset_metadata_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.asset_metadata_jobs;
  should_retry boolean;
begin
  if outcome not in ('succeeded','failed','cancelled') then
    raise exception 'Unknown job outcome %', outcome using errcode = 'invalid_parameter_value';
  end if;

  select * into job
    from public.asset_metadata_jobs
   where id = target_job
     for update;

  if not found then
    return null;
  end if;

  -- Someone else owns this job now. Say nothing and change nothing.
  if job.lock_token is null or job.lock_token is distinct from token then
    return null;
  end if;

  should_retry := outcome = 'failed'
    and retry_in_seconds is not null
    and job.attempts < job.max_attempts;

  if should_retry then
    update public.asset_metadata_jobs
       set status = 'queued',
           run_after = now() + make_interval(secs => greatest(1, least(retry_in_seconds, 3600))),
           lock_token = null,
           locked_until = null,
           locked_at = null,
           finished_at = null,
           failure_code = code,
           failure_detail = detail
     where id = target_job
     returning * into job;
  else
    update public.asset_metadata_jobs
       set status = outcome::public.metadata_job_status,
           finished_at = now(),
           lock_token = null,
           locked_until = null,
           failure_code = case when outcome = 'succeeded' then null else code end,
           failure_detail = case when outcome = 'succeeded' then null else detail end
     where id = target_job
     returning * into job;
  end if;

  return job;
end;
$$;

revoke all on function public.claim_metadata_jobs_admin(integer, integer) from public;
revoke all on function public.claim_metadata_jobs_admin(integer, integer) from anon;
revoke all on function public.claim_metadata_jobs_admin(integer, integer) from authenticated;
grant execute on function public.claim_metadata_jobs_admin(integer, integer) to service_role;

revoke all on function public.complete_metadata_job_admin(uuid, uuid, text, text, text, integer) from public;
revoke all on function public.complete_metadata_job_admin(uuid, uuid, text, text, text, integer) from anon;
revoke all on function public.complete_metadata_job_admin(uuid, uuid, text, text, text, integer) from authenticated;
grant execute on function public.complete_metadata_job_admin(uuid, uuid, text, text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Same shape as `assets`: every active member reads, owner and editor write.
-- Forced, so a missing policy fails closed even for the table owner.
-- ---------------------------------------------------------------------------

alter table public.asset_metadata enable row level security;
alter table public.asset_metadata force row level security;
alter table public.asset_metadata_jobs enable row level security;
alter table public.asset_metadata_jobs force row level security;

create policy asset_metadata_select on public.asset_metadata
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy asset_metadata_write on public.asset_metadata
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

create policy asset_metadata_jobs_select on public.asset_metadata_jobs
  for select to authenticated
  using (private.is_org_member(organization_id));

-- Enqueue only. Advancing a job is the worker's business, and the worker holds
-- the service role; a signed-in caller has no update or delete path at all, so
-- nobody can mark their own job succeeded or reset somebody else's lease.
create policy asset_metadata_jobs_insert on public.asset_metadata_jobs
  for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner','editor']::public.app_role[])
    and requested_by = (select auth.uid())
    and status = 'queued'
    and attempts = 0
  );

-- ---------------------------------------------------------------------------
-- Grants
--
-- Explicit, because the current Supabase image grants no DML on a new public
-- table to anyone. RLS remains the row authorization layer; a grant is not an
-- authorization decision here.
-- ---------------------------------------------------------------------------

grant select, insert, update on public.asset_metadata to authenticated;
grant select, insert on public.asset_metadata_jobs to authenticated;

grant select, insert, update, delete on public.asset_metadata to service_role;
grant select, insert, update, delete on public.asset_metadata_jobs to service_role;

-- Deliberately no delete grant to authenticated on either table. A metadata
-- record goes when its photograph goes, by cascade, and a job is history.

revoke all on all tables in schema public from anon;
