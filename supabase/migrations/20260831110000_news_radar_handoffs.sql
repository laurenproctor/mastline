-- News Radar: deterministic evaluations become controlled photographer actions.
--
-- An evaluated archive path can now become ONE draft package holding the
-- photographs a person selected from its recorded matches; an evaluated shoot
-- path can become ONE draft shoot carrying only the facts a person confirmed.
-- Nothing here approves, sends, prices, licenses, or contacts anyone: the
-- package lands where every package lands (the dispatch review, unapproved,
-- with no buyer, no submission, no snapshot, no link) and the shoot lands as
-- a private draft, exactly as the Create Shoot screen would leave it.
--
--   public.opportunity_handoffs     append-only provenance: which path, which
--                                   signal, which evaluation (version + input
--                                   hash), what was created, by whom, when,
--                                   under which idempotency key
--   public.handoff_archive_package  the archive handoff, one transaction
--   public.handoff_shoot_draft      the shoot handoff, one transaction
--
-- VERSION
--
-- Created with `supabase migration new` (stamped 20260830181638) and renamed
-- so it sorts after 20260831100000_news_radar_evaluation, which it depends on
-- -- the same coordination the two earlier radar migrations used. No database
-- can receive this before the evaluation tables it references.
--
-- WHY A FUNCTION, AND WHY INVOKER
--
-- A handoff is several writes that must land together or not at all: the
-- package and its frames (or the shoot), the provenance row, the path's
-- decision, and the events. The Data API offers no client transaction, so the
-- function is the only atomic boundary there is. SECURITY INVOKER keeps every
-- write under the caller's own row level security: membership, the
-- owner-and-editor rule, pinned authorship on the events, the read-only trial
-- trigger. The function adds atomicity, the kind rule, the evaluation
-- identity check, the idempotent answer, and a classified result with no
-- database text in it. Nothing in it could be done by a caller who could not
-- do it with direct table writes.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No approval, submission, snapshot, recipient, delivery link, buyer, license,
-- price, or message. No write to assets (`selected` is contact-sheet culling
-- and stays untouched). No mutation of the evaluation, the matches, or the
-- brief: the handoff reads them and records which version it read.

-- ---------------------------------------------------------------------------
-- Composite target for the shoot foreign key
--
-- packages and assets gained (organization_id, id) in 20260828090000; shoots
-- did not, and a provenance row must not be able to point at a shoot in
-- another workspace however it is written.
-- ---------------------------------------------------------------------------

alter table public.shoots
  add constraint shoots_org_id_key unique (organization_id, id);

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------

