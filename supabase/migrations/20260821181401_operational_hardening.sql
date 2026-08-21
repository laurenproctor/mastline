-- Operational hardening: delivery attempts, statement reconciliation, and
-- buyer delivery templates.
--
-- Three things a live operator needs that the first loop did not provide:
--
--   * A failed delivery has to be visible, explainable, and retryable without
--     rewriting the record of what was sent.
--   * An agency statement has to be importable, matched line by line, and
--     re-importable without creating duplicate money.
--   * A buyer's delivery requirements should be recorded once rather than
--     retyped into every package.

-- ---------------------------------------------------------------------------
-- Delivery attempts
--
-- The submission says what was sent and stays frozen. Attempts are the separate
-- log of trying to get it there, so a retry adds a fact rather than editing
-- history.
-- ---------------------------------------------------------------------------

create table public.submission_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('sending', 'delivered', 'failed')),
  error_code text,
  error_detail text,
  -- Null when a provider webhook reported the result rather than a person.
  attempted_by uuid references auth.users(id) on delete set null,
  attempted_at timestamptz not null default now(),
  unique (submission_id, attempt_number)
);

-- No index on (submission_id, attempt_number): the unique constraint already
-- provides one, and a duplicate costs write throughput for nothing.
create index submission_delivery_attempts_org_idx
  on public.submission_delivery_attempts(organization_id, attempted_at desc);
create index submission_delivery_attempts_attempted_by_idx
  on public.submission_delivery_attempts(attempted_by);

create trigger submission_delivery_attempts_append_only
before update or delete on public.submission_delivery_attempts
for each row execute function private.protect_append_only();

-- ---------------------------------------------------------------------------
-- Statement reconciliation
--
-- An import is a file. Its lines are what the agency claims it paid. Matching a
-- line produces a payment and an allocation; the line itself keeps the original
-- claim so a disagreement stays visible rather than being edited away.
-- ---------------------------------------------------------------------------

create table public.statement_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  buyer_id uuid references public.buyers(id) on delete set null,
  filename text not null,
  -- Re-importing the same bytes collides here instead of duplicating money.
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  row_count integer not null default 0 check (row_count >= 0),
  currency char(3) not null default 'USD',
  imported_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, content_sha256)
);

create index statement_imports_org_idx
  on public.statement_imports(organization_id, created_at desc);
create index statement_imports_buyer_idx on public.statement_imports(buyer_id);
create index statement_imports_imported_by_idx on public.statement_imports(imported_by);

create table public.statement_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  statement_import_id uuid not null references public.statement_imports(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  -- The row exactly as it arrived. Never edited, so the agency's claim and our
  -- interpretation of it stay separable.
  raw jsonb not null default '{}'::jsonb,
  external_reference text,
  description text,
  gross_minor bigint not null default 0,
  deductions_minor bigint not null default 0,
  net_minor bigint not null default 0,
  currency char(3) not null default 'USD',
  match_status text not null default 'unmatched'
    check (match_status in ('unmatched', 'suggested', 'matched', 'ignored', 'disputed')),
  match_basis text,
  matched_submission_id uuid references public.submissions(id) on delete set null,
  matched_license_id uuid references public.licenses(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (statement_import_id, line_number),
  -- A matched line must say what it matched to.
  check (
    match_status <> 'matched'
    or num_nonnulls(matched_submission_id, matched_license_id) >= 1
  )
);

-- The unique constraint on (statement_import_id, line_number) already indexes
-- that pair.
create index statement_lines_org_status_idx
  on public.statement_lines(organization_id, match_status);
create index statement_lines_reference_idx
  on public.statement_lines(organization_id, external_reference);
create index statement_lines_payment_idx on public.statement_lines(payment_id);
create index statement_lines_submission_idx on public.statement_lines(matched_submission_id);
create index statement_lines_license_idx on public.statement_lines(matched_license_id);

create trigger set_updated_at before update on public.statement_lines
for each row execute function private.set_updated_at();

-- The raw row is what the agency said. It does not change.
create or replace function private.protect_statement_raw()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.raw is distinct from old.raw
     or new.gross_minor is distinct from old.gross_minor
     or new.net_minor is distinct from old.net_minor then
    raise exception 'An imported statement line cannot be rewritten. Record a dispute instead.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger statement_lines_protect_raw
before update on public.statement_lines
for each row execute function private.protect_statement_raw();

-- ---------------------------------------------------------------------------
-- Buyer delivery templates
--
-- One fact entered once: a buyer's route, terms, and restrictions are recorded
-- against the buyer and inherited by every package built for them.
-- ---------------------------------------------------------------------------

alter table public.buyers
  add column default_delivery_method text,
  add column default_restrictions text,
  add column metadata_requirements jsonb not null default '{}'::jsonb,
  add column payment_terms_days integer check (payment_terms_days is null or payment_terms_days >= 0);

comment on column public.buyers.metadata_requirements is
  'Fields this buyer requires beyond the baseline. Additive only: a baseline requirement is never dropped because a buyer did not ask for it.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.submission_delivery_attempts enable row level security;
alter table public.submission_delivery_attempts force row level security;
alter table public.statement_imports enable row level security;
alter table public.statement_imports force row level security;
alter table public.statement_lines enable row level security;
alter table public.statement_lines force row level security;

create policy submission_delivery_attempts_select on public.submission_delivery_attempts
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy submission_delivery_attempts_insert on public.submission_delivery_attempts
  for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner','dispatcher']::public.app_role[])
  );

