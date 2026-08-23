-- A workspace may require a second factor of the roles that carry the most risk.
--
-- Two-factor authentication itself is Supabase's: factors, secrets, and
-- verification live in the auth schema and are never copied here. What this
-- column records is policy -- whether this workspace insists on it -- because
-- that is a decision about the business, not about an account.
--
-- Deliberately defaulting to false, including for new workspaces. Turning it on
-- locks out an owner who has not enrolled yet, so it is something a workspace
-- chooses rather than something that happens to it on a Tuesday. The roles it
-- applies to are in src/lib/mfa.ts: owner and finance, the two that can export
-- the entire commercial record.

alter table public.organizations
  add column require_mfa boolean not null default false;

comment on column public.organizations.require_mfa is
  'Whether owners and finance must hold a verified second factor. Policy only; the factors themselves belong to Supabase auth.';
