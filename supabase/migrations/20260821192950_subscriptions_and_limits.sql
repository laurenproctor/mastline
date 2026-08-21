-- Subscription state, trial expiry, and storage limits.
--
-- The settled trial terms (`docs/DECISIONS.md` item 1): 30 days, no payment
-- method, a storage cap during the trial, and a read-only workspace with export
-- still available when it ends.
--
-- Enforcement lives here rather than only in the application. The interface
-- decides what to offer; the database decides what actually happens, so a
-- lapsed workspace cannot be written to by any code path, including a Server
-- Action someone forgets to guard.
--
-- Read-only means exactly that: SELECT is untouched everywhere, and the export
-- route keeps working. A commercial record is never held hostage.

create type public.subscription_status as enum (
  'trialing',
  'active',
  'past_due',
  'expired',
  'cancelled'
);

alter table public.organizations
  add column plan text not null default 'pro'
    check (plan in ('solo', 'pro', 'studio', 'agency')),
  add column subscription_status public.subscription_status not null default 'trialing',
  add column trial_started_at timestamptz,
  add column trial_ends_at timestamptz,
  -- Null means negotiated, which is how Agency works.
  add column storage_limit_bytes bigint check (storage_limit_bytes is null or storage_limit_bytes > 0),
  add column seat_limit integer check (seat_limit is null or seat_limit > 0),
  -- A trialing workspace must know when its trial ends.
  add constraint organizations_trial_has_an_end
    check (subscription_status <> 'trialing' or trial_ends_at is not null);

comment on column public.organizations.storage_limit_bytes is
  'Bytes of originals and derivatives this workspace may hold. Null means negotiated (Agency).';

-- ---------------------------------------------------------------------------
-- Storage usage
--
-- Derived from the stored versions rather than kept as a counter, for the same
-- reason asset earnings are: a counter drifts and nobody notices until the
-- number is wrong in a conversation about money.
-- ---------------------------------------------------------------------------

create view public.organization_storage_usage
with (security_invoker = on) as
select
  o.id as organization_id,
  coalesce(sum(v.bytes), 0)::bigint as bytes_used,
  count(v.id)::bigint as object_count
from public.organizations o
left join public.asset_versions v on v.organization_id = o.id
group by o.id;

comment on view public.organization_storage_usage is
  'Bytes held per workspace, derived from asset_versions. security_invoker keeps the caller''s RLS in force.';

grant select on public.organization_storage_usage to authenticated;

-- ---------------------------------------------------------------------------
-- Is this workspace writable?
--
-- security definer so the check does not depend on the caller being able to
-- read the organizations row through RLS.
-- ---------------------------------------------------------------------------

create or replace function private.workspace_is_writable(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organizations o
    where o.id = target_org
      and (
        o.subscription_status in ('active', 'past_due')
        -- past_due still writes. A card that failed on Tuesday should not stop
        -- a photographer working a story on Wednesday.
        or (o.subscription_status = 'trialing' and o.trial_ends_at > now())
      )
  );
$$;

revoke all on function private.workspace_is_writable(uuid) from public;
grant execute on function private.workspace_is_writable(uuid) to authenticated;

create or replace function private.enforce_workspace_writable()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_org uuid;
begin
  -- A purge is a deliberate administrative act and is not subject to this.
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  target_org := coalesce(
    case tg_op when 'DELETE' then null else (to_jsonb(new) ->> 'organization_id')::uuid end,
    case tg_op when 'INSERT' then null else (to_jsonb(old) ->> 'organization_id')::uuid end
  );

  if target_org is not null and not private.workspace_is_writable(target_org) then
    raise exception
      'This workspace is read-only. Everything is still readable and exportable; choose a plan to resume importing, dispatching, and recording.'
      using errcode = 'insufficient_privilege';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

