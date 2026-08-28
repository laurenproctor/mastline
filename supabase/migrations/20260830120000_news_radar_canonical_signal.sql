-- News Radar: one canonical news signal, two independent opportunity paths.
--
-- The radar receives one news signal and evaluates it through two commercial
-- paths: can this story reactivate photographs the workspace already owns
-- (archive_match), and does it justify creating new photographs now
-- (shoot_opportunity). A person enters the story once; both evaluations come
-- into existence together and are decided independently.
--
--   public.news_signals      the story: source facts, owned once
--   public.opportunities     one evaluation path per kind, per signal
--
-- This migration supersedes the unmerged 20260828190739_news_radar_two_modes,
-- which put the kind and the source facts on the same row -- a model that
-- required entering the same article twice to receive both evaluations, and
-- kept two mutable copies of its facts. That file was verified unapplied on
-- every shared database before being replaced (hosted deploys come from main,
-- which never contained it; the shared local stack's history was read back).
-- The version is deliberately later than the in-flight import-queue chain
-- (20260830100000) so no database can receive it out of order.
--
-- Deliberately NOT here, as before: a news-provider model, provider
-- identifiers, and any matched-asset storage. Archive matching will add a
-- relational opportunity-assets table; asset ids never go into
-- suggestion_basis.

-- ---------------------------------------------------------------------------
-- The canonical signal
-- ---------------------------------------------------------------------------

create table public.news_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  source_name text,
  source_url text,
  source_published_at timestamptz,
  summary text,
  -- Who typed the story. Null for machine-ingested and historical rows, and
  -- the row outlives its author: history is not deleted with an account.
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The composite target for the organization-consistency foreign key below.
  unique (id, organization_id)
);

-- One story per source URL per workspace. The URL is the only stable identity
-- a story has; a story entered without one cannot be deduplicated and is not
-- refused for it. Different workspaces may of course hold the same story.
create unique index news_signals_org_source_url_key
  on public.news_signals (organization_id, source_url)
  where source_url is not null;

create index news_signals_org_published_idx
  on public.news_signals (organization_id, source_published_at desc);
create index news_signals_created_by_idx on public.news_signals (created_by);

create trigger set_updated_at
  before update on public.news_signals
  for each row execute function private.set_updated_at();

-- A lapsed trial can read its radar but not work it, same as every table that
-- represents doing work.
create trigger enforce_workspace_writable
  before insert or update or delete on public.news_signals
  for each row execute function private.enforce_workspace_writable();

-- ---------------------------------------------------------------------------
-- Opportunities become evaluation paths of a signal
-- ---------------------------------------------------------------------------

alter table public.opportunities
  add column news_signal_id uuid,
  add column opportunity_kind text not null default 'archive_match'
    check (opportunity_kind in ('archive_match', 'shoot_opportunity')),
  add column dismissal_reason text
    check (dismissal_reason is null or char_length(dismissal_reason) between 1 and 1000),
  add column acted_at timestamptz;

-- The kind default exists only for the backfill below: every pre-existing
-- opportunity was an archive-value suggestion. The application always writes
-- the kind explicitly.

alter table public.opportunities
  add constraint opportunities_dismissal_reason_requires_dismissed
    check (dismissal_reason is null or status = 'dismissed'),
  add constraint opportunities_acted_at_requires_acted
    check (acted_at is null or status = 'acted'),
  -- A confidence with nothing behind it is a number pretending to be a
  -- reason. suggestion_basis carries a human-readable `summary`.
  add constraint opportunities_confidence_requires_basis
    check (confidence is null or coalesce(suggestion_basis ->> 'summary', '') <> '');

-- ---------------------------------------------------------------------------
-- Backfill: every existing opportunity row gets a canonical signal.
--
-- No application code has ever written this table (the radar read a mock
-- layer until now), so in practice these statements move zero rows; they
-- exist so a database that somehow does hold rows migrates correctly rather
-- than failing or losing anything. Rows sharing (organization, source URL)
-- collapse into one signal, keeping the earliest entry's facts; rows with no
-- URL each keep their own. No counterpart path is invented for historical
-- rows -- an evaluation nobody made is not backfilled -- so a historical
-- signal may carry one path where a manually entered story carries two.
-- ---------------------------------------------------------------------------

insert into public.news_signals
  (organization_id, title, source_name, source_url, source_published_at, summary, created_at)
select o.organization_id, o.title, o.source_name, o.source_url, o.source_published_at,
       o.summary, o.created_at