create table public.opportunity_handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null,
  opportunity_kind text not null
    check (opportunity_kind in ('archive_match', 'shoot_opportunity')),
  news_signal_id uuid not null,
  action_type text not null check (action_type in ('package_draft', 'shoot_draft')),
  -- The evaluation the person was looking at when they confirmed.
  evaluator_version text not null check (char_length(evaluator_version) between 1 and 40),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  -- Exactly one of these, matching the action.
  package_id uuid,
  shoot_id uuid,
  -- What was confirmed, as it was confirmed: selected frames in order for a
  -- package; the confirmed fields and which suggestions were copied into the
  -- notes for a shoot. Ids of the frames only ever appear here as a record of
  -- the selection; the relationship itself is package_assets.
  details jsonb not null default '{}'::jsonb,
  -- The confirmation form's own key. A retry, a double click, or a re-posted
  -- form carries the same one and is answered with what the first made.
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),

  foreign key (opportunity_id, organization_id, opportunity_kind)
    references public.opportunities (id, organization_id, opportunity_kind) on delete cascade,
  foreign key (news_signal_id, organization_id)
    references public.news_signals (id, organization_id) on delete cascade,
  -- RESTRICT, not cascade: this row is append-only provenance, and a cascade
  -- would let deleting the package or shoot silently erase it -- and, through
  -- the unique below, quietly reopen the path for a second handoff. Whoever
  -- removes the result must remove the provenance first, deliberately: the
  -- service role holds the delete grant (cleanup and the audited purge
  -- routines), and deleting the news signal or the opportunity still cascades
  -- the whole story away. `purge_package_admin` does not delete handoff rows
  -- itself; a purge of a handoff-made package deletes this row first.
  -- Application delete paths do not collide: the only hard package delete in
  -- the application (createPackageFromSelection's member-insert failure path,
  -- src/lib/data/packages.ts) can only ever delete a package it just created
  -- outside any handoff, and a handoff-made package is committed in the same
  -- transaction as its handoff row, so no handoff row can exist for a package
  -- that path deletes.
  foreign key (organization_id, package_id)
    references public.packages (organization_id, id) on delete restrict,
  foreign key (organization_id, shoot_id)
    references public.shoots (organization_id, id) on delete restrict,

  -- The kind decides the action: an archive path makes packages, a shoot path
  -- makes shoots, and the database refuses the other way round.
  constraint opportunity_handoffs_action_matches_kind
    check (
      (opportunity_kind = 'archive_match' and action_type = 'package_draft')
      or (opportunity_kind = 'shoot_opportunity' and action_type = 'shoot_draft')
    ),
  constraint opportunity_handoffs_one_result
    check (
      (action_type = 'package_draft' and package_id is not null and shoot_id is null)
      or (action_type = 'shoot_draft' and shoot_id is not null and package_id is null)
    ),
  -- One handoff per path. The package or shoot it made is authoritative from
  -- then on; a second request on the same path is answered with the first.
  -- Named, because the handoff functions catch unique_violation by exactly
  -- these two names and rethrow every other one.
  constraint opportunity_handoffs_one_per_path unique (opportunity_id),
  -- And one per request key, so a repeat is a repeat whichever path it names.
  constraint opportunity_handoffs_one_per_request unique (organization_id, request_key)
);

-- Every foreign key covered in its own column order (advisor lint 0001).
create index opportunity_handoffs_org_idx on public.opportunity_handoffs (organization_id);
create index opportunity_handoffs_path_idx
  on public.opportunity_handoffs (opportunity_id, organization_id, opportunity_kind);
create index opportunity_handoffs_signal_idx
  on public.opportunity_handoffs (news_signal_id, organization_id);
create index opportunity_handoffs_package_idx
  on public.opportunity_handoffs (organization_id, package_id) where package_id is not null;
create index opportunity_handoffs_shoot_idx
  on public.opportunity_handoffs (organization_id, shoot_id) where shoot_id is not null;
create index opportunity_handoffs_created_by_idx on public.opportunity_handoffs (created_by);

-- A lapsed trial can read its radar but not act on it.
create trigger enforce_workspace_writable
  before insert or update or delete on public.opportunity_handoffs
  for each row execute function private.enforce_workspace_writable();

-- Provenance is written once. No client holds an update grant (see below), no
-- policy permits one, and this trigger says so to the service role as well,
-- whose bypass of row level security does not bypass triggers.
create or replace function private.opportunity_handoffs_are_immutable()
returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'opportunity_handoffs is append-only; a handoff is not rewritten'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function private.opportunity_handoffs_are_immutable() from public;

create trigger opportunity_handoffs_immutable
  before update on public.opportunity_handoffs
  for each row execute function private.opportunity_handoffs_are_immutable();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Members read; owner and editor insert, and only as themselves. No update or
-- delete policy: the row is history. The service role deletes for cleanup
-- only (test fixtures, the audited purge routines), bypassing RLS by design.
-- ---------------------------------------------------------------------------

alter table public.opportunity_handoffs enable row level security;
alter table public.opportunity_handoffs force row level security;

create policy opportunity_handoffs_select on public.opportunity_handoffs
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy opportunity_handoffs_insert on public.opportunity_handoffs
  for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner','editor']::public.app_role[])
    and created_by = (select auth.uid())
  );

