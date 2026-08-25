-- Who a person is, readable by the people they work with.
--
-- Until now identity lived entirely in `auth.users.user_metadata`, which the
-- Data API does not expose. `listWorkspaceMembers` said so in as many words and
-- fell back to the first eight characters of the user id, so a colleague
-- appeared in People & permissions as "a3f9c2e1" with the initials "A3". Only
-- the signed-in user ever saw a real name, because only their own metadata was
-- readable to them.
--
-- This is the profiles table that comment anticipated. It exists so that a name
-- and a face can be shown to the people who share a workspace with their owner,
-- and to nobody else.
--
-- Shape notes:
--
--   * The primary key IS `auth.users.id`. A profile is not a separate identity
--     with its own lifetime; it is the readable face of an account, and it goes
--     when the account goes.
--
--   * `first_name` and `last_name`, matching how sign-up already collects them
--     and how `src/lib/person-name.ts` already reads them. The metadata copy
--     stays authoritative for the signed-in user's own session; this is the
--     copy other people are allowed to read.
--
--   * `email` as well, because without it a colleague who has not set a name
--     has nothing to render at all -- neither a label nor the two letters an
--     avatar falls back to. `initialsFrom` already reads an email for exactly
--     this reason, and `WorkspaceMember.email` has been an empty string waiting
--     for it. It is kept in step with `auth.users.email` by trigger; a column
--     that silently went stale would be worse than no column.
--
--   * `avatar_path` is a storage key, not a URL. The bucket is private, so a
--     URL would be a signature with an expiry baked into a column that outlives
--     it. The check constraint keeps the key under the owner's own prefix, so a
--     row cannot point at somebody else's object.
--
--   * RLS is enabled but NOT forced, which departs from every other table here.
--     The sign-up trigger has to write a row before the account it belongs to
--     can authenticate, and a forced policy would block its own security
--     definer. In exchange the client surface is narrower than elsewhere rather
--     than wider: there is no insert policy and no delete policy at all, so a
--     signed-in caller can only read profiles they share a workspace with and
--     update exactly one row -- their own.
--
-- ROLLBACK
--
--   begin;
--     drop trigger if exists create_profile_after_user_insert on auth.users;
--     drop trigger if exists sync_profile_email_after_user_update on auth.users;
--     drop function if exists private.create_profile_for_user();
--     drop function if exists private.sync_profile_email();
--     drop policy if exists mastline_avatar_select on storage.objects;
--     drop policy if exists mastline_avatar_insert on storage.objects;
--     drop policy if exists mastline_avatar_update on storage.objects;
--     drop policy if exists mastline_avatar_delete on storage.objects;
--     delete from storage.objects where bucket_id = 'avatars';
--     delete from storage.buckets where id = 'avatars';
--     drop table if exists public.profiles;
--     drop function if exists private.storage_user_id(text);
--     drop function if exists private.shares_org_with(uuid);
--   commit;
--
--   Dropping the table discards uploaded names and avatar keys. The image
--   objects are deleted with the bucket, so this is not reversible by re-running
--   the migration; the trigger repopulates names from metadata, not faces.

-- ---------------------------------------------------------------------------
-- Do I work with this person?
--
-- The read rule for both the table and the bucket. Membership in a shared
-- organization is the whole test: not a role, because everyone in a workspace
-- sees everyone else in People & permissions, and not an active status on the
-- other side, because a suspended colleague is still listed and still needs a
-- name against their row.
-- ---------------------------------------------------------------------------

create or replace function private.shares_org_with(target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = target_user
  );
$$;

revoke all on function private.shares_org_with(uuid) from public;
revoke all on function private.shares_org_with(uuid) from anon;
grant execute on function private.shares_org_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'The readable face of an account: the name and photo that colleagues in a shared workspace may see. Identity itself stays in auth.users.';
comment on column public.profiles.avatar_path is
  'Key in the private avatars bucket, always under the owner''s own id. Not a URL: the bucket is private and a signature would outlive the column.';

-- A row may only ever point at an object in its own prefix. Without this an
-- update could aim avatar_path at a colleague's object and borrow their face.
alter table public.profiles
  drop constraint if exists profiles_avatar_path_check;
