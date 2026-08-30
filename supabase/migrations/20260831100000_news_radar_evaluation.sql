-- News Radar: deterministic evaluation of both paths of a signal.
--
-- A story on the radar now has two standing questions asked of it by a
-- versioned, reproducible evaluator: which photographs the workspace already
-- owns look relevant, and why (archive_match); and whether the recorded facts
-- support a new shoot, and what still has to be confirmed (shoot_opportunity).
-- Nothing here involves a model, a vector, a feed, or a network call. The
-- evaluator is pure TypeScript over rows in this database; these tables hold
-- what it needs and what it concludes.
--
--   public.news_signal_context       the story's structured context, one row
--                                    per signal: location, event timing, and
--                                    the window, each with its provenance
--   public.news_signal_entities      the story's people, organizations, topics
--                                    and keywords, one row each, normalized
--   public.opportunity_evaluations   one row per path: evaluation state, which
--                                    evaluator ran, over which input, when, and
--                                    how it failed if it failed
--   public.opportunity_asset_matches ranked archive matches: one row per
--                                    (archive path, asset), with the score, its
--                                    breakdown and the human-readable reasons
--   public.opportunity_shoot_briefs  one typed brief per shoot path
--
-- VERSION
--
-- This file was created with `supabase migration new` and then renamed. The
-- immutable-dispatch branch (PR #16) carries 20260831090000 and must merge
-- first; this version is deliberately later so that no database, hosted or
-- local, can receive the two out of order -- the same coordination the
-- canonical-signal migration used against the import-queue chain.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No package, shoot, submission, buyer or delivery record is created or
-- referenced. Asset rows are never written: `assets.selected` in particular is
-- contact-sheet culling and has nothing to do with matching. No asset id is
-- stored in JSON anywhere; every relationship is a column with a foreign key.

-- ---------------------------------------------------------------------------
-- Normalization, shared by the uniqueness rule and the scorer
--
-- Lower case, trimmed, inner whitespace collapsed. The TypeScript evaluator
-- applies the same three steps, so "Avery  Hart " and "avery hart" are one
-- person on both sides. Immutable, so a generated column may use it.
-- ---------------------------------------------------------------------------

create or replace function private.news_radar_normalize(input text)
returns text
language sql immutable strict set search_path = '' as $$
  select lower(regexp_replace(btrim(input), '\s+', ' ', 'g'));
$$;

revoke all on function private.news_radar_normalize(text) from public;
grant execute on function private.news_radar_normalize(text) to authenticated;
grant execute on function private.news_radar_normalize(text) to service_role;

-- ---------------------------------------------------------------------------
-- Structured context on the canonical signal
--
-- Typed columns, one row per signal, optional. A headline-only story is still
-- a complete story; this row exists once somebody records more. Each fact
-- carries where it came from: typed by a person (manual), read from the
-- source (source), or suggested by the system and then accepted by a person
-- (system) -- in which case the basis and confidence that were shown at the
-- time are kept beside it.
-- ---------------------------------------------------------------------------

create table public.news_signal_context (
  news_signal_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,

  location_name text
    check (location_name is null or char_length(location_name) between 1 and 200),
  location_provenance text not null default 'manual'
    check (location_provenance in ('manual', 'source', 'system')),
  location_basis text check (location_basis is null or char_length(location_basis) <= 500),
  location_confidence numeric(3,2)
    check (location_confidence is null or location_confidence between 0 and 1),

  event_starts_at timestamptz,
  event_ends_at timestamptz,
  event_time_provenance text not null default 'manual'
    check (event_time_provenance in ('manual', 'source', 'system')),
  event_time_basis text
    check (event_time_basis is null or char_length(event_time_basis) <= 500),
  event_time_confidence numeric(3,2)
    check (event_time_confidence is null or event_time_confidence between 0 and 1),

  -- What the operator knows about the useful window that a timestamp cannot
  -- say: "public gallery, doors 6pm", "sentencing may slip a day".
  window_note text check (window_note is null or char_length(window_note) <= 500),

  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Organization consistency is the database's job, same as the paths.
  foreign key (news_signal_id, organization_id)
    references public.news_signals (id, organization_id) on delete cascade,

  constraint news_signal_context_event_order
    check (event_starts_at is null or event_ends_at is null or event_ends_at >= event_starts_at),
  -- A confidence never appears without its basis, and a system suggestion is
  -- never recorded without the reason it was shown.
  constraint news_signal_context_location_inference
    check (
      (location_confidence is null or location_basis is not null)
      and (location_provenance <> 'system' or location_name is null or location_basis is not null)
    ),
  constraint news_signal_context_event_time_inference
    check (
      (event_time_confidence is null or event_time_basis is not null)
      and (
        event_time_provenance <> 'system'
        or event_starts_at is null
        or event_time_basis is not null
      )
    )
);

create index news_signal_context_org_idx on public.news_signal_context (organization_id);
-- Covers the composite foreign key in its own column order, which the primary
-- key alone does not (the advisor lint 0001 reads it that way).
create index news_signal_context_signal_org_idx
  on public.news_signal_context (news_signal_id, organization_id);
create index news_signal_context_updated_by_idx
  on public.news_signal_context (updated_by) where updated_by is not null;

create trigger set_updated_at
  before update on public.news_signal_context
  for each row execute function private.set_updated_at();

create trigger enforce_workspace_writable
  before insert or update or delete on public.news_signal_context
  for each row execute function private.enforce_workspace_writable();

-- ---------------------------------------------------------------------------
-- Entities: people, organizations, topics, keywords
--
-- One row each, so the evaluator can compare them exactly and the interface
-- can show where each one came from. Unique per signal on the kind and the
-- normalized value, so a second spelling of the same name is refused rather
-- than counted twice.
-- ---------------------------------------------------------------------------

create table public.news_signal_entities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  news_signal_id uuid not null,
  entity_kind text not null check (entity_kind in ('person', 'organization', 'topic', 'keyword')),
  value text not null check (char_length(value) between 1 and 200),
  normalized_value text generated always as (private.news_radar_normalize(value)) stored,
  provenance text not null default 'manual' check (provenance in ('manual', 'source', 'system')),
  basis text check (basis is null or char_length(basis) <= 500),
  confidence numeric(3,2) check (confidence is null or confidence between 0 and 1),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  foreign key (news_signal_id, organization_id)
    references public.news_signals (id, organization_id) on delete cascade,
  unique (news_signal_id, entity_kind, normalized_value),
  constraint news_signal_entities_inference
    check ((confidence is null or basis is not null) and (provenance <> 'system' or basis is not null))
);

