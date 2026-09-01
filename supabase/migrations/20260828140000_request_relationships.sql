-- What answered the request.
--
-- Phase 1 recorded inbound demand and stopped there, deliberately: "no shoot,
-- asset, package, submission, license or payment depends on a request, because
-- the connection between a request and the work that answers it is Phase 2."
-- This is that connection.
--
-- The shape is four relationship tables, not four columns on buyer_requests.
-- A desk that asks for the departure may be answered by a shoot, and then by
-- three frames already in the archive, and then by a second package a week
-- later when the first was not used. A request is answered as many times as it
-- takes, and a foreign key on the request would allow exactly one of those.
--
-- Nothing here is a new canonical entity. There is no request-asset, no
-- request-package, no request-license: every row points at the shoot, asset,
-- package or submission that already exists, and deleting the link leaves the
-- work untouched. `won` is evidenced through the submission a license already
-- hangs off, which is why there is no request_licenses table.
--
-- ---------------------------------------------------------------------------
-- Cross-workspace safety
--
-- Every link carries organization_id and reaches its two ends by COMPOSITE
-- foreign key, following buyers_id_organization_key from Phase 1. This is the
-- difference between "a policy says no" and "the database cannot represent it".
-- A service-role caller bypasses row level security by design; it does not
-- bypass a foreign key. Linking a request in workspace A to a shoot in
-- workspace B fails for the trusted server path, the webhook, and the psql
-- session alike.
--
-- The four `unique (id, organization_id)` constraints added below are what make
-- that possible. None of them constrains data that was not already constrained:
-- id is the primary key of each of those tables, so uniqueness of (id, ...) is
-- already guaranteed. They exist purely to be referenced.
--
-- ---------------------------------------------------------------------------
-- Idempotency
--
-- Every table has a natural unique key -- (request_id, shoot_id) and its three
-- siblings -- so linking the same pair twice is one row, not two. Callers use
-- `on conflict do nothing` / `do update`. A retried Server Action, a
-- double-clicked button, a replayed webhook and a reconciliation pass all
-- converge on the same row. The surrogate `id` exists so a link can be named in
-- an activity event and removed by identity.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   begin;
--     drop trigger if exists buyer_requests_require_evidence on public.buyer_requests;
--     drop trigger if exists buyer_requests_require_evidence_insert on public.buyer_requests;
--     drop function if exists private.request_evidence_gate();
--     drop function if exists private.request_evidence_gate_insert();
--     drop function if exists private.request_has_shoot(uuid);
--     drop function if exists private.request_has_package(uuid);
--     drop function if exists private.request_was_shared(uuid);
--     drop function if exists private.request_has_license(uuid);
--     drop table if exists public.request_submissions;
--     drop table if exists public.request_packages;
--     drop table if exists public.request_assets;
--     drop table if exists public.request_shoots;
--     drop type if exists public.request_asset_state;
--     drop type if exists public.request_match_origin;
--     alter table public.shoots      drop constraint if exists shoots_id_organization_key;
--     alter table public.assets      drop constraint if exists assets_id_organization_key;
--     alter table public.packages    drop constraint if exists packages_id_organization_key;
--     alter table public.submissions drop constraint if exists submissions_id_organization_key;
--   commit;
--
--   What is lost is the record of which work answered which request. Every
--   shoot, asset, package, submission and license survives untouched, because
--   nothing in this migration owns any of them.

-- ---------------------------------------------------------------------------
-- Vocabularies
--
-- Mirrors src/lib/domain.ts, and guarded with to_regtype for the reason Phase 1
-- documented: pg_net defines net.request_status, and an unqualified pg_type
-- lookup matches the wrong thing.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regtype('public.request_match_origin') is null then
    -- Who decided this asset was worth showing the buyer.
    --
    -- 'system' is reserved for Phase 4 and is not writable by anything in this
    -- phase: there is no automatic matching, and a row claiming a machine found
    -- it when a person did would make the provenance worthless the moment it
    -- mattered. The value exists now so Phase 4 adds a writer, not a migration
    -- that rewrites an enum every row depends on -- the same reasoning that put
    -- 'won' in buyer_request_status one phase early.
    create type public.request_match_origin as enum ('human','system');
  end if;

  if to_regtype('public.request_asset_state') is null then
    -- A candidate has been put forward. Selected and rejected are both
    -- decisions a person made, and both are worth keeping: a frame rejected for
    -- this request is evidence next time somebody wonders why it was not sent.
    create type public.request_asset_state as enum ('candidate','selected','rejected');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Composite-key targets
