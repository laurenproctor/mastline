-- The exact photograph, metadata, terms, restrictions, and ordering approved by
-- the photographer must be exactly what every recipient later sees and
-- downloads.
--
-- Approval already froze the package: its membership, its versions, its terms.
-- What it did not do was make the recipient read from that freeze. The
-- delivery functions walked from the link to the submission to the package to
-- the *current* package_assets, then to the *current* asset row for the
-- caption, and then picked whichever preview or delivery derivative happened to
-- be preferred *now*. The download path never looked at `asset_version_id` at
-- all, and it wrote the `downloaded` event before anything had been signed. So
-- a caption edited after approval changed what the desk read, a derivative made
-- after approval became the file they took, and a signing failure left a
-- download on the record that never happened -- while the JSON manifest on the
-- submission sat there unchanged, proving nothing.
--
-- This migration makes the approval record the thing the recipient consumes.
--
--   public.submission_assets      one row per approved frame: the exact
--                                 version and storage object, the exact
--                                 preview shown at approval, and the editorial
--                                 facts as they stood at that instant.
--                                 Append-only. Written only by the approval
--                                 transaction, and once by the backfill.
--
--   public.approve_package()      the approval as ONE transaction: lock the
--                                 package and its membership, verify every
--                                 version, read the metadata behind the lock,
--                                 freeze the package, create the submission,
--                                 write every snapshot row, and write the audit
--                                 event. Any failure leaves nothing behind.
--
--   open_delivery / delivery_assets / delivery_preview
--                                 read the snapshot and nothing mutable.
--
--   authorize_delivery_download / record_delivery_download
--                                 authorise the exact frozen object, and record
--                                 the download only once the route holds a
--                                 signed response.
--
-- `submissions.delivery_manifest` stays. It is a summary and a compatibility
-- record for existing readers and the export, built from the same locked read
-- in the same transaction as the relational rows; the admin checks at the end
-- prove they agree.
--
-- ROLLBACK
--
--   The table holds commercial evidence from the moment it exists and is not
--   dropped by a rollback. Roll the application back and, by hand, re-apply the
--   previous bodies of delivery_assets, delivery_preview, open_delivery, and
--   record_delivery_download from 20260824101000, 20260824111000, and
--   20260828093000; approve_package and authorize_delivery_download can stay
--   unused. See docs/DEPLOY.md.

-- ---------------------------------------------------------------------------
-- A composite key the snapshot can point at
--
-- A snapshot must name a version OF ITS OWN ASSET in ITS OWN WORKSPACE. One
-- three-column foreign key says both, so a version from another asset or
-- another organization is refused by Postgres whatever the application does.
-- ---------------------------------------------------------------------------

alter table public.asset_versions
  add constraint asset_versions_org_asset_id_key unique (organization_id, asset_id, id);

-- ---------------------------------------------------------------------------
-- The approved frames
-- ---------------------------------------------------------------------------

