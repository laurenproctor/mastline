-- Somebody holding the link opened it. That, and not approval, is delivery.
--
-- `open_delivery` recorded the open and stopped there, because the submission
-- had already been marked `sent` and `delivered` by the approval that preceded
-- it -- both of them before a link existed. With approval no longer claiming
-- either, the states have to be reached by the things that actually evidence
-- them, and the first valid open of a live link is the strongest evidence
-- Mastline will ever have that the package reached somebody.
--
-- What it is not is evidence about a *person*. The link was made for the New
-- York picture desk; what this proves is that the link made for the New York
-- picture desk was opened. Whoever was holding it may be the editor, their
-- colleague, or a forwarded copy. The interface says the former and never the
-- latter, and the only thing that upgrades it is the visitor typing their own
-- name into the acceptance.
--
-- The awkward case is a link opened before the photographer got round to
-- pressing "Mark as shared". The package plainly left Mastline -- somebody has
-- it -- so the missing send evidence is filled in from the open. The link's own
-- `shared_at` stays null, because that column records the photographer saying
-- they passed it on, and nobody said it. An anonymous open has no operator to
-- attribute a share to, which the paired-nullability constraint would refuse
-- anyway.

create or replace function public.open_delivery(
  delivery_token text,
  caller_ip text default null,
  caller_agent text default null
)
returns table (
  submission_id uuid,
  package_name text,
  headline text,
  credit_line text,
  terms text,
  restrictions text,
  embargo_until timestamptz,
  expires_at timestamptz,
  asset_count integer,
  accepted_at timestamptz,
  accepted_by text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  link record;
  opened_at timestamptz := now();
begin
  select d.*, s.package_id, s.terms_snapshot, s.restrictions_snapshot,
         s.status as submission_status, s.sent_at, s.delivered_at
    into link
  from public.submission_deliveries d
  join public.submissions s
    on s.id = d.submission_id and s.organization_id = d.organization_id
  where d.token = delivery_token;

  if not FOUND then
    -- Nothing is recorded for a token that does not exist: there is no
    -- workspace to attribute it to, and writing one would be a way to make
    -- rows appear by guessing.
    return;
  end if;

  if link.revoked_at is not null or link.expires_at <= now() then
    insert into public.delivery_access_events
      (organization_id, delivery_id, kind, ip_address, user_agent, detail)
    values (
      link.organization_id, link.id, 'refused', caller_ip::inet, caller_agent,
      case when link.revoked_at is not null then 'withdrawn' else 'expired' end
    );
    return;
  end if;

  insert into public.delivery_access_events
    (organization_id, delivery_id, kind, ip_address, user_agent)
  values (link.organization_id, link.id, 'opened', caller_ip::inet, caller_agent);

  -- ---------------------------------------------------------------------
  -- The lifecycle move
  --
  -- Every one of these is guarded so a second open changes nothing. The
  -- photographer's record should read "first opened" and "last opened", and
  -- the second of those lives in the access events, not in a timestamp that
  -- keeps being rewritten.
  -- ---------------------------------------------------------------------

  -- Send evidence, if the operator never recorded sharing it. `sent_at` is
  -- write-once at the database level, so this cannot move an existing one.
  if link.sent_at is null then
    update public.submissions s
       set sent_at = opened_at,
           status = case when s.status = 'queued' then 'sent' else s.status end
     where s.id = link.submission_id
       and s.sent_at is null;
  end if;

  -- Delivered. Only forward, and only from the states that precede it: a
  -- submission already acknowledged, sold, or settled is not walked back
  -- because somebody opened an old link.
  update public.submissions s
     set status = 'delivered',
         delivered_at = coalesce(s.delivered_at, opened_at)
   where s.id = link.submission_id
     and s.status = 'sent';

  -- ...and if it had already moved past `sent` without ever recording a
  -- delivery time, record it now without touching the status.
  update public.submissions s
     set delivered_at = opened_at
   where s.id = link.submission_id
     and s.delivered_at is null
     and s.status in ('delivered', 'acknowledged', 'sold', 'no_sale');

  update public.packages p
     set status = 'delivered'
   where p.id = link.package_id
     and p.status in ('approved', 'sending');

  return query
  select
    link.submission_id,
    p.name,
    p.package_note,
    (select a.credit_line
       from public.package_assets pa
       join public.assets a on a.id = pa.asset_id
      where pa.package_id = p.id
      limit 1),
    link.terms_snapshot,
    link.restrictions_snapshot,
    p.embargo_until,
    link.expires_at,
    (select count(*)::integer from public.package_assets pa where pa.package_id = p.id),
    acc.accepted_at,
    acc.accepted_by
  from public.packages p
  left join public.delivery_acceptances acc on acc.delivery_id = link.id
  where p.id = link.package_id;
end;
$$;

comment on function public.open_delivery(text, text, text) is
  'What a link holder sees, and the record of them seeing it. The first valid open is what moves a submission to delivered; it proves the link was opened, never who opened it.';

revoke all on function public.open_delivery(text, text, text) from public;
grant execute on function public.open_delivery(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Acceptance, restated
--
-- One line changes: a submission can now reach acceptance from `queued` too.
-- A link opened and accepted in the same visit used to arrive here with the
-- submission already `sent` because approval had said so. It no longer is, and
-- while `open_delivery` moves it along the way, a recipient who somehow accepts
-- without a recorded open -- a retried request, a page restored from cache --
-- should still leave the record in the right state rather than stuck.
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
  agreed_at timestamptz := now();
begin
  if char_length(who) < 2 then
    return;
  end if;

  select d.*, s.terms_snapshot, s.restrictions_snapshot, s.package_id, s.status,
         s.sent_at
    into link
  from public.submission_deliveries d
  join public.submissions s
    on s.id = d.submission_id and s.organization_id = d.organization_id
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

  -- Somebody has it, so the send evidence holds even if this is the first
  -- thing that ever ran against the link.
  update public.submissions s
     set sent_at = agreed_at
   where s.id = link.submission_id
     and s.sent_at is null;

  update public.submissions s
     set status = 'acknowledged',
         acknowledged_at = coalesce(s.acknowledged_at, agreed_at),
         delivered_at = coalesce(s.delivered_at, agreed_at)
   where s.id = link.submission_id
     and s.status in ('queued', 'sent', 'delivered');

  update public.packages p
     set status = 'delivered'
   where p.id = link.package_id
     and p.status in ('approved', 'sending');

  insert into public.delivery_access_events
    (organization_id, delivery_id, kind, ip_address, user_agent, detail)
  values (link.organization_id, link.id, 'accepted', caller_ip::inet, caller_agent, who);

  return query
  select a.accepted_at from public.delivery_acceptances a where a.delivery_id = link.id;
end;
$$;

revoke all on function public.accept_delivery(text, text, text, text) from public;
grant execute on function public.accept_delivery(text, text, text, text) to anon, authenticated;
