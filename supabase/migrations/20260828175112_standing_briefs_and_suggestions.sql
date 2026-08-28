-- What a buyer always wants, and what might answer it.
--
-- Two tables and two vocabularies. They are separate on purpose, because they
-- are different kinds of claim and confusing them is the failure mode this
-- whole phase has to avoid.
--
-- A STANDING BRIEF is a durable commercial preference: "Northstar takes London
-- departures, editorial, UK, up to about eight hundred." It is a thing the desk
-- said once and has not withdrawn. It is NOT evidence that they want to buy
-- anything today, and nothing in this schema may render it as a live request.
-- A brief becomes a request when a person decides it has, and only then.
--
-- A SUGGESTION is a frame the archive thinks might answer a request. It is a
-- proposal with a stated basis, never a selection. Accepting one writes into
-- request_assets -- the table Phase 2 already made canonical -- so there is one
-- record of what was chosen and no second, parallel notion of a selected frame.
--
-- ---------------------------------------------------------------------------
-- Relevance is not clearance
--
-- Every suggestion carries both, in separate columns, because they answer
-- different questions and the answers routinely disagree. A restricted frame of
-- exactly the right moment is highly relevant and not sendable. Collapsing them
-- into one score would either hide the best picture or imply a right nobody
-- granted, and the second is how a workspace ends up licensing something it
-- could not license.
--
-- ---------------------------------------------------------------------------
-- No faces, no inference, no model
--
-- Matching in this phase reads text an operator typed: subjects, keywords,
-- location, capture date, asset kind. It never opens an image, and it never
-- derives who is in one. `subjects` is context a person recorded, not an
-- identification this system made, and origin='model' exists in the enum
-- without a writer so that adding one later is a code change rather than an
-- enum migration -- the same reasoning that put 'won' and 'system' in early.
--
-- The repository has an approved model abstraction and it is deliberately
-- unused here. Four assets and one real request cannot demonstrate that a model
-- improves ranking, and a confidence number learned from nothing is decoration.
--
-- ROLLBACK
--
--   begin;
--     drop table if exists public.request_asset_suggestions;
--     drop table if exists public.standing_brief_occurrences;
--     drop table if exists public.standing_briefs;
--     drop type if exists public.suggestion_state;
--     drop type if exists public.suggestion_origin;
--     drop type if exists public.standing_brief_status;
--   commit;
--
--   No request, asset or licence depends on any of this: suggestions point at
--   assets and occurrences point at requests, never the other way round.

do $$
begin
  if to_regtype('public.standing_brief_status') is null then
    -- Ended rather than deleted. A brief that expired explains why a request
    -- was answered the way it was in March, and deleting it loses that.
    create type public.standing_brief_status as enum ('active','paused','ended');
  end if;

  if to_regtype('public.suggestion_origin') is null then
    create type public.suggestion_origin as enum ('deterministic','model');
  end if;

  if to_regtype('public.suggestion_state') is null then
    -- Rejected is kept, not removed. "We looked at this frame and said no" is
    -- worth more six months later than a tidy list.
    create type public.suggestion_state as enum ('live','accepted','rejected');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Standing briefs
-- ---------------------------------------------------------------------------
create table if not exists public.standing_briefs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  buyer_id uuid not null,
  created_by uuid not null references auth.users(id),

  title text not null check (char_length(trim(title)) between 2 and 200),
  note text check (note is null or char_length(note) <= 4000),

  subjects text[] not null default '{}',
  topics text[] not null default '{}',
  locations text[] not null default '{}',
  requested_formats text[] not null default '{}',

  -- Terms exactly as stated, or not at all. Same rule as a request: an unsaid
  -- term is null and is rendered as "not stated", never as a default.
  usage_media text check (usage_media is null or char_length(usage_media) <= 500),
  territory text check (territory is null or char_length(territory) <= 500),
  usage_duration text check (usage_duration is null or char_length(usage_duration) <= 500),
  exclusivity text check (exclusivity is null or char_length(exclusivity) <= 500),
  delivery_preferences text check (delivery_preferences is null or char_length(delivery_preferences) <= 2000),

  -- Guidance, and named so nothing mistakes it for revenue. What a desk says
  -- they usually pay is not what they have paid.
  budget_guidance_disclosed boolean not null default false,
  budget_guidance_min_minor bigint check (budget_guidance_min_minor is null or budget_guidance_min_minor >= 0),
  budget_guidance_max_minor bigint check (budget_guidance_max_minor is null or budget_guidance_max_minor >= 0),
  currency char(3) not null default 'USD',

  effective_from timestamptz,
  effective_to timestamptz,

  -- How often somebody said they would look at it again. A number of days and
  -- a date, both inert: nothing in this system acts on either, and a brief past
  -- its review date is rendered as "due for review", never moved by a job that
  -- does not exist.
  review_cadence_days integer check (review_cadence_days is null or review_cadence_days between 1 and 3650),
  last_reviewed_at timestamptz,
  last_reviewed_by uuid references auth.users(id),

  status public.standing_brief_status not null default 'active',
  ended_reason text check (ended_reason is null or char_length(ended_reason) between 4 and 1000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint standing_briefs_guidance_undisclosed check (
    budget_guidance_disclosed
    or (budget_guidance_min_minor is null and budget_guidance_max_minor is null)
  ),
  constraint standing_briefs_guidance_disclosed check (
    not budget_guidance_disclosed
    or budget_guidance_min_minor is not null or budget_guidance_max_minor is not null
  ),
  constraint standing_briefs_guidance_range check (
    budget_guidance_min_minor is null or budget_guidance_max_minor is null
    or budget_guidance_min_minor <= budget_guidance_max_minor
  ),
  unique (id, organization_id),
  foreign key (buyer_id, organization_id)
    references public.buyers (id, organization_id) on delete cascade
);