alter table public.profiles
  add constraint profiles_avatar_path_check check (
    avatar_path is null
    or avatar_path like (id::text || '/%')
  );

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Reading a colleague's row means scanning by the ids a membership can see.
create index if not exists profiles_updated_idx on public.profiles(updated_at desc);

alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.shares_org_with(id)
  );

-- Your own row, and only ever your own. The `with check` repeats the test so
-- an update cannot rewrite `id` and walk the row onto somebody else.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Deliberately no insert policy and no delete policy: rows arrive with the
-- account and leave with it.
grant select, update on public.profiles to authenticated;
revoke all on public.profiles from anon;

-- ---------------------------------------------------------------------------
-- A profile arrives with the account
--
-- Security definer because this runs inside sign-up, before the account it
-- describes can authenticate; there is no auth.uid() to satisfy a policy with
-- at that moment. `on conflict do nothing` so a replayed sign-up is not an
-- error, matching how create_workspace treats a repeat.
-- ---------------------------------------------------------------------------

create or replace function private.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, first_name, last_name, email)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data->>'first_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'last_name', '')), ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_profile_after_user_insert on auth.users;
create trigger create_profile_after_user_insert
  after insert on auth.users
  for each row execute function private.create_profile_for_user();

-- A changed address has to reach the copy, or the People list slowly fills with
-- addresses that no longer reach anyone.
create or replace function private.sync_profile_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists sync_profile_email_after_user_update on auth.users;
create trigger sync_profile_email_after_user_update
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function private.sync_profile_email();

-- Everyone who signed up before this migration existed.
insert into public.profiles (id, first_name, last_name, email)
select
  u.id,
  nullif(trim(coalesce(u.raw_user_meta_data->>'first_name', '')), ''),
  nullif(trim(coalesce(u.raw_user_meta_data->>'last_name', '')), ''),
  u.email
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The avatars bucket
--
-- Private, like every other bucket here. A photographer's own face is not a
-- thing to leave world-readable at a key derived from their user id, and the
-- source-protection principle in CLAUDE.md points the same way.
--
-- Keyed by user rather than by organization, because a person who works in two
-- workspaces has one face. That is why it needs policies of its own: the
-- existing ones require the first path segment to be an organization id.
--
-- Two megabytes and three formats. The browser squares and downscales to 256px
-- before uploading, so the ceiling is there to stop something unexpected, not
-- to accommodate a camera original.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- The first path segment as a uuid, or null when the key is malformed. The
-- sibling of private.storage_org_id, for the bucket that is keyed by person.
create or replace function private.storage_user_id(object_name text)
returns uuid language plpgsql immutable set search_path = '' as $$
declare first_segment text;
begin
  first_segment := split_part(object_name, '/', 1);
  if first_segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return first_segment::uuid;
end;
$$;

revoke all on function private.storage_user_id(text) from public;
revoke all on function private.storage_user_id(text) from anon;
grant execute on function private.storage_user_id(text) to authenticated;

-- Read: yourself, or somebody you share a workspace with. The same rule as the
-- table, so a face is never visible to anyone who cannot already see the name.
drop policy if exists mastline_avatar_select on storage.objects;
create policy mastline_avatar_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and private.storage_user_id(name) is not null
    and (
      private.storage_user_id(name) = (select auth.uid())
      or private.shares_org_with(private.storage_user_id(name))
    )
  );

-- Write: your own prefix only, in all three directions. Unlike an original, an
-- avatar is meant to be replaced and removed -- it is a preference, not a
-- record of what was captured.
drop policy if exists mastline_avatar_insert on storage.objects;
create policy mastline_avatar_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and private.storage_user_id(name) = (select auth.uid())
  );

drop policy if exists mastline_avatar_update on storage.objects;
create policy mastline_avatar_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and private.storage_user_id(name) = (select auth.uid())
  )
  with check (
    bucket_id = 'avatars'
    and private.storage_user_id(name) = (select auth.uid())
  );

drop policy if exists mastline_avatar_delete on storage.objects;
create policy mastline_avatar_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and private.storage_user_id(name) = (select auth.uid())
  );