from (
  select distinct on (organization_id, source_url) *
  from public.opportunities
  where source_url is not null
  order by organization_id, source_url, created_at
) o;

update public.opportunities o
set news_signal_id = s.id
from public.news_signals s
where o.source_url is not null
  and s.organization_id = o.organization_id
  and s.source_url = o.source_url;

-- URL-less rows: the signal reuses the opportunity's id, which maps the two
-- without a temporary column. Fresh rows get fresh ids from the default.
insert into public.news_signals
  (id, organization_id, title, source_name, source_url, source_published_at, summary, created_at)
select o.id, o.organization_id, o.title, o.source_name, null, o.source_published_at,
       o.summary, o.created_at
from public.opportunities o
where o.source_url is null;

update public.opportunities
set news_signal_id = id
where source_url is null;

alter table public.opportunities
  alter column news_signal_id set not null;

-- Organization consistency is the database's job: a path in organization A
-- cannot reference a signal in organization B, because the foreign key
-- carries both columns.
alter table public.opportunities
  add constraint opportunities_news_signal_fkey
    foreign key (news_signal_id, organization_id)
    references public.news_signals (id, organization_id)
    on delete cascade;

-- One evaluation of each kind per signal.
alter table public.opportunities
  add constraint opportunities_signal_kind_key unique (news_signal_id, opportunity_kind);

-- ---------------------------------------------------------------------------
-- Drop the legacy source columns. The canonical signal is authoritative and
-- nothing may maintain a second editable copy of a story's facts. Dropping
-- rather than keeping them is the compatibility decision: this table has
-- never been written by application code, the one migration that shaped it
-- differently was never applied to a shared database, and a deprecated
-- column that still accepts writes is how two copies drift apart.
-- (opportunities_org_status_idx dies with source_published_at.)
-- ---------------------------------------------------------------------------

alter table public.opportunities
  drop column title,
  drop column source_name,
  drop column source_url,
  drop column source_published_at,
  drop column summary;

create index opportunities_org_kind_status_idx
  on public.opportunities (organization_id, opportunity_kind, status);
create index opportunities_org_window_idx
  on public.opportunities (organization_id, window_closes_at)
  where window_closes_at is not null;
-- opportunities_signal_kind_key already supports the signal foreign key.

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Same shape as the rest of the schema: every active member reads, owner and
-- editor write, both halves of every write policy are stated. opportunities
-- keeps its existing opportunities_select and opportunities_write policies
-- and grants unchanged.
-- ---------------------------------------------------------------------------

alter table public.news_signals enable row level security;
alter table public.news_signals force row level security;

create policy news_signals_select on public.news_signals
  for select to authenticated
  using (private.is_org_member(organization_id));

-- Authorship is pinned to the caller, so a client cannot forge created_by.
-- Machine-ingested rows (created_by null) are written by the service role,
-- which bypasses RLS by design.
create policy news_signals_insert on public.news_signals
  for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner','editor']::public.app_role[])
    and created_by = (select auth.uid())
  );

create policy news_signals_update on public.news_signals
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

-- No delete policy, and no delete grant below: a signal underpins the paths'
-- history. Unwinding one is a service-role act.

-- Explicit Data API grants, paired with the policies. The platform's default
-- privileges on a new table have flipped between "nothing" and "everything"
-- across image versions, so the revoke is not ceremony: grants are additive,
-- and a column-scoped grant restricts nothing while a table-wide default
-- UPDATE stands beside it. State the whole surface explicitly.
revoke all on public.news_signals from authenticated;
revoke all on public.news_signals from anon;

-- The update grant is column-scoped: the source facts may be corrected, but
-- organization_id, created_by, and the timestamps cannot be rewritten by any
-- client, whatever a future policy says. No delete grant: a signal underpins
-- the paths' history, and unwinding one is a service-role act.
grant select, insert on public.news_signals to authenticated;
grant update (title, source_name, source_url, source_published_at, summary)
  on public.news_signals to authenticated;

-- service_role holds what trusted server paths need, per the standing rule
-- from 20260825170000: same table privileges, RLS bypassed by design.
grant select, insert, update, delete on public.news_signals to service_role;

-- ---------------------------------------------------------------------------
-- Atomic manual entry
--
-- One submission creates one signal and both evaluation paths, or nothing.
-- SECURITY INVOKER: every insert here runs as the caller, so row level
-- security -- membership, role, pinned authorship, the read-only trial
-- trigger -- applies exactly as it would to direct table writes. The
-- function adds only atomicity and the duplicate answer.
-- ---------------------------------------------------------------------------

