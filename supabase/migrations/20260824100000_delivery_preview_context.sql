-- What a preview needs to know about itself.
--
-- The mark burned into a buyer's preview names the recipient and the date,
-- which is what makes a leaked frame traceable to the desk it was sent to. That
-- means the route serving it needs the recipient label as well as the file, and
-- it is called by someone with no account.
--
-- Same shape as the rest of the delivery surface: security definer, keyed on
-- the token, checking expiry and withdrawal before returning anything. It
-- returns no original, no note, no price, and no buyer record -- only the
-- preview's location and the words that go on it.

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
  join public.asset_versions v on v.asset_id = a.id and v.version_kind = 'preview'
  where d.token = delivery_token
    and a.id = target_asset
    and d.revoked_at is null
    and d.expires_at > now()
  limit 1;
$$;

revoke all on function public.delivery_preview(text, uuid) from public;
grant execute on function public.delivery_preview(text, uuid) to anon, authenticated;
