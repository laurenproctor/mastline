-- How long a desk actually looked at the pictures.
--
-- The access record already answered "did they open it" and "did they take a
-- copy". It could not answer the question a photographer actually asks, which
-- is whether anybody *looked*. An open is one row whether the editor read every
-- caption or closed the tab in half a second.
--
-- So: sessions and per-photograph visible time, measured first-party, with the
-- server deciding what counts. Nothing here is a third-party tag, nothing
-- fingerprints a browser, and nothing records what the visitor did beyond which
-- frames were on screen and for roughly how long.
--
-- Four tables, and the split matters:
--
--   delivery_view_sessions        one visit, detailed, prunable
--   delivery_asset_views          one frame within one visit, detailed, prunable
--   delivery_engagement_totals    the durable rollup for a link
--   delivery_asset_engagement_totals   the durable rollup for a frame
--
-- The rollups exist so retention is a real option. Detailed session rows are
-- the privacy-sensitive half and can be pruned on a schedule; the totals a
-- photographer needs a year later survive, because they are written at the same
-- time rather than derived on the way out.
--
-- These are analytics, deliberately kept apart from the append-only evidence in
-- delivery_access_events and delivery_acceptances. Acceptance and downloads are
-- commercial facts and are recorded whatever the visitor's consent choice.
-- Dwell time is not, and the delivery page does not send a single heartbeat
-- unless the optional-analytics choice allows it.

-- ---------------------------------------------------------------------------
-- What the server will believe
--
-- Every number below arrives from a browser, which is to say from a stranger.
-- The client proposes; these constants decide.
-- ---------------------------------------------------------------------------

-- A heartbeat carries at most this much time, whatever it claims. The page
-- beats every 10 seconds; three times that absorbs timer throttling in a
-- backgrounded tab without letting a forged beat claim an afternoon.
create or replace function private.delivery_beat_ceiling_ms()
returns integer language sql immutable set search_path = '' as $$ select 30000 $$;

-- Beyond this gap the session is over. A laptop lid closed at lunch should not
-- produce a four-hour view, and no legitimate beat is ever this late.
create or replace function private.delivery_session_idle_ms()
returns integer language sql immutable set search_path = '' as $$ select 120000 $$;

-- ---------------------------------------------------------------------------
-- One visit
-- ---------------------------------------------------------------------------

create table public.delivery_view_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_id uuid not null references public.submission_deliveries(id) on delete cascade,
  -- Pseudonymous, first-party, and scoped to this link by construction: the
  -- server hashes the delivery id into it, so the same browser opening two
  -- different links is two unrelated visitors and nothing can join them up.
  -- Never an IP address, never anything sampled from the device.
  visitor_key text not null check (char_length(visitor_key) = 64),
  session_key text not null check (char_length(session_key) = 64),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  -- Only time the server was willing to count.
  active_visible_ms bigint not null default 0 check (active_visible_ms >= 0),
  -- Monotonic, so a replayed or duplicated beat is recognised and dropped.
  last_sequence integer not null default 0 check (last_sequence >= 0),
  -- A coarse family name ("Safari on macOS"), not the raw string. The raw user
  -- agent stays on the access event, which is evidence; this is a label.
  user_agent_summary text check (user_agent_summary is null or char_length(user_agent_summary) <= 80),
  created_at timestamptz not null default now(),
  unique (delivery_id, session_key),
  check (ended_at is null or ended_at >= started_at),
  check (last_seen_at >= started_at)
);

alter table public.delivery_view_sessions
  add constraint delivery_view_sessions_org_id_key unique (organization_id, id);

-- The delivery must be in the session's own organization.
alter table public.delivery_view_sessions
  add constraint delivery_view_sessions_delivery_same_org
  foreign key (organization_id, delivery_id)
  references public.submission_deliveries(organization_id, id)
  on delete cascade;

create index delivery_view_sessions_delivery_idx
  on public.delivery_view_sessions(delivery_id, started_at desc);
create index delivery_view_sessions_org_idx
  on public.delivery_view_sessions(organization_id, started_at desc);
create index delivery_view_sessions_visitor_idx
  on public.delivery_view_sessions(delivery_id, visitor_key);
-- Retention sweeps by age.
create index delivery_view_sessions_age_idx
  on public.delivery_view_sessions(started_at);

comment on table public.delivery_view_sessions is
  'One viewing session on a recipient delivery link. Optional analytics, not evidence: pseudonymous, first-party, prunable, and never collected without the applicable consent.';