-- Applied to the tables that represent doing work. Deliberately NOT applied to
-- organizations or memberships: a lapsed workspace must still be able to change
-- its own plan and manage its people, which is how it stops being lapsed.
do $$
declare target_table text;
begin
  foreach target_table in array array[
    'shoots','shoot_sensitive_notes','shoot_collaborators','assets','asset_versions',
    'asset_caption_revisions','opportunities','packages','package_assets','submissions',
    'submission_delivery_attempts','licenses','license_assets','payments',
    'payment_allocations','revenue_splits','expenses','rights_matches',
    'statement_imports','statement_lines'
  ]
  loop
    execute format(
      'create trigger enforce_workspace_writable before insert or update or delete on public.%I for each row execute function private.enforce_workspace_writable()',
      target_table
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage limit
--
-- Checked when a new version is written. Going over stops the next import; it
-- never touches anything already stored.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_storage_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  allowed bigint;
  used bigint;
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return new;
  end if;

  select o.storage_limit_bytes into allowed
  from public.organizations o where o.id = new.organization_id;

  -- Null means negotiated, so there is nothing to enforce.
  if allowed is null then
    return new;
  end if;

  select coalesce(sum(v.bytes), 0) into used
  from public.asset_versions v where v.organization_id = new.organization_id;

  if used + new.bytes > allowed then
    raise exception
      'Storage is full: this workspace holds % of % bytes. Free space or move up a plan. Nothing already stored is affected.',
      used, allowed
      using errcode = 'disk_full';
  end if;

  return new;
end;
$$;

create trigger asset_versions_enforce_storage_limit
before insert on public.asset_versions
for each row execute function private.enforce_storage_limit();

-- ---------------------------------------------------------------------------
-- Seat limit
-- ---------------------------------------------------------------------------

create or replace function private.enforce_seat_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  allowed integer;
  taken integer;
begin
  select o.seat_limit into allowed
  from public.organizations o where o.id = new.organization_id;

  if allowed is null then
    return new;
  end if;

  select count(*) into taken
  from public.memberships m
  where m.organization_id = new.organization_id and m.status <> 'suspended';

  if taken >= allowed then
    raise exception
      'This plan includes % people. Move up a plan to add another.', allowed
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger memberships_enforce_seat_limit
before insert on public.memberships
for each row execute function private.enforce_seat_limit();

-- ---------------------------------------------------------------------------
-- Creating a workspace
--
-- A new workspace and its founding owner have to appear together. Doing it as
-- one security-definer call avoids the window where an organization exists with
-- nobody able to reach it, and sets the trial from the approved constants.
-- ---------------------------------------------------------------------------

create or replace function public.create_workspace(
  workspace_name text,
  workspace_slug text,
  workspace_timezone text default 'America/New_York',
  trial_days integer default 30,
  trial_storage_bytes bigint default 26843545600,
  trial_seats integer default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org uuid;
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'Sign in before creating a workspace' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(workspace_name), '') = '' then
    raise exception 'A workspace needs a name' using errcode = 'check_violation';
  end if;

  insert into public.organizations (
    name, slug, timezone, created_by,
    plan, subscription_status, trial_started_at, trial_ends_at,
    storage_limit_bytes, seat_limit
  )
  values (
    trim(workspace_name), workspace_slug, workspace_timezone, caller,
    'pro', 'trialing', now(), now() + make_interval(days => trial_days),
    trial_storage_bytes, trial_seats
  )
  returning id into new_org;

  insert into public.memberships (organization_id, user_id, role, status)
  values (new_org, caller, 'owner', 'active');

  insert into public.activity_events (organization_id, actor_id, entity_type, entity_id, action, event_data)
  values (
    new_org, caller, 'organization', new_org, 'workspace.created',
    jsonb_build_object('summary', 'Workspace created', 'trial_days', trial_days)
  );

  return new_org;
end;
$$;

revoke all on function public.create_workspace(text, text, text, integer, bigint, integer) from public;
revoke all on function public.create_workspace(text, text, text, integer, bigint, integer) from anon;
grant execute on function public.create_workspace(text, text, text, integer, bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Existing workspaces
--
-- The seeded workspaces are treated as paying customers, so local development
-- and every existing test keep working rather than tripping the new triggers.
-- ---------------------------------------------------------------------------

update public.organizations
set
  plan = 'studio',
  subscription_status = 'active',
  storage_limit_bytes = 5 * 1024 ^ 4,
  seat_limit = 10
where subscription_status = 'trialing' and trial_ends_at is null;

-- Supabase default privileges grant new objects to anon; take that back.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;