revoke all on public.opportunity_handoffs from authenticated, anon;
grant select, insert on public.opportunity_handoffs to authenticated;
grant select, insert, delete on public.opportunity_handoffs to service_role;

-- ---------------------------------------------------------------------------
-- Shared preamble: the path, locked, with the caller's standing on it
--
-- Every check that can refuse a handoff without writing anything happens
-- before the writes, in this order: the path exists for the caller (row level
-- security answers "elsewhere" with "nowhere"); the caller may act; the path
-- is of the kind the action needs; a handoff already made is answered with;
-- the path is still open; the evaluation the person confirmed against is the
-- one on record. The row lock serializes two simultaneous confirmations of
-- the same path, so the second one reads the first one's handoff and answers
-- `existing` instead of racing it.
--
-- Returns a refusal ({"outcome": ...}) or {"ok": true, "path": {...}}.
-- ---------------------------------------------------------------------------

-- The answer for a path that has already been handed off, or null when it
-- has not been. Shared by the preamble and by the functions' unique_violation
-- handlers, so a repeat is answered identically wherever it is noticed.
--
-- For a package handoff the answer carries the PACKAGE's shoot -- the
-- provenance row's own shoot_id is null for a package handoff (see
-- opportunity_handoffs_one_result), and the dispatch review is addressed by
-- shoot and package, so an `existing` answer without the shoot would leave
-- the person no way to continue. It also carries the package's live frame
-- count, so a repeat answered as the creation it was can say how many
-- photographs the draft holds.
--
-- A row found by request key alone -- the same key reused on a DIFFERENT
-- path -- is NOT that path's handoff, and answering `existing` with it would
-- hand the person another path's package. That is a key that identifies the
-- wrong confirmation: refused as such, and a reload issues a fresh key.
create or replace function private.handoff_existing_answer(
  path_id uuid,
  target_org uuid,
  request_key text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  existing record;
begin
  select h.id, h.opportunity_id, h.package_id, h.shoot_id, h.request_key,
         p.shoot_id as package_shoot_id,
         case when h.package_id is null then null else
           (select count(*)::int from public.package_assets pa where pa.package_id = h.package_id)
         end as frame_count
    into existing
  from public.opportunity_handoffs h
  left join public.packages p
    on p.organization_id = h.organization_id and p.id = h.package_id
  where h.opportunity_id = handoff_existing_answer.path_id
     or (h.organization_id = target_org
         and h.request_key = handoff_existing_answer.request_key)
  order by (h.opportunity_id = handoff_existing_answer.path_id) desc
  limit 1;
  if existing.id is null then
    return null;
  end if;
  if existing.opportunity_id <> handoff_existing_answer.path_id then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'request_key');
  end if;
  return jsonb_build_object(
    'outcome', 'existing',
    'handoff_id', existing.id,
    'package_id', existing.package_id,
    'shoot_id', coalesce(existing.shoot_id, existing.package_shoot_id),
    'frame_count', existing.frame_count,
    'same_request', existing.request_key = handoff_existing_answer.request_key);
end;
$$;

revoke all on function private.handoff_existing_answer(uuid, uuid, text) from public;
grant execute on function private.handoff_existing_answer(uuid, uuid, text) to authenticated;

