-- The slug registry: a workspace address becomes durable identity.
--
-- Workspace URLs are moving from a cookie to the path -- /laurenproctor/work
-- rather than /work plus a cookie saying which workspace that means. Once an
-- address is in the URL it is pasted into messages, bookmarked, and sent to
-- picture desks, so it stops being a display detail and becomes something the
-- product has to keep its word about.
--
-- organizations.slug already existed and was almost enough. What it could not
-- do is remember. A rename simply overwrote it, which meant every link anyone
-- had ever shared died silently, and the freed slug could later be taken by a
-- different workspace -- so an old link would not 404, it would quietly land
-- somebody in somebody else's studio. That is the failure this table exists to
-- make impossible.
--
-- The rule, and the reason for nearly every decision below: a slug is never
-- released and never reassigned. It belongs to the organization that first held
-- it, for as long as the database exists. Redirects and eventual reuse cannot
-- both be true, because a client that cached the redirect would be delivered to
-- the wrong workspace after the reuse.
--
-- workspace_slugs is canonical. organizations.slug stays as a compatibility
-- mirror so nothing that reads it has to change in the same deploy, but it is
-- no longer the source of truth and can no longer be written directly.

-- ---------------------------------------------------------------------------
-- Format and reserved words, enforced here rather than only in TypeScript
-- ---------------------------------------------------------------------------

-- Kebab-case, 1-40 characters, matching organizations.slug's existing check and
-- the 40-character cap in slugifyWorkspace().
create or replace function private.slug_format_ok(candidate text)
returns boolean language sql immutable set search_path = '' as $$
  select candidate is not null
     and char_length(candidate) between 1 and 40
     and candidate ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$';
$$;

/*
 * Words a workspace may not take, because a slug sits at the root of the site.
 *
 * A workspace called "pricing" would sit at /pricing, where the marketing page
 * already lives. Next resolves a static route before a dynamic one, so the
 * workspace would not be a security problem -- it would simply be unreachable,
 * its owner staring at a pricing page. This is the same collision that broke
 * the build when /commercial existed twice.
 *
 * The list is every marketing route, every top-level application segment, the
 * auth screens, and the handful of names any site eventually wants. It is kept
 * in step with src/lib/routes.ts by a test, because the two drifting apart is
 * how a route added next year quietly becomes unreachable.
 */
create or replace function private.reserved_slugs()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    -- Marketing
    'acceptable-use','accessibility','commercial','company','copyright',
    'early-access','editors','how-it-works','press','pricing','privacy',
    'product','security','subjects','teams','terms','trust','welcome',
    -- Application
    'api','archive','assets','auth','billing','d','dispatch','money','news',
    'onboarding','rights','secure-your-account','settings','shoots',
    'submissions','work','workspace',
    -- Auth screens and their redirects
    'login','reset-password','sign-in','sign-up','signup',
    -- Reserved for the site itself
    'about','admin','app','blog','cdn','contact','docs','help','mail','static',
    'status','support','www'
  ]::text[];
$$;

create or replace function private.slug_is_reserved(candidate text)
returns boolean language sql immutable set search_path = '' as $$
  select candidate = any(private.reserved_slugs());
$$;

