-- Show a frame even when no preview derivative was made.
--
-- Previews are generated in the browser at import, and only for formats it can
-- decode. A RAW file, or anything imported before that existed, has an original
-- and a delivery derivative but no preview -- and a buyer page that says "no
-- preview" for every frame is not a page anyone buys from.
--
-- So both functions now fall back to the delivery version. What the recipient
-- receives is still a preview: the route that serves it scales it down and
-- burns the mark in, so falling back does not mean handing over the full file.

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
    (
      select v.object_key from public.asset_versions v
      where v.asset_id = a.id and v.version_kind in ('preview', 'delivery')
      order by case v.version_kind when 'preview' then 0 else 1 end
      limit 1
    )
  from public.submission_deliveries d
  join public.submissions s on s.id = d.submission_id
  join public.package_assets pa on pa.package_id = s.package_id
  join public.assets a on a.id = pa.asset_id
  where d.token = delivery_token
    and d.revoked_at is null
    and d.expires_at > now()
  order by pa.position;
$$;

create or replace function public.delivery_preview(
  delivery_token text,
  target_asset uuid
)
returns table (
  object_key text,
  storage_bucket text,
  recipient_label text,
  credit_line text,
  sent_on timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.object_key,
    v.storage_bucket,
    d.recipient_label,
    a.credit_line,
    d.created_at
  from public.submission_deliveries d
  join public.submissions s on s.id = d.submission_id
  join public.package_assets pa on pa.package_id = s.package_id
  join public.assets a on a.id = pa.asset_id
  join public.asset_versions v
    on v.asset_id = a.id and v.version_kind in ('preview', 'delivery')
  where d.token = delivery_token
    and a.id = target_asset
    and d.revoked_at is null
    and d.expires_at > now()
  order by case v.version_kind when 'preview' then 0 else 1 end
  limit 1;
$$;

revoke all on function public.delivery_assets(text) from public;
revoke all on function public.delivery_preview(text, uuid) from public;
grant execute on function public.delivery_assets(text) to anon, authenticated;
grant execute on function public.delivery_preview(text, uuid) to anon, authenticated;
