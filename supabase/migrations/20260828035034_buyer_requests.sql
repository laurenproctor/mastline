-- Inbound demand, recorded where the work already lives.
--
-- A picture desk rings, or texts, or sends three lines of WhatsApp at 6am
-- asking whether anybody has the departure from last night. Today that request
-- exists in a phone and nowhere else: it is not on the work queue, it cannot be
-- assigned, and when it is missed there is no record that it was ever made. The
-- shoot, the package and the submission all have a durable record of what the
-- photographer DID. Nothing records what they were ASKED.
--
-- These two tables are that record. A buyer request is one piece of inbound
-- demand: who asked, what for, by when, on what commercial terms, and what
-- happened to it.
--
-- What this deliberately is NOT
--
-- It is not a buyer portal, a marketplace, or an outbound channel. Nothing here
-- sends anything to anybody. Creating a request is a private note-to-self about
-- a conversation that already happened somewhere else, and the interface says
-- so in as many words. Phase 2 can add ingestion; this phase adds memory.
--
-- Naming
--
-- `buyer_requests` rather than `requests`, because a bare "request" in a
-- Next.js codebase is an HTTP request and the ambiguity would be permanent.
-- `organization_id` rather than `workspace_id`, because the product says
-- workspace and the schema has always said organization, and a second name for
-- the column every policy keys on is worse than the mismatch.
--
-- The status vocabulary
--
--   draft -> new -> needs_clarification -> qualified -> matching
--         -> coverage_planned -> preparing_response -> submitted -> negotiating
--
-- and the closed states: won, lost, expired, declined, cancelled.
--
-- Two notes on it, both deliberate:
--
--   * `cancelled` with two Ls. public.shoot_status and public.license_status
--     already spell it that way, and one schema with two spellings of one word
--     is a bug waiting for somebody to type the other one. See docs/DECISIONS.md.
--   * `won` exists in the enum and is not reachable in this phase. Winning a
--     request means connecting it to a license, and that connection does not
--     exist yet; the transition table in src/lib/requests.ts refuses it. Putting
--     the value in now means Phase 2 adds a link, not a migration that rewrites
--     an enum every row and policy depends on.
--
-- Nothing expires by itself
--
-- `expired` is a transition somebody performs, not a thing a passing deadline
-- does. There is no scheduler in this system, and a status that quietly becomes
-- true when nobody is looking is a status nobody can trust. A deadline that has
-- passed is rendered as "Past deadline", derived at read time from
-- response_deadline, and the request stays exactly as active as it was.
--
-- What "not provided" means
--
-- Most of the commercial columns are nullable and stay null. A desk that did
-- not say what territory it wanted has not asked for worldwide, and a desk that
-- did not mention money has not offered zero. Budget is the sharp case, so it
-- carries an explicit `budget_disclosed` flag and a pair of check constraints:
-- figures cannot exist without disclosure, and disclosure cannot be claimed
-- without at least one figure. A disclosed budget of zero -- "we have no money
-- for this, send it anyway" -- is a real thing a desk says, and it is a
-- different row from a budget nobody mentioned.
--
-- ROLLBACK
--
--   begin;
--     drop table if exists public.request_sensitive_notes;
--     drop table if exists public.buyer_requests;
--     drop function if exists private.protect_buyer_request();
--     drop function if exists private.protect_new_buyer_request();
--     drop function if exists private.request_is_closed(public.buyer_request_status);
--     alter table public.buyers drop constraint if exists buyers_id_organization_key;
--     drop type if exists public.buyer_request_status;
--     drop type if exists public.buyer_request_type;
--     drop type if exists public.buyer_request_source;
--   commit;
--
--   Nothing else references these tables. No shoot, asset, package, submission,
--   license or payment depends on a request, because the connection between a
--   request and the work that answers it is Phase 2. What is lost is the record
--   of inbound demand, which is what the product had before this migration.

-- ---------------------------------------------------------------------------
-- Status vocabularies
--
-- These mirror src/lib/domain.ts one for one, like every other enum here.
-- ---------------------------------------------------------------------------