create or replace function private.handoff_preamble(
  target_opportunity uuid,
  wanted_kind text,
  evaluator text,
  input_digest text,
  request_key text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  path record;
  existing jsonb;
  evaluation record;
begin
  if actor is null then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if request_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'request_key');
  end if;

  -- Read as the caller: a path in another workspace does not exist here.
  -- Read WITHOUT the lock first -- a row lock is governed by the update
  -- policy, under which a viewer sees no row at all, and a member who may not
  -- act deserves "forbidden" rather than "not found".
  select o.id, o.organization_id, o.opportunity_kind, o.news_signal_id, o.status
    into path
  from public.opportunities o
  where o.id = target_opportunity;
  if path.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if not private.has_org_role(path.organization_id, array['owner','editor']::public.app_role[]) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if path.opportunity_kind <> wanted_kind then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Now locked for the rest of the transaction, and re-read under the lock
  -- so the status and the handoff check below see what the lock holder left.
  select o.id, o.organization_id, o.opportunity_kind, o.news_signal_id, o.status
    into path
  from public.opportunities o
  where o.id = target_opportunity
  for update;
  if path.id is null then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  -- A repeat -- the same key, or any second confirmation on a path that has
  -- already been handed off -- is answered with the record as it stands; a
  -- key reused from another path is refused (see handoff_existing_answer).
  existing := private.handoff_existing_answer(
    path.id, path.organization_id, handoff_preamble.request_key);
  if existing is not null then
    return existing;
  end if;

  if path.status in ('acted', 'dismissed', 'expired') then
    return jsonb_build_object('outcome', 'path_closed', 'status', path.status);
  end if;

  select e.state, e.result_state, e.result_evaluator_version, e.result_input_hash
    into evaluation
  from public.opportunity_evaluations e
  where e.opportunity_id = path.id;
  if evaluation.result_state is null then
    return jsonb_build_object('outcome', 'needs_context',
      'state', coalesce(evaluation.state, 'not_evaluated'));
  end if;
  -- The identity the person confirmed against must be the identity on
  -- record. A re-evaluation in between -- new inputs, or a new evaluator --
  -- means they confirmed something that is no longer what is there.
  if evaluation.result_evaluator_version is distinct from evaluator
     or evaluation.result_input_hash is distinct from input_digest then
    return jsonb_build_object(
      'outcome', 'stale_evaluation',
      'current_evaluator_version', evaluation.result_evaluator_version,
      'current_input_hash', evaluation.result_input_hash);
  end if;
  if evaluation.result_state = 'needs_context' and wanted_kind = 'archive_match' then
    -- An archive result that needed context has no matches to select from.
    return jsonb_build_object('outcome', 'needs_context', 'state', evaluation.result_state);
  end if;

  return jsonb_build_object('ok', true, 'path', jsonb_build_object(
    'id', path.id,
    'organization_id', path.organization_id,
    'opportunity_kind', path.opportunity_kind,
    'news_signal_id', path.news_signal_id,
    'status', path.status));
end;
$$;

revoke all on function private.handoff_preamble(uuid, text, text, text, text) from public;
grant execute on function private.handoff_preamble(uuid, text, text, text, text) to authenticated;

