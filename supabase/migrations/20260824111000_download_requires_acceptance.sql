-- The full file follows the yes, not the link.
--
-- /security says full-resolution files are "released only through a
-- time-limited link tied to an accepted license". Until now the link alone was
-- enough, which made the first half true and the second half a hope. A refusal
-- is recorded like any other, so a desk that tries before accepting is visible
-- rather than silent.
--
-- open_delivery gains a column, so it is dropped and rebuilt rather than
-- replaced: a return type cannot be changed in place.

drop function if exists public.open_delivery(text, text, text);

create function public.open_delivery(
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
begin
  select d.*, s.package_id, s.terms_snapshot, s.restrictions_snapshot
    into link
  from public.submission_deliveries d
  join public.submissions s on s.id = d.submission_id
  where d.token = delivery_token;

  if not FOUND then
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

revoke all on function public.open_delivery(text, text, text) from public;
grant execute on function public.open_delivery(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Downloading, now that a yes is required
-- ---------------------------------------------------------------------------

create or replace function public.record_delivery_download(
  delivery_token text,
  target_asset uuid,
  caller_ip text default null,
  caller_agent text default null
)
returns table (object_key text, storage_bucket text, filename text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  link record;
begin
  select d.*, s.package_id into link
  from public.submission_deliveries d
  join public.submissions s on s.id = d.submission_id
  where d.token = delivery_token;

  if not FOUND or link.revoked_at is not null or link.expires_at <= now() then
    if FOUND then
      insert into public.delivery_access_events
        (organization_id, delivery_id, kind, asset_id, ip_address, user_agent, detail)
      values (link.organization_id, link.id, 'refused', target_asset, caller_ip::inet,
              caller_agent, 'download after the link stopped working');
    end if;
    return;
  end if;

  if not exists (
    select 1 from public.package_assets pa
    where pa.package_id = link.package_id and pa.asset_id = target_asset
  ) then
    insert into public.delivery_access_events
      (organization_id, delivery_id, kind, asset_id, ip_address, user_agent, detail)
    values (link.organization_id, link.id, 'refused', target_asset, caller_ip::inet,
            caller_agent, 'frame not in this package');
    return;
  end if;

  -- The yes comes first. A preview is for judging; the file is for using.
  if not exists (
    select 1 from public.delivery_acceptances a where a.delivery_id = link.id
  ) then
    insert into public.delivery_access_events
      (organization_id, delivery_id, kind, asset_id, ip_address, user_agent, detail)
    values (link.organization_id, link.id, 'refused', target_asset, caller_ip::inet,
            caller_agent, 'download before accepting the terms');
    return;
  end if;

  insert into public.delivery_access_events
    (organization_id, delivery_id, kind, asset_id, ip_address, user_agent)
  values (link.organization_id, link.id, 'downloaded', target_asset, caller_ip::inet, caller_agent);

  return query
  select v.object_key, v.storage_bucket, a.canonical_filename
  from public.assets a
  join public.asset_versions v on v.asset_id = a.id
  where a.id = target_asset
    and v.version_kind in ('delivery', 'original')
  order by case v.version_kind when 'delivery' then 0 else 1 end
  limit 1;
end;
$$;

revoke all on function public.record_delivery_download(text, uuid, text, text) from public;
grant execute on function public.record_delivery_download(text, uuid, text, text) to anon, authenticated;