create index news_signal_entities_org_idx on public.news_signal_entities (organization_id);
create index news_signal_entities_signal_org_idx
  on public.news_signal_entities (news_signal_id, organization_id);
create index news_signal_entities_created_by_idx
  on public.news_signal_entities (created_by) where created_by is not null;

create trigger enforce_workspace_writable
  before insert or update or delete on public.news_signal_entities
  for each row execute function private.enforce_workspace_writable();

-- ---------------------------------------------------------------------------
-- The kind travels with the path's identity
--
-- Matches and briefs reference (id, organization_id, opportunity_kind) so
-- that the database, not the application, refuses archive matches on a shoot
-- path and a shoot brief on an archive path.
-- ---------------------------------------------------------------------------

alter table public.opportunities
  add constraint opportunities_id_org_kind_key unique (id, organization_id, opportunity_kind);

-- ---------------------------------------------------------------------------
-- Evaluation state, one row per path
--
-- Two registers on one row. The LATEST RUN: state, evaluator, input hash,
-- time, and the classified failure if it failed. The LATEST RESULT: the score
-- and explanation of the most recent run that produced one, stamped with its
-- own evaluator and input hash. A failed rerun updates the first register and
-- leaves the second -- and the match rows and brief that go with it -- exactly
-- as they were.
-- ---------------------------------------------------------------------------