--
-- Additive and idempotent. See the note above on why these constrain nothing
-- that was not already constrained.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['shoots','assets','packages','submissions'] loop
    if not exists (
      select 1 from pg_constraint where conname = t || '_id_organization_key'
    ) then
      execute format(
        'alter table public.%I add constraint %I unique (id, organization_id)',
        t, t || '_id_organization_key'
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Request -> shoot
--
-- "We will go and photograph this." Created from the request detail screen
-- through the existing shoot-creation path; this table records that the shoot
-- exists because the request asked for it.
-- ---------------------------------------------------------------------------
create table if not exists public.request_shoots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  shoot_id uuid not null,
  linked_by uuid not null references auth.users(id),
  linked_at timestamptz not null default now(),

  -- Idempotency. One request, one shoot, one row, however many times the
  -- button is pressed.
  unique (request_id, shoot_id),

  foreign key (request_id, organization_id)
    references public.buyer_requests (id, organization_id) on delete cascade,
  foreign key (shoot_id, organization_id)
    references public.shoots (id, organization_id) on delete cascade
);

comment on table public.request_shoots is
  'Which shoots were planned to answer which request. Removing a row unlinks the shoot; it never deletes it.';

-- ---------------------------------------------------------------------------
-- Request -> asset
--
-- Manual matching against the archive. Every row in this phase is a human
-- decision, and the constraint below says so rather than trusting the caller.
-- ---------------------------------------------------------------------------
create table if not exists public.request_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  asset_id uuid not null,

  state public.request_asset_state not null default 'candidate',
  match_origin public.request_match_origin not null default 'human',

  -- Who put it forward, and when. Required for a human match; see the check.
  matched_by uuid references auth.users(id),
  matched_at timestamptz not null default now(),

  -- Who selected or rejected it. Null while it is still only a candidate.
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),

  unique (request_id, asset_id),

  -- A human match without an actor is an anonymous claim about provenance.
  constraint request_assets_human_match_has_actor check (
    match_origin <> 'human' or matched_by is not null
  ),
  -- Phase 4 owns 'system'. Until it exists, a machine match is unwritable.
  constraint request_assets_system_matching_not_in_this_phase check (
    match_origin = 'human'
  ),
  -- A decision has a decider and a time, or it has neither.
  constraint request_assets_decision_is_attributable check (
    (state = 'candidate' and decided_by is null and decided_at is null)
    or (state <> 'candidate' and decided_by is not null and decided_at is not null)
  ),

  foreign key (request_id, organization_id)
    references public.buyer_requests (id, organization_id) on delete cascade,
  foreign key (asset_id, organization_id)
    references public.assets (id, organization_id) on delete cascade
);

comment on table public.request_assets is
  'Candidate and selected archive frames for a request. Removing a row unmatches the frame; the asset, its original and its history are untouched.';
comment on column public.request_assets.match_origin is
  'How the match was made. Only human is writable in this phase; system is reserved for Phase 4 and refused by a check constraint until then.';
comment on constraint request_assets_system_matching_not_in_this_phase on public.request_assets is
  'Drop this constraint in the phase that introduces automatic matching. Until then a system match cannot be written by anyone, service_role included.';

-- ---------------------------------------------------------------------------
-- Request -> package, and request -> submission
--
-- Two tables rather than one, because they answer different questions at
-- different times. A package exists while the response is being prepared and
-- may never be approved. A submission exists only once approval has frozen
-- what went out. Collapsing them would make "preparing_response" and
-- "submitted" the same fact, and the whole point of the status rules below is
-- that they are not.
-- ---------------------------------------------------------------------------
create table if not exists public.request_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  package_id uuid not null,
  linked_by uuid not null references auth.users(id),
  linked_at timestamptz not null default now(),

  unique (request_id, package_id),

  foreign key (request_id, organization_id)
    references public.buyer_requests (id, organization_id) on delete cascade,
  foreign key (package_id, organization_id)
    references public.packages (id, organization_id) on delete cascade
);

comment on table public.request_packages is
  'Which dispatch packages are being prepared as the response to a request. Reuses the existing package; creates no second kind of package.';

create table if not exists public.request_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  submission_id uuid not null,
  linked_by uuid not null references auth.users(id),
  linked_at timestamptz not null default now(),

  unique (request_id, submission_id),

  foreign key (request_id, organization_id)
    references public.buyer_requests (id, organization_id) on delete cascade,
  foreign key (submission_id, organization_id)
    references public.submissions (id, organization_id) on delete cascade
);

comment on table public.request_submissions is
  'Which submissions answered a request. A license reaches the request through this table and submissions.submission_id, which is why there is no request_licenses.';

