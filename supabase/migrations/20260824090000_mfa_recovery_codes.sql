-- A way back in when the phone is gone.
--
-- docs/TWO_FACTOR.md recorded this as the thing missing before two-factor could
-- reasonably be required of anyone: without it, a lost device means an
-- administrator with service-role access, which is not a recovery path a
-- customer can use at two in the morning.
--
-- Supabase has no notion of recovery codes, so they are ours. What they cannot
-- do is raise a session to aal2 -- only a real TOTP verification does that. So a
-- code does the honest thing instead: it proves the person is who they say,
-- removes the factor, and lets them back in to enrol again. That is what the
-- code is actually for.
--
-- Only the hash is stored, with a salt of its own, exactly as a password would
-- be. A code is shown once, when it is made, and never again.

create table public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- scrypt, per-code salt. The plaintext exists only in the moment it is shown.
  code_hash text not null,
  salt text not null,
  -- Single use. Kept after use rather than deleted, so "a code was used to get
  -- back in" stays visible.
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index mfa_recovery_codes_user_idx on public.mfa_recovery_codes(user_id, used_at);

comment on table public.mfa_recovery_codes is
  'Single-use codes that remove a second factor and let the holder back in to enrol again. Hashed with a per-code salt; the plaintext is shown once.';

alter table public.mfa_recovery_codes enable row level security;
alter table public.mfa_recovery_codes force row level security;

-- Your own codes and nobody else's. There is deliberately no path here for an
-- owner to read or replace a colleague's, which would be a way around the
-- factor rather than an administrative convenience.
create policy mfa_recovery_codes_select on public.mfa_recovery_codes
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy mfa_recovery_codes_insert on public.mfa_recovery_codes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy mfa_recovery_codes_update on public.mfa_recovery_codes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy mfa_recovery_codes_delete on public.mfa_recovery_codes
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.mfa_recovery_codes to authenticated;

revoke all on all tables in schema public from anon;