create table public.opportunity_evaluations (
  opportunity_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_kind text not null
    check (opportunity_kind in ('archive_match', 'shoot_opportunity')),

  state text not null default 'not_evaluated'
    check (state in ('not_evaluated', 'evaluating', 'ready', 'needs_context', 'failed')),
  evaluator_version text
    check (evaluator_version is null or char_length(evaluator_version) between 1 and 40),
  input_hash text check (input_hash is null or input_hash ~ '^[a-f0-9]{64}$'),
  evaluated_at timestamptz,
  failure_code text check (failure_code is null or char_length(failure_code) between 1 and 64),

  score integer check (score is null or score between 0 and 100),
  explanation text check (explanation is null or char_length(explanation) <= 2000),
  result_state text check (result_state is null or result_state in ('ready', 'needs_context')),
  result_evaluator_version text,
  result_input_hash text check (result_input_hash is null or result_input_hash ~ '^[a-f0-9]{64}$'),
  result_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (opportunity_id, organization_id, opportunity_kind)
    references public.opportunities (id, organization_id, opportunity_kind) on delete cascade,

  -- A failure is always classified, and only a failure carries a code.
  constraint opportunity_evaluations_failure_classified
    check ((state = 'failed') = (failure_code is not null)),
  -- Anything that has run says what ran, over what, and when.
  constraint opportunity_evaluations_run_stamped
    check (
      state = 'not_evaluated'
      or (evaluator_version is not null and input_hash is not null and evaluated_at is not null)
    ),
  constraint opportunity_evaluations_unevaluated_is_blank
    check (state <> 'not_evaluated' or (evaluated_at is null and result_at is null)),
  -- A ready or needs_context state IS the latest result: the two registers agree.
  constraint opportunity_evaluations_result_is_current
    check (
      state not in ('ready', 'needs_context')
      or (
        result_state = state
        and result_input_hash = input_hash
        and result_evaluator_version = evaluator_version
        and result_at is not null
      )
    ),
  constraint opportunity_evaluations_result_stamped
    check (
      (result_at is null)
      = (result_state is null and result_evaluator_version is null and result_input_hash is null)
    )
);

create index opportunity_evaluations_org_state_idx
  on public.opportunity_evaluations (organization_id, state);
create index opportunity_evaluations_path_idx
  on public.opportunity_evaluations (opportunity_id, organization_id, opportunity_kind);

create trigger set_updated_at
  before update on public.opportunity_evaluations
  for each row execute function private.set_updated_at();

create trigger enforce_workspace_writable
  before insert or update or delete on public.opportunity_evaluations
  for each row execute function private.enforce_workspace_writable();

-- ---------------------------------------------------------------------------
-- Archive matches
--
-- One row per (archive path, asset). The kind is part of the foreign key and
-- pinned by a check, so this table can only ever point at an archive path.
-- The asset foreign key is composite on the organization, so a match can
-- never reach across workspaces however it is written.
-- ---------------------------------------------------------------------------

create table public.opportunity_asset_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null,
  opportunity_kind text not null default 'archive_match'
    check (opportunity_kind = 'archive_match'),
  asset_id uuid not null,
  score integer not null check (score between 0 and 100),
  rank integer not null check (rank >= 1),
  -- Human-readable, one sentence each: what the asset shares with the story.
  reasons text[] not null check (cardinality(reasons) >= 1),
  -- The documented components that sum to the score. Numbers only; no ids.
  score_breakdown jsonb not null default '{}'::jsonb,
  evaluator_version text not null check (char_length(evaluator_version) between 1 and 40),
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  foreign key (opportunity_id, organization_id, opportunity_kind)
    references public.opportunities (id, organization_id, opportunity_kind) on delete cascade,
  foreign key (organization_id, asset_id)
    references public.assets (organization_id, id) on delete cascade,
  unique (opportunity_id, asset_id),
  unique (opportunity_id, rank)
);

-- (opportunity_id, rank) is the read order; the path and asset foreign keys
-- each get a covering index in their own column order.
create index opportunity_asset_matches_path_idx
  on public.opportunity_asset_matches (opportunity_id, organization_id, opportunity_kind);
create index opportunity_asset_matches_org_asset_idx
  on public.opportunity_asset_matches (organization_id, asset_id);

create trigger enforce_workspace_writable
  before insert or update or delete on public.opportunity_asset_matches
  for each row execute function private.enforce_workspace_writable();

