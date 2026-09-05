-- Per-delivery access options for the five-stage delivery flow.
--
-- Three facts a photographer decides per recipient link, none of which the
-- schema could hold before:
--
--   delivery_note                A short plain-text note to the recipient,
--                                shown on the delivery page. It is a note, not
--                                an email: Mastline still transmits nothing.
--   allow_full_resolution        Whether this link offers the full-resolution
--                                files at all. Off means the marked previews
--                                are the whole offer.
--   require_acceptance_to_view   Whether the photographs are shown only after
--                                the terms are accepted. Off keeps today's
--                                behavior: previews visible, downloads gated.
--
-- The enforcement lives where the existing controls live -- inside the
-- security-definer functions -- not in the page. The anonymous surface does
-- not grow: the same five functions, with the same grants, read the new
-- columns themselves. Defaults reproduce today's behavior exactly, so every
-- existing link keeps doing what it did.
--
-- The options freeze when the link is marked shared, alongside the recipient
-- and the attribution: what a desk was offered is part of the record.
--
-- ROLLBACK: re-apply the previous bodies of open_delivery, delivery_assets,
-- delivery_preview, and private.delivery_download_gate from 20260830130000,
-- and drop the three columns. The trigger change is compatible either way.

alter table public.submission_deliveries
  add column delivery_note text
    check (delivery_note is null or char_length(delivery_note) between 1 and 500),
  add column allow_full_resolution boolean not null default true,
  add column require_acceptance_to_view boolean not null default false;

comment on column public.submission_deliveries.delivery_note is
  'Plain-text note from the photographer, shown on the delivery page. Not an email; nothing is transmitted.';
comment on column public.submission_deliveries.allow_full_resolution is
  'Whether this link offers full-resolution downloads. Enforced in the download gate, not the page.';
comment on column public.submission_deliveries.require_acceptance_to_view is
  'Whether the frames are shown only after the terms are accepted. Enforced in delivery_assets and delivery_preview.';

-- ---------------------------------------------------------------------------
-- The options freeze at the share, like the recipient and the attribution
-- ---------------------------------------------------------------------------

create or replace function private.protect_shared_delivery()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return new;
  end if;

  if old.shared_at is not null then
    if new.custom_parameters is distinct from old.custom_parameters then
      raise exception 'The attribution on a shared delivery link is part of the record and cannot be changed.'
        using errcode = 'restrict_violation';
    end if;
    if new.recipient_label is distinct from old.recipient_label
       or new.contact_reference is distinct from old.contact_reference then
      raise exception 'The recipient on a shared delivery link is part of the record and cannot be changed.'
        using errcode = 'restrict_violation';
    end if;
    -- What the recipient was offered is part of the record too.
    if new.delivery_note is distinct from old.delivery_note
       or new.allow_full_resolution is distinct from old.allow_full_resolution
       or new.require_acceptance_to_view is distinct from old.require_acceptance_to_view then
      raise exception 'The access options on a shared delivery link are part of the record and cannot be changed.'
        using errcode = 'restrict_violation';
    end if;
    -- Marking a link shared twice is the same act, so it must be idempotent
    -- rather than an error -- but it must never move the original timestamp.
    if new.shared_at is distinct from old.shared_at
       or new.shared_by is distinct from old.shared_by then
      raise exception 'A delivery link records when it was first shared, and that does not move.'
        using errcode = 'restrict_violation';
    end if;
  end if;

  -- The token and its parent never change, shared or not.
  if new.token is distinct from old.token
     or new.submission_id is distinct from old.submission_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'A delivery link cannot be repointed after it is created.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- What a link holder sees: unchanged reads, plus the three options