create index if not exists request_shoots_request_idx on public.request_shoots (organization_id, request_id);
create index if not exists request_shoots_shoot_idx on public.request_shoots (organization_id, shoot_id);
create index if not exists request_assets_request_idx on public.request_assets (organization_id, request_id, state);
create index if not exists request_assets_asset_idx on public.request_assets (organization_id, asset_id);
create index if not exists request_packages_request_idx on public.request_packages (organization_id, request_id);
create index if not exists request_packages_package_idx on public.request_packages (organization_id, package_id);
create index if not exists request_submissions_request_idx on public.request_submissions (organization_id, request_id);
create index if not exists request_submissions_submission_idx on public.request_submissions (organization_id, submission_id);

-- ---------------------------------------------------------------------------
-- Status follows evidence
--
-- Phase 1 put the transition table in src/lib/requests.ts so a refusal could be
-- rendered next to the control that caused it, and kept in the database only
-- what must hold whatever a client believes. The same division applies here.
-- What the database enforces is that four statuses cannot be claimed without
-- the record that makes them true.
--
-- This is the same principle as the existing rule that a package cannot reach a
-- shipped status without a recorded approval: the interface may be wrong, a
-- Server Action may be missing a guard, a script may be run by hand at 3am, and
-- the commercial record still cannot say a thing happened that did not.
--
-- Each function is a separate, named, stable predicate rather than one large
-- condition, because the interface needs to answer "why is this control
-- disabled" with the same logic that would refuse the write.
-- ---------------------------------------------------------------------------

-- Matching has begun once anything has been put forward, whatever became of it.
-- A rejected candidate is still evidence that somebody looked.
create or replace function private.request_has_match_activity(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.request_assets ra where ra.request_id = target)
$$;

create or replace function private.request_has_shoot(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.request_shoots rs where rs.request_id = target)
$$;

create or replace function private.request_has_package(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.request_packages rp where rp.request_id = target)
$$;

-- Submitted means a person shared it, and nothing weaker.
--
-- Three facts about a delivery are routinely confused, and the product has been
-- careful to keep them apart: the link was CREATED, the link was SHARED, the
-- link was OPENED. Only the middle one is the photographer asserting they sent
-- the work to the buyer. Creating a link is preparation; opening one is the
-- recipient's act, evidence of engagement and never of a sale.
--
-- submissions.sent_at covers the submission recorded as sent through the
-- existing dispatch path; submission_deliveries.shared_at covers the recipient
-- link the operator marked as shared. Either is a person saying "this went".
-- delivery_access_events and delivery_view_sessions are deliberately absent.
create or replace function private.request_was_shared(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.request_submissions rs
    join public.submissions s on s.id = rs.submission_id
    where rs.request_id = target
      and (
        s.sent_at is not null
        or exists (
          select 1 from public.submission_deliveries d
          where d.submission_id = s.id and d.shared_at is not null
        )
      )
  )
$$;

-- Won means money was agreed, reached through the submission a license already
-- hangs off. There is no request_licenses table and there must not be one: the
-- license is the canonical commercial record and a second edge to it would be a
-- second answer to "what did this earn".
--
-- Qualifying deliberately excludes 'cancelled', and excludes a proposed licence
-- carrying no figure -- a proposal is an offer, not a win. An active licence
-- qualifies even at zero, because a rights-for-credit deal is a real outcome
-- somebody negotiated.
create or replace function private.request_has_license(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.request_submissions rs
    join public.licenses l on l.submission_id = rs.submission_id
    where rs.request_id = target
      and l.status <> 'cancelled'
      and (l.sale_base_minor > 0 or l.status = 'active')
  )
$$;

-- Both roles, deliberately, and this is not belt-and-braces.
--
-- These predicates are called from a trigger function that is NOT security
-- definer, so the EXECUTE check lands on whoever is writing the row. Granting
-- only to `authenticated` leaves every trusted server path -- the delivery
-- webhook, the billing webhook, an invitation, a reconciliation pass -- failing
-- with "permission denied for function" at the moment it tries to move a
-- request. 20260825170000_service_role_data_api_grants.sql is the migration
-- that exists because that lesson cost a day; it covered tables, and functions
-- need saying too.
--
-- Phase 1 has this gap on private.request_is_closed, which its own
-- protect_new_buyer_request calls. Fixed forward here rather than by editing
-- that migration: grants are idempotent, so Phase 1 correcting it later is
-- harmless, and a migration that has been applied anywhere should be added to
-- rather than rewritten.
grant execute on function private.request_is_closed(public.buyer_request_status) to service_role;