create table public.submission_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id uuid not null,
  asset_id uuid not null,
  asset_version_id uuid not null,
  position integer not null check (position >= 0),

  -- The exact object the recipient is authorised to receive. Copied from the
  -- version row and checked against it by a trigger below, so the snapshot can
  -- never claim an object its version does not have.
  version_kind_snapshot text not null
    check (version_kind_snapshot in ('original', 'preview', 'edit', 'delivery', 'thumbnail')),
  storage_bucket_snapshot text not null
    check (storage_bucket_snapshot in ('originals', 'derivatives')),
  object_key_snapshot text not null check (char_length(object_key_snapshot) > 0),
  sha256_snapshot text not null check (sha256_snapshot ~ '^[a-f0-9]{64}$'),
  mime_type_snapshot text not null check (char_length(mime_type_snapshot) between 1 and 255),
  bytes_snapshot bigint not null check (bytes_snapshot > 0),
  width_snapshot integer check (width_snapshot is null or width_snapshot > 0),
  height_snapshot integer check (height_snapshot is null or height_snapshot > 0),

  -- The exact preview the reviewer was looking at when they approved. The
  -- review screen shows a preview derivative while the package names the
  -- delivery derivative or the original, so both identities are frozen: a
  -- preview made later must never stand in for the one that was approved. Null
  -- when no preview derivative existed at approval, in which case the recipient
  -- preview is rendered from the approved object itself or not at all.
  preview_asset_version_id uuid,
  preview_storage_bucket_snapshot text
    check (preview_storage_bucket_snapshot is null or preview_storage_bucket_snapshot = 'derivatives'),
  preview_object_key_snapshot text
    check (preview_object_key_snapshot is null or char_length(preview_object_key_snapshot) > 0),
  preview_sha256_snapshot text
    check (preview_sha256_snapshot is null or preview_sha256_snapshot ~ '^[a-f0-9]{64}$'),
  preview_mime_type_snapshot text
    check (preview_mime_type_snapshot is null or char_length(preview_mime_type_snapshot) between 1 and 255),

  -- The editorial facts as they stood when the photographer approved them.
  filename_snapshot text not null check (char_length(filename_snapshot) > 0),
  headline_snapshot text,
  caption_snapshot text,
  -- Who is in the frame, as the photographer recorded it (assets.subjects).
  -- Operator-entered, never inferred; the same representation the review
  -- screen shows as "People".
  people_snapshot jsonb not null default '[]'::jsonb
    check (jsonb_typeof(people_snapshot) = 'array'),
  credit_line_snapshot text,
  copyright_notice_snapshot text,
  copyright_owner_snapshot text,
  captured_at_snapshot timestamptz,
  -- The asset's own location field. Not shown to a recipient today; frozen so
  -- the internal record says what was approved. Confidential locations never
  -- live on the asset row in the first place.
  location_snapshot text,
  usage_restrictions_snapshot text,

  -- 'approval' rows were written by the approval transaction and are the
  -- record of that moment. 'legacy_backfill' rows were written by this
  -- migration for submissions that predate it: their version and object are
  -- the ones frozen in the manifest, but their editorial fields are the
  -- metadata as it stood at MIGRATION time, which is not provably what the
  -- recipient saw at the original approval. The interface says so.
  snapshot_origin text not null check (snapshot_origin in ('approval', 'legacy_backfill')),
  -- When the snapshot was taken. For an approval row this is the approval
  -- instant; for a backfilled row it is when the migration ran.
  created_at timestamptz not null default now(),

  unique (submission_id, position),
  -- One asset appears once in a submission. The product has never allowed a
  -- frame twice in a package (package_assets is keyed on (package, asset)).
  unique (submission_id, asset_id),
  -- So composite foreign keys can point here.
  unique (organization_id, id),

  -- The preview identity is all there or all absent.
  constraint submission_assets_preview_identity_complete check (
    (preview_asset_version_id is null) = (preview_storage_bucket_snapshot is null)
    and (preview_asset_version_id is null) = (preview_object_key_snapshot is null)
    and (preview_asset_version_id is null) = (preview_sha256_snapshot is null)
    and (preview_asset_version_id is null) = (preview_mime_type_snapshot is null)
  ),

  constraint submission_assets_submission_same_org
    foreign key (organization_id, submission_id)
    references public.submissions(organization_id, id) on delete cascade,
  constraint submission_assets_asset_same_org
    foreign key (organization_id, asset_id)
    references public.assets(organization_id, id) on delete restrict,
  constraint submission_assets_version_of_asset_same_org
    foreign key (organization_id, asset_id, asset_version_id)
    references public.asset_versions(organization_id, asset_id, id) on delete restrict,
  constraint submission_assets_preview_of_asset_same_org
    foreign key (organization_id, asset_id, preview_asset_version_id)
    references public.asset_versions(organization_id, asset_id, id) on delete restrict
);

-- The recipient path: link -> submission -> frames in order. Also the RLS
-- prefix and the (organization_id, submission_id) foreign key.
create index submission_assets_org_submission_idx
  on public.submission_assets(organization_id, submission_id, position);
-- The asset and approved-version foreign keys, and "which submissions carry
-- this frame" for the inspector.
create index submission_assets_org_asset_version_idx
  on public.submission_assets(organization_id, asset_id, asset_version_id);
-- The preview-version foreign key.
create index submission_assets_org_asset_preview_idx
  on public.submission_assets(organization_id, asset_id, preview_asset_version_id);

comment on table public.submission_assets is
  'The authoritative approved-delivery record: one row per approved frame, naming the exact version, storage object, and preview, and the editorial facts at approval. Append-only. What a recipient link shows and downloads.';
comment on column public.submission_assets.snapshot_origin is
  'approval: written by the approval transaction at the approval instant. legacy_backfill: written by migration 20260829153325 from the manifest, with metadata as it stood at migration time.';
comment on column public.submission_assets.preview_asset_version_id is
  'The preview derivative shown on the review screen at approval, if one existed. A preview made later never replaces it.';
comment on column public.submission_assets.created_at is
  'When the snapshot was taken: the approval instant for approval rows, the migration run for legacy_backfill rows.';

-- ---------------------------------------------------------------------------
-- The snapshot must record the version's real object
--
-- The three-column foreign keys prove each version belongs to the asset and
-- the workspace. This proves the bucket, key, digest, type, and size written
-- into the row are that version's, so a row cannot name a valid version and a
-- different file -- and that the preview identity, when present, is a preview.
-- ---------------------------------------------------------------------------

create or replace function private.check_submission_asset_snapshot()
returns trigger language plpgsql set search_path = '' as $$
declare
  version record;
  preview record;