-- ---------------------------------------------------------------------------
-- One frame within one visit
-- ---------------------------------------------------------------------------

create table public.delivery_asset_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_id uuid not null references public.submission_deliveries(id) on delete cascade,
  session_id uuid not null references public.delivery_view_sessions(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  first_visible_at timestamptz not null default now(),
  last_visible_at timestamptz not null default now(),
  active_visible_ms bigint not null default 0 check (active_visible_ms >= 0),
  -- How many separate times this frame came back into view in this session.
  view_count integer not null default 1 check (view_count >= 0),
  unique (session_id, asset_id),
  check (last_visible_at >= first_visible_at)
);

alter table public.delivery_asset_views
  add constraint delivery_asset_views_session_same_org
  foreign key (organization_id, session_id)
  references public.delivery_view_sessions(organization_id, id)
  on delete cascade;

alter table public.delivery_asset_views
  add constraint delivery_asset_views_delivery_same_org
  foreign key (organization_id, delivery_id)
  references public.submission_deliveries(organization_id, id)
  on delete cascade;

-- A frame viewed through a link must be a frame in the same workspace.
alter table public.delivery_asset_views
  add constraint delivery_asset_views_asset_same_org
  foreign key (organization_id, asset_id)
  references public.assets(organization_id, id)
  on delete cascade;

create index delivery_asset_views_delivery_idx
  on public.delivery_asset_views(delivery_id, asset_id);
create index delivery_asset_views_session_idx
  on public.delivery_asset_views(session_id);

-- ---------------------------------------------------------------------------
-- The durable rollups
--
-- Written alongside the detail, never derived from it, so pruning the detail
-- costs the photographer the session-by-session breakdown and none of the
-- totals.
-- ---------------------------------------------------------------------------