--
-- Return type changes, so it is dropped and rebuilt. The body is the
-- 20260830130000 body with the three columns appended; every guard on the
-- lifecycle moves is exactly as it was.
-- ---------------------------------------------------------------------------

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
  accepted_by text,
  delivery_note text,
  allow_full_resolution boolean,
  require_acceptance_to_view boolean
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

  -- The lifecycle move, unchanged from 20260828093000: every step is guarded
  -- so a second open changes nothing.
  if link.sent_at is null then
    update public.submissions s
       set sent_at = opened_at,
           status = case when s.status = 'queued' then 'sent' else s.status end
     where s.id = link.submission_id
       and s.sent_at is null;
  end if;

  update public.submissions s
     set status = 'delivered',
         delivered_at = coalesce(s.delivered_at, opened_at)
   where s.id = link.submission_id
     and s.status = 'sent';

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
    (select sa.credit_line_snapshot
       from public.submission_assets sa
      where sa.submission_id = link.submission_id
        and sa.organization_id = link.organization_id
      order by sa.position
      limit 1),
    link.terms_snapshot,
    link.restrictions_snapshot,
    p.embargo_until,
    link.expires_at,
    (select count(*)::integer
       from public.submission_assets sa
      where sa.submission_id = link.submission_id
        and sa.organization_id = link.organization_id),
    acc.accepted_at,
    acc.accepted_by,
    link.delivery_note,
    link.allow_full_resolution,
    link.require_acceptance_to_view
  from public.packages p
  left join public.delivery_acceptances acc on acc.delivery_id = link.id
  where p.id = link.package_id;
end;
$$;

comment on function public.open_delivery(text, text, text) is
  'What a link holder sees, and the record of them seeing it. Reads the approved snapshot, never the live asset or package membership. The first valid open is what moves a submission to delivered.';

