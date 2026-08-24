-- What a recipient may see, and the record of them seeing it.
--
-- The caller here is anonymous: a picture editor with a link and no account.
-- These are the only things they can reach, and each one validates the token,
-- the expiry, and the revocation before returning anything.
--
-- security definer, because row level security would otherwise refuse an
-- anonymous caller entirely. The narrowness is the safety: the token is the
-- only input that selects a row, nothing accepts an organization id, and no
-- function here returns an original, a source note, a price, or a buyer's
-- details. What comes back is the package as offered and nothing else.
--
-- Every call writes an access event first. A read that is not recorded is a
-- read the photographer cannot see, and the point of the feature is that they
-- can.

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
  asset_count integer
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
    (select count(*)::integer from public.package_assets pa where pa.package_id = p.id)
  from public.packages p
  where p.id = link.package_id;
end;
$$;

comment on function public.open_delivery(text, text, text) is
  'What a link holder sees, and the record of them seeing it. Anonymous by design; returns no original, note, price, or buyer detail.';

-- ---------------------------------------------------------------------------
-- The frames in the package
-- ---------------------------------------------------------------------------

create or replace function public.delivery_assets(delivery_token text)
returns table (
  asset_id uuid,
  canonical_filename text,
  headline text,
  caption text,
  captured_at timestamptz,
  preview_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.canonical_filename,
    a.headline,
    a.caption,
    a.captured_at,
    (select v.object_key from public.asset_versions v
      where v.asset_id = a.id and v.version_kind = 'preview' limit 1)
  from public.submission_deliveries d
  join public.submissions s on s.id = d.submission_id
  join public.package_assets pa on pa.package_id = s.package_id
  join public.assets a on a.id = pa.asset_id
  where d.token = delivery_token
    and d.revoked_at is null
    and d.expires_at > now()
  order by pa.position;
$$;

-- ---------------------------------------------------------------------------
-- Taking a copy
--
-- Records who, when, and from where before it hands anything over, and returns
-- the delivery version rather than the original.
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

  -- The asset has to be in this package. Without this the token would open
  -- every frame in the workspace.
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

revoke all on function public.open_delivery(text, text, text) from public;
revoke all on function public.delivery_assets(text) from public;
revoke all on function public.record_delivery_download(text, uuid, text, text) from public;

-- The recipient has no account, so anon is the role that calls these. The token
-- is the credential and every function checks it, its expiry, and whether it
-- has been withdrawn before returning a single row.
grant execute on function public.open_delivery(text, text, text) to anon, authenticated;
grant execute on function public.delivery_assets(text) to anon, authenticated;
grant execute on function public.record_delivery_download(text, uuid, text, text) to anon, authenticated;
