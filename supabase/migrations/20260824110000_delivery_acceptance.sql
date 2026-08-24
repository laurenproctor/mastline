-- A desk accepting the terms.
--
-- This is the hinge the commercial record was missing. A package went out and
-- the next event was a photographer typing a licence in by hand; nothing
-- recorded the moment a buyer said yes. /security also tells people the full
-- file is released "only through a time-limited link tied to an accepted
-- license", which was not true while any link holder could download.
--
-- Acceptance is not a new state. `submission_status` already has
-- `acknowledged`, and submissions already carry `acknowledged_at`; until now
-- only an operator could set them, from their side of the conversation. This
-- lets the person who actually accepted do it, and keeps the evidence.
--
-- What is kept is the whole of what they agreed to, copied at the moment they
-- agreed: a later disagreement is about the words on the screen that day, not
-- the words in the package today.

create table public.delivery_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_id uuid not null references public.submission_deliveries(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  -- Typed by the person accepting. A desk is often an alias, so this is who
  -- says they are behind it.
  accepted_by text not null check (char_length(trim(accepted_by)) between 2 and 120),
  -- The terms as shown, not as they stand now.
  terms_snapshot text,
  restrictions_snapshot text,
  embargo_until timestamptz,
  ip_address inet,
  user_agent text,
  accepted_at timestamptz not null default now(),
  -- One acceptance per link. Accepting twice is the same yes.
  unique (delivery_id)
);

create index delivery_acceptances_submission_idx
  on public.delivery_acceptances(submission_id, accepted_at desc);
create index delivery_acceptances_org_idx
  on public.delivery_acceptances(organization_id, accepted_at desc);

comment on table public.delivery_acceptances is
  'A recipient agreeing to the terms as they were shown. Evidence: append-only, and it carries the words they saw rather than the words in force today.';

create trigger delivery_acceptances_append_only
before update or delete on public.delivery_acceptances
for each row execute function private.forbid_access_event_rewrite();

alter table public.delivery_acceptances enable row level security;
alter table public.delivery_acceptances force row level security;

create policy delivery_acceptances_select on public.delivery_acceptances
  for select to authenticated
  using (private.is_org_member(organization_id));

grant select on public.delivery_acceptances to authenticated;

-- ---------------------------------------------------------------------------
-- Accepting
-- ---------------------------------------------------------------------------

create or replace function public.accept_delivery(
  delivery_token text,
  accepted_by_name text,
  caller_ip text default null,
  caller_agent text default null
)
returns table (accepted_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  link record;
  who text := trim(coalesce(accepted_by_name, ''));
begin
  if char_length(who) < 2 then
    return;
  end if;

  select d.*, s.terms_snapshot, s.restrictions_snapshot, s.package_id, s.status
    into link
  from public.submission_deliveries d
  join public.submissions s on s.id = d.submission_id
  where d.token = delivery_token;

  if not FOUND or link.revoked_at is not null or link.expires_at <= now() then
    return;
  end if;

  insert into public.delivery_acceptances (
    organization_id, delivery_id, submission_id, accepted_by,
    terms_snapshot, restrictions_snapshot, embargo_until, ip_address, user_agent
  )
  values (
    link.organization_id, link.id, link.submission_id, who,
    link.terms_snapshot, link.restrictions_snapshot,
    (select p.embargo_until from public.packages p where p.id = link.package_id),
    caller_ip::inet, caller_agent
  )
  on conflict (delivery_id) do nothing;

  -- The submission reaches a state it already had a name for. Only forward:
  -- a package already sold is not walked back by someone opening an old link.
  update public.submissions s
     set status = 'acknowledged', acknowledged_at = coalesce(s.acknowledged_at, now())
   where s.id = link.submission_id
     and s.status in ('sent', 'delivered');

  insert into public.delivery_access_events
    (organization_id, delivery_id, kind, ip_address, user_agent, detail)
  values (link.organization_id, link.id, 'opened', caller_ip::inet, caller_agent,
          'accepted the terms as ' || who);

  return query
  select a.accepted_at from public.delivery_acceptances a where a.delivery_id = link.id;
end;
$$;

revoke all on function public.accept_delivery(text, text, text, text) from public;
grant execute on function public.accept_delivery(text, text, text, text) to anon, authenticated;
