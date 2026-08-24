-- An acceptance is not an open.
--
-- It was recorded as one with a note attached, which made the photographer's
-- record read "Opened" three times for a link that was opened once and accepted
-- once. The kinds are what the operator reads; they should say what happened.

alter table public.delivery_access_events
  drop constraint delivery_access_events_kind_check;

alter table public.delivery_access_events
  add constraint delivery_access_events_kind_check
  check (kind in ('opened', 'downloaded', 'refused', 'accepted'));

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

  update public.submissions s
     set status = 'acknowledged', acknowledged_at = coalesce(s.acknowledged_at, now())
   where s.id = link.submission_id
     and s.status in ('sent', 'delivered');

  insert into public.delivery_access_events
    (organization_id, delivery_id, kind, ip_address, user_agent, detail)
  values (link.organization_id, link.id, 'accepted', caller_ip::inet, caller_agent, who);

  return query
  select a.accepted_at from public.delivery_acceptances a where a.delivery_id = link.id;
end;
$$;

revoke all on function public.accept_delivery(text, text, text, text) from public;
grant execute on function public.accept_delivery(text, text, text, text) to anon, authenticated;