-- ---------------------------------------------------------------------------
-- Shoot briefs
--
-- One typed brief per shoot path: what is known, what the evaluator suggests
-- (always labelled as a suggestion by the interface), and what a person still
-- has to confirm. Typed columns, so the interface and the tests can read each
-- part by name. Nothing here is a fact the evaluator invented: every value is
-- copied from the stored context or derived from it by a documented rule.
-- ---------------------------------------------------------------------------

create table public.opportunity_shoot_briefs (
  opportunity_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_kind text not null default 'shoot_opportunity'
    check (opportunity_kind = 'shoot_opportunity'),

  readiness text not null check (readiness in ('ready', 'needs_context')),
  readiness_score integer not null check (readiness_score between 0 and 100),
  why_now text[] not null default '{}',
  known_people text[] not null default '{}',
  known_organizations text[] not null default '{}',
  known_location text,
  event_starts_at timestamptz,
  event_ends_at timestamptz,
  window_state text not null check (window_state in ('open', 'closing', 'closed', 'unknown')),
  window_closes_at timestamptz,
  geographic_relevance text not null,
  -- Null when the workspace has recorded no specialties: relevance to a
  -- preference that does not exist is not reported as anything.
  specialty_relevance text,
  suggested_angle text,
  suggested_shots text[] not null default '{}',
  missing_confirmations text[] not null default '{}',
  score_breakdown jsonb not null default '{}'::jsonb,
  evaluator_version text not null check (char_length(evaluator_version) between 1 and 40),
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (opportunity_id, organization_id, opportunity_kind)
    references public.opportunities (id, organization_id, opportunity_kind) on delete cascade,
  -- needs_context always says what is missing.
  constraint opportunity_shoot_briefs_needs_context_lists_gaps
    check (readiness <> 'needs_context' or cardinality(missing_confirmations) >= 1)
);

create index opportunity_shoot_briefs_org_idx on public.opportunity_shoot_briefs (organization_id);
create index opportunity_shoot_briefs_path_idx
  on public.opportunity_shoot_briefs (opportunity_id, organization_id, opportunity_kind);

create trigger set_updated_at
  before update on public.opportunity_shoot_briefs
  for each row execute function private.set_updated_at();

create trigger enforce_workspace_writable
  before insert or update or delete on public.opportunity_shoot_briefs
  for each row execute function private.enforce_workspace_writable();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Same shape as the rest of the schema: every active member reads, owner and
-- editor write, both halves of every write policy stated, authorship pinned
-- to the caller where a row records one. Forced, so the table owner is bound
-- too.
-- ---------------------------------------------------------------------------

alter table public.news_signal_context enable row level security;
alter table public.news_signal_context force row level security;
alter table public.news_signal_entities enable row level security;
alter table public.news_signal_entities force row level security;
alter table public.opportunity_evaluations enable row level security;
alter table public.opportunity_evaluations force row level security;
alter table public.opportunity_asset_matches enable row level security;
alter table public.opportunity_asset_matches force row level security;
alter table public.opportunity_shoot_briefs enable row level security;
alter table public.opportunity_shoot_briefs force row level security;

-- Context ------------------------------------------------------------------

create policy news_signal_context_select on public.news_signal_context
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy news_signal_context_insert on public.news_signal_context
  for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner','editor']::public.app_role[])
    and updated_by = (select auth.uid())
  );

create policy news_signal_context_update on public.news_signal_context
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]))
  with check (
    private.has_org_role(organization_id, array['owner','editor']::public.app_role[])
    and updated_by = (select auth.uid())
  );

create policy news_signal_context_delete on public.news_signal_context
  for delete to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

-- Entities -----------------------------------------------------------------

create policy news_signal_entities_select on public.news_signal_entities
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy news_signal_entities_insert on public.news_signal_entities
  for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner','editor']::public.app_role[])
    and created_by = (select auth.uid())
  );

-- An entity is removed and re-entered, never edited in place: there is no
-- update policy and no update grant.
create policy news_signal_entities_delete on public.news_signal_entities
  for delete to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