begin
  select v.version_kind, v.storage_bucket, v.object_key, v.sha256, v.mime_type,
         v.bytes, v.width, v.height
    into version
  from public.asset_versions v
  where v.id = new.asset_version_id
    and v.asset_id = new.asset_id
    and v.organization_id = new.organization_id;

  if not found then
    raise exception 'A submission snapshot must name a version of its own asset in its own workspace.'
      using errcode = 'foreign_key_violation';
  end if;

  if new.version_kind_snapshot is distinct from version.version_kind
     or new.storage_bucket_snapshot is distinct from version.storage_bucket
     or new.object_key_snapshot is distinct from version.object_key
     or new.sha256_snapshot is distinct from version.sha256
     or new.mime_type_snapshot is distinct from version.mime_type
     or new.bytes_snapshot is distinct from version.bytes
     or new.width_snapshot is distinct from version.width
     or new.height_snapshot is distinct from version.height then
    raise exception 'A submission snapshot must record the exact object of the version it names.'
      using errcode = 'check_violation';
  end if;

  if new.preview_asset_version_id is not null then
    select v.version_kind, v.storage_bucket, v.object_key, v.sha256, v.mime_type
      into preview
    from public.asset_versions v
    where v.id = new.preview_asset_version_id
      and v.asset_id = new.asset_id
      and v.organization_id = new.organization_id;

    if not found or preview.version_kind <> 'preview' then
      raise exception 'A submission snapshot''s preview must be a preview version of its own asset in its own workspace.'
        using errcode = 'foreign_key_violation';
    end if;

    if new.preview_storage_bucket_snapshot is distinct from preview.storage_bucket
       or new.preview_object_key_snapshot is distinct from preview.object_key
       or new.preview_sha256_snapshot is distinct from preview.sha256
       or new.preview_mime_type_snapshot is distinct from preview.mime_type then
      raise exception 'A submission snapshot must record the exact object of the preview it names.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.check_submission_asset_snapshot() from public;

create trigger submission_assets_match_version
before insert on public.submission_assets
for each row execute function private.check_submission_asset_snapshot();

-- Immutable after creation. The same append-only guard the caption history and
-- the activity log use; it honours the purge flag and nothing else. An asset
-- edit, a new derivative, a package change, a recall, or a withdrawn link
-- touches none of these rows: nothing in the product updates or deletes them.
create trigger submission_assets_append_only
before update or delete on public.submission_assets
for each row execute function private.protect_append_only();

-- ---------------------------------------------------------------------------
-- Row level security and grants
--
-- Members read their workspace's snapshots. Nobody inserts, updates, or deletes
-- through the Data API as a signed-in user: the approval function writes them,
-- the trigger above freezes them, and the purge routines are the audited way
-- out. The recipient reaches them only through the delivery functions below.
--
-- RLS and grants are separate controls, and the platform default for a new
-- table has been seen handing every privilege to every role, so both are
-- stated explicitly: revoke everything, then grant exactly what is needed.
-- ---------------------------------------------------------------------------

alter table public.submission_assets enable row level security;
alter table public.submission_assets force row level security;

create policy submission_assets_select on public.submission_assets
  for select to authenticated
  using (private.is_org_member(organization_id));

revoke all on public.submission_assets from public;
revoke all on public.submission_assets from anon;
revoke all on public.submission_assets from authenticated;
revoke all on public.submission_assets from service_role;
grant select on public.submission_assets to authenticated;
-- Trusted server code and test fixtures. Insert is still checked by the
-- version-match trigger; delete still needs the purge flag; update is refused
-- for everyone, and no role holds it.
grant select, insert, delete on public.submission_assets to service_role;

-- ---------------------------------------------------------------------------
-- What an approved package may still change: nothing the recipient sees
--
-- `name` and `package_note` were missing from the frozen set. Both reach the
-- recipient (the page title and the headline), so both are frozen from now on.
-- ---------------------------------------------------------------------------

create or replace function private.protect_approved_package()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return new;
  end if;

  if old.approved_at is null then
    return new;
  end if;

  -- Returning an approved package to review is still allowed; changing what
  -- was approved is not.
  if new.approved_at is null then
    return new;
  end if;

  if new.buyer_id is distinct from old.buyer_id or
     new.shoot_id is distinct from old.shoot_id or
     new.name is distinct from old.name or
     new.package_note is distinct from old.package_note or
     new.delivery_method is distinct from old.delivery_method or
     new.proposed_terms is distinct from old.proposed_terms or
     new.restrictions is distinct from old.restrictions or
     new.exclusivity is distinct from old.exclusivity or
     new.embargo_until is distinct from old.embargo_until
  then
    raise exception 'An approved package is frozen. Recall it and prepare a new one instead of editing what was approved.'
      using errcode = 'restrict_violation';
  end if;

  if new.approved_at is distinct from old.approved_at then
    raise exception 'A package records when it was approved, and that does not move.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Membership changes wait behind an approval in flight
--
-- The approval function locks the package row FOR UPDATE. A concurrent insert
-- into package_assets used to read `approved_at` with a plain select, which
-- does not wait for that lock, so a frame added in the window between the
-- membership read and the commit would have landed in the package and in no
-- snapshot. Taking a share lock on the parent makes the insert wait until the
-- approval commits, at which point it sees the approval and is refused.
-- ---------------------------------------------------------------------------

create or replace function private.protect_approved_package_assets()
returns trigger language plpgsql set search_path = '' as $$
declare
  parent_approved timestamptz;
  target_package uuid := case tg_op when 'DELETE' then old.package_id else new.package_id end;
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  select p.approved_at into parent_approved
  from public.packages p where p.id = target_package
  for share;

  if parent_approved is not null then
    raise exception 'The contents of an approved package are frozen.'
      using errcode = 'restrict_violation';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