-- Named buyer_request_* rather than request_*, and guarded with to_regtype
-- rather than a bare pg_type lookup, for the same reason: pg_net -- installed
-- in every Supabase project -- already defines net.request_status. An
-- unqualified `select 1 from pg_type where typname = 'request_status'` matches
-- it, skips the create, and leaves the table below referring to a type that was
-- never made. to_regtype takes the schema-qualified name, so it answers the
-- question actually being asked.
do $$
begin
  if to_regtype('public.buyer_request_source') is null then
    -- How the record got into Mastline, not how the buyer got hold of the
    -- photographer -- that is received_via. Only 'manual' is written in this
    -- phase; the rest are here so ingestion is a code change rather than an
    -- enum migration.
    create type public.buyer_request_source as enum ('manual','email','portal','api');
  end if;

  if to_regtype('public.buyer_request_type') is null then
    create type public.buyer_request_type as enum (
      'archive','coverage','commission','exclusive','other'
    );
  end if;

  if to_regtype('public.buyer_request_status') is null then
    create type public.buyer_request_status as enum (
      'draft','new','needs_clarification','qualified','matching','coverage_planned',
      'preparing_response','submitted','negotiating',
      'won','lost','expired','declined','cancelled'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A buyer reference that cannot leave the workspace
--
-- buyers.id is already unique on its own, so this adds no new guarantee about
-- buyers. What it adds is a target for a COMPOSITE foreign key: with it,
-- buyer_requests can reference (buyer_id, organization_id) and the database
-- refuses a request in workspace A pointing at a buyer in workspace B --
-- structurally, without depending on a policy being written correctly.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'buyers_id_organization_key'
  ) then
    alter table public.buyers
      add constraint buyers_id_organization_key unique (id, organization_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The request
-- ---------------------------------------------------------------------------

create table if not exists public.buyer_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Null when the caller has not been identified yet: a stringer forwarding a
  -- desk's message often knows the deadline before they know the masthead.
  buyer_id uuid,

  created_by uuid not null references auth.users(id),

  -- Who owns answering it. Constrained by composite foreign key to a membership
  -- of THIS workspace below, so a request cannot be assigned to somebody who is
  -- not in the room.
  assigned_to uuid,
  assigned_at timestamptz,
  assigned_by uuid references auth.users(id),

  -- Stable per capture attempt. A form resubmitted by a flaky connection, or a
  -- second tab, lands on the request it already made. Unique by constraint
  -- rather than by a read-then-write, because the case that matters is a retry
  -- racing its own timeout and a select followed by an insert loses that race
  -- by construction.
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 128),

  -- What a photographer says out loud on the phone: "that's REQ-0827-4417".
  -- Unique per workspace; drawn and redrawn by the data layer until the
  -- database says one is free.
  reference text not null
    check (reference ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),

  source public.buyer_request_source not null default 'manual',

  -- The channel the buyer actually used. Null is "not recorded", which is
  -- different from 'other'.
  received_via text
    check (received_via is null or received_via in (
      'phone','text_message','whatsapp','email','in_person','buyer_relationship','other'
    )),

  request_type public.buyer_request_type not null default 'other',
  status public.buyer_request_status not null default 'draft',

  title text not null check (char_length(title) between 1 and 200),
  brief text check (brief is null or char_length(brief) <= 4000),

  -- The story, and who or what it is about. Kept apart from the title because
  -- the title is what an operator scans a list for and the subject is what a
  -- later archive search will key on.
  subject_or_event text check (subject_or_event is null or char_length(subject_or_event) <= 300),
  subject_names text[] not null default '{}',
  topics text[] not null default '{}',

  event_at timestamptz,
  location_name text check (location_name is null or char_length(location_name) <= 300),

  -- When the buyer needs an answer, and when the request stops being worth
  -- anything. Different dates, and a desk routinely gives one without the other.
  response_deadline timestamptz,
  expires_at timestamptz,

  deliverables text check (deliverables is null or char_length(deliverables) <= 2000),
  requested_formats text[] not null default '{}',
  orientation text
    check (orientation is null or orientation in ('landscape','portrait','square','any')),
  -- "About twenty frames." Null is "they did not say", which is not zero.
  approximate_quantity integer
    check (approximate_quantity is null or approximate_quantity between 1 and 100000),

  -- The commercial terms exactly as stated, or not at all. None of these
  -- defaults to worldwide, perpetual, or unrestricted: a term nobody negotiated
  -- must never be presented later as one that was.
  usage_media text check (usage_media is null or char_length(usage_media) <= 500),
  territory text check (territory is null or char_length(territory) <= 500),
  usage_duration text check (usage_duration is null or char_length(usage_duration) <= 500),
  exclusivity text check (exclusivity is null or char_length(exclusivity) <= 500),

  budget_disclosed boolean not null default false,
  budget_min_minor bigint check (budget_min_minor is null or budget_min_minor >= 0),
  budget_max_minor bigint check (budget_max_minor is null or budget_max_minor >= 0),
  currency char(3) not null default 'USD',

  embargo_until timestamptz,
  delivery_requirements text
    check (delivery_requirements is null or char_length(delivery_requirements) <= 2000),
  usage_restrictions text
    check (usage_restrictions is null or char_length(usage_restrictions) <= 2000),

  -- Why it ended. Required for lost and declined by the trigger below: "we lost
  -- it" with no reason attached teaches nobody anything the next time.
  closed_reason text
    check (closed_reason is null or char_length(closed_reason) between 4 and 1000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Stamped once, by the trigger, when the request first reaches qualified.
  qualified_at timestamptz,
  -- Stamped once, by the trigger, when it first reaches a closed state.
  closed_at timestamptz,

  -- Figures cannot exist unless somebody said them.
  constraint buyer_requests_budget_undisclosed check (
    budget_disclosed or (budget_min_minor is null and budget_max_minor is null)
  ),
  -- And a disclosure with no figure in it is not a disclosure.
  constraint buyer_requests_budget_disclosed check (
    not budget_disclosed or budget_min_minor is not null or budget_max_minor is not null
  ),
  constraint buyer_requests_budget_range check (
    budget_min_minor is null or budget_max_minor is null
    or budget_min_minor <= budget_max_minor
  ),

  unique (organization_id, idempotency_key),
  unique (organization_id, reference),
  -- Lets request_sensitive_notes carry a composite foreign key, so a note
  -- cannot be attached to a request in another workspace even if a policy were
  -- wrong.
  unique (id, organization_id),

  -- Cross-workspace denial, structurally. The column list on `set null` is what
  -- keeps organization_id out of it: nulling that would violate not null and
  -- abort the buyer's deletion instead of detaching the request from it.
  foreign key (buyer_id, organization_id)
    references public.buyers (id, organization_id) on delete set null (buyer_id),

  -- An assignee must hold a membership of THIS workspace. Removing somebody
  -- from the workspace releases their requests rather than blocking the removal.
  foreign key (organization_id, assigned_to)
    references public.memberships (organization_id, user_id) on delete set null (assigned_to)
);