revoke all on function private.slug_format_ok(text) from public;
revoke all on function private.reserved_slugs() from public;
revoke all on function private.slug_is_reserved(text) from public;
grant execute on function private.slug_format_ok(text) to authenticated;
grant execute on function private.reserved_slugs() to authenticated;
grant execute on function private.slug_is_reserved(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The registry
-- ---------------------------------------------------------------------------

create table public.workspace_slugs (
  slug text primary key,
  -- Nullable only for the purge case below: a hard-deleted organization leaves
  -- its slugs behind as tombstones so they stay unclaimable.
  organization_id uuid references public.organizations(id) on delete restrict,
  is_current boolean not null default true,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  -- The two states are "current, never retired" and "retired, not current".
  -- Nothing else is meaningful, and without this a row could claim both.
  constraint workspace_slugs_state check (
    (is_current and retired_at is null)
    or (not is_current and retired_at is not null)
  ),
  constraint workspace_slugs_format check (private.slug_format_ok(slug))
);

-- The primary key already gives global uniqueness across current AND historical
-- slugs, which is what stops one workspace claiming another's former address.
-- This one says an organization has AT MOST one current slug; the creation and
-- rename paths are what maintain the stronger promise of exactly one.
create unique index workspace_slugs_one_current
  on public.workspace_slugs (organization_id) where is_current;

-- Historical lookups go the other way: given an organization, what did it hold?
create index workspace_slugs_by_org on public.workspace_slugs (organization_id);

comment on table public.workspace_slugs is
  'Every slug an organization has ever held. Canonical; organizations.slug mirrors the current row. Slugs are never released or reassigned.';

-- Backfill. Deliberately permissive: an existing workspace may already hold a
-- now-reserved word, and renaming it here would destroy the history this table
-- exists to keep. Collisions are resolved afterwards through the RPC, which
-- preserves the old value as a historical reservation.
insert into public.workspace_slugs (slug, organization_id, is_current, created_at)
select o.slug, o.id, true, o.created_at
from public.organizations o;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.workspace_slugs enable row level security;
alter table public.workspace_slugs force row level security;

-- Members read their own workspace's addresses, current and historical, which
-- is what lets an old link be resolved without a public slug lookup. A
-- non-member sees nothing, so the registry cannot be used to enumerate
-- workspaces or to confirm that a particular studio exists.
create policy workspace_slugs_select on public.workspace_slugs
  for select to authenticated
  using (organization_id is not null and private.is_org_member(organization_id));

-- No insert, update or delete policy exists. Every write goes through
-- rename_workspace_slug() or create_workspace(), which are security definer.

grant select on public.workspace_slugs to authenticated;
grant select, insert, update on public.workspace_slugs to service_role;

-- ---------------------------------------------------------------------------
-- Every organization registers its address, whatever created it
-- ---------------------------------------------------------------------------

/*
 * Registration is a trigger rather than a line inside create_workspace.
 *
 * The first draft of this migration put the insert in create_workspace, which
 * covers the only path the application uses and misses every other one. The
 * seed found it immediately: seed.sql inserts organizations directly, so a
 * freshly reset database had workspaces with no address on record -- and the
 * invariant this table exists to hold ("every live organization has exactly one
 * current slug") was true only for as long as everybody remembered it.
 *
 * As a trigger it is structural. The seed, a future admin script, and a hand
 * written insert all register, and all fail the same way on a slug somebody
 * already holds -- because the primary key refuses it, whether that slug is
 * current or was retired years ago.
 */
create or replace function private.organizations_register_slug()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Raised as a duplicate because the caller's remedy is the same either way:
  -- choose another address. The onboarding action already retries on this.
  if private.slug_is_reserved(new.slug) then
    raise exception 'The workspace address % is reserved', new.slug
      using errcode = 'unique_violation';
  end if;

  insert into public.workspace_slugs (slug, organization_id)
  values (new.slug, new.id);

  return new;
end;
$$;

create trigger organizations_register_slug
  after insert on public.organizations
  for each row execute function private.organizations_register_slug();

-- ---------------------------------------------------------------------------
-- The mirror cannot drift
-- ---------------------------------------------------------------------------

/*
 * organizations.slug may only change to whatever the registry already says.
 *
 * A column-level revoke was the obvious alternative and does not work here:
 * `authenticated` holds table-level UPDATE on organizations, and in PostgreSQL
 * a table-level grant covers every column -- revoking one column back out is a
 * no-op. Making it real would mean revoking UPDATE entirely and re-granting
 * thirty columns by name, after which every future `add column` silently breaks
 * whichever feature forgot to grant it. That is the same reliance on implicit
 * grant behaviour that migration 20260825170000 was written to remove.
 *
 * A trigger is both simpler and stronger: it binds every role, including
 * service_role and postgres, and it needs no flag to be set correctly by the
 * caller. The rename RPC writes the registry first, so its own mirror update
 * satisfies this check; nothing else can.
 */
create or replace function private.organizations_slug_follows_registry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.slug is distinct from old.slug then
    if not exists (
      select 1 from public.workspace_slugs ws
      where ws.organization_id = new.id
        and ws.is_current
        and ws.slug = new.slug
    ) then
      raise exception
        'The workspace address is changed with rename_workspace_slug(), which keeps the registry and its history in step'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger organizations_slug_follows_registry
  before update of slug on public.organizations
  for each row execute function private.organizations_slug_follows_registry();

-- ---------------------------------------------------------------------------
-- Renaming
-- ---------------------------------------------------------------------------

/*
 * Change a workspace's address, or say precisely why not.
 *
 * Returns one of: renamed, unchanged, invalid, reserved, taken, rate_limited,
 * not_found. A structured outcome rather than an exception, so the interface
 * never has to read a database error string to decide what to tell somebody --
 * and so "taken" reads the same whether it was discovered by a lookup or by
 * losing a race for it.
 *
 * The availability check the form performs while typing is advisory only. This
 * function is the authority, because a slug can be claimed between the moment
 * it is checked and the moment the form is submitted.
 */
create or replace function public.rename_workspace_slug(target_org uuid, new_slug text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  candidate text := lower(trim(coalesce(new_slug, '')));
  current_slug text;
  holder uuid;
  renames integer;
begin
  if caller is null then
    raise exception 'Sign in before changing a workspace address'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * Lock the organization row, not the current-slug row.
   *
   * The current-slug row is the wrong mutex because its identity changes
   * inside this transaction: it is retired half way through and a different
   * row takes its place, so two concurrent calls could lock two different
   * rows and both believe they held the gate. The organization row is stable
   * for the life of the workspace, which is exactly what a mutex needs to be.
   */
  perform 1 from public.organizations where id = target_org for update;
  if not found then
    return 'not_found';
  end if;

  -- Ownership is checked after the lock, so a membership change racing this
  -- call resolves one way or the other rather than half way.
  if not exists (
    select 1 from public.memberships m
    where m.organization_id = target_org
      and m.user_id = caller
      and m.status = 'active'
      and m.role = 'owner'
  ) then
    raise exception 'Only an owner can change the workspace address'
      using errcode = 'insufficient_privilege';
  end if;

  select ws.slug into current_slug
  from public.workspace_slugs ws
  where ws.organization_id = target_org and ws.is_current;

  if candidate = current_slug then
    return 'unchanged';
  end if;

  if not private.slug_format_ok(candidate) then
    return 'invalid';
  end if;

  if private.slug_is_reserved(candidate) then
    return 'reserved';
  end if;

  select ws.organization_id into holder
  from public.workspace_slugs ws
  where ws.slug = candidate;

  -- Held by somebody else, now or at any point in the past. Never available.
  if holder is not null and holder <> target_org then
    return 'taken';
  end if;
  -- A tombstoned slug from a purged organization keeps its reservation too.
  if holder is null and exists (select 1 from public.workspace_slugs ws where ws.slug = candidate) then
    return 'taken';
  end if;

  /*
   * The rolling limit counts successful renames only.
   *
   * It reads the audit events rather than the registry, because the registry
   * records what a workspace holds and the question here is how often somebody
   * has moved it. A rejected attempt -- reserved, taken, malformed -- costs
   * nothing and must not spend an allowance.
   */
  select count(*) into renames
  from public.activity_events e
  where e.organization_id = target_org
    and e.action = 'workspace.slug.renamed'
    and e.created_at > now() - interval '12 months';

  if renames >= 3 then
    return 'rate_limited';
  end if;

  update public.workspace_slugs
     set is_current = false, retired_at = now()
   where organization_id = target_org and is_current;

  if holder = target_org then
    -- Returning to an address this workspace held before. Allowed, and it
    -- spends an allowance like any other move.
    update public.workspace_slugs
       set is_current = true, retired_at = null
     where slug = candidate;
  else
    insert into public.workspace_slugs (slug, organization_id)
    values (candidate, target_org);
  end if;

  -- The registry is now correct, which is the condition the trigger checks.
  update public.organizations
     set slug = candidate, updated_at = now()
   where id = target_org;

  insert into public.activity_events (
    organization_id, actor_id, entity_type, entity_id, action, event_data
  )
  values (
    target_org, caller, 'organization', target_org, 'workspace.slug.renamed',
    jsonb_build_object(
      'summary', format('Workspace address changed from %s to %s', current_slug, candidate),
      'from', current_slug,
      'to', candidate
    )
  );

  return 'renamed';
exception
  -- Another transaction took the slug between the check above and the insert.
  -- The whole body rolls back to the start of this block, so the retirement is
  -- undone with it and the workspace keeps the address it had.
  when unique_violation then
    return 'taken';
end;
$$;

revoke all on function public.rename_workspace_slug(uuid, text) from public;
revoke all on function public.rename_workspace_slug(uuid, text) from anon;
grant execute on function public.rename_workspace_slug(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Creation writes the registry row in the same transaction
-- ---------------------------------------------------------------------------

/*
 * create_workspace, now registering the slug it hands out.
 *
 * One addition, and nothing else about this function changes: the slug's shape
 * is checked before any work is done, so a malformed address fails with a
 * sentence rather than a constraint name.
 *
 * Registration itself belongs to the trigger on public.organizations, which
 * catches reserved and already-held addresses on every insert path rather than
 * only this one. Both are raised as unique_violation on purpose: the onboarding
 * action retries a collision with a random suffix, so "press" becomes
 * "press-k3f9" and the photographer never sees a failure on their first screen.
 */
create or replace function public.create_workspace(
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

  -- The slug, checked before anything is written ---------------------------

  if not private.slug_format_ok(workspace_slug) then
    raise exception 'That workspace address is not a usable one'
      using errcode = 'check_violation';
  end if;

  -- Reserved words and already-held addresses are refused by the registration
  -- trigger on public.organizations, which every insert path goes through.

  -- Profile, validated before anything is written --------------------------

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

-- ---------------------------------------------------------------------------
-- Purging an organization leaves its addresses behind
-- ---------------------------------------------------------------------------

/*
 * The registry's foreign key is ON DELETE RESTRICT, which would stop this
 * routine dead. That is deliberate: a hard delete should not be able to quietly
 * release addresses other people may still hold links to.
 *
 * So the purge opts in explicitly. The organization's slugs are detached and
 * retired rather than deleted -- the primary key still holds the text, so
 * nothing can ever claim it again -- and only then does the organization go.
 * A tombstoned row has no organization_id, which also puts it beyond the RLS
 * policy: nobody can read it, and nobody can take it.
 */
create or replace function private.purge_organization(target_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('mastline.allow_purge', 'on', true);
  -- submissions restrict packages, and package_assets restrict asset_versions,
  -- so these have to go before the organization cascade can run.
  delete from public.submissions where organization_id = target_org;
  delete from public.package_assets where organization_id = target_org;
  delete from public.license_assets where organization_id = target_org;
  delete from public.asset_versions where organization_id = target_org;
  delete from public.assets where organization_id = target_org;
  -- Tombstone the addresses before the RESTRICT can refuse the delete.
  update public.workspace_slugs
     set organization_id = null,
         is_current = false,
         retired_at = coalesce(retired_at, now())
   where organization_id = target_org;
  delete from public.organizations where id = target_org;
  perform set_config('mastline.allow_purge', 'off', true);
end;
$$;

revoke all on function private.purge_organization(uuid) from public;
revoke all on function private.purge_organization(uuid) from authenticated;

revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- The reserved list, readable so it can be compared against the application's
-- ---------------------------------------------------------------------------

/*
 * private.reserved_slugs() is not reachable from the Data API, and the list has
 * to be comparable against src/lib/slug.ts or the two silently drift. This
 * exposes it to the service role only: it is not a secret, but it is also not
 * something an anonymous caller needs, and a shorter reachable surface is worth
 * more than the convenience.
 */
create or replace function public.reserved_slugs_admin()
returns text[] language sql stable security definer set search_path = '' as $$
  select private.reserved_slugs();
$$;

revoke all on function public.reserved_slugs_admin() from public;
revoke all on function public.reserved_slugs_admin() from anon;
revoke all on function public.reserved_slugs_admin() from authenticated;
grant execute on function public.reserved_slugs_admin() to service_role;