-- ---------------------------------------------------------------------------
-- A reference a picture desk can quote back, e.g. BG-0820-4417
--
-- Drawn here rather than in the application so the approval transaction owns
-- its retry: the tail is one of nine thousand values per buyer per day, and
-- the unique constraint is what says whether it is free. Same shape as the
-- application used to draw: up to three initials, the UTC month and day, and
-- a four-digit tail.
-- ---------------------------------------------------------------------------

create or replace function private.draw_submission_reference(buyer_name text, drawn_at timestamptz)
returns text language sql volatile set search_path = '' as $$
  select coalesce(nullif(upper(left(string_agg(left(word, 1), ''), 3)), ''), 'MS')
         || '-' || to_char(drawn_at at time zone 'UTC', 'MMDD')
         || '-' || (floor(random() * 9000) + 1000)::integer::text
  from regexp_split_to_table(coalesce(nullif(trim(buyer_name), ''), 'MS'), '\s+') as word
  where word <> '';
$$;

revoke all on function private.draw_submission_reference(text, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- Approval, as one transaction
--
-- security definer, because the snapshot table deliberately has no insert
-- policy for signed-in users: with an invoker function every owner and
-- dispatcher would need INSERT on submission_assets, and could then write a
-- frame into an approved submission from outside this transaction. Everything
-- a policy would have decided is decided here instead, before anything is
-- written: the caller is resolved from auth.uid(), must be a member of the
-- package's workspace (otherwise "could not be found", the same answer a
-- stranger gets from RLS) and must hold a role that may write submissions.
-- Nothing authoritative is accepted from the caller: the organization, the
-- actor, the versions, the object keys, and the metadata are all read behind
-- the lock.
-- ---------------------------------------------------------------------------