-- The duplicate answer, shaped like the created one. INVOKER: it can only
-- describe rows the caller could already read.
create or replace function public.news_story_paths(target_signal uuid, outcome text)
returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object(
    'outcome', outcome,
    'signal_id', target_signal,
    'archive_opportunity_id',
      (select o.id from public.opportunities o
       where o.news_signal_id = target_signal and o.opportunity_kind = 'archive_match'),
    'shoot_opportunity_id',
      (select o.id from public.opportunities o
       where o.news_signal_id = target_signal and o.opportunity_kind = 'shoot_opportunity'));
$$;

create or replace function public.create_news_story(
  target_organization uuid,
  story_title text,
  story_source_name text default null,
  story_source_url text default null,
  story_published_at timestamptz default null,
  story_summary text default null,
  path_signal text default 'watch',
  path_confidence numeric default null,
  path_basis text default null,
  path_window_closes_at timestamptz default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  signal_id uuid;
  archive_id uuid;
  shoot_id uuid;
  basis jsonb := case
    when path_basis is null or path_basis = '' then '{}'::jsonb
    else jsonb_build_object('summary', path_basis)
  end;
begin
  -- The same story already on this workspace's radar is answered with the
  -- record as it stands, not with a second copy.
  if story_source_url is not null then
    select s.id into signal_id
    from public.news_signals s
    where s.organization_id = target_organization
      and s.source_url = story_source_url;
    if signal_id is not null then
      return public.news_story_paths(signal_id, 'duplicate');
    end if;
  end if;

  begin
    insert into public.news_signals
      (organization_id, title, source_name, source_url, source_published_at, summary, created_by)
    values
      (target_organization, story_title, story_source_name, story_source_url,
       story_published_at, story_summary, actor)
    returning id into signal_id;

    insert into public.opportunities
      (organization_id, news_signal_id, opportunity_kind, signal, confidence,
       suggestion_basis, status, window_closes_at)
    values
      (target_organization, signal_id, 'archive_match', path_signal, path_confidence,
       basis, 'new', path_window_closes_at)
    returning id into archive_id;

    insert into public.opportunities
      (organization_id, news_signal_id, opportunity_kind, signal, confidence,
       suggestion_basis, status, window_closes_at)
    values
      (target_organization, signal_id, 'shoot_opportunity', path_signal, path_confidence,
       basis, 'new', path_window_closes_at)
    returning id into shoot_id;

    -- One event for the canonical entry. Path decisions write their own
    -- events later; creating the paths IS the entry, not a decision on one.
    insert into public.activity_events
      (organization_id, actor_id, entity_type, entity_id, action, event_data)
    values
      (target_organization, actor, 'news_signal', signal_id, 'news_signal.created',
       jsonb_build_object(
         'summary', 'Story entered by hand; archive and shoot paths opened',
         'sourceRecorded', story_source_url is not null));
  exception
    when unique_violation then
      -- Two people entering the same story at once: the loser of the race is
      -- answered exactly like any other repeat. The block's work rolled back.
      select s.id into signal_id
      from public.news_signals s
      where s.organization_id = target_organization
        and s.source_url = story_source_url;
      if signal_id is null then raise; end if;
      return public.news_story_paths(signal_id, 'duplicate');
  end;

  return jsonb_build_object(
    'outcome', 'created',
    'signal_id', signal_id,
    'archive_opportunity_id', archive_id,
    'shoot_opportunity_id', shoot_id);
end;
$$;

-- Default function privileges grant execute widely; these are called by
-- signed-in operators and nobody else.
revoke all on function public.create_news_story(uuid, text, text, text, timestamptz, text, text, numeric, text, timestamptz) from public;
revoke all on function public.create_news_story(uuid, text, text, text, timestamptz, text, text, numeric, text, timestamptz) from anon;
grant execute on function public.create_news_story(uuid, text, text, text, timestamptz, text, text, numeric, text, timestamptz) to authenticated;

revoke all on function public.news_story_paths(uuid, text) from public;
revoke all on function public.news_story_paths(uuid, text) from anon;
grant execute on function public.news_story_paths(uuid, text) to authenticated;

-- Unchanged, and repeated so a later default cannot quietly reopen it.
revoke all on all tables in schema public from anon;