-- Statements are money, so finance and owner only -- the same boundary that
-- keeps payments away from editors and dispatchers.
create policy statement_imports_select on public.statement_imports
  for select to authenticated
  using (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]));

create policy statement_imports_write on public.statement_imports
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]));

create policy statement_lines_select on public.statement_lines
  for select to authenticated
  using (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]));

create policy statement_lines_write on public.statement_lines
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]));

-- ---------------------------------------------------------------------------
-- Deliberate purge, extended to submissions
--
-- The append-only trigger on delivery attempts blocks DELETE, which also blocks
-- the cascade from a submission. That is the same trap the initial migration
-- hit with asset_versions: immutability is right, but it has to leave one
-- audited way through for an account closure or an erasure request.
--
-- Submissions are never deleted through the product. This exists only so a
-- workspace can actually be removed when someone asks for that.
-- ---------------------------------------------------------------------------

create or replace function private.purge_submissions(target_submission_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('mastline.allow_purge', 'on', true);
  delete from public.submission_delivery_attempts
    where submission_id = any(target_submission_ids);
  update public.statement_lines set matched_submission_id = null
    where matched_submission_id = any(target_submission_ids);
  update public.payment_allocations set submission_id = null
    where submission_id = any(target_submission_ids);
  update public.licenses set submission_id = null
    where submission_id = any(target_submission_ids);
  delete from public.submissions where id = any(target_submission_ids);
  perform set_config('mastline.allow_purge', 'off', true);
end;
$$;

revoke all on function private.purge_submissions(uuid[]) from public;
revoke all on function private.purge_submissions(uuid[]) from authenticated;

create or replace function public.purge_submission_admin(target_submission uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.purge_submissions(array[target_submission]);
end;
$$;

revoke all on function public.purge_submission_admin(uuid) from public;
revoke all on function public.purge_submission_admin(uuid) from anon;
revoke all on function public.purge_submission_admin(uuid) from authenticated;
grant execute on function public.purge_submission_admin(uuid) to service_role;

-- The organization purge has to clear delivery attempts too, now that they
-- exist and refuse an ordinary cascade.
create or replace function private.purge_organization(target_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('mastline.allow_purge', 'on', true);
  delete from public.submission_delivery_attempts where organization_id = target_org;
  delete from public.statement_lines where organization_id = target_org;
  delete from public.statement_imports where organization_id = target_org;
  delete from public.submissions where organization_id = target_org;
  delete from public.package_assets where organization_id = target_org;
  delete from public.license_assets where organization_id = target_org;
  delete from public.asset_versions where organization_id = target_org;
  delete from public.assets where organization_id = target_org;
  delete from public.organizations where id = target_org;
  perform set_config('mastline.allow_purge', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Append-only tables get no update or delete.
-- ---------------------------------------------------------------------------

grant select, insert on public.submission_delivery_attempts to authenticated;
grant select, insert, update, delete on public.statement_imports to authenticated;
grant select, insert, update, delete on public.statement_lines to authenticated;

-- Supabase default privileges hand every new public table to anon and
-- authenticated. RLS is forced on all three so nothing leaks either way, but
-- an anonymous caller should not hold a grant at all. This revoke covers the
-- whole schema so it also catches anything added in a future migration that
-- forgets to.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;
