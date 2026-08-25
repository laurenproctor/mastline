-- What onboarding learns about a photographer, kept.
--
-- The seven-step flow asked a photographer how they work, what they shoot, what
-- they want first, and whether to run the Sales Engine -- then dropped every
-- answer on submit. Two fields reached the database. These columns are the
-- other end of that flow.
--
-- Shape notes:
--
--   * `work_style` is a text column with a check constraint rather than an
--     enum. The repository uses enums for canonical status vocabularies that
--     `src/lib/domain.ts` mirrors one-for-one (app_role, shoot_status). It uses
--     checked text for smaller sets that are expected to move -- buyer_type,
--     shoot priority, asset_kind, membership status. An onboarding answer is
--     the second kind: widening it should be one migration, not a type change
--     with a rewrite behind it.
--
--   * `specialties` and `onboarding_goals` are text[] rather than the jsonb
--     used elsewhere for lists. jsonb is right for keywords and subjects, which
--     are open vocabularies. These two are closed sets drawn from a fixed
--     menu, and text[] lets the database say so with `<@`. jsonb cannot
--     constrain membership without a trigger. This is a deliberate departure
--     from the surrounding convention; see docs/DECISIONS.md.
--
--   * Machine keys, not display labels. The interface renders "Street style"
--     from the key `street_style`, so the wording can change without a data
--     migration.
--
-- ROLLBACK
--
--   begin;
--     drop function if exists public.create_workspace(
--       text, text, text, integer, bigint, integer, boolean, jsonb);
--     -- then re-run 20260825090000_create_workspace_is_idempotent.sql verbatim
--     -- to restore the 7-argument function.
--     alter table public.organizations
--       drop column if exists work_style,
--       drop column if exists base_city,
--       drop column if exists specialties,
--       drop column if exists onboarding_goals,
--       drop column if exists sales_engine_enabled,
--       drop column if exists sales_engine_enabled_at,
--       drop column if exists sales_engine_terms_version,
--       drop column if exists onboarding_completed_at,
--       drop column if exists onboarding_version;
--   commit;
--
--   Dropping the columns discards recorded Sales Engine consent. The matching
--   `organization.sales_engine.enabled` activity events are append-only and
--   survive, so the consent record is not lost with the column.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists work_style text,
  add column if not exists base_city text,
  add column if not exists specialties text[] not null default '{}'::text[],
  add column if not exists onboarding_goals text[] not null default '{}'::text[],
  add column if not exists sales_engine_enabled boolean not null default false,
  add column if not exists sales_engine_enabled_at timestamptz,
  add column if not exists sales_engine_terms_version text,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists onboarding_version integer not null default 0;

comment on column public.organizations.work_style is
  'How the photographer described their practice at onboarding. Self-reported, not a permission.';
comment on column public.organizations.specialties is
  'Closed set of subject areas, machine keys. Display labels live in the interface.';
comment on column public.organizations.onboarding_goals is
  'What the photographer said Mastline should handle first. Used to order the work queue, never to gate a feature.';
comment on column public.organizations.sales_engine_enabled is
  'Whether this workspace opted into the Mastline Sales Engine. Governs the 70/30 split, so the opt-in is also an append-only activity event.';
comment on column public.organizations.sales_engine_terms_version is
  'Which commercial terms were on screen when consent was given. Without this the boolean says nothing about what was agreed to.';
comment on column public.organizations.onboarding_version is
  '0 means never completed. A completed run stamps the flow version so the funnel stays readable when the flow changes.';

-- ---------------------------------------------------------------------------
-- Controlled sets
-- ---------------------------------------------------------------------------

alter table public.organizations
  drop constraint if exists organizations_work_style_check;
alter table public.organizations
  add constraint organizations_work_style_check check (
    work_style is null
    or work_style in ('independent', 'agency', 'team', 'contributor')
  );

alter table public.organizations
  drop constraint if exists organizations_specialties_check;
alter table public.organizations
  add constraint organizations_specialties_check check (
    specialties <@ array[
      'celebrity', 'street_style', 'entertainment', 'events', 'news', 'portraits'
    ]::text[]
    and array_position(specialties, null) is null
  );

alter table public.organizations
  drop constraint if exists organizations_onboarding_goals_check;
alter table public.organizations
  add constraint organizations_onboarding_goals_check check (
    onboarding_goals <@ array[
      'organize', 'dispatch', 'editorial', 'brands', 'rights', 'archive'
    ]::text[]
    and array_position(onboarding_goals, null) is null
  );

-- Consent is a fact with a date and a document, or it is not consent. A bare
-- boolean cannot answer "agreed to what, and when" about the 70/30 split.
alter table public.organizations
  drop constraint if exists organizations_sales_engine_consent_check;
alter table public.organizations
  add constraint organizations_sales_engine_consent_check check (
    sales_engine_enabled = false
    or (sales_engine_enabled_at is not null and sales_engine_terms_version is not null)
  );

alter table public.organizations
  drop constraint if exists organizations_onboarding_version_check;
alter table public.organizations
  add constraint organizations_onboarding_version_check check (
    onboarding_version >= 0
    and (onboarding_completed_at is null) = (onboarding_version = 0)
  );

-- ---------------------------------------------------------------------------
-- create_workspace, now carrying the onboarding profile
--
-- One argument, not nine. The function already had six positional parameters
-- and a seventh flag; adding a column per onboarding answer would make the call
-- site unreadable and every future answer a signature change. The profile
-- arrives as one jsonb document, is validated here, and lands in typed columns.
--
-- Everything the idempotency migration established is preserved unchanged:
-- ownership (not membership) is the test, the oldest owned workspace wins so a
-- repeat always resolves to the same row, `allow_additional` still opens the
-- door to a deliberate second workspace, and the billing-write escape still
-- brackets the insert.
--
-- A repeat call returns the existing workspace and does NOT apply the profile.
-- A double-submitted form must not overwrite settings the photographer may have
-- since changed.
-- ---------------------------------------------------------------------------