-- Evaluations, matches, briefs ---------------------------------------------
--
-- Written by the evaluator running as the caller (SECURITY INVOKER below), so
-- the owner-and-editor rule is the same one that governs entering a story.
-- One policy per command rather than a `for all` write policy: a second
-- permissive policy on SELECT would run for every read (advisor lint 0006).

create policy opportunity_evaluations_select on public.opportunity_evaluations
  for select to authenticated
  using (private.is_org_member(organization_id));
create policy opportunity_evaluations_insert on public.opportunity_evaluations
  for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));
create policy opportunity_evaluations_update on public.opportunity_evaluations
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));
create policy opportunity_evaluations_delete on public.opportunity_evaluations
  for delete to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

create policy opportunity_asset_matches_select on public.opportunity_asset_matches
  for select to authenticated
  using (private.is_org_member(organization_id));
create policy opportunity_asset_matches_insert on public.opportunity_asset_matches
  for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));
create policy opportunity_asset_matches_delete on public.opportunity_asset_matches
  for delete to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

create policy opportunity_shoot_briefs_select on public.opportunity_shoot_briefs
  for select to authenticated
  using (private.is_org_member(organization_id));
create policy opportunity_shoot_briefs_insert on public.opportunity_shoot_briefs
  for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));
create policy opportunity_shoot_briefs_update on public.opportunity_shoot_briefs
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));
create policy opportunity_shoot_briefs_delete on public.opportunity_shoot_briefs
  for delete to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

-- ---------------------------------------------------------------------------
-- Grants, stated exhaustively
--
-- The platform's default privileges on a new table have flipped between
-- nothing and everything across image versions, and since 2026-04 a new
-- table is not exposed to the Data API at all unless granted. Revoke first,
-- then grant exactly the surface each table offers. Column-scoped where a
-- client may correct facts but never rewrite identity.
-- ---------------------------------------------------------------------------

revoke all on public.news_signal_context from authenticated, anon;
revoke all on public.news_signal_entities from authenticated, anon;
revoke all on public.opportunity_evaluations from authenticated, anon;
revoke all on public.opportunity_asset_matches from authenticated, anon;
revoke all on public.opportunity_shoot_briefs from authenticated, anon;

grant select, insert, delete on public.news_signal_context to authenticated;
grant update (
  location_name, location_provenance, location_basis, location_confidence,
  event_starts_at, event_ends_at, event_time_provenance, event_time_basis, event_time_confidence,
  window_note, updated_by
) on public.news_signal_context to authenticated;

grant select, insert, delete on public.news_signal_entities to authenticated;

grant select, insert, delete on public.opportunity_evaluations to authenticated;
grant update (
  state, evaluator_version, input_hash, evaluated_at, failure_code,
  score, explanation, result_state, result_evaluator_version, result_input_hash, result_at
) on public.opportunity_evaluations to authenticated;

grant select, insert, delete on public.opportunity_asset_matches to authenticated;

grant select, insert, delete on public.opportunity_shoot_briefs to authenticated;
grant update (
  readiness, readiness_score, why_now, known_people, known_organizations, known_location,
  event_starts_at, event_ends_at, window_state, window_closes_at, geographic_relevance,
  specialty_relevance, suggested_angle, suggested_shots, missing_confirmations,
  score_breakdown, evaluator_version, evaluated_at
) on public.opportunity_shoot_briefs to authenticated;

-- service_role holds what trusted server paths and fixtures need, per the
-- standing rule from 20260825170000: same table privileges, RLS bypassed.
grant select, insert, update, delete on public.news_signal_context to service_role;
grant select, insert, update, delete on public.news_signal_entities to service_role;
grant select, insert, update, delete on public.opportunity_evaluations to service_role;
grant select, insert, update, delete on public.opportunity_asset_matches to service_role;
grant select, insert, update, delete on public.opportunity_shoot_briefs to service_role;

-- ---------------------------------------------------------------------------
-- Recording a result, atomically
--
-- The evaluator runs in the application and hands its result here in one
-- call. SECURITY INVOKER: every write runs as the caller, so membership, role,
-- the read-only trial trigger, and every check and foreign key above apply
-- exactly as they would to direct table writes. The function adds three
-- things: atomicity (the old matches are replaced by the new ones or not at
-- all), the kind rule (a result of the wrong shape for the path is refused
-- before anything is written), and a classified answer with no database text
-- in it.
--
-- `result` is transport, not storage: its contents land in typed columns and
-- the asset ids in it are resolved through the composite foreign key. A
-- failure inside the block rolls back the block, and the evaluation row is
-- then marked failed OUTSIDE it, so the previous result rows survive and the
-- failure is on the record.
-- ---------------------------------------------------------------------------

