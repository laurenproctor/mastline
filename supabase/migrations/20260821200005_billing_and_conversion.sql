-- Conversion: how a trialing workspace starts paying.
--
-- Settled terms (`docs/DECISIONS.md` item 1, conversion half):
--   * Stripe, with Mastline as the seller of record.
--   * A card attached mid-trial does not bring the charge forward. The trial
--     runs its full course; the first charge lands when it ends.
--   * A failed renewal keeps the workspace working for 14 days, then read-only.
--
-- Writability is DERIVED from the recorded dates rather than flipped by a
-- nightly job. There is nothing to schedule and nothing that can fall behind.

alter table public.organizations
  -- Provider identifiers. Nullable because a workspace exists before it pays,
  -- and unique because two workspaces must never share a customer or a
  -- subscription -- that is how billing gets applied to the wrong account.
  add column stripe_customer_id text unique,
  add column stripe_subscription_id text unique,
  add column billing_period text check (billing_period in ('annual', 'monthly')),
  -- Set when a card is on file. A trial with a card still runs its course; this
  -- lifts the trial storage cap and nothing else.
  add column payment_method_attached_at timestamptz,
  -- When the renewal first failed. Drives the grace window.
  add column past_due_since timestamptz,
  add column current_period_end timestamptz,
  add column cancel_at_period_end boolean not null default false,
  -- A past-due workspace must know when it went past due, or the grace window
  -- has no start and the workspace would keep writing forever.
  add constraint organizations_past_due_has_a_start
    check (subscription_status <> 'past_due' or past_due_since is not null);

comment on column public.organizations.payment_method_attached_at is
  'When a card was attached. Lifts the trial storage cap immediately; does NOT end the trial or bring the first charge forward.';

comment on column public.organizations.past_due_since is
  'When a renewal first failed. The workspace keeps writing for 14 days from this point, then goes read-only.';

-- ---------------------------------------------------------------------------
-- Writability, now including the grace window
--
-- Replaces the Phase 3 version, which let a past-due workspace write forever.
-- ---------------------------------------------------------------------------