comment on table public.standing_briefs is
  'A durable buyer preference. Evidence of what a desk generally wants, never evidence that they intend to buy today.';
comment on column public.standing_briefs.budget_guidance_min_minor is
  'What a buyer says they usually pay. Guidance, not revenue; never to be summed with licensed money.';
comment on column public.standing_briefs.review_cadence_days is
  'How often somebody intends to revisit this. Inert: no scheduler exists, so a brief past review is rendered as due, never moved.';

create index if not exists standing_briefs_workspace_idx
  on public.standing_briefs (organization_id, status, created_at desc);
create index if not exists standing_briefs_buyer_idx
  on public.standing_briefs (organization_id, buyer_id);

-- ---------------------------------------------------------------------------
-- Occurrences
--
-- A brief did not generate a request unless one of these exists. There is no
-- scheduler in this system and this phase does not invent one, so every
-- occurrence is a person pressing a control: generated_by is not null and
-- references a real user, which makes an unattended occurrence unrepresentable
-- rather than merely discouraged.
--
-- period_key is the idempotency. A person generating "August 2026" twice gets
-- one occurrence, because the unique key says so rather than because a read
-- happened to come back non-empty first.
-- ---------------------------------------------------------------------------
create table if not exists public.standing_brief_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brief_id uuid not null,
  request_id uuid not null,

  generated_by uuid not null references auth.users(id),
  generated_at timestamptz not null default now(),

  -- The window this occurrence stands for, chosen by the person generating it.
  period_key text not null check (period_key ~ '^[0-9A-Za-z][0-9A-Za-z._:-]{0,63}$'),
  -- Why, in the words of whoever pressed it.
  basis text not null check (char_length(trim(basis)) between 4 and 1000),

  unique (brief_id, period_key),
  unique (request_id),

  foreign key (brief_id, organization_id)
    references public.standing_briefs (id, organization_id) on delete cascade,
  foreign key (request_id, organization_id)
    references public.buyer_requests (id, organization_id) on delete cascade
);

comment on table public.standing_brief_occurrences is
  'A request a person created from a standing brief. The only thing that makes "this brief produced a request" true; generated_by is not null because nothing here runs unattended.';

create index if not exists standing_brief_occurrences_brief_idx
  on public.standing_brief_occurrences (organization_id, brief_id, generated_at desc);

-- ---------------------------------------------------------------------------
-- Suggestions
-- ---------------------------------------------------------------------------
create table if not exists public.request_asset_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  asset_id uuid not null,

  -- Provenance, all six of them, none nullable.
  basis text not null check (char_length(trim(basis)) between 4 and 500),
  basis_signals jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  origin public.suggestion_origin not null default 'deterministic',
  created_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),

  -- Clearance, kept apart from relevance. 'unknown' is a real answer and the
  -- interface must show it as one rather than rounding it to clear.
  clearance text not null default 'unknown'
    check (clearance in ('clear','restricted','unknown')),
  clearance_note text check (clearance_note is null or char_length(clearance_note) <= 500),

  state public.suggestion_state not null default 'live',
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),

  -- One row per pair, which is what stops a second run producing a second live
  -- suggestion for the same frame. A refresh updates this row; it never
  -- resurrects one a person already decided.
  unique (request_id, asset_id),

  constraint request_asset_suggestions_decision_is_attributable check (
    (state = 'live' and decided_by is null and decided_at is null)
    or (state <> 'live' and decided_by is not null and decided_at is not null)
  ),
  -- Only a person decides. There is no automatic acceptance in this phase and
  -- the model origin cannot be written at all yet.
  constraint request_asset_suggestions_model_not_in_this_phase check (origin = 'deterministic'),

  foreign key (request_id, organization_id)
    references public.buyer_requests (id, organization_id) on delete cascade,
  foreign key (asset_id, organization_id)
    references public.assets (id, organization_id) on delete cascade
);

comment on table public.request_asset_suggestions is
  'A proposal that a frame may answer a request, with its basis, confidence and origin. Never a selection: accepting one writes request_assets, which stays the single record of what was chosen.';
comment on column public.request_asset_suggestions.clearance is
  'Whether the frame may commercially be sent, which is a different question from whether it is relevant. unknown is a real answer and must be shown as one.';
comment on constraint request_asset_suggestions_model_not_in_this_phase on public.request_asset_suggestions is
  'Drop this in the phase that introduces model ranking, and only once it can be shown to improve it.';

create index if not exists request_asset_suggestions_request_idx
  on public.request_asset_suggestions (organization_id, request_id, state, confidence desc);
create index if not exists request_asset_suggestions_asset_idx
  on public.request_asset_suggestions (organization_id, asset_id);

-- ---------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['standing_briefs','standing_brief_occurrences','request_asset_suggestions'] loop
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

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

drop trigger if exists set_updated_at on public.standing_briefs;
create trigger set_updated_at before update on public.standing_briefs
for each row execute function private.set_updated_at();

revoke all on all tables in schema public from anon;