-- Marks the path acted and writes its decision event -- the same row change
-- and the same event shape the radar's own decision path writes, so the
-- history reads identically whether a person pressed "acted" or handed off.
create or replace function private.handoff_close_path(
  path_id uuid,
  target_org uuid,
  path_kind text,
  signal_id uuid,
  previous_status text,
  handoff_id uuid,
  action_type text,
  created_id uuid
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  kind_label text := case path_kind when 'archive_match' then 'archive path' else 'shoot path' end;
begin
  update public.opportunities o
  set status = 'acted', acted_at = now(), dismissal_reason = null
  where o.id = path_id;
  if not found then
    raise exception 'path not updatable' using errcode = 'insufficient_privilege';
  end if;

  insert into public.activity_events
    (organization_id, actor_id, entity_type, entity_id, action, event_data)
  values
    (target_org, actor, 'opportunity', path_id, 'opportunity.acted',
     jsonb_build_object(
       'summary', case action_type
         when 'package_draft' then 'Draft package created from the archive matches (' || kind_label || ')'
         else 'Draft shoot created from the confirmed brief (' || kind_label || ')' end,
       'newsSignalId', signal_id,
       'kind', path_kind,
       'previousStatus', previous_status,
       'status', 'acted',
       'reasonRecorded', false,
       'handoffId', handoff_id,
       'actionType', action_type,
       case action_type when 'package_draft' then 'packageId' else 'shootId' end, created_id));
end;
$$;

revoke all on function private.handoff_close_path(uuid, uuid, text, uuid, text, uuid, text, uuid) from public;
grant execute on function private.handoff_close_path(uuid, uuid, text, uuid, text, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The archive handoff
--
-- The person selected frames from the recorded matches; this makes one draft
-- package of exactly those, the way the dispatch screen's own builder would:
-- one packages row in `draft`, one package_assets row per frame naming the
-- delivery version where one exists and the original otherwise, positions in
-- canonical filename order, then `needs_review` -- unapproved, no buyer, no
-- terms, nothing sent. A package belongs to a shoot, and the dispatch review
-- reads its frames through that shoot, so every selected frame must sit on
-- one shoot; a selection that spans shoots, or reaches a frame that is on no
-- shoot, is refused with the reason rather than quietly trimmed. A restricted
-- frame is refused the same way: approval would refuse it later, and a
-- selection should not be edited by the system between confirm and create.
--
-- SOURCE OF TRUTH FOR THE PACKAGE SHAPE
--
-- createPackageFromSelection (src/lib/data/packages.ts) is the application's
-- builder and the source of truth for what a draft package looks like: one
-- packages row in `draft`, package_assets in canonical filename order naming
-- the delivery version where one exists and the original otherwise, then
-- `needs_review`. If that builder's shape changes, change this function with
-- it. One deliberate divergence: the builder packages only `active` frames,
-- because it reads a live shoot's contact-sheet selection; this function ALSO
-- admits `archived` frames, because reselling from the archive is the whole
-- point of the archive path -- an archived frame is filed, not withdrawn.
-- Every other status is refused under its own name (`restricted`,
-- `ingesting`, `tombstoned`), matching SELECTION_REASON_LABELS in
-- src/lib/news-radar-handoff.ts.
-- ---------------------------------------------------------------------------

create or replace function public.handoff_archive_package(
  target_opportunity uuid,
  evaluator text,
  input_digest text,
  selected_assets uuid[],
  request_key text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  pre jsonb;
  path_id uuid;
  org uuid;
  signal_id uuid;
  previous_status text;
  wanted uuid[];
  unmatched uuid[];
  frames record;
  shoot uuid;
  story_title text;
  package_id uuid;
  handoff_id uuid;
  slot integer := 0;
  frame record;
  version uuid;
  ordered uuid[] := '{}'::uuid[];
  conflicted text;
  existing jsonb;
begin
  pre := private.handoff_preamble(target_opportunity, 'archive_match', evaluator, input_digest, request_key);
  if pre ? 'outcome' then return pre; end if;
  path_id := (pre #>> '{path,id}')::uuid;
  org := (pre #>> '{path,organization_id}')::uuid;
  signal_id := (pre #>> '{path,news_signal_id}')::uuid;
  previous_status := pre #>> '{path,status}';

  -- The selection: non-empty, distinct, every frame a recorded match of THIS
  -- path, on one shoot, with a file to send, and not restricted.
  select coalesce(array_agg(distinct a), '{}'::uuid[]) into wanted
  from unnest(selected_assets) a where a is not null;
  if cardinality(wanted) = 0 then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'empty');
  end if;

  -- Not a recorded match (or not readable by the caller): the only way a
  -- frame enters a radar package is through the evaluation it came from.
  select coalesce(array_agg(w), '{}'::uuid[]) into unmatched
  from unnest(wanted) w
  where not exists (
    select 1 from public.opportunity_asset_matches m
    where m.opportunity_id = path_id and m.asset_id = w);
  if cardinality(unmatched) > 0 then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'not_matched',
      'asset_ids', to_jsonb(unmatched));
  end if;

  select
    coalesce(array_agg(a.id) filter (where a.status = 'restricted'), '{}'::uuid[]) as restricted,
    coalesce(array_agg(a.id) filter (where a.status = 'ingesting'), '{}'::uuid[]) as ingesting,
    coalesce(array_agg(a.id) filter (where a.status = 'tombstoned'), '{}'::uuid[]) as tombstoned,
    coalesce(array_agg(a.id) filter (where a.shoot_id is null), '{}'::uuid[]) as unshot,
    count(distinct a.shoot_id) as shoots,
    min(a.shoot_id::text)::uuid as shoot,
    count(*) as readable
    into frames
  from public.assets a
  where a.organization_id = org and a.id = any(wanted);
  if frames.readable <> cardinality(wanted) then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'not_matched');
  end if;
  -- `active` and `archived` may enter (see the section comment); everything
  -- else is refused under its own name rather than as a generic restriction.
  if cardinality(frames.restricted) > 0 then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'restricted',
      'asset_ids', to_jsonb(frames.restricted));
  end if;
  if cardinality(frames.tombstoned) > 0 then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'tombstoned',
      'asset_ids', to_jsonb(frames.tombstoned));
  end if;
  if cardinality(frames.ingesting) > 0 then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'ingesting',
      'asset_ids', to_jsonb(frames.ingesting));
  end if;
  if cardinality(frames.unshot) > 0 then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'no_shoot',
      'asset_ids', to_jsonb(frames.unshot));
  end if;
  if frames.shoots <> 1 then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'mixed_shoots');
  end if;
  shoot := frames.shoot;

  select s.title into story_title from public.news_signals s where s.id = signal_id;

  -- Everything below lands together or not at all: an exception anywhere in
  -- the block undoes every statement in it.
  begin
    insert into public.packages
      (organization_id, shoot_id, buyer_id, name, status, package_note, created_by)
    values
      (org, shoot, null, left(coalesce(story_title, 'News Radar package'), 200), 'draft',
       'Drafted from News Radar. Review the frames, metadata, rights, terms and recipient before approving anything.',
       actor)
    returning id into package_id;

    for frame in
      select a.id, a.canonical_filename
      from public.assets a
      where a.id = any(wanted)
      order by a.canonical_filename, a.id
    loop
      select v.id into version
      from public.asset_versions v
      where v.asset_id = frame.id
      order by case v.version_kind when 'delivery' then 0 when 'original' then 1 else 2 end,
               v.created_at, v.id
      limit 1;
      if version is null then
        raise exception 'no stored file' using errcode = 'no_data_found';
      end if;
      insert into public.package_assets
        (package_id, organization_id, asset_id, asset_version_id, position)
      values (package_id, org, frame.id, version, slot);
      slot := slot + 1;
      ordered := ordered || frame.id;
    end loop;

    update public.packages set status = 'needs_review' where id = package_id;

    insert into public.opportunity_handoffs
      (organization_id, opportunity_id, opportunity_kind, news_signal_id, action_type,
       evaluator_version, input_hash, package_id, details, request_key, created_by)
    values
      (org, path_id, 'archive_match', signal_id, 'package_draft',
       evaluator, input_digest, package_id,
       jsonb_build_object('selected_asset_ids', to_jsonb(ordered), 'shoot_id', shoot),
       request_key, actor)
    returning id into handoff_id;

    insert into public.activity_events
      (organization_id, actor_id, entity_type, entity_id, action, event_data)
    values
      (org, actor, 'package', package_id, 'package.created',
       jsonb_build_object(
         'summary', left(coalesce(story_title, 'News Radar package'), 200)
           || ' drafted from ' || slot || ' News Radar '
           || case when slot = 1 then 'match' else 'matches' end,
         'count', slot,
         'source', 'news_radar',
         'opportunityId', path_id,
         'handoffId', handoff_id));

    perform private.handoff_close_path(
      path_id, org, 'archive_match', signal_id, previous_status,
      handoff_id, 'package_draft', package_id);
  exception
    when no_data_found then
      return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'no_file');
    when insufficient_privilege then
      return jsonb_build_object('outcome', 'forbidden');
    when unique_violation then
      -- Only reachable if the lock did not serialize (it does), and only the
      -- two handoff uniques mean "a concurrent confirmation won". Any other
      -- unique violation -- package_assets, anything else the block touched
      -- -- is a real failure and is rethrown as one.
      get stacked diagnostics conflicted = constraint_name;
      if conflicted not in
        ('opportunity_handoffs_one_per_path', 'opportunity_handoffs_one_per_request') then
        raise;
      end if;
      -- The block's own writes are rolled back; the winner's committed
      -- handoff answers with the ids the person can continue with.
      existing := private.handoff_existing_answer(path_id, org, handoff_archive_package.request_key);
      if existing is null then
        raise;
      end if;
      return existing;
  end;

  return jsonb_build_object(
    'outcome', 'created',
    'handoff_id', handoff_id,
    'package_id', package_id,
    'shoot_id', shoot,
    'frame_count', slot);