create or replace function public.record_opportunity_evaluation(
  target_opportunity uuid,
  evaluator text,
  input_digest text,
  outcome text,
  result jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  path record;
  failure text;
  match jsonb;
  written integer := 0;
  brief jsonb;
  ran_at timestamptz := now();
begin
  -- Read as the caller: a path in another workspace does not exist here.
  select o.id, o.organization_id, o.opportunity_kind
    into path
  from public.opportunities o
  where o.id = target_opportunity;
  if path.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if outcome not in ('ready', 'needs_context') then
    return jsonb_build_object('outcome', 'invalid_result');
  end if;
  if input_digest !~ '^[a-f0-9]{64}$'
     or coalesce(char_length(evaluator), 0) not between 1 and 40 then
    return jsonb_build_object('outcome', 'invalid_result');
  end if;

  -- Idempotent: the same evaluator over the same input has nothing to add.
  -- Answered before any write, so a repeat creates no rows and no event. The
  -- application makes the same check before marking a path `evaluating`; a
  -- path that IS marked evaluating has been deliberately re-run and is written.
  if exists (
    select 1 from public.opportunity_evaluations e
    where e.opportunity_id = path.id
      and e.state in ('ready', 'needs_context')
      and e.result_state = outcome
      and e.result_evaluator_version = evaluator
      and e.result_input_hash = input_digest
  ) then
    return jsonb_build_object('outcome', 'unchanged');
  end if;

  begin
    if path.opportunity_kind = 'archive_match' then
      if jsonb_typeof(result -> 'matches') <> 'array' or result ? 'brief' then
        raise exception 'shape' using errcode = 'check_violation';
      end if;

      delete from public.opportunity_asset_matches m where m.opportunity_id = path.id;

      for match in select * from jsonb_array_elements(result -> 'matches') loop
        insert into public.opportunity_asset_matches
          (organization_id, opportunity_id, opportunity_kind, asset_id, score, rank,
           reasons, score_breakdown, evaluator_version, evaluated_at)
        values
          (path.organization_id, path.id, 'archive_match', (match ->> 'asset_id')::uuid,
           (match ->> 'score')::integer, (match ->> 'rank')::integer,
           (select coalesce(array_agg(r), '{}'::text[])
              from jsonb_array_elements_text(match -> 'reasons') r),
           coalesce(match -> 'breakdown', '{}'::jsonb), evaluator, ran_at);
        written := written + 1;
      end loop;

    elsif path.opportunity_kind = 'shoot_opportunity' then
      brief := result -> 'brief';
      if jsonb_typeof(brief) <> 'object' or result ? 'matches' then
        raise exception 'shape' using errcode = 'check_violation';
      end if;

      insert into public.opportunity_shoot_briefs
        (opportunity_id, organization_id, opportunity_kind, readiness, readiness_score,
         why_now, known_people, known_organizations, known_location,
         event_starts_at, event_ends_at, window_state, window_closes_at,
         geographic_relevance, specialty_relevance, suggested_angle, suggested_shots,
         missing_confirmations, score_breakdown, evaluator_version, evaluated_at)
      values
        (path.id, path.organization_id, 'shoot_opportunity', outcome,
         (brief ->> 'readiness_score')::integer,
         (select coalesce(array_agg(x), '{}'::text[])
            from jsonb_array_elements_text(brief -> 'why_now') x),
         (select coalesce(array_agg(x), '{}'::text[])
            from jsonb_array_elements_text(brief -> 'known_people') x),
         (select coalesce(array_agg(x), '{}'::text[])
            from jsonb_array_elements_text(brief -> 'known_organizations') x),
         brief ->> 'known_location',
         (brief ->> 'event_starts_at')::timestamptz,
         (brief ->> 'event_ends_at')::timestamptz,
         brief ->> 'window_state',
         (brief ->> 'window_closes_at')::timestamptz,
         brief ->> 'geographic_relevance',
         brief ->> 'specialty_relevance',
         brief ->> 'suggested_angle',
         (select coalesce(array_agg(x), '{}'::text[])
            from jsonb_array_elements_text(brief -> 'suggested_shots') x),
         (select coalesce(array_agg(x), '{}'::text[])
            from jsonb_array_elements_text(brief -> 'missing_confirmations') x),
         coalesce(brief -> 'breakdown', '{}'::jsonb), evaluator, ran_at)
      on conflict (opportunity_id) do update set
        readiness = excluded.readiness,
        readiness_score = excluded.readiness_score,
        why_now = excluded.why_now,
        known_people = excluded.known_people,
        known_organizations = excluded.known_organizations,
        known_location = excluded.known_location,
        event_starts_at = excluded.event_starts_at,
        event_ends_at = excluded.event_ends_at,
        window_state = excluded.window_state,
        window_closes_at = excluded.window_closes_at,
        geographic_relevance = excluded.geographic_relevance,
        specialty_relevance = excluded.specialty_relevance,
        suggested_angle = excluded.suggested_angle,
        suggested_shots = excluded.suggested_shots,
        missing_confirmations = excluded.missing_confirmations,
        score_breakdown = excluded.score_breakdown,
        evaluator_version = excluded.evaluator_version,
        evaluated_at = excluded.evaluated_at;
      written := 1;
    else
      raise exception 'kind' using errcode = 'check_violation';
    end if;

    insert into public.opportunity_evaluations
      (opportunity_id, organization_id, opportunity_kind, state, evaluator_version, input_hash,
       evaluated_at, failure_code, score, explanation,
       result_state, result_evaluator_version, result_input_hash, result_at)
    values
      (path.id, path.organization_id, path.opportunity_kind, outcome, evaluator, input_digest,
       ran_at, null, (result ->> 'score')::integer, result ->> 'explanation',
       outcome, evaluator, input_digest, ran_at)
    on conflict (opportunity_id) do update set
      state = excluded.state,
      evaluator_version = excluded.evaluator_version,
      input_hash = excluded.input_hash,
      evaluated_at = excluded.evaluated_at,
      failure_code = null,
      score = excluded.score,
      explanation = excluded.explanation,
      result_state = excluded.result_state,
      result_evaluator_version = excluded.result_evaluator_version,
      result_input_hash = excluded.result_input_hash,
      result_at = excluded.result_at;
  exception
    when insufficient_privilege then failure := 'denied';
    when foreign_key_violation then failure := 'asset_not_in_workspace';
    when check_violation then failure := 'invalid_result';
    when unique_violation then failure := 'invalid_result';
    when others then failure := 'write_failed';
  end;

  if failure is not null then
    -- The block rolled back: the previous matches, brief, and result register
    -- are untouched. Only the run register records the failure.
    insert into public.opportunity_evaluations
      (opportunity_id, organization_id, opportunity_kind, state, evaluator_version, input_hash,
       evaluated_at, failure_code)
    values
      (path.id, path.organization_id, path.opportunity_kind, 'failed', evaluator, input_digest,
       ran_at, failure)
    on conflict (opportunity_id) do update set
      state = 'failed',
      evaluator_version = excluded.evaluator_version,
      input_hash = excluded.input_hash,
      evaluated_at = excluded.evaluated_at,
      failure_code = excluded.failure_code;
    return jsonb_build_object('outcome', 'failed', 'failure_code', failure);
  end if;

  return jsonb_build_object('outcome', 'recorded', 'written', written, 'evaluated_at', ran_at);
end;
$$;

revoke all on function public.record_opportunity_evaluation(uuid, text, text, text, jsonb) from public;
revoke all on function public.record_opportunity_evaluation(uuid, text, text, text, jsonb) from anon;
grant execute on function public.record_opportunity_evaluation(uuid, text, text, text, jsonb) to authenticated;

-- Unchanged, and repeated so a later default cannot quietly reopen it.
revoke all on all tables in schema public from anon;