comment on table public.buyer_requests is
  'One piece of inbound demand: who asked, what for, by when, on what terms, and what became of it. Recording one sends nothing to anybody.';
comment on column public.buyer_requests.idempotency_key is
  'Stable per capture attempt. Re-submitting the same key returns the existing request rather than creating a second one.';
comment on column public.buyer_requests.reference is
  'Human-readable and unique per workspace, e.g. REQ-0827-4417. What a photographer quotes back to a desk.';
comment on column public.buyer_requests.budget_disclosed is
  'Whether a budget was stated at all. False with null figures is "they did not say", which is not the same as zero.';
comment on column public.buyer_requests.expires_at is
  'When the request stops being worth answering. Nothing acts on this: no scheduler exists, so a passing deadline is rendered as a derived fact, never written as a status.';
comment on column public.buyer_requests.closed_reason is
  'Why it ended. Required by trigger for lost and declined.';

-- ---------------------------------------------------------------------------
-- Confidential material
--
-- A brief can carry a tip, an address, or the identity of whoever passed it on.
-- The request row itself is readable by every active member, exactly as a shoot
-- is; anything narrower than that lives here, behind the same owner/editor
-- policy as shoot_sensitive_notes, and is never mirrored into the request, the
-- activity stream, or an export a finance role can run.
--
-- One table rather than a `confidential boolean` on the request, because a flag
-- that hides a column in the interface is not a permission -- the row still
-- comes back over the Data API to anyone who can read the request.
-- ---------------------------------------------------------------------------