end;
$$;

revoke all on function public.handoff_archive_package(uuid, text, text, uuid[], text) from public;
revoke all on function public.handoff_archive_package(uuid, text, text, uuid[], text) from anon;
grant execute on function public.handoff_archive_package(uuid, text, text, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- The shoot handoff
--
-- `confirmed` carries only what a person confirmed on the form:
--
--   title            required, 1..200
--   location_name    optional, 1..200         (an authoritative field)
--   starts_at        optional timestamptz     (authoritative)
--   ends_at          optional timestamptz     (authoritative, >= starts_at)
--   timezone         optional IANA name       (authoritative)
--   priority         watch|standard|high|urgent, default standard
--   notes            optional text, <= 4000 -- assembled by the application
--                    from the confirmed people and any suggestion the person
--                    chose to carry over, each paragraph labelled as what it is
--   people           string[] the person confirmed, for the provenance row
--   copied_suggestions  string[] of what was carried into the notes, for the
--                    provenance row only
--
-- The shoot is created exactly as the Create Shoot screen creates one: one
-- shoots row in `draft`, nothing else. The brief's suggested angle and shots
-- never reach story_angle: a suggestion the person chose to keep goes into
-- the notes, labelled, where it stays a suggestion.
-- ---------------------------------------------------------------------------

create or replace function public.handoff_shoot_draft(
  target_opportunity uuid,
  evaluator text,
  input_digest text,
  confirmed jsonb,
  request_key text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  pre jsonb;
  path_id uuid;
  org uuid;
  signal_id uuid;
  previous_status text;
  title text;
  location_name text;
  starts_at timestamptz;
  ends_at timestamptz;
  tz text;
  priority text;
  notes text;
  shoot_id uuid;
  handoff_id uuid;
  conflicted text;
  existing jsonb;
begin
  pre := private.handoff_preamble(target_opportunity, 'shoot_opportunity', evaluator, input_digest, request_key);
  if pre ? 'outcome' then return pre; end if;
  path_id := (pre #>> '{path,id}')::uuid;
  org := (pre #>> '{path,organization_id}')::uuid;
  signal_id := (pre #>> '{path,news_signal_id}')::uuid;
  previous_status := pre #>> '{path,status}';

  if confirmed is null or jsonb_typeof(confirmed) <> 'object' then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'shape');
  end if;
  title := btrim(coalesce(confirmed ->> 'title', ''));
  location_name := nullif(btrim(coalesce(confirmed ->> 'location_name', '')), '');
  tz := nullif(btrim(coalesce(confirmed ->> 'timezone', '')), '');
  priority := coalesce(nullif(confirmed ->> 'priority', ''), 'standard');
  notes := nullif(confirmed ->> 'notes', '');

  if char_length(title) not between 1 and 200 then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'title');
  end if;
  if location_name is not null and char_length(location_name) > 200 then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'location');
  end if;
  if priority not in ('watch', 'standard', 'high', 'urgent') then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'priority');
  end if;
  if notes is not null and char_length(notes) > 4000 then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'notes');
  end if;
  begin
    starts_at := (confirmed ->> 'starts_at')::timestamptz;
    ends_at := (confirmed ->> 'ends_at')::timestamptz;
  exception when others then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'time');
  end;
  if starts_at is not null and ends_at is not null and ends_at < starts_at then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'time');
  end if;
  if tz is not null and not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = tz) then
    return jsonb_build_object('outcome', 'invalid_selection', 'reason', 'timezone');
  end if;

  begin
    insert into public.shoots
      (organization_id, opportunity_id, title, status, priority, starts_at, ends_at, timezone,
       location_name, notes, created_by)
    values
      (org, path_id, title, 'draft', priority, starts_at, ends_at, tz,
       location_name, notes, actor)
    returning id into shoot_id;

    insert into public.opportunity_handoffs
      (organization_id, opportunity_id, opportunity_kind, news_signal_id, action_type,
       evaluator_version, input_hash, shoot_id, details, request_key, created_by)
    values
      (org, path_id, 'shoot_opportunity', signal_id, 'shoot_draft',
       evaluator, input_digest, shoot_id,
       jsonb_build_object(
         'confirmed', jsonb_build_object(
           'title', title,
           'location_name', location_name,
           'starts_at', starts_at,
           'ends_at', ends_at,
           'timezone', tz,
           'priority', priority,
           'people', coalesce(confirmed -> 'people', '[]'::jsonb)),
         'copied_suggestions', coalesce(confirmed -> 'copied_suggestions', '[]'::jsonb)),
       request_key, actor)
    returning id into handoff_id;

    insert into public.activity_events
      (organization_id, actor_id, entity_type, entity_id, action, event_data)
    values
      (org, actor, 'shoot', shoot_id, 'shoot.created',
       jsonb_build_object(
         'summary', 'Shoot created: ' || title,
         'source', 'news_radar',
         'opportunityId', path_id,
         'handoffId', handoff_id,
         -- Under its own name, NOT `client_token`: that key is the Create
         -- Shoot screen's idempotency namespace (shootCreatedWithToken in
         -- src/lib/data/shoots.ts reads it back), and the handoff's key must
         -- never satisfy that lookup. The handoff's idempotency lives on
         -- opportunity_handoffs.request_key; this copy is for the event trail.
         'request_key', request_key));

    perform private.handoff_close_path(
      path_id, org, 'shoot_opportunity', signal_id, previous_status,
      handoff_id, 'shoot_draft', shoot_id);
  exception
    when insufficient_privilege then
      return jsonb_build_object('outcome', 'forbidden');
    when unique_violation then
      -- Same narrowing as handoff_archive_package: only the two handoff
      -- uniques are "a concurrent confirmation won"; anything else is real.
      get stacked diagnostics conflicted = constraint_name;
      if conflicted not in
        ('opportunity_handoffs_one_per_path', 'opportunity_handoffs_one_per_request') then
        raise;
      end if;
      existing := private.handoff_existing_answer(path_id, org, handoff_shoot_draft.request_key);
      if existing is null then
        raise;
      end if;
      return existing;
  end;

  return jsonb_build_object(
    'outcome', 'created',
    'handoff_id', handoff_id,
    'shoot_id', shoot_id);
end;
$$;

revoke all on function public.handoff_shoot_draft(uuid, text, text, jsonb, text) from public;
revoke all on function public.handoff_shoot_draft(uuid, text, text, jsonb, text) from anon;
grant execute on function public.handoff_shoot_draft(uuid, text, text, jsonb, text) to authenticated;

-- Unchanged, and repeated so a later default cannot quietly reopen it.
revoke all on all tables in schema public from anon;
