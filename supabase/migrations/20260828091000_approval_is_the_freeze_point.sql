-- Approval is when the commercial package becomes permanent.
--
-- The submission snapshot was frozen by `sent_at`, which was fine while
-- approving a package and sending it were the same motion. They are not, and
-- pretending otherwise is what let approval claim a delivery. Now a submission
-- is created `queued` with `sent_at` null and stays that way until a link is
-- actually shared -- so a snapshot keyed on `sent_at` would have been editable
-- for the whole of the window between approval and sharing, which is exactly
-- the window in which somebody might be tempted to adjust it.
--
-- So the freeze moves to the moment the record is created. What was approved is
-- what was approved. Everything that legitimately happens afterwards -- a
-- delivery timestamp, an acknowledgement, an outcome, a linked sale -- is
-- forward-only and stays open.
--
-- The same argument applies one level up. A package that has been approved has
-- had its contents and its commercial terms agreed; the frames, the versions,
-- the ordering, the buyer, the terms, the restrictions, the exclusivity, and
-- the embargo are the thing the photographer signed off. A link created
-- afterwards points at that, and if the membership could still change, the
-- manifest on the submission and the frames behind the link would drift apart.

-- ---------------------------------------------------------------------------
-- The submission snapshot, frozen from creation
--
-- `sent_at` gets one special rule: it may be filled in once, from null, because
-- that is the share (or the first open) recording that the package left
-- Mastline. It may never be moved afterwards, and it may never be cleared.
-- ---------------------------------------------------------------------------

create or replace function private.protect_submission_snapshot()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return new;
  end if;

  -- What was approved. Not conditional on anything: the snapshot is written by
  -- the insert and is never a draft.
  if new.package_id is distinct from old.package_id or
     new.organization_id is distinct from old.organization_id or
     new.buyer_id is distinct from old.buyer_id or
     new.recipient_snapshot is distinct from old.recipient_snapshot or
     new.terms_snapshot is distinct from old.terms_snapshot or
     new.restrictions_snapshot is distinct from old.restrictions_snapshot or
     new.delivery_manifest is distinct from old.delivery_manifest or
     new.delivery_method is distinct from old.delivery_method
  then
    raise exception 'A submission snapshot is immutable from the moment it is created.'
      using errcode = 'restrict_violation';
  end if;

  -- Forward-only send evidence.
  if old.sent_at is not null and new.sent_at is distinct from old.sent_at then
    raise exception 'A submission records when it was first sent, and that does not move.'
      using errcode = 'restrict_violation';
  end if;

  -- The same for the first delivery. A second open does not restate it.
  if old.delivered_at is not null and new.delivered_at is distinct from old.delivered_at then
    raise exception 'A submission records when it was first delivered, and that does not move.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

comment on function private.protect_submission_snapshot() is
  'What was approved stays what was approved. Outcome, status, and the forward-only delivery timestamps remain open.';

-- ---------------------------------------------------------------------------
-- An approved package
--
-- Status stays mutable: `approved` becomes `sending` when a link is shared and
-- `delivered` when one is opened, and a package can still be recalled. What is
-- frozen is the commercial substance.
--
-- Clearing the approval is deliberately still possible, because the approval
-- path rolls the package back if the submission insert fails and a package left
-- approved with no submission would be a worse record than one returned to
-- review.
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

  -- Returning an approved package to review is allowed; changing what was
  -- approved is not.
  if new.approved_at is null then
    return new;
  end if;

  if new.buyer_id is distinct from old.buyer_id or
     new.shoot_id is distinct from old.shoot_id or
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

create trigger packages_protect_approved
before update on public.packages
for each row execute function private.protect_approved_package();

-- ---------------------------------------------------------------------------
-- ...and its contents
--
-- Membership, ordering, and the exact selected version. This is the one the
-- manifest depends on: a frame added to an approved package would appear behind
-- every delivery link without ever appearing in the submission's manifest.
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
  from public.packages p where p.id = target_package;

  if parent_approved is not null then
    raise exception 'The contents of an approved package are frozen.'
      using errcode = 'restrict_violation';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger package_assets_protect_approved
before insert or update or delete on public.package_assets
for each row execute function private.protect_approved_package_assets();

comment on function private.protect_approved_package_assets() is
  'Frames, versions, and ordering are fixed at approval, so the manifest on the submission and the frames behind a delivery link cannot drift apart.';

-- ---------------------------------------------------------------------------
-- The purge routines have to be able to unwind this
--
-- Both new triggers honour `mastline.allow_purge`, but the package purge never
-- set it. It did not need to before, because nothing on packages refused an
-- update. It does now.
-- ---------------------------------------------------------------------------

create or replace function private.purge_packages(target_package_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('mastline.allow_purge', 'on', true);
  delete from public.package_assets where package_id = any(target_package_ids);
  delete from public.packages where id = any(target_package_ids);
  perform set_config('mastline.allow_purge', 'off', true);
end;
$$;

revoke all on function private.purge_packages(uuid[]) from public;
revoke all on function private.purge_packages(uuid[]) from anon;
revoke all on function private.purge_packages(uuid[]) from authenticated;

create or replace function public.purge_package_admin(target_package uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.purge_packages(array[target_package]);
end;
$$;

revoke all on function public.purge_package_admin(uuid) from public;
revoke all on function public.purge_package_admin(uuid) from anon;
revoke all on function public.purge_package_admin(uuid) from authenticated;
grant execute on function public.purge_package_admin(uuid) to service_role;

-- `private.purge_organization` needs no change: it already raises the purge
-- flag before it deletes package_assets, and both new triggers honour it. The
-- shoot-level cleanup the test fixtures use does not, which is what
-- `purge_package_admin` above is for.