drop function if exists public.create_workspace(text, text, text, integer, bigint, integer, boolean);

create function public.create_workspace(
  workspace_name text,
  workspace_slug text,
  workspace_timezone text default 'America/New_York',
  trial_days integer default 30,
  trial_storage_bytes bigint default 26843545600,
  trial_seats integer default 1,
  allow_additional boolean default false,
  onboarding_profile jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org uuid;
  existing uuid;
  caller uuid := (select auth.uid());
  p_work_style text;
  p_base_city text;
  p_specialties text[];
  p_goals text[];
  p_sales_engine boolean;
  p_terms_version text;
  p_version integer;
  p_completed_at timestamptz;
  p_enabled_at timestamptz;
begin
  if caller is null then
    raise exception 'Sign in before creating a workspace' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(workspace_name), '') = '' then
    raise exception 'A workspace needs a name' using errcode = 'check_violation';
  end if;

  if not allow_additional then
    -- Oldest first, so a repeat always resolves to the same workspace rather
    -- than whichever row happened to come back.
    select m.organization_id into existing
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = caller
      and m.role = 'owner'
      and m.status <> 'suspended'
    order by o.created_at
    limit 1;

    if existing is not null then
      return existing;
    end if;
  end if;

  -- Profile, validated before anything is written -------------------------

  p_work_style := nullif(trim(coalesce(onboarding_profile->>'work_style', '')), '');
  p_base_city := nullif(trim(coalesce(onboarding_profile->>'base_city', '')), '');
  p_terms_version := nullif(trim(coalesce(onboarding_profile->>'sales_engine_terms_version', '')), '');

  select coalesce(array_agg(distinct entry), '{}'::text[]) into p_specialties
  from jsonb_array_elements_text(
    case when jsonb_typeof(onboarding_profile->'specialties') = 'array'
      then onboarding_profile->'specialties' else '[]'::jsonb end
  ) as entry;

  select coalesce(array_agg(distinct entry), '{}'::text[]) into p_goals
  from jsonb_array_elements_text(
    case when jsonb_typeof(onboarding_profile->'goals') = 'array'
      then onboarding_profile->'goals' else '[]'::jsonb end
  ) as entry;

  p_sales_engine := coalesce(
    case when jsonb_typeof(onboarding_profile->'sales_engine_enabled') = 'boolean'
      then (onboarding_profile->>'sales_engine_enabled')::boolean end,
    false
  );

  p_version := coalesce(
    case when jsonb_typeof(onboarding_profile->'onboarding_version') = 'number'
      then (onboarding_profile->>'onboarding_version')::integer end,
    0
  );

  -- Consent needs a document. Refusing here beats storing a boolean nobody can
  -- later explain, given what this flag governs.
  if p_sales_engine and p_terms_version is null then
    raise exception
      'Sales Engine consent needs the terms version that was presented'
      using errcode = 'check_violation';
  end if;

  -- Both timestamps are the server's. A client cannot backdate consent.
  p_enabled_at := case when p_sales_engine then now() end;
  p_completed_at := case when p_version > 0 then now() end;

  perform set_config('mastline.billing_write', 'on', true);

  insert into public.organizations (
    name, slug, timezone, created_by,
    plan, subscription_status, trial_started_at, trial_ends_at,
    storage_limit_bytes, seat_limit,
    work_style, base_city, specialties, onboarding_goals,
    sales_engine_enabled, sales_engine_enabled_at, sales_engine_terms_version,
    onboarding_completed_at, onboarding_version
  )
  values (
    trim(workspace_name), workspace_slug, workspace_timezone, caller,
    'pro', 'trialing', now(), now() + make_interval(days => trial_days),
    trial_storage_bytes, trial_seats,
    p_work_style, p_base_city, p_specialties, p_goals,
    p_sales_engine, p_enabled_at, p_terms_version,
    p_completed_at, p_version
  )
  returning id into new_org;

  insert into public.memberships (organization_id, user_id, role, status)
  values (new_org, caller, 'owner', 'active');

  insert into public.activity_events (organization_id, actor_id, entity_type, entity_id, action, event_data)
  values (
    new_org, caller, 'organization', new_org, 'workspace.created',
    jsonb_build_object(
      'summary', 'Workspace created',
      'trial_days', trial_days,
      'onboarding_version', p_version
    )
  );

  -- The 70/30 split needs a record of its own. A column can be updated; an
  -- activity event cannot -- the table is append-only -- so this is what can
  -- still answer "who agreed to what, and when" a year from now.
  if p_sales_engine then
    insert into public.activity_events (
      organization_id, actor_id, entity_type, entity_id, action, event_data
    )
    values (
      new_org, caller, 'organization', new_org, 'organization.sales_engine.enabled',
      jsonb_build_object(
        'summary', 'Sales Engine enabled during onboarding',
        'terms_version', p_terms_version,
        'enabled_at', p_enabled_at,
        'source', 'onboarding'
      )
    );
  end if;

  perform set_config('mastline.billing_write', 'off', true);
  return new_org;
end;
$$;

revoke all on function public.create_workspace(text, text, text, integer, bigint, integer, boolean, jsonb) from public;
revoke all on function public.create_workspace(text, text, text, integer, bigint, integer, boolean, jsonb) from anon;
grant execute on function public.create_workspace(text, text, text, integer, bigint, integer, boolean, jsonb) to authenticated;