create table public.delivery_engagement_totals (
  delivery_id uuid primary key references public.submission_deliveries(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_count integer not null default 0 check (session_count >= 0),
  visitor_count integer not null default 0 check (visitor_count >= 0),
  active_visible_ms bigint not null default 0 check (active_visible_ms >= 0),
  first_session_at timestamptz,
  last_session_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.delivery_engagement_totals
  add constraint delivery_engagement_totals_delivery_same_org
  foreign key (organization_id, delivery_id)
  references public.submission_deliveries(organization_id, id)
  on delete cascade;

create index delivery_engagement_totals_org_idx
  on public.delivery_engagement_totals(organization_id);

create table public.delivery_asset_engagement_totals (
  delivery_id uuid not null references public.submission_deliveries(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  active_visible_ms bigint not null default 0 check (active_visible_ms >= 0),
  view_count integer not null default 0 check (view_count >= 0),
  first_visible_at timestamptz,
  last_visible_at timestamptz,
  primary key (delivery_id, asset_id)
);

alter table public.delivery_asset_engagement_totals
  add constraint delivery_asset_totals_delivery_same_org
  foreign key (organization_id, delivery_id)
  references public.submission_deliveries(organization_id, id)
  on delete cascade;

alter table public.delivery_asset_engagement_totals
  add constraint delivery_asset_totals_asset_same_org
  foreign key (organization_id, asset_id)
  references public.assets(organization_id, id)
  on delete cascade;

create index delivery_asset_engagement_totals_org_idx
  on public.delivery_asset_engagement_totals(organization_id);

comment on table public.delivery_engagement_totals is
  'Durable per-link engagement rollup. Survives retention pruning of the detailed session rows.';

-- ---------------------------------------------------------------------------
-- Row level security
--
-- The workspace reads its own. The recipient writes through the
-- security-definer function below and can read none of it -- not even their own
-- session, which is the photographer''s record rather than theirs.
-- ---------------------------------------------------------------------------

alter table public.delivery_view_sessions enable row level security;
alter table public.delivery_view_sessions force row level security;
alter table public.delivery_asset_views enable row level security;
alter table public.delivery_asset_views force row level security;
alter table public.delivery_engagement_totals enable row level security;
alter table public.delivery_engagement_totals force row level security;
alter table public.delivery_asset_engagement_totals enable row level security;
alter table public.delivery_asset_engagement_totals force row level security;

create policy delivery_view_sessions_select on public.delivery_view_sessions
  for select to authenticated using (private.is_org_member(organization_id));
create policy delivery_asset_views_select on public.delivery_asset_views
  for select to authenticated using (private.is_org_member(organization_id));
create policy delivery_engagement_totals_select on public.delivery_engagement_totals
  for select to authenticated using (private.is_org_member(organization_id));
create policy delivery_asset_engagement_totals_select on public.delivery_asset_engagement_totals
  for select to authenticated using (private.is_org_member(organization_id));

-- Read-only for everyone with a session. Writing is the definer function's job.
grant select on public.delivery_view_sessions to authenticated;
grant select on public.delivery_asset_views to authenticated;
grant select on public.delivery_engagement_totals to authenticated;
grant select on public.delivery_asset_engagement_totals to authenticated;

grant select, insert, update on public.delivery_view_sessions to service_role;
grant select, insert, update on public.delivery_asset_views to service_role;
grant select, insert, update on public.delivery_engagement_totals to service_role;
grant select, insert, update on public.delivery_asset_engagement_totals to service_role;

revoke all on public.delivery_view_sessions from anon;
revoke all on public.delivery_asset_views from anon;
revoke all on public.delivery_engagement_totals from anon;
revoke all on public.delivery_asset_engagement_totals from anon;

-- ---------------------------------------------------------------------------
-- A heartbeat
--
-- The one thing the delivery page may write. It takes a claim and returns what
-- was actually counted, which is usually less.
--
-- Three separate defences against an inflated number:
--
--   1. A ceiling. No single beat is worth more than 30 seconds however large
--      the claim.
--   2. The wall clock. A beat cannot count more time than has passed since the
--      previous beat, plus a small grace for scheduling jitter.
--   3. A sequence number. A beat at or below the highest already seen is a
--      replay -- the browser retried, or somebody is replaying the request --
--      and counts zero.
--
-- Between them, sending the same beat a thousand times adds the time once, and
-- claiming an hour in a ten-second beat adds ten seconds.
-- ---------------------------------------------------------------------------

create or replace function public.record_delivery_activity(
  delivery_token text,
  visitor_handle text,
  session_handle text,
  beat_sequence integer,
  claimed_visible_ms integer,
  asset_beats jsonb default '[]'::jsonb,
  caller_agent text default null
)
returns table (accepted_ms integer, session_active_ms bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  link record;
  v_key text;
  s_key text;
  session_row record;
  elapsed_ms bigint;
  granted integer;
  beat record;
  target_asset uuid;
  asset_ms integer;
  asset_started boolean;
  is_new_session boolean := false;
begin
  -- A handle has to look like one. This is not a credential -- it selects
  -- nothing on its own -- but a malformed one should not reach the hash.
  if visitor_handle is null or session_handle is null
     or visitor_handle !~ '^[A-Za-z0-9_-]{16,64}$'
     or session_handle !~ '^[A-Za-z0-9_-]{16,64}$' then
    return;
  end if;

  select d.id, d.organization_id, d.revoked_at, d.expires_at, d.submission_id
    into link
  from public.submission_deliveries d
  where d.token = delivery_token;

  -- Unknown, withdrawn, or out of date: the same silence the rest of this
  -- surface gives, and no row written for a token nobody holds.
  if not FOUND or link.revoked_at is not null or link.expires_at <= now() then
    return;
  end if;

  -- Scoped to the link by construction. The same browser on two links is two
  -- unrelated visitors, and neither key can be reversed into the handle.
  v_key := encode(sha256((link.id::text || ':v:' || visitor_handle)::bytea), 'hex');
  s_key := encode(sha256((link.id::text || ':s:' || session_handle)::bytea), 'hex');

  select * into session_row
  from public.delivery_view_sessions s
  where s.delivery_id = link.id and s.session_key = s_key;

  if not FOUND then
    insert into public.delivery_view_sessions
      (organization_id, delivery_id, visitor_key, session_key, user_agent_summary)
    values (link.organization_id, link.id, v_key, s_key, left(caller_agent, 80))
    returning * into session_row;
    is_new_session := true;

    insert into public.delivery_engagement_totals as t
      (delivery_id, organization_id, session_count, visitor_count,
       first_session_at, last_session_at)
    values (link.id, link.organization_id, 1, 1, now(), now())
    on conflict (delivery_id) do update
      set session_count = t.session_count + 1,
          -- A returning browser is not a new visitor.
          visitor_count = (
            select count(distinct s.visitor_key)::integer
            from public.delivery_view_sessions s
            where s.delivery_id = link.id
          ),
          last_session_at = now(),
          first_session_at = coalesce(t.first_session_at, now()),
          updated_at = now();
  end if;

  -- A session that has been closed, or one that went quiet for longer than any
  -- real tab would, counts nothing more. The browser starts a fresh session
  -- rather than resuming a stale one, so a slept device does not wake up owing
  -- itself an hour.
  if session_row.ended_at is not null then
    return query select 0, session_row.active_visible_ms;
    return;
  end if;

  elapsed_ms := (extract(epoch from (now() - session_row.last_seen_at)) * 1000)::bigint;

  if not is_new_session and elapsed_ms > private.delivery_session_idle_ms() then
    update public.delivery_view_sessions s
       set ended_at = s.last_seen_at
     where s.id = session_row.id;
    return query select 0, session_row.active_visible_ms;
    return;
  end if;

  -- Replay. The beat has been seen, or an older one has come back around.
  if beat_sequence is null or beat_sequence <= session_row.last_sequence then
    return query select 0, session_row.active_visible_ms;
    return;
  end if;

  granted := greatest(coalesce(claimed_visible_ms, 0), 0);
  granted := least(granted, private.delivery_beat_ceiling_ms());
  -- ...and never more time than has actually passed. 2s of grace for a timer
  -- that fired late. A brand-new session has no previous beat, so its first
  -- claim is bounded by the ceiling alone.
  if not is_new_session then
    granted := least(granted, greatest(elapsed_ms + 2000, 0))::integer;
  end if;

  update public.delivery_view_sessions s
     set active_visible_ms = s.active_visible_ms + granted,
         last_seen_at = now(),
         last_sequence = beat_sequence
   where s.id = session_row.id
  returning * into session_row;

  update public.delivery_engagement_totals t
     set active_visible_ms = t.active_visible_ms + granted,
         last_session_at = now(),
         updated_at = now()
   where t.delivery_id = link.id;

  -- ---------------------------------------------------------------------
  -- Per-frame time
  --
  -- Bounded by the session beat it arrived in: the frames on screen during a
  -- ten-second beat cannot between them have been visible for a minute. Each
  -- one is clamped individually, which is the honest reading when two frames
  -- are genuinely on screen at once.
  -- ---------------------------------------------------------------------
  if jsonb_typeof(asset_beats) = 'array' then
    for beat in select * from jsonb_array_elements(asset_beats) as value loop
      begin
        target_asset := (beat.value ->> 'asset_id')::uuid;
      exception when others then
        continue;
      end;
      if target_asset is null then continue; end if;

      -- The frame has to be in the package behind this link.
      if not exists (
        select 1
        from public.submissions sub
        join public.package_assets pa on pa.package_id = sub.package_id
        where sub.id = link.submission_id and pa.asset_id = target_asset
      ) then
        continue;
      end if;

      asset_ms := least(
        greatest(coalesce((beat.value ->> 'visible_ms')::integer, 0), 0),
        granted
      );
      asset_started := coalesce((beat.value ->> 'view_started')::boolean, false);

      insert into public.delivery_asset_views as av
        (organization_id, delivery_id, session_id, asset_id,
         active_visible_ms, view_count)
      values (link.organization_id, link.id, session_row.id, target_asset,
              asset_ms, 1)
      on conflict (session_id, asset_id) do update
        set active_visible_ms = av.active_visible_ms + asset_ms,
            last_visible_at = now(),
            view_count = av.view_count + case when asset_started then 1 else 0 end;

      insert into public.delivery_asset_engagement_totals as t
        (delivery_id, asset_id, organization_id, active_visible_ms, view_count,
         first_visible_at, last_visible_at)
      values (link.id, target_asset, link.organization_id, asset_ms, 1, now(), now())
      on conflict (delivery_id, asset_id) do update
        set active_visible_ms = t.active_visible_ms + asset_ms,
            view_count = t.view_count + case when asset_started then 1 else 0 end,
            last_visible_at = now(),
            first_visible_at = coalesce(t.first_visible_at, now());
    end loop;
  end if;

  return query select granted, session_row.active_visible_ms;
end;
$$;

comment on function public.record_delivery_activity(text, text, text, integer, integer, jsonb, text) is
  'One heartbeat from a recipient delivery page. The client proposes a duration; this decides, bounded by a ceiling, the wall clock, and a monotonic sequence.';

-- ---------------------------------------------------------------------------
-- Closing a session
--
-- Sent on pagehide, best-effort. A session that never gets one is closed by the
-- idle rule on the next beat, or simply stops being updated -- which is why
-- `ended_at` is nullable and nothing reads it as "still watching".
-- ---------------------------------------------------------------------------

create or replace function public.end_delivery_session(
  delivery_token text,
  session_handle text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  link record;
  s_key text;
begin
  if session_handle is null or session_handle !~ '^[A-Za-z0-9_-]{16,64}$' then
    return;
  end if;

  select d.id into link
  from public.submission_deliveries d
  where d.token = delivery_token
    and d.revoked_at is null
    and d.expires_at > now();

  if not FOUND then return; end if;

  s_key := encode(sha256((link.id::text || ':s:' || session_handle)::bytea), 'hex');

  update public.delivery_view_sessions s
     set ended_at = now()
   where s.delivery_id = link.id
     and s.session_key = s_key
     and s.ended_at is null;
end;
$$;

revoke all on function public.record_delivery_activity(text, text, text, integer, integer, jsonb, text) from public;
revoke all on function public.end_delivery_session(text, text) from public;
grant execute on function public.record_delivery_activity(text, text, text, integer, integer, jsonb, text) to anon, authenticated;
grant execute on function public.end_delivery_session(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention
--
-- Detailed session rows are the part worth forgetting. The rollups are not
-- personal -- they are counts and durations against a link -- so they stay, and
-- the photographer keeps "the New York desk spent four minutes across three
-- visits" long after the individual visits are gone.
--
-- Service role only, and it takes the window as an argument rather than baking
-- a period in, because how long to keep this is a policy decision and belongs
-- with whoever makes it.
-- ---------------------------------------------------------------------------

create or replace function public.prune_delivery_analytics(retain_days integer default 90)
returns table (sessions_removed integer, asset_views_removed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz;
  views_gone integer;
  sessions_gone integer;
begin
  if retain_days is null or retain_days < 1 then
    raise exception 'Retention must be at least one day.' using errcode = 'check_violation';
  end if;

  cutoff := now() - make_interval(days => retain_days);

  with removed as (
    delete from public.delivery_asset_views av
    using public.delivery_view_sessions s
    where av.session_id = s.id and s.started_at < cutoff
    returning av.id
  )
  select count(*)::integer into views_gone from removed;

  with removed as (
    delete from public.delivery_view_sessions s
    where s.started_at < cutoff
    returning s.id
  )
  select count(*)::integer into sessions_gone from removed;

  return query select sessions_gone, views_gone;
end;
$$;

revoke all on function public.prune_delivery_analytics(integer) from public;
revoke all on function public.prune_delivery_analytics(integer) from anon;
revoke all on function public.prune_delivery_analytics(integer) from authenticated;
grant execute on function public.prune_delivery_analytics(integer) to service_role;

comment on function public.prune_delivery_analytics(integer) is
  'Drop detailed viewing sessions past the retention window. The durable rollups are untouched, so totals survive and the individual visits do not.';

-- ---------------------------------------------------------------------------
-- Clearing analytics for the test suite, in the same shape as the other purges
-- ---------------------------------------------------------------------------

create or replace function public.purge_delivery_analytics()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.delivery_asset_views where id is not null;
  delete from public.delivery_view_sessions where id is not null;
  delete from public.delivery_asset_engagement_totals where delivery_id is not null;
  delete from public.delivery_engagement_totals where delivery_id is not null;
end;
$$;

revoke all on function public.purge_delivery_analytics() from public;
revoke all on function public.purge_delivery_analytics() from anon;
revoke all on function public.purge_delivery_analytics() from authenticated;
grant execute on function public.purge_delivery_analytics() to service_role;

-- The link purge has to take the analytics with it, or the next run starts with
-- rollups pointing at deliveries that no longer exist.
create or replace function public.purge_delivery_links()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('mastline.allow_purge', 'on', true);
  delete from public.delivery_asset_views where id is not null;
  delete from public.delivery_view_sessions where id is not null;
  delete from public.delivery_asset_engagement_totals where delivery_id is not null;
  delete from public.delivery_engagement_totals where delivery_id is not null;
  delete from public.delivery_access_events where id is not null;
  delete from public.submission_deliveries where id is not null;
  perform set_config('mastline.allow_purge', 'off', true);
end;
$$;

revoke all on function public.purge_delivery_links() from public;
revoke all on function public.purge_delivery_links() from anon;
revoke all on function public.purge_delivery_links() from authenticated;
grant execute on function public.purge_delivery_links() to service_role;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