-- One foreign key onto the request, not two. `request_id` is the primary key
-- here, so an inline `references buyer_requests(id)` would have been the
-- obvious way to write it -- but the composite key below already guarantees
-- everything that one would, including the cascade, and having both made
-- PostgREST refuse to embed the table: two relationships, no way to choose
-- between them without naming a generated constraint in a query string.
create table if not exists public.request_sensitive_notes (
  request_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_note text check (source_note is null or char_length(source_note) <= 4000),
  confidential_location text
    check (confidential_location is null or char_length(confidential_location) <= 500),
  confidential_identity text
    check (confidential_identity is null or char_length(confidential_identity) <= 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint request_sensitive_notes_request_fkey
    foreign key (request_id, organization_id)
    references public.buyer_requests (id, organization_id) on delete cascade
);

comment on table public.request_sensitive_notes is
  'Source protection for a buyer request. Owner and editor only; finance, dispatch, rights and viewer roles cannot reach these rows at all.';

-- ---------------------------------------------------------------------------
-- Indexes
--
-- The questions this table is asked: what is in the inbox (status, newest
-- first), what is running out of time, what did this buyer ask for, and what is
-- mine to answer.
-- ---------------------------------------------------------------------------

create index if not exists buyer_requests_inbox_idx
  on public.buyer_requests (organization_id, status, created_at desc);

-- Partial: a deadline only matters while there is still something to do about
-- it, and a workspace with three years of closed requests should not pay for
-- them every time somebody opens the inbox.
create index if not exists buyer_requests_deadline_idx
  on public.buyer_requests (organization_id, response_deadline)
  where status not in ('won','lost','expired','declined','cancelled');

create index if not exists buyer_requests_buyer_idx
  on public.buyer_requests (organization_id, buyer_id)
  where buyer_id is not null;

create index if not exists buyer_requests_assignee_idx
  on public.buyer_requests (organization_id, assigned_to)
  where assigned_to is not null;

-- ---------------------------------------------------------------------------
-- What the database enforces about the lifecycle
--
-- The full transition table lives in src/lib/requests.ts, because a refusal has
-- to be a typed error the form can render next to a control rather than a round
-- trip that fails. What is enforced here is the half that must hold whatever a
-- client believes: identity is fixed, a closed request stays closed, and the
-- two decisions that need a reason cannot be recorded without one.
-- ---------------------------------------------------------------------------

create or replace function private.request_is_closed(s public.buyer_request_status)
returns boolean language sql immutable set search_path = '' as $$
  select s in ('won','lost','expired','declined','cancelled')
$$;

create or replace function private.protect_buyer_request()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- A deliberate purge is the one path that may unwind any of this, and it is
  -- the same flag every other protective trigger in this schema honours.
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by
     or new.idempotency_key is distinct from old.idempotency_key
     or new.reference is distinct from old.reference then
    raise exception 'The workspace, author, reference and idempotency key of a request are fixed at creation.'
      using errcode = 'restrict_violation';
  end if;

  -- A closed request is finished. Not "cannot go back to active" but cannot
  -- move at all: lost -> cancelled is a rewrite of what happened, and the
  -- commercial record is worth more than the convenience of tidying it.
  if private.request_is_closed(old.status) and new.status is distinct from old.status then
    raise exception 'Request % is already recorded as %, and a closed request cannot be reopened.',
      old.reference, old.status
      using errcode = 'restrict_violation';
  end if;

  if new.status in ('lost','declined') and coalesce(char_length(trim(new.closed_reason)), 0) < 4 then
    raise exception 'Recording a request as % needs a reason.', new.status
      using errcode = 'not_null_violation';
  end if;

  -- Two lifecycle timestamps, stamped where they are evidenced rather than
  -- trusted from whichever client claimed them, and write-once thereafter.
  if new.status = 'qualified' and old.status is distinct from 'qualified' then
    new.qualified_at := coalesce(old.qualified_at, new.qualified_at, now());
  else
    new.qualified_at := coalesce(old.qualified_at, new.qualified_at);
  end if;

  if private.request_is_closed(new.status) and not private.request_is_closed(old.status) then
    new.closed_at := coalesce(old.closed_at, new.closed_at, now());
  else
    new.closed_at := old.closed_at;
  end if;

  -- Assignment carries its own timestamp, and losing an assignee clears it
  -- rather than leaving a time attached to nobody.
  if new.assigned_to is distinct from old.assigned_to then
    if new.assigned_to is null then
      new.assigned_at := null;
      new.assigned_by := null;
    else
      new.assigned_at := coalesce(new.assigned_at, now());
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists buyer_requests_protect on public.buyer_requests;
create trigger buyer_requests_protect
before update on public.buyer_requests
for each row execute function private.protect_buyer_request();

-- A brand new row may not claim a history it does not have.
create or replace function private.protect_new_buyer_request()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return new;
  end if;

  if new.status in ('lost','declined') and coalesce(char_length(trim(new.closed_reason)), 0) < 4 then
    raise exception 'Recording a request as % needs a reason.', new.status
      using errcode = 'not_null_violation';
  end if;

  if private.request_is_closed(new.status) then
    new.closed_at := coalesce(new.closed_at, now());
  else
    new.closed_at := null;
  end if;

  if new.status = 'qualified' then
    new.qualified_at := coalesce(new.qualified_at, now());
  end if;

  if new.assigned_to is not null then
    new.assigned_at := coalesce(new.assigned_at, now());
  else
    new.assigned_at := null;
    new.assigned_by := null;
  end if;

  return new;
end;
$$;

drop trigger if exists buyer_requests_protect_insert on public.buyer_requests;
create trigger buyer_requests_protect_insert
before insert on public.buyer_requests
for each row execute function private.protect_new_buyer_request();

revoke all on function private.protect_buyer_request() from public;
revoke all on function private.protect_new_buyer_request() from public;
revoke all on function private.request_is_closed(public.buyer_request_status) from public;

-- The triggers above are not security definer, so they run as whoever is
-- writing the row -- and that is every role that can write one, the service
-- role included. Granting to `authenticated` alone made every service-role
-- insert fail with "permission denied for function request_is_closed", which
-- is a fixture failing rather than a policy working.
grant execute on function private.request_is_closed(public.buyer_request_status) to authenticated;
grant execute on function private.request_is_closed(public.buyer_request_status) to service_role;

-- updated_at, like every other table that has one.
drop trigger if exists set_updated_at on public.buyer_requests;
create trigger set_updated_at before update on public.buyer_requests
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at on public.request_sensitive_notes;
create trigger set_updated_at before update on public.request_sensitive_notes
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Read for every active member, including viewers, exactly as shoots are.
--
-- Write for owner, editor and dispatcher. Editors brief and answer the work;
-- dispatchers are the ones a picture desk actually rings, and a role that
-- fields the call but cannot write down what was said would push the record
-- back into the phone this table exists to get it out of. Finance and rights
-- reviewers read, because a request explains where a later license came from,
-- and viewers read only.
--
-- Confidential notes are narrower again: owner and editor, mirroring
-- shoot_sensitive_notes. A dispatcher may record a request without being able
-- to read whoever the tip came from.
-- ---------------------------------------------------------------------------

alter table public.buyer_requests enable row level security;
alter table public.buyer_requests force row level security;
alter table public.request_sensitive_notes enable row level security;
alter table public.request_sensitive_notes force row level security;

drop policy if exists buyer_requests_select on public.buyer_requests;
create policy buyer_requests_select on public.buyer_requests
  for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists buyer_requests_write on public.buyer_requests;
create policy buyer_requests_write on public.buyer_requests
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]));