revoke all on function public.open_delivery(text, text, text) from public;
grant execute on function public.open_delivery(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The frames wait for the yes when the link says so
--
-- Same signature, same grants; the WHERE clause gains the gate. A link with
-- require_acceptance_to_view and no acceptance returns no frames -- to the
-- page and to anyone calling the function directly, which is the point of
-- enforcing it here rather than in the page.
-- ---------------------------------------------------------------------------

create or replace function public.delivery_assets(delivery_token text)
returns table (
  asset_id uuid,
  canonical_filename text,
  headline text,
  caption text,
  people jsonb,
  captured_at timestamptz,
  has_preview boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    sa.asset_id,
    sa.filename_snapshot,
    sa.headline_snapshot,
    sa.caption_snapshot,
    sa.people_snapshot,
    sa.captured_at_snapshot,
    sa.preview_asset_version_id is not null
      or private.delivery_preview_renderable(sa.mime_type_snapshot)
  from public.submission_deliveries d
  join public.submission_assets sa
    on sa.submission_id = d.submission_id
   and sa.organization_id = d.organization_id
  where d.token = delivery_token
    and d.revoked_at is null
    and d.expires_at > now()
    and (
      not d.require_acceptance_to_view
      or exists (select 1 from public.delivery_acceptances acc where acc.delivery_id = d.id)
    )
  order by sa.position;
$$;

comment on function public.delivery_assets(text) is
  'The approved frames behind a link, in approved order, from the snapshot only. Empty until acceptance when the link requires it. Names no bucket, key, or token.';

revoke all on function public.delivery_assets(text) from public;
grant execute on function public.delivery_assets(text) to anon, authenticated;

-- The marked preview honors the same gate: a page that is not allowed to show
-- the frames must not be able to fetch them one by one either.
create or replace function public.delivery_preview(
  delivery_token text,
  target_asset uuid
)
returns table (
  snapshot_id uuid,
  object_key text,
  storage_bucket text,
  sha256 text,
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
    sa.id,
    coalesce(sa.preview_object_key_snapshot, sa.object_key_snapshot),
    coalesce(sa.preview_storage_bucket_snapshot, sa.storage_bucket_snapshot),
    coalesce(sa.preview_sha256_snapshot, sa.sha256_snapshot),
    d.recipient_label,
    sa.credit_line_snapshot,
    d.created_at
  from public.submission_deliveries d
  join public.submission_assets sa
    on sa.submission_id = d.submission_id
   and sa.organization_id = d.organization_id
  where d.token = delivery_token
    and sa.asset_id = target_asset
    and d.revoked_at is null
    and d.expires_at > now()
    and (
      not d.require_acceptance_to_view
      or exists (select 1 from public.delivery_acceptances acc where acc.delivery_id = d.id)
    )
    and (
      sa.preview_asset_version_id is not null
      or private.delivery_preview_renderable(sa.mime_type_snapshot)
    )
  limit 1;
$$;

comment on function public.delivery_preview(text, uuid) is
  'The exact frozen object a marked preview is rendered from. Waits for acceptance when the link requires it. Never a later derivative.';

revoke all on function public.delivery_preview(text, uuid) from public;
revoke all on function public.delivery_preview(text, uuid) from anon;
revoke all on function public.delivery_preview(text, uuid) from authenticated;
grant execute on function public.delivery_preview(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- A link that does not offer the file refuses the download, and says why
--
-- The refusal comes before the acceptance check: when the file is not on
-- offer at all, whether the terms were accepted is beside the point, and the
-- photographer's record should say which gate answered.
-- ---------------------------------------------------------------------------

create or replace function private.delivery_download_gate(
  delivery_token text,
  target_asset uuid,
  caller_ip text,
  caller_agent text
)
returns table (
  delivery_id uuid,
  organization_id uuid,
  snapshot_id uuid,
  object_key text,
  storage_bucket text,
  sha256 text,
  filename text,
  mime_type text
)
language plpgsql
set search_path = ''
as $$
declare
  link record;
  frame record;
  known_asset uuid;
begin
  select d.id, d.organization_id, d.submission_id, d.revoked_at, d.expires_at,
         d.allow_full_resolution
    into link
  from public.submission_deliveries d
  where d.token = delivery_token;

  if not FOUND then
    -- Nothing is recorded for a token nobody holds.
    return;
  end if;

  -- Only attribute a refusal to an asset that exists in this workspace; an
  -- arbitrary id would fail the foreign key and turn a refusal into an error.
  select a.id into known_asset
  from public.assets a
  where a.id = target_asset and a.organization_id = link.organization_id;

  if link.revoked_at is not null or link.expires_at <= now() then
    insert into public.delivery_access_events
      (organization_id, delivery_id, kind, asset_id, ip_address, user_agent, detail)
    values (link.organization_id, link.id, 'refused', known_asset, caller_ip::inet,
            caller_agent, 'download after the link stopped working');
    return;
  end if;

  -- The frame has to be in THIS submission's snapshot. Not the package, not the
  -- workspace: the approved record.
  select sa.id, sa.object_key_snapshot, sa.storage_bucket_snapshot, sa.sha256_snapshot,
         sa.filename_snapshot, sa.mime_type_snapshot
    into frame
  from public.submission_assets sa
  where sa.submission_id = link.submission_id
    and sa.organization_id = link.organization_id
    and sa.asset_id = target_asset;

  if not FOUND then
    insert into public.delivery_access_events
      (organization_id, delivery_id, kind, asset_id, ip_address, user_agent, detail)
    values (link.organization_id, link.id, 'refused', known_asset, caller_ip::inet,
            caller_agent, 'frame not in this submission');
    return;
  end if;

  if not link.allow_full_resolution then
    insert into public.delivery_access_events
      (organization_id, delivery_id, kind, asset_id, ip_address, user_agent, detail)
    values (link.organization_id, link.id, 'refused', known_asset, caller_ip::inet,
            caller_agent, 'full-resolution download not offered on this link');
    return;
  end if;

  -- The yes comes first. A preview is for judging; the file is for using.
  if not exists (
    select 1 from public.delivery_acceptances a where a.delivery_id = link.id
  ) then
    insert into public.delivery_access_events
      (organization_id, delivery_id, kind, asset_id, ip_address, user_agent, detail)
    values (link.organization_id, link.id, 'refused', known_asset, caller_ip::inet,
            caller_agent, 'download before accepting the terms');
    return;
  end if;

  return query
  select link.id, link.organization_id, frame.id, frame.object_key_snapshot,
         frame.storage_bucket_snapshot, frame.sha256_snapshot, frame.filename_snapshot,
         frame.mime_type_snapshot;
end;
$$;

revoke all on function private.delivery_download_gate(text, uuid, text, text) from public;

-- The platform default hands anon everything on a new table. Every migration
-- closes with this, and it is load-bearing.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
