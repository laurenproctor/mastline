-- Allow a staged upload to be promoted, without making originals mutable.
--
-- The import contract stages bytes, hashes them, and promotes them only once
-- the record exists. Promotion is a rename within the originals bucket, which
-- needs UPDATE on storage.objects -- and UPDATE on originals is exactly what
-- keeps a promoted original immutable.
--
-- The resolution is to scope mutability to the staging prefix. An object under
-- <organization_id>/_staging/ may be renamed or cleaned up; once promoted out
-- of staging it is immutable like every other original. The unique constraint
-- on (bucket_id, name) is what stops a promotion overwriting an existing key.

create or replace function private.is_staging_object(object_name text)
returns boolean language sql immutable set search_path = '' as $$
  select split_part(object_name, '/', 2) = '_staging';
$$;

revoke all on function private.is_staging_object(text) from public;
grant execute on function private.is_staging_object(text) to authenticated;

drop policy if exists mastline_storage_update on storage.objects;
drop policy if exists mastline_storage_delete on storage.objects;

-- Renaming is permitted for derivatives, which can be regenerated, and for
-- staged uploads that have not yet been promoted.
create policy mastline_storage_update on storage.objects
  for update to authenticated
  using (
    private.storage_org_id(name) is not null
    and (
      (
        bucket_id = 'derivatives'
        and private.has_org_role(
          private.storage_org_id(name), array['owner','editor']::public.app_role[]
        )
      )
      or (
        bucket_id = 'originals'
        and private.is_staging_object(name)
        and private.has_org_role(
          private.storage_org_id(name), array['owner','editor']::public.app_role[]
        )
      )
    )
  )
  with check (
    private.storage_org_id(name) is not null
    and bucket_id in ('originals', 'derivatives')
    and private.has_org_role(
      private.storage_org_id(name), array['owner','editor']::public.app_role[]
    )
  );

-- Deleting is permitted for derivatives and for abandoned staged uploads.
-- A promoted original is never deleted; the asset is tombstoned instead.
create policy mastline_storage_delete on storage.objects
  for delete to authenticated
  using (
    private.storage_org_id(name) is not null
    and (
      (
        bucket_id = 'derivatives'
        and private.has_org_role(
          private.storage_org_id(name), array['owner','editor']::public.app_role[]
        )
      )
      or (
        bucket_id = 'originals'
        and private.is_staging_object(name)
        and private.has_org_role(
          private.storage_org_id(name), array['owner','editor']::public.app_role[]
        )
      )
    )
  );