create or replace function public.approve_package(
  target_package uuid,
  recipient_label text default null,
  follow_up_at timestamptz default null
)
returns table (submission_id uuid, reference text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  pkg record;
  buyer record;
  members jsonb;
  member_count integer;
  stamped timestamptz := now();
  drawn text;
  new_submission uuid;
  attempt integer;
  failed_constraint text;
begin
  if actor is null then
    raise exception 'Only a signed-in operator can approve a package.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 1. Lock the package. Every read below happens behind this lock, and the
  --    package_assets trigger waits on it, so the membership cannot move.
  --    A second approval of the same package queues here and then finds it
  --    already approved.
  select p.id, p.organization_id, p.status, p.buyer_id, p.delivery_method,
         p.proposed_terms, p.restrictions, p.exclusivity, p.embargo_until,
         p.package_note, p.approved_at
    into pkg
  from public.packages p
  where p.id = target_package
  for update;

  -- 2. Membership and role, checked in the package's own workspace.
  if not found or not private.is_org_member(pkg.organization_id) then
    raise exception 'That package could not be found in this workspace.'
      using errcode = 'no_data_found';
  end if;

  if not private.has_org_role(pkg.organization_id, array['owner','dispatcher']::public.app_role[]) then
    raise exception 'This role cannot approve a package.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 3. Approvable?
  if pkg.approved_at is not null or pkg.status in ('approved', 'sending', 'delivered') then
    raise exception 'This package has already been approved.' using errcode = 'check_violation';
  end if;
  if pkg.buyer_id is null then
    raise exception 'Set a buyer before approving.' using errcode = 'check_violation';
  end if;
  if nullif(trim(coalesce(pkg.delivery_method, '')), '') is null then
    raise exception 'Record a delivery method before approving.' using errcode = 'check_violation';
  end if;
  if nullif(trim(coalesce(pkg.proposed_terms, '')), '') is null then
    raise exception 'Record the proposed terms before approving.' using errcode = 'check_violation';
  end if;

  -- 4. Lock the membership, then read it exactly once. The manifest and the
  --    snapshot rows are both built from this one read.
  perform 1 from public.package_assets pa
   where pa.package_id = pkg.id and pa.organization_id = pkg.organization_id
   for update;

  select count(*)::integer into member_count
  from public.package_assets pa
  where pa.package_id = pkg.id and pa.organization_id = pkg.organization_id;

  if member_count = 0 then
    raise exception 'The package is empty.' using errcode = 'check_violation';
  end if;

  -- The recipient-visible metadata at the approval instant, the approved
  -- object, and the preview the reviewer was shown: the earliest preview
  -- derivative of the asset, which is the one the review screen renders.
  select jsonb_agg(
           jsonb_build_object(
             'asset_id', pa.asset_id,
             'asset_version_id', pa.asset_version_id,
             'position', pa.position,
             'version_kind', v.version_kind,
             'storage_bucket', v.storage_bucket,
             'object_key', v.object_key,
             'sha256', v.sha256,
             'mime_type', v.mime_type,
             'bytes', v.bytes,
             'width', v.width,
             'height', v.height,
             'preview', (
               select jsonb_build_object(
                        'id', pv.id,
                        'storage_bucket', pv.storage_bucket,
                        'object_key', pv.object_key,
                        'sha256', pv.sha256,
                        'mime_type', pv.mime_type
                      )
               from public.asset_versions pv
               where pv.asset_id = pa.asset_id
                 and pv.organization_id = pa.organization_id
                 and pv.version_kind = 'preview'
               order by pv.created_at, pv.id
               limit 1
             ),
             'filename', a.canonical_filename,
             'headline', a.headline,
             'caption', a.caption,
             'people', case when jsonb_typeof(a.subjects) = 'array' then a.subjects else '[]'::jsonb end,
             'credit_line', a.credit_line,
             'copyright_notice', a.copyright_notice,
             'copyright_owner', a.copyright_owner,
             'captured_at', a.captured_at,
             'location', a.location_name,
             'usage_restrictions', a.usage_restrictions,
             'asset_status', a.status
           )
           order by pa.position
         )
    into members
  from public.package_assets pa
  join public.assets a
    on a.id = pa.asset_id and a.organization_id = pa.organization_id
  join public.asset_versions v
    on v.id = pa.asset_version_id
   and v.asset_id = pa.asset_id
   and v.organization_id = pa.organization_id
  where pa.package_id = pkg.id and pa.organization_id = pkg.organization_id;

  -- 5. Every entry must resolve to a version of its own asset in this
  --    workspace. A row the join dropped is a row that does not.
  if coalesce(jsonb_array_length(members), 0) <> member_count then
    raise exception 'A packaged frame points at a version that no longer exists or belongs to another asset.'
      using errcode = 'foreign_key_violation';
  end if;

  if exists (
    select 1 from jsonb_array_elements(members) m
    where m ->> 'asset_status' in ('restricted', 'tombstoned')
  ) then
    raise exception 'A packaged frame is restricted or tombstoned. Remove it before approving.'
      using errcode = 'check_violation';
  end if;

  -- 6. Freeze the package. `approved`, not `delivered`: nothing has been sent.
  update public.packages p
     set status = 'approved',
         approved_by = actor,
         approved_at = stamped
   where p.id = pkg.id;

  select b.name, b.contact_name into buyer
  from public.buyers b
  where b.id = pkg.buyer_id and b.organization_id = pkg.organization_id;

  -- 7. The submission, with the manifest built from the same read. The
  --    reference is drawn until the unique constraint accepts one -- the
  --    insert is the check, so there is no select-then-insert race -- and any
  --    other failure is a real failure that unwinds everything above.
  for attempt in 1..6 loop
    drawn := private.draw_submission_reference(buyer.name, stamped);
    begin
      insert into public.submissions (
        organization_id, package_id, buyer_id, status, recipient_snapshot,
        terms_snapshot, restrictions_snapshot, delivery_manifest, delivery_method,
        external_reference, follow_up_at, created_by
      )
      values (
        pkg.organization_id, pkg.id, pkg.buyer_id, 'queued',
        jsonb_build_object(
          'desk', coalesce(nullif(trim(coalesce(recipient_label, '')), ''), buyer.contact_name),
          'buyer_name', buyer.name
        ),
        pkg.proposed_terms, pkg.restrictions,
        jsonb_build_object(
          'assets', (
            select jsonb_agg(
                     jsonb_build_object(
                       'assetId', m ->> 'asset_id',
                       'assetVersionId', m ->> 'asset_version_id',
                       'position', (m ->> 'position')::integer
                     )
                     order by (m ->> 'position')::integer
                   )
            from jsonb_array_elements(members) m
          ),
          'asset_count', member_count,
          'exclusivity', pkg.exclusivity,
          'embargo_until', pkg.embargo_until,
          'package_note', pkg.package_note
        ),
        pkg.delivery_method, drawn, follow_up_at, actor
      )
      returning id into new_submission;
      exit;
    exception when unique_violation then
      get stacked diagnostics failed_constraint = constraint_name;
      if failed_constraint <> 'submissions_organization_id_external_reference_key' then
        raise;
      end if;
      if attempt = 6 then
        raise exception 'Could not draw a free submission reference. Try again.'
          using errcode = 'unique_violation';
      end if;
    end;
  end loop;

  -- 8. The approved frames, one row each, from the same read. The insert
  --    trigger re-checks every object identity against the version rows.
  insert into public.submission_assets (
    organization_id, submission_id, asset_id, asset_version_id, position,
    version_kind_snapshot, storage_bucket_snapshot, object_key_snapshot, sha256_snapshot,
    mime_type_snapshot, bytes_snapshot, width_snapshot, height_snapshot,
    preview_asset_version_id, preview_storage_bucket_snapshot, preview_object_key_snapshot,
    preview_sha256_snapshot, preview_mime_type_snapshot,
    filename_snapshot, headline_snapshot, caption_snapshot, people_snapshot,
    credit_line_snapshot, copyright_notice_snapshot, copyright_owner_snapshot,
    captured_at_snapshot, location_snapshot, usage_restrictions_snapshot,
    snapshot_origin, created_at
  )
  select
    pkg.organization_id, new_submission,
    (m ->> 'asset_id')::uuid, (m ->> 'asset_version_id')::uuid, (m ->> 'position')::integer,
    m ->> 'version_kind', m ->> 'storage_bucket', m ->> 'object_key', m ->> 'sha256',
    m ->> 'mime_type', (m ->> 'bytes')::bigint, (m ->> 'width')::integer, (m ->> 'height')::integer,
    (m -> 'preview' ->> 'id')::uuid, m -> 'preview' ->> 'storage_bucket', m -> 'preview' ->> 'object_key',
    m -> 'preview' ->> 'sha256', m -> 'preview' ->> 'mime_type',
    m ->> 'filename', m ->> 'headline', m ->> 'caption', m -> 'people',
    m ->> 'credit_line', m ->> 'copyright_notice', m ->> 'copyright_owner',
    (m ->> 'captured_at')::timestamptz, m ->> 'location', m ->> 'usage_restrictions',
    'approval', stamped
  from jsonb_array_elements(members) m;

  -- 9. The audit record, inside the transaction rather than after it.
  insert into public.activity_events
    (organization_id, actor_id, entity_type, entity_id, action, event_data)
  values (
    pkg.organization_id, actor, 'package', pkg.id, 'package.approved',
    jsonb_build_object(
      'summary', format('Package approved · %s %s · nothing sent yet',
                        member_count, case when member_count = 1 then 'frame' else 'frames' end),
      'count', member_count,
      'submission_id', new_submission,
      'reference', drawn,
      'snapshot_frames', member_count
    )
  );

  return query select new_submission, drawn;
end;
$$;

comment on function public.approve_package(uuid, text, timestamptz) is
  'Approve a package in one transaction: lock, verify every version, freeze the package, create the submission, write the per-frame snapshot with its preview identity, and record the approval. Nothing is sent.';

revoke all on function public.approve_package(uuid, text, timestamptz) from public;
revoke all on function public.approve_package(uuid, text, timestamptz) from anon;
grant execute on function public.approve_package(uuid, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Which frozen objects a browser can be shown a preview of
--
-- A frame has a preview when a preview derivative was frozen at approval, or
-- when the approved object itself is an image the route can scale and mark.
-- A frame whose approved object is a RAW original and had no preview at
-- approval has none: the honest state, and the one the page already knows
-- how to draw. Falling back to a different object is exactly what this
-- migration removes.
-- ---------------------------------------------------------------------------

create or replace function private.delivery_preview_renderable(mime_type text)
returns boolean language sql immutable set search_path = '' as $$
  select mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/avif'
  );
$$;

revoke all on function private.delivery_preview_renderable(text) from public;

-- ---------------------------------------------------------------------------
-- What a link holder sees: the snapshot, and nothing mutable
-- ---------------------------------------------------------------------------

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

  -- The package's name, note, and embargo are frozen by the approval trigger;
  -- the terms and restrictions are the submission's own snapshot; the credit
  -- and the count come from the frozen frames themselves.
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
    acc.accepted_by
  from public.packages p
  left join public.delivery_acceptances acc on acc.delivery_id = link.id
  where p.id = link.package_id;
end;
$$;

comment on function public.open_delivery(text, text, text) is
  'What a link holder sees, and the record of them seeing it. Reads the approved snapshot, never the live asset or package membership. The first valid open is what moves a submission to delivered.';

revoke all on function public.open_delivery(text, text, text) from public;
grant execute on function public.open_delivery(text, text, text) to anon, authenticated;

-- The frames. Return type changes (people in, storage key out), so it is
-- dropped and rebuilt. No column here names a bucket or an object key: the
-- page needs to know whether a preview exists, not where the file is.
drop function if exists public.delivery_assets(text);

create function public.delivery_assets(delivery_token text)
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
  order by sa.position;
$$;

comment on function public.delivery_assets(text) is
  'The approved frames behind a link, in approved order, from the snapshot only. Names no bucket, key, or token.';

revoke all on function public.delivery_assets(text) from public;
grant execute on function public.delivery_assets(text) to anon, authenticated;

-- The preview is rendered by the route from the exact frozen preview, or from
-- the exact approved object when no preview was frozen and the object is an
-- image. This returns that object's identity to trusted server code, never to
-- a page, and the snapshot id and digest so the marked cache can never serve
-- one approval's preview for another. Return type changes, so it is dropped
-- and rebuilt.
drop function if exists public.delivery_preview(text, uuid);

create function public.delivery_preview(
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
      sa.preview_asset_version_id is not null
      or private.delivery_preview_renderable(sa.mime_type_snapshot)
    )
  limit 1;
$$;

comment on function public.delivery_preview(text, uuid) is
  'The exact frozen object a marked preview is rendered from: the preview frozen at approval, else the approved object when it is an image. Never a later derivative.';

revoke all on function public.delivery_preview(text, uuid) from public;
grant execute on function public.delivery_preview(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Downloading the exact approved object
--
-- Two steps, because the record must say what actually happened. The old
-- function wrote `downloaded` and then handed back a key for the route to
-- sign; a signing failure left an event claiming a download that never was.
--
--   authorize_delivery_download  validates the token, expiry, withdrawal,
--                                acceptance, and that the frame is in this
--                                submission's snapshot; records any refusal;
--                                returns the frozen object and its digest.
--                                Writes no download event.
--   record_delivery_download     re-validates the same things and writes the
--                                event. The route calls it only once it holds
--                                a signed response, and releases that response
--                                only if this returns a row.
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
  select d.id, d.organization_id, d.submission_id, d.revoked_at, d.expires_at
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

create or replace function public.authorize_delivery_download(
  delivery_token text,
  target_asset uuid,
  caller_ip text default null,
  caller_agent text default null
)
returns table (
  snapshot_id uuid,
  object_key text,
  storage_bucket text,
  sha256 text,
  filename text,
  mime_type text
)
language sql
security definer
set search_path = ''
as $$
  select g.snapshot_id, g.object_key, g.storage_bucket, g.sha256, g.filename, g.mime_type
  from private.delivery_download_gate(delivery_token, target_asset, caller_ip, caller_agent) g;
$$;

comment on function public.authorize_delivery_download(text, uuid, text, text) is
  'Whether this link may download this frame, and exactly which stored object and digest that is. Records refusals. Records no download: that is record_delivery_download, once the route has a signed response.';

drop function if exists public.record_delivery_download(text, uuid, text, text);

create function public.record_delivery_download(
  delivery_token text,
  target_asset uuid,
  caller_ip text default null,
  caller_agent text default null
)
returns table (recorded_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate record;
  stamped timestamptz;
begin
  select * into gate
  from private.delivery_download_gate(delivery_token, target_asset, caller_ip, caller_agent);

  if not FOUND then
    return;
  end if;

  insert into public.delivery_access_events
    (organization_id, delivery_id, kind, asset_id, ip_address, user_agent)
  values (gate.organization_id, gate.delivery_id, 'downloaded', target_asset,
          caller_ip::inet, caller_agent)
  returning occurred_at into stamped;

  return query select stamped;
end;
$$;

comment on function public.record_delivery_download(text, uuid, text, text) is
  'The append-only record of a download. Called by the route after signing succeeds; the response is released only if this returns a row.';

revoke all on function public.authorize_delivery_download(text, uuid, text, text) from public;
revoke all on function public.record_delivery_download(text, uuid, text, text) from public;
grant execute on function public.authorize_delivery_download(text, uuid, text, text) to anon, authenticated;
grant execute on function public.record_delivery_download(text, uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Existing submissions
--
-- A submission approved before this migration has a manifest naming exact
-- version ids and nothing else. The backfill writes one snapshot row per
-- manifest entry that resolves to a version of its own asset in its own
-- workspace, using that version's real bucket, key, digest, and size, and the
-- editorial metadata as it stands NOW -- marked `legacy_backfill`, because
-- nothing proves that is what a recipient saw at the original approval. No
-- preview identity is invented for these rows: the preview shown at that
-- approval is unknown, so their recipient preview is rendered from the
-- approved object or not at all.
--
-- Each entry is its own subtransaction. An entry that names a missing version,
-- a version of another asset, or a malformed id is skipped: no substitute is
-- chosen, the submission keeps its record, that one frame is simply
-- unavailable to recipients, and `submission_snapshot_gaps_admin()` lists it.
-- ---------------------------------------------------------------------------

create or replace function private.backfill_submission_assets()
returns table (
  submissions_seen integer,
  frames_written integer,
  frames_unresolved integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub record;
  entry jsonb;
  written integer;
  seen integer := 0;
  done integer := 0;
  unresolved integer := 0;
begin
  for sub in
    select s.id, s.organization_id, s.delivery_manifest
    from public.submissions s
    where not exists (
      select 1 from public.submission_assets sa where sa.submission_id = s.id
    )
    order by s.created_at
  loop
    seen := seen + 1;

    for entry in
      select e.value
      from jsonb_array_elements(
             case when jsonb_typeof(sub.delivery_manifest -> 'assets') = 'array'
                  then sub.delivery_manifest -> 'assets'
                  else '[]'::jsonb end
           ) e
    loop
      begin
        insert into public.submission_assets (
          organization_id, submission_id, asset_id, asset_version_id, position,
          version_kind_snapshot, storage_bucket_snapshot, object_key_snapshot, sha256_snapshot,
          mime_type_snapshot, bytes_snapshot, width_snapshot, height_snapshot,
          filename_snapshot, headline_snapshot, caption_snapshot, people_snapshot,
          credit_line_snapshot, copyright_notice_snapshot, copyright_owner_snapshot,
          captured_at_snapshot, location_snapshot, usage_restrictions_snapshot,
          snapshot_origin
        )
        select
          sub.organization_id, sub.id, a.id, v.id, (entry ->> 'position')::integer,
          v.version_kind, v.storage_bucket, v.object_key, v.sha256,
          v.mime_type, v.bytes, v.width, v.height,
          a.canonical_filename, a.headline, a.caption,
          case when jsonb_typeof(a.subjects) = 'array' then a.subjects else '[]'::jsonb end,
          a.credit_line, a.copyright_notice, a.copyright_owner,
          a.captured_at, a.location_name, a.usage_restrictions,
          'legacy_backfill'
        from public.asset_versions v
        join public.assets a
          on a.id = v.asset_id and a.organization_id = v.organization_id
        where v.id = (entry ->> 'assetVersionId')::uuid
          and v.asset_id = (entry ->> 'assetId')::uuid
          and v.organization_id = sub.organization_id;

        get diagnostics written = row_count;
        if written = 1 then
          done := done + 1;
        else
          unresolved := unresolved + 1;
        end if;
      exception when others then
        -- A malformed id, a duplicate position, or a constraint the version
        -- row cannot satisfy: this frame only is rolled back and counted.
        unresolved := unresolved + 1;
      end;
    end loop;
  end loop;

  return query select seen, done, unresolved;
end;
$$;

revoke all on function private.backfill_submission_assets() from public;

do $$
declare
  result record;
begin
  select * into result from private.backfill_submission_assets();
  raise notice 'submission_assets backfill: % submissions seen, % frames written, % manifest entries unresolved',
    result.submissions_seen, result.frames_written, result.frames_unresolved;
end $$;

-- ---------------------------------------------------------------------------
-- Operational checks, service role only
--
-- The post-deploy smoke test and the test suite use these; a browser cannot.
-- ---------------------------------------------------------------------------

-- Run the backfill again for any submission that still has no snapshot row:
-- a submission inserted by a path that predates the transaction, or one whose
-- versions were repaired after the migration ran. Idempotent -- a submission
-- with rows is never touched -- and it substitutes nothing, exactly as above.
create or replace function public.backfill_submission_assets_admin()
returns table (
  submissions_seen integer,
  frames_written integer,
  frames_unresolved integer
)
language sql
security definer
set search_path = ''
as $$
  select * from private.backfill_submission_assets();
$$;

revoke all on function public.backfill_submission_assets_admin() from public;
revoke all on function public.backfill_submission_assets_admin() from anon;
revoke all on function public.backfill_submission_assets_admin() from authenticated;
grant execute on function public.backfill_submission_assets_admin() to service_role;

-- Manifest entries with no snapshot row. A recipient link cannot show or
-- download that frame; it is listed rather than guessed at.
create or replace function public.submission_snapshot_gaps_admin()
returns table (
  submission_id uuid,
  organization_id uuid,
  external_reference text,
  manifest_position integer,
  manifest_asset_id text,
  manifest_asset_version_id text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.organization_id, s.external_reference,
         (e ->> 'position')::integer, e ->> 'assetId', e ->> 'assetVersionId'
  from public.submissions s
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(s.delivery_manifest -> 'assets') = 'array'
         then s.delivery_manifest -> 'assets'
         else '[]'::jsonb end
  ) e
  where not exists (
    select 1 from public.submission_assets sa
    where sa.submission_id = s.id
      and sa.asset_id::text = e ->> 'assetId'
      and sa.asset_version_id::text = e ->> 'assetVersionId'
  )
  order by s.created_at, (e ->> 'position')::integer;
$$;

-- Snapshot rows the manifest does not account for. Must always be empty: the
-- approval writes both from one read, and nothing else writes either.
create or replace function public.submission_snapshot_drift_admin()
returns table (submission_id uuid, organization_id uuid, external_reference text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct s.id, s.organization_id, s.external_reference
  from public.submissions s
  join public.submission_assets sa on sa.submission_id = s.id
  where not exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(s.delivery_manifest -> 'assets') = 'array'
           then s.delivery_manifest -> 'assets'
           else '[]'::jsonb end
    ) e
    where e ->> 'assetId' = sa.asset_id::text
      and e ->> 'assetVersionId' = sa.asset_version_id::text
      and (e ->> 'position')::integer = sa.position
  );
$$;

revoke all on function public.submission_snapshot_gaps_admin() from public;
revoke all on function public.submission_snapshot_gaps_admin() from anon;
revoke all on function public.submission_snapshot_gaps_admin() from authenticated;
grant execute on function public.submission_snapshot_gaps_admin() to service_role;

revoke all on function public.submission_snapshot_drift_admin() from public;
revoke all on function public.submission_snapshot_drift_admin() from anon;
revoke all on function public.submission_snapshot_drift_admin() from authenticated;
grant execute on function public.submission_snapshot_drift_admin() to service_role;

-- ---------------------------------------------------------------------------
-- The purge routines
--
-- Snapshot rows restrict their asset and both versions, so an asset purge
-- (account closure, an erasure request) has to remove them first, under the
-- purge flag, in the same audited routine that removes the package rows.
-- Purging an asset that was in an approved submission removes that frame from
-- the submission's record; that is what erasure means. Organization and
-- submission purges need no change: they delete submissions first, under the
-- flag, and the rows cascade.
-- ---------------------------------------------------------------------------

create or replace function private.purge_assets(target_asset_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('mastline.allow_purge', 'on', true);
  delete from public.submission_assets where asset_id = any(target_asset_ids);
  delete from public.package_assets where asset_id = any(target_asset_ids);
  delete from public.license_assets where asset_id = any(target_asset_ids);
  update public.payment_allocations set asset_id = null where asset_id = any(target_asset_ids);
  update public.expenses set asset_id = null where asset_id = any(target_asset_ids);
  delete from public.asset_versions where asset_id = any(target_asset_ids);
  delete from public.assets where id = any(target_asset_ids);
  perform set_config('mastline.allow_purge', 'off', true);
end;
$$;

revoke all on function private.purge_assets(uuid[]) from public;
revoke all on function private.purge_assets(uuid[]) from authenticated;

-- The platform default hands anon everything on a new table. Every migration
-- closes with this, and it is load-bearing.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