revoke all on function private.request_has_match_activity(uuid) from public;
revoke all on function private.request_has_shoot(uuid) from public;
revoke all on function private.request_has_package(uuid) from public;
revoke all on function private.request_was_shared(uuid) from public;
revoke all on function private.request_has_license(uuid) from public;
grant execute on function private.request_has_match_activity(uuid) to authenticated;
grant execute on function private.request_has_shoot(uuid) to authenticated;
grant execute on function private.request_has_package(uuid) to authenticated;
grant execute on function private.request_was_shared(uuid) to authenticated;
grant execute on function private.request_has_license(uuid) to authenticated;
grant execute on function private.request_has_match_activity(uuid) to service_role;
grant execute on function private.request_has_shoot(uuid) to service_role;
grant execute on function private.request_has_package(uuid) to service_role;
grant execute on function private.request_was_shared(uuid) to service_role;
grant execute on function private.request_has_license(uuid) to service_role;

-- The gate itself.
--
-- Checked only on the transition INTO a gated status, never on every later
-- update of a row already sitting in it. A submission whose delivery link is
-- revoked next week does not retroactively un-submit the request, and an editor
-- fixing a typo on a won request should not have to re-prove the sale.
create or replace function private.request_evidence(new_status public.buyer_request_status, target uuid)
returns text language plpgsql stable set search_path = '' as $$
begin
  if new_status = 'matching' and not private.request_has_match_activity(target) then
    return 'Matching starts when a frame or a shoot is put forward. Add a candidate asset first.';
  elsif new_status = 'coverage_planned' and not private.request_has_shoot(target) then
    return 'Coverage is planned once a shoot exists to answer the request. Create the linked shoot first.';
  elsif new_status = 'preparing_response' and not private.request_has_package(target) then
    return 'Preparing a response means a package is being built. Link or create a package first.';
  elsif new_status = 'submitted' and not private.request_was_shared(target) then
    return 'Submitted means the work was actually shared with the buyer. Approve the package and mark the delivery shared first; creating a link, or a buyer opening one, is not the same thing.';
  elsif new_status = 'won' and not private.request_has_license(target) then
    return 'Won means a license or recorded sale connects back to this request. Record the license against the submission first; an opened delivery link is not a sale.';
  end if;
  return null;
end;
$$;

revoke all on function private.request_evidence(public.buyer_request_status, uuid) from public;
grant execute on function private.request_evidence(public.buyer_request_status, uuid) to authenticated;
grant execute on function private.request_evidence(public.buyer_request_status, uuid) to service_role;

create or replace function private.request_evidence_gate()
returns trigger language plpgsql set search_path = '' as $$
declare
  refusal text;
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  refusal := private.request_evidence(new.status, new.id);
  if refusal is not null then
    raise exception '%', refusal using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

-- Fires after buyer_requests_protect: triggers of the same kind run in name
-- order, and 'p' precedes 'r'. Identity and closed-request rules are answered
-- before evidence is consulted, which is the order the messages read best in.
drop trigger if exists buyer_requests_require_evidence on public.buyer_requests;
create trigger buyer_requests_require_evidence
before update on public.buyer_requests
for each row execute function private.request_evidence_gate();

-- A request cannot be born in a state it has no evidence for either. On insert
-- there are no links yet -- they reference the request that does not exist --
-- so every gated status is unreachable at creation, which is correct and worth
-- saying out loud rather than leaving as an accident of ordering.
create or replace function private.request_evidence_gate_insert()
returns trigger language plpgsql set search_path = '' as $$
declare
  refusal text;
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return new;
  end if;

  refusal := private.request_evidence(new.status, new.id);
  if refusal is not null then
    raise exception '%', refusal using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists buyer_requests_require_evidence_insert on public.buyer_requests;
create trigger buyer_requests_require_evidence_insert
before insert on public.buyer_requests
for each row execute function private.request_evidence_gate_insert();

revoke all on function private.request_evidence_gate() from public;
revoke all on function private.request_evidence_gate_insert() from public;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Identical to buyer_requests, deliberately: a link is part of the request, and
-- a reader who can see the request can see what answered it. Write is owner,
-- editor and dispatcher -- the same three roles that may write the request.
--
-- Delete IS granted here, unlike buyer_requests. Unlinking is not forgetting:
-- the shoot, asset, package and submission all survive, and a match somebody
-- put forward by mistake should not have to be carried forever as a rejected
-- candidate. What must never be deletable is the work itself, and none of it
-- lives in these tables.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['request_shoots','request_assets','request_packages','request_submissions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$
      create policy %I on public.%I for select to authenticated
      using (private.is_org_member(organization_id))
    $p$, t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$
      create policy %I on public.%I for all to authenticated
      using (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]))
      with check (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]))
    $p$, t || '_write', t);

    -- Explicit for both roles. The Supabase image grants no DML on a new public
    -- table to anybody, and service_role has no implicit grant either -- see
    -- 20260825170000_service_role_data_api_grants.sql, which was written after
    -- that silence cost a day.
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon;