drop policy if exists request_sensitive_notes_select on public.request_sensitive_notes;
create policy request_sensitive_notes_select on public.request_sensitive_notes
  for select to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

drop policy if exists request_sensitive_notes_write on public.request_sensitive_notes;
create policy request_sensitive_notes_write on public.request_sensitive_notes
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
-- No delete grant on buyer_requests. A request that came to nothing is recorded
-- as declined or cancelled with a reason, which is a fact worth keeping; making
-- it disappear instead is how a workspace forgets that a desk asked three times
-- and got no answer. The purge routines remain the audited way to remove a
-- workspace's records.
-- ---------------------------------------------------------------------------

grant select, insert, update on public.buyer_requests to authenticated;
-- Explicitly taken back rather than merely not granted. Supabase's default
-- privileges hand ALL on a new public table to `authenticated`, so silence here
-- is not absence: without this revoke, any member with a write policy could
-- delete a request outright.
revoke delete on public.buyer_requests from authenticated;
grant select, insert, update, delete on public.buyer_requests to service_role;

grant select, insert, update, delete on public.request_sensitive_notes to authenticated;
grant select, insert, update, delete on public.request_sensitive_notes to service_role;

-- Unchanged, and repeated so a later default cannot quietly reopen it.
revoke all on public.buyer_requests from anon;
revoke all on public.request_sensitive_notes from anon;
revoke all on all tables in schema public from anon;
