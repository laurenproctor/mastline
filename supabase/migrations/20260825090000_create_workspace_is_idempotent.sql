-- Creating a workspace twice creates one workspace.
--
-- The function had no guard against a caller who already owns one, so two calls
-- produced two. The onboarding page redirects anyone who has a workspace, which
-- covers the ordinary path and loses to a race: a double click, a slow network,
-- a back button re-post. Each extra workspace also minted another 30-day trial,
-- which is the abuse that `docs/DECISIONS.md` item 1 is still open about.
--
-- Ownership is the test, not membership. Someone invited into another
-- photographer's studio as an editor has no workspace of their own and must
-- still be able to make one; handing them their employer's would be wrong.
--
-- `allow_additional` leaves the door open for a deliberate second workspace
-- later without reopening this one. Onboarding uses the default.

drop function if exists public.create_workspace(text, text, text, integer, bigint, integer);

create function public.create_workspace(
  workspace_name text,
  workspace_slug text,
  workspace_timezone text default 'America/New_York',
  trial_days integer default 30,
  trial_storage_bytes bigint default 26843545600,
  trial_seats integer default 1,
  allow_additional boolean default false
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

  perform set_config('mastline.billing_write', 'on', true);

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

  perform set_config('mastline.billing_write', 'off', true);
  return new_org;
end;
$$;

revoke all on function public.create_workspace(text, text, text, integer, bigint, integer, boolean) from public;
revoke all on function public.create_workspace(text, text, text, integer, bigint, integer, boolean) from anon;
grant execute on function public.create_workspace(text, text, text, integer, bigint, integer, boolean) to authenticated;