create or replace function private.workspace_is_writable(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organizations o
    where o.id = target_org
      and (
        o.subscription_status = 'active'
        or (o.subscription_status = 'trialing' and o.trial_ends_at > now())
        -- A card that failed on Tuesday should not stop a photographer working
        -- a story on Wednesday, but it cannot be indefinite either.
        or (
          o.subscription_status = 'past_due'
          and o.past_due_since > now() - interval '14 days'
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Effective storage allowance
--
-- A trial is capped until a card is attached. Rather than rewrite the limit
-- column every time billing changes -- which is a value that can drift out of
-- step with the subscription -- the enforcement asks what the allowance is now.
-- ---------------------------------------------------------------------------

create or replace function private.workspace_storage_allowance(target_org uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select case
    -- Null means negotiated, so there is nothing to enforce.
    when o.storage_limit_bytes is null then null
    -- A trial with no card on file stays at its cap.
    when o.subscription_status = 'trialing' and o.payment_method_attached_at is null
      then o.storage_limit_bytes
    -- Otherwise the plan's own allowance applies, which is what a paying
    -- customer and a committed trialist both expect.
    else greatest(o.storage_limit_bytes, o.plan_storage_bytes)
  end
  from (
    select
      o.*,
      case o.plan
        when 'solo' then 250::bigint * 1024 * 1024 * 1024
        when 'pro' then 1024::bigint * 1024 * 1024 * 1024
        when 'studio' then 5::bigint * 1024 * 1024 * 1024 * 1024
        else null
      end as plan_storage_bytes
    from public.organizations o
    where o.id = target_org
  ) o;
$$;

create or replace function private.enforce_storage_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  allowed bigint;
  used bigint;
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return new;
  end if;

  allowed := private.workspace_storage_allowance(new.organization_id);
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

-- ---------------------------------------------------------------------------
-- Billing changes come from the provider, not from the customer
--
-- A workspace owner may change their own timezone and name. They may not set
-- their own plan, subscription status, or provider identifiers: those follow
-- from a real payment and are written by the webhook handler with the service
-- role. Without this, an owner could grant themselves Studio with an UPDATE.
-- ---------------------------------------------------------------------------

create or replace function private.protect_billing_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The service role bypasses RLS but still runs triggers, so the webhook
  -- handler announces itself rather than being guessed at.
  if coalesce(current_setting('mastline.billing_write', true), 'off') = 'on' then
    return new;
  end if;

  if new.plan is distinct from old.plan
     or new.subscription_status is distinct from old.subscription_status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.storage_limit_bytes is distinct from old.storage_limit_bytes
     or new.seat_limit is distinct from old.seat_limit
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.payment_method_attached_at is distinct from old.payment_method_attached_at
     or new.past_due_since is distinct from old.past_due_since
     or new.current_period_end is distinct from old.current_period_end
     or new.cancel_at_period_end is distinct from old.cancel_at_period_end
  then
    raise exception
      'Billing state follows from a payment and cannot be set directly.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger organizations_protect_billing
before update on public.organizations
for each row execute function private.protect_billing_columns();

-- ---------------------------------------------------------------------------
-- The one path that may write billing state
--
-- Service role only. Every change goes through here so there is a single place
-- to read when asking why a workspace is on the plan it is on.
-- ---------------------------------------------------------------------------

create or replace function public.apply_billing_state(
  target_org uuid,
  new_plan text default null,
  new_status public.subscription_status default null,
  new_billing_period text default null,
  new_customer_id text default null,
  new_subscription_id text default null,
  new_payment_method_attached_at timestamptz default null,
  new_past_due_since timestamptz default null,
  new_current_period_end timestamptz default null,
  new_cancel_at_period_end boolean default null,
  new_storage_limit_bytes bigint default null,
  new_seat_limit integer default null,
  -- Explicit clears. Every other parameter coalesces, so passing null means
  -- "leave alone" -- which is right for a partial update but makes removal
  -- impossible without saying so deliberately.
  clear_trial boolean default false,
  clear_payment_method boolean default false,
  clear_subscription boolean default false,
  -- Clearing the allowance is what puts a workspace on a negotiated (Agency)
  -- footing, where there is no limit to enforce.
  clear_storage_limit boolean default false,
  -- Extending a trial is a real support action for a pilot workspace, so there
  -- has to be a way to set this that is not a raw UPDATE.
  new_trial_ends_at timestamptz default null,
  clear_customer boolean default false
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('mastline.billing_write', 'on', true);

  update public.organizations set
    plan = coalesce(new_plan, plan),
    subscription_status = coalesce(new_status, subscription_status),
    billing_period = coalesce(new_billing_period, billing_period),
    stripe_subscription_id = case
      when clear_subscription then null
      else coalesce(new_subscription_id, stripe_subscription_id)
    end,
    payment_method_attached_at = case
      when clear_payment_method then null
      else coalesce(new_payment_method_attached_at, payment_method_attached_at)
    end,
    -- Explicitly clearable: a recovered payment has no past-due date.
    past_due_since = case
      when coalesce(new_status, subscription_status) <> 'past_due' then null
      else coalesce(new_past_due_since, past_due_since, now())
    end,
    current_period_end = coalesce(new_current_period_end, current_period_end),
    cancel_at_period_end = coalesce(new_cancel_at_period_end, cancel_at_period_end),
    storage_limit_bytes = case
      when clear_storage_limit then null
      else coalesce(new_storage_limit_bytes, storage_limit_bytes)
    end,
    seat_limit = coalesce(new_seat_limit, seat_limit),
    trial_ends_at = case
      when clear_trial then null
      else coalesce(new_trial_ends_at, trial_ends_at)
    end,
    stripe_customer_id = case
      when clear_customer then null
      else coalesce(new_customer_id, stripe_customer_id)
    end
  where id = target_org;

  perform set_config('mastline.billing_write', 'off', true);
end;
$$;

revoke all on function public.apply_billing_state(
  uuid, text, public.subscription_status, text, text, text,
  timestamptz, timestamptz, timestamptz, boolean, bigint, integer,
  boolean, boolean, boolean, boolean, timestamptz, boolean
) from public;
revoke all on function public.apply_billing_state(
  uuid, text, public.subscription_status, text, text, text,
  timestamptz, timestamptz, timestamptz, boolean, bigint, integer,
  boolean, boolean, boolean, boolean, timestamptz, boolean
) from anon;
revoke all on function public.apply_billing_state(
  uuid, text, public.subscription_status, text, text, text,
  timestamptz, timestamptz, timestamptz, boolean, bigint, integer,
  boolean, boolean, boolean, boolean, timestamptz, boolean
) from authenticated;
grant execute on function public.apply_billing_state(
  uuid, text, public.subscription_status, text, text, text,
  timestamptz, timestamptz, timestamptz, boolean, bigint, integer,
  boolean, boolean, boolean, boolean, timestamptz, boolean
) to service_role;

-- create_workspace writes billing columns, so it has to announce itself too.
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

-- ---------------------------------------------------------------------------
-- Usage, now reporting the allowance that is actually enforced
--
-- The stored storage_limit_bytes is the trial cap for a workspace that has not
-- paid; once a card is attached the plan's own allowance applies. Reading the
-- column alone would show a paying customer their old trial cap, so the view
-- reports what the enforcement will actually do.
-- ---------------------------------------------------------------------------

drop view if exists public.organization_storage_usage;

create view public.organization_storage_usage
with (security_invoker = on) as
select
  o.id as organization_id,
  coalesce(sum(v.bytes), 0)::bigint as bytes_used,
  count(v.id)::bigint as object_count,
  private.workspace_storage_allowance(o.id) as allowance_bytes
from public.organizations o
left join public.asset_versions v on v.organization_id = o.id
group by o.id;

comment on view public.organization_storage_usage is
  'Bytes held per workspace and the allowance actually enforced, which is the plan allowance once a card is on file rather than the stored trial cap.';

grant select on public.organization_storage_usage to authenticated;

-- No index on stripe_customer_id or stripe_subscription_id: the unique
-- constraints on those columns already provide one.
create index organizations_past_due_idx on public.organizations(past_due_since)
  where subscription_status = 'past_due';

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;
