-- Mastline commercial graph.
--
-- Adapted from supabase/schema/initial.sql with the defects found during the
-- Phase 0 audit corrected. Each correction is marked FIX with a short reason.
--
-- Conventions:
--   * Every business table carries organization_id and is RLS-protected.
--   * Money is an integer count of minor units plus an ISO 4217 currency.
--   * Timestamps are UTC; the workspace timezone is a render-time concern.
--   * Explicit Data API grants are paired with RLS policies.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Status vocabularies
--
-- These mirror src/lib/domain.ts one for one. A value may only change by an
-- explicit migration, and the TypeScript unions must move with it.
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('owner','editor','dispatcher','finance','rights_reviewer','viewer');
create type public.shoot_status as enum ('draft','scheduled','active','ingesting','preparing','ready','dispatched','completed','archived','cancelled');
create type public.asset_status as enum ('ingesting','active','restricted','archived','tombstoned');
create type public.package_status as enum ('draft','needs_review','ready','approved','sending','delivered','failed','recalled');
create type public.submission_status as enum ('queued','sent','delivered','failed','acknowledged','sold','no_sale','recalled');
create type public.license_status as enum ('proposed','active','expired','cancelled','disputed');
create type public.payment_status as enum ('expected','invoiced','reported','partial','received','overdue','disputed','written_off');
create type public.rights_match_status as enum ('new','reviewing','licensed','ignored','monitoring','escalated','resolved');

-- FIX 3: the Sales Engine share is conditional on where a license came from,
-- and the starter schema had nowhere to record that. Without this column the
-- single most important conditional in the business model cannot be evaluated.
create type public.license_origin as enum ('mastline_sales_engine','external');

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  timezone text not null default 'America/New_York',
  currency char(3) not null default 'USD',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  status text not null default 'active' check (status in ('invited','active','suspended')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.buyers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  buyer_type text not null default 'agency' check (buyer_type in ('agency','publisher','picture_desk','direct_licensee','other')),
  contact_name text,
  contact_email text,
  default_terms text,
  delivery_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

-- ---------------------------------------------------------------------------
-- Opportunities and shoots
-- ---------------------------------------------------------------------------

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  source_name text,
  source_url text,
  source_published_at timestamptz,
  signal text not null default 'watch' check (signal in ('rising','high','steady','watch')),
  summary text,
  suggested_value_low_minor bigint check (suggested_value_low_minor is null or suggested_value_low_minor >= 0),
  suggested_value_high_minor bigint check (suggested_value_high_minor is null or suggested_value_high_minor >= 0),
  currency char(3) not null default 'USD',
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  suggestion_basis jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new','watching','pitching','acted','dismissed','expired')),
  window_closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    suggested_value_low_minor is null
    or suggested_value_high_minor is null
    or suggested_value_low_minor <= suggested_value_high_minor
  )
);

create table public.shoots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  title text not null,
  story_angle text,
  status public.shoot_status not null default 'draft',
  priority text not null default 'standard' check (priority in ('watch','standard','high','urgent')),
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  location_name text,
  location_address text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  assignment_label text,
  target_buyers jsonb not null default '[]'::jsonb,
  exclusivity text,
  embargo_until timestamptz,
  sensitive_content boolean not null default false,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

-- Source protection: confidential fields live in their own table behind a
-- narrower policy so that finance and dispatch access cannot reach them.
create table public.shoot_sensitive_notes (
  shoot_id uuid primary key references public.shoots(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_note text,
  confidential_location text,
  confidential_identity text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shoot_collaborators (
  shoot_id uuid not null references public.shoots(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_role text not null default 'photographer' check (assignment_role in ('photographer','editor','dispatcher','assistant','finance','other')),
  created_at timestamptz not null default now(),
  primary key (shoot_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Assets
-- ---------------------------------------------------------------------------

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shoot_id uuid references public.shoots(id) on delete set null,
  status public.asset_status not null default 'ingesting',
  asset_kind text not null default 'image' check (asset_kind in ('image','video')),
  canonical_filename text not null,
  captured_at timestamptz,
  headline text,
  caption text,
  subjects jsonb not null default '[]'::jsonb,
  location_name text,
  keywords jsonb not null default '[]'::jsonb,
  creator_name text,
  copyright_notice text,
  copyright_owner text,
  credit_line text,
  usage_restrictions text,
  selected boolean not null default false,
  rating smallint check (rating is null or rating between 0 and 5),
  -- FIX 7: lifetime_earnings_minor was a stored counter with nothing keeping it
  -- in step with payment_allocations, so it was guaranteed to drift. Earnings
  -- are now derived by the asset_lifetime_earnings view below.
  tombstoned_at timestamptz,
  tombstoned_by uuid references auth.users(id),
  tombstone_reason text,
  currency char(3) not null default 'USD',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'tombstoned') = (tombstoned_at is not null)
  )
);

create table public.asset_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- FIX 1: this was `on delete cascade`, which combined with the append-only
  -- trigger below to abort any asset or organization delete. Originals are
  -- tombstoned rather than deleted, so restrict is the honest constraint; a
  -- deliberate purge goes through private.purge_organization().
  asset_id uuid not null references public.assets(id) on delete restrict,
  version_kind text not null check (version_kind in ('original','preview','edit','delivery','thumbnail')),
  storage_bucket text not null check (storage_bucket in ('originals','derivatives')),
  object_key text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint not null check (bytes > 0),
  mime_type text not null,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  technical_metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, object_key),
  unique (asset_id, version_kind, sha256),
  -- An original always lands in the originals bucket and nothing else may.
  check (
    (version_kind = 'original') = (storage_bucket = 'originals')
  )
);

-- FIX 6: caption history had nowhere to live, yet the asset record screen is
-- specified to show it and metadata edits must not destroy prior values.
create table public.asset_caption_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  headline text,
  caption text,
  subjects jsonb not null default '[]'::jsonb,
  keywords jsonb not null default '[]'::jsonb,
  usage_restrictions text,
  edited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Dispatch and submissions
-- ---------------------------------------------------------------------------

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shoot_id uuid not null references public.shoots(id) on delete cascade,
  buyer_id uuid references public.buyers(id) on delete set null,
  name text not null,
  status public.package_status not null default 'draft',
  delivery_method text,
  proposed_terms text,
  exclusivity text,
  embargo_until timestamptz,
  restrictions text,
  package_note text,
  validation_results jsonb not null default '{}'::jsonb,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Approval is a single fact: both columns are set, or neither is.
  check ((approved_by is null) = (approved_at is null)),
  -- A package cannot reach a shipped state without a recorded approval.
  check (
    status not in ('approved','sending','delivered')
    or approved_at is not null
  )
);

create table public.package_assets (
  package_id uuid not null references public.packages(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  asset_version_id uuid not null references public.asset_versions(id) on delete restrict,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  primary key (package_id, asset_id),
  unique (package_id, position) deferrable initially deferred
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id uuid not null references public.packages(id) on delete restrict,
  buyer_id uuid references public.buyers(id) on delete set null,
  status public.submission_status not null default 'queued',
  recipient_snapshot jsonb not null default '{}'::jsonb,
  terms_snapshot text,
  restrictions_snapshot text,
  -- Exactly which asset versions went out. Frozen once sent_at is set.
  delivery_manifest jsonb not null default '{}'::jsonb,
  delivery_method text,
  external_reference text,
  sent_at timestamptz,
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  follow_up_at timestamptz,
  outcome_note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_reference),
  check (delivered_at is null or sent_at is not null),
  check (delivered_at is null or sent_at is null or delivered_at >= sent_at)
);

-- ---------------------------------------------------------------------------
-- Licenses, payments, splits
-- ---------------------------------------------------------------------------

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id uuid references public.submissions(id) on delete set null,
  buyer_id uuid references public.buyers(id) on delete set null,
  status public.license_status not null default 'proposed',
  licensee_name text not null,
  media text,
  territory text,
  starts_at timestamptz,
  ends_at timestamptz,
  exclusivity text,
  terms text,
  -- FIX 3: origin gates the Sales Engine share. The contractual sale base is
  -- stored as an explicit input and is never back-derived from net revenue.
  origin public.license_origin not null default 'external',
  sale_base_minor bigint not null default 0 check (sale_base_minor >= 0),
  sales_engine_share_minor bigint not null default 0 check (sales_engine_share_minor >= 0),
  photographer_share_minor bigint not null default 0 check (photographer_share_minor >= 0),
  currency char(3) not null default 'USD',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at),
  -- The two shares always reconstitute the base. No lost or invented cent.
  check (sales_engine_share_minor + photographer_share_minor = sale_base_minor),
  -- An externally generated license can never carry a platform fee. This is
  -- the 70/30 business rule expressed as a database constraint.
  check (origin = 'mastline_sales_engine' or sales_engine_share_minor = 0)
);

create table public.license_assets (
  license_id uuid not null references public.licenses(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (license_id, asset_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  buyer_id uuid references public.buyers(id) on delete set null,
  status public.payment_status not null default 'expected',
  source text not null default 'manual' check (source in ('manual','invoice','statement','checkout','recovery')),
  external_reference text,
  -- FIX 4: these were all `>= 0`, which made a refund or chargeback
  -- unrepresentable. The acceptance criteria require the 70/30 calculation to
  -- be tested including refunds, so reversals must be storable as signed rows.
  gross_minor bigint not null default 0,
  deductions_minor bigint not null default 0,
  platform_fee_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  net_minor bigint not null default 0,
  currency char(3) not null default 'USD',
  -- A reversal points at what it reverses and is never merged into it.
  reverses_payment_id uuid references public.payments(id) on delete restrict,
  expected_at timestamptz,
  due_at timestamptz,
  received_at timestamptz,
  statement_payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, external_reference),
  -- A reversal is negative throughout; an ordinary payment is not negative.
  check (
    (reverses_payment_id is null and gross_minor >= 0 and net_minor >= 0)
    or (reverses_payment_id is not null and gross_minor <= 0 and net_minor <= 0)
  )
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  license_id uuid references public.licenses(id) on delete set null,
  submission_id uuid references public.submissions(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  -- FIX 4: allocations may be negative so a reversal can unwind them.
  -- Allocations divide the payment's NET, never its gross.
  allocated_minor bigint not null check (allocated_minor <> 0),
  currency char(3) not null default 'USD',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (num_nonnulls(license_id, submission_id, asset_id) >= 1)
);

-- FIX 5: team splits were required to stay separately inspectable but had no
-- table. Shares are basis points so they divide exactly and total 10000.
create table public.revenue_splits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  license_id uuid references public.licenses(id) on delete cascade,
  submission_id uuid references public.submissions(id) on delete cascade,
  payee_user_id uuid references auth.users(id) on delete set null,
  payee_label text not null,
  share_basis_points integer not null check (share_basis_points between 0 and 10000),
  amount_minor bigint not null default 0,
  currency char(3) not null default 'USD',
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(license_id, submission_id) >= 1)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shoot_id uuid references public.shoots(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  category text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null default 'USD',
  incurred_at timestamptz not null,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Rights, audit, idempotency
-- ---------------------------------------------------------------------------

create table public.rights_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  -- Human triage state. Deliberately separate from the machine observation.
  status public.rights_match_status not null default 'new',
  source_url text not null,
  publisher_name text,
  publisher_domain text,
  page_title text,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  match_method text,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  evidence_bucket text check (evidence_bucket is null or evidence_bucket = 'evidence'),
  evidence_object_key text,
  evidence_hash text,
  -- An observation about our own records, never a legal conclusion.
  license_check text not null default 'not_checked' check (license_check in ('not_checked','linked_license_found','possible_license','no_linked_license_found')),
  decision_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, asset_id, source_url),
  check (last_observed_at >= first_observed_at),
  check ((reviewed_by is null) = (reviewed_at is null))
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Null actor means the system acted. Only the service role may write those.
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- FIX 9: repeating a delivery webhook must not create a duplicate submission or
-- event. The unique constraint is the idempotency guarantee; a replayed
-- delivery collides here instead of being processed twice.
--
-- Service-role only. Note that Supabase default privileges grant ALL on new
-- public tables to authenticated, so silence is not protection: the grant is
-- revoked explicitly further down.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  provider text not null,
  external_event_id text not null,
  event_type text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  unique (provider, external_event_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index memberships_user_active_idx on public.memberships(user_id, organization_id) where status = 'active';
create index organizations_created_by_idx on public.organizations(created_by);
create index buyers_org_idx on public.buyers(organization_id);
create index opportunities_org_status_idx on public.opportunities(organization_id, status, source_published_at desc);
create index shoots_org_status_updated_idx on public.shoots(organization_id, status, updated_at desc);
create index shoots_opportunity_id_idx on public.shoots(opportunity_id);
create index shoot_sensitive_notes_org_idx on public.shoot_sensitive_notes(organization_id);
create index shoot_collaborators_org_user_idx on public.shoot_collaborators(organization_id, user_id);
create index assets_org_shoot_captured_idx on public.assets(organization_id, shoot_id, captured_at desc);
create index assets_org_selected_idx on public.assets(organization_id, selected) where selected;
create index asset_versions_asset_idx on public.asset_versions(asset_id);
create index asset_versions_org_idx on public.asset_versions(organization_id);
create index asset_caption_revisions_asset_idx on public.asset_caption_revisions(asset_id, created_at desc);
create index asset_caption_revisions_org_idx on public.asset_caption_revisions(organization_id);
create index packages_org_shoot_idx on public.packages(organization_id, shoot_id);
create index packages_buyer_id_idx on public.packages(buyer_id);
create index package_assets_org_asset_idx on public.package_assets(organization_id, asset_id);
create index package_assets_version_idx on public.package_assets(asset_version_id);
create index submissions_org_status_followup_idx on public.submissions(organization_id, status, follow_up_at);
create index submissions_package_id_idx on public.submissions(package_id);
create index submissions_buyer_id_idx on public.submissions(buyer_id);
create index licenses_org_status_end_idx on public.licenses(organization_id, status, ends_at);
create index licenses_submission_id_idx on public.licenses(submission_id);
create index licenses_buyer_id_idx on public.licenses(buyer_id);
create index licenses_org_origin_idx on public.licenses(organization_id, origin);
create index license_assets_org_asset_idx on public.license_assets(organization_id, asset_id);
create index payments_org_status_due_idx on public.payments(organization_id, status, due_at);
create index payments_buyer_id_idx on public.payments(buyer_id);
create index payments_reverses_idx on public.payments(reverses_payment_id);
create index payment_allocations_org_idx on public.payment_allocations(organization_id);
create index payment_allocations_payment_idx on public.payment_allocations(payment_id);
create index payment_allocations_license_idx on public.payment_allocations(license_id);
create index payment_allocations_submission_idx on public.payment_allocations(submission_id);
create index payment_allocations_asset_idx on public.payment_allocations(asset_id);
create index revenue_splits_org_idx on public.revenue_splits(organization_id);
create index revenue_splits_license_idx on public.revenue_splits(license_id);
create index revenue_splits_submission_idx on public.revenue_splits(submission_id);
create index expenses_org_shoot_idx on public.expenses(organization_id, shoot_id);
create index expenses_asset_id_idx on public.expenses(asset_id);
create index rights_matches_org_status_observed_idx on public.rights_matches(organization_id, status, last_observed_at desc);
create index rights_matches_asset_idx on public.rights_matches(asset_id);
create index activity_events_entity_idx on public.activity_events(organization_id, entity_type, entity_id, created_at desc);
create index activity_events_actor_idx on public.activity_events(actor_id);
create index webhook_events_org_idx on public.webhook_events(organization_id, created_at desc);

-- Foreign keys need a supporting index or every parent delete degenerates into
-- a sequential scan. Flagged by the performance advisor rule set.
create index memberships_invited_by_idx on public.memberships(invited_by);
create index shoots_created_by_idx on public.shoots(created_by);
create index shoot_sensitive_notes_created_by_idx on public.shoot_sensitive_notes(created_by);
create index assets_created_by_idx on public.assets(created_by);
create index assets_tombstoned_by_idx on public.assets(tombstoned_by);
create index asset_versions_created_by_idx on public.asset_versions(created_by);
create index asset_caption_revisions_edited_by_idx on public.asset_caption_revisions(edited_by);
create index packages_created_by_idx on public.packages(created_by);
create index packages_approved_by_idx on public.packages(approved_by);
create index submissions_created_by_idx on public.submissions(created_by);
create index licenses_created_by_idx on public.licenses(created_by);
create index payments_created_by_idx on public.payments(created_by);
create index payment_allocations_created_by_idx on public.payment_allocations(created_by);
create index revenue_splits_created_by_idx on public.revenue_splits(created_by);
create index revenue_splits_payee_user_id_idx on public.revenue_splits(payee_user_id);
create index expenses_created_by_idx on public.expenses(created_by);
create index rights_matches_reviewed_by_idx on public.rights_matches(reviewed_by);

-- ---------------------------------------------------------------------------
-- Functions and triggers
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare target_table text;
begin
  foreach target_table in array array[
    'organizations','memberships','buyers','opportunities','shoots',
    'shoot_sensitive_notes','assets','packages','submissions','licenses',
    'payments','revenue_splits','expenses','rights_matches'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()',
      target_table
    );
  end loop;
end $$;

-- FIX 1: the original trigger raised unconditionally on both UPDATE and DELETE,
-- so a cascaded delete from assets or organizations aborted the transaction and
-- an organization could never be removed. Immutability is still the default;
-- a deliberate purge sets a session flag that only trusted server code sets.
create or replace function private.protect_asset_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception
    'Asset versions are append-only. Tombstone the asset instead of deleting it.'
    using errcode = 'restrict_violation';
end;
$$;

create trigger asset_versions_append_only
before update or delete on public.asset_versions
for each row execute function private.protect_asset_version();

-- Caption history is a log. It may be added to, never rewritten.
create or replace function private.protect_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception '% records are append-only.', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

create trigger asset_caption_revisions_append_only
before update or delete on public.asset_caption_revisions
for each row execute function private.protect_append_only();

-- Defence in depth: the activity log has no update or delete grant either, but
-- a trigger means a future grant cannot silently make history editable.
create trigger activity_events_append_only
before update or delete on public.activity_events
for each row execute function private.protect_append_only();

-- What was sent stays exactly what was sent. Outcome fields remain editable so
-- a sale can be linked afterwards without rewriting the delivery record.
create or replace function private.protect_submission_snapshot()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.sent_at is not null and (
    new.package_id is distinct from old.package_id or
    new.buyer_id is distinct from old.buyer_id or
    new.recipient_snapshot is distinct from old.recipient_snapshot or
    new.terms_snapshot is distinct from old.terms_snapshot or
    new.restrictions_snapshot is distinct from old.restrictions_snapshot or
    new.delivery_manifest is distinct from old.delivery_manifest or
    new.delivery_method is distinct from old.delivery_method or
    new.sent_at is distinct from old.sent_at
  ) then
    raise exception 'Sent submission snapshots are immutable'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger submissions_protect_snapshot
before update on public.submissions
for each row execute function private.protect_submission_snapshot();

-- Tombstoning stamps who and when, so the asset record can explain itself.
create or replace function private.stamp_tombstone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'tombstoned' and old.status is distinct from 'tombstoned' then
    new.tombstoned_at = coalesce(new.tombstoned_at, now());
    new.tombstoned_by = coalesce(new.tombstoned_by, (select auth.uid()));
  elsif new.status <> 'tombstoned' then
    new.tombstoned_at = null;
    new.tombstoned_by = null;
    new.tombstone_reason = null;
  end if;
  return new;
end;
$$;

create trigger assets_stamp_tombstone
before update on public.assets
for each row execute function private.stamp_tombstone();

-- An original is written once. A derivative may never take its place.
create or replace function private.protect_original_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.version_kind = 'original' and exists (
    select 1 from public.asset_versions v
    where v.asset_id = new.asset_id and v.version_kind = 'original'
  ) then
    raise exception 'Asset % already has an original version', new.asset_id
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

create trigger asset_versions_single_original
before insert on public.asset_versions
for each row execute function private.protect_original_version();

-- ---------------------------------------------------------------------------
-- Authorization helpers
--
-- security definer with an empty search_path so they read memberships without
-- re-entering RLS. Role truth lives here, never in user-editable metadata.
-- ---------------------------------------------------------------------------

create or replace function private.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.memberships m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create or replace function private.has_org_role(target_org uuid, allowed_roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.memberships m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any(allowed_roles)
  );
$$;

revoke all on function private.is_org_member(uuid) from public;
revoke all on function private.has_org_role(uuid, public.app_role[]) from public;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.app_role[]) to authenticated;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Derived money
--
-- FIX 7: earnings are computed from allocations rather than stored, so they
-- cannot drift. security_invoker keeps the caller's RLS in force; without it a
-- view would read as its owner and leak across organizations.
-- ---------------------------------------------------------------------------

create view public.asset_lifetime_earnings
with (security_invoker = on) as
select
  a.id as asset_id,
  a.organization_id,
  a.currency,
  coalesce(sum(pa.allocated_minor), 0)::bigint as lifetime_earnings_minor
from public.assets a
left join public.payment_allocations pa
  on pa.asset_id = a.id
 and pa.organization_id = a.organization_id
group by a.id, a.organization_id, a.currency;

comment on view public.asset_lifetime_earnings is
  'Lifetime earnings per asset, derived from payment allocations. Allocations divide a payment''s net, never its gross.';

-- ---------------------------------------------------------------------------
-- Deliberate purge
--
-- Tombstoning is the operator-facing behaviour; originals are never destroyed
-- through the product. This exists so an account closure or an erasure request
-- can still be honoured, by trusted server code only, in one auditable place.
-- ---------------------------------------------------------------------------

create or replace function private.purge_assets(target_asset_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('mastline.allow_purge', 'on', true);
  -- Deletion order follows the foreign keys that restrict rather than cascade.
  delete from public.package_assets where asset_id = any(target_asset_ids);
  delete from public.license_assets where asset_id = any(target_asset_ids);
  update public.payment_allocations set asset_id = null where asset_id = any(target_asset_ids);
  update public.expenses set asset_id = null where asset_id = any(target_asset_ids);
  delete from public.asset_versions where asset_id = any(target_asset_ids);
  delete from public.assets where id = any(target_asset_ids);
  perform set_config('mastline.allow_purge', 'off', true);
end;
$$;

create or replace function private.purge_organization(target_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('mastline.allow_purge', 'on', true);
  -- submissions restrict packages, and package_assets restrict asset_versions,
  -- so these have to go before the organization cascade can run.
  delete from public.submissions where organization_id = target_org;
  delete from public.package_assets where organization_id = target_org;
  delete from public.license_assets where organization_id = target_org;
  delete from public.asset_versions where organization_id = target_org;
  delete from public.assets where organization_id = target_org;
  delete from public.organizations where id = target_org;
  perform set_config('mastline.allow_purge', 'off', true);
end;
$$;

revoke all on function private.purge_organization(uuid) from public;
revoke all on function private.purge_organization(uuid) from authenticated;
revoke all on function private.purge_assets(uuid[]) from public;
revoke all on function private.purge_assets(uuid[]) from authenticated;

-- RPC surface for trusted server code. Reachable only with the service role;
-- authenticated and anon are explicitly revoked.
create or replace function public.purge_organization_admin(target_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.purge_organization(target_org);
end;
$$;

create or replace function public.purge_asset_admin(target_asset uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.purge_assets(array[target_asset]);
end;
$$;

revoke all on function public.purge_organization_admin(uuid) from public;
revoke all on function public.purge_organization_admin(uuid) from anon;
revoke all on function public.purge_organization_admin(uuid) from authenticated;
grant execute on function public.purge_organization_admin(uuid) to service_role;

revoke all on function public.purge_asset_admin(uuid) from public;
revoke all on function public.purge_asset_admin(uuid) from anon;
revoke all on function public.purge_asset_admin(uuid) from authenticated;
grant execute on function public.purge_asset_admin(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

do $$
declare target_table text;
begin
  foreach target_table in array array[
    'organizations','memberships','buyers','opportunities','shoots',
    'shoot_sensitive_notes','shoot_collaborators','assets','asset_versions',
    'asset_caption_revisions','packages','package_assets','submissions',
    'licenses','license_assets','payments','payment_allocations',
    'revenue_splits','expenses','rights_matches','activity_events',
    'webhook_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', target_table);
    -- Deny by default even to the table owner, so a missing policy fails closed.
    execute format('alter table public.%I force row level security', target_table);
  end loop;
end $$;

-- Organizations -------------------------------------------------------------

create policy organizations_select on public.organizations
  for select to authenticated
  using (private.is_org_member(id) or created_by = (select auth.uid()));

create policy organizations_insert on public.organizations
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy organizations_update on public.organizations
  for update to authenticated
  using (private.has_org_role(id, array['owner']::public.app_role[]))
  with check (private.has_org_role(id, array['owner']::public.app_role[]));

-- Memberships ---------------------------------------------------------------

create policy memberships_select on public.memberships
  for select to authenticated
  using (private.is_org_member(organization_id) or user_id = (select auth.uid()));

-- FIX 2: there was no way to add a second person to a workspace, which made
-- Studio's "up to 5 people" unimplementable.
--
-- Two admission paths, expressed as one policy because separate permissive
-- policies for the same role and command are OR'd anyway and each is evaluated
-- on its own:
--   1. the founding owner adding themselves to an organization they created
--   2. an existing owner inviting someone else, but never as another owner
create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (
    (
      user_id = (select auth.uid())
      and role = 'owner'
      and exists (
        select 1 from public.organizations o
        where o.id = organization_id and o.created_by = (select auth.uid())
      )
    )
    or (
      private.has_org_role(organization_id, array['owner']::public.app_role[])
      and user_id <> (select auth.uid())
      and role <> 'owner'
    )
  );

create policy memberships_owner_update on public.memberships
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner']::public.app_role[]));

create policy memberships_owner_delete on public.memberships
  for delete to authenticated
  using (
    private.has_org_role(organization_id, array['owner']::public.app_role[])
    -- An owner cannot remove themselves and strand the workspace.
    and user_id <> (select auth.uid())
  );

-- Read access for every active member, including viewers -------------------

do $$
declare target_table text;
begin
  foreach target_table in array array[
    'buyers','opportunities','shoots','shoot_collaborators','assets',
    'asset_versions','asset_caption_revisions','packages','package_assets',
    'submissions','licenses','license_assets','payments','payment_allocations',
    'revenue_splits','expenses','rights_matches'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))',
      target_table || '_select', target_table
    );
  end loop;
end $$;

-- Write access by role -------------------------------------------------------
--
-- Roles follow docs/DATA_MODEL.md. viewer appears in no write policy.
-- Each policy carries both a visibility check and a write check.

create policy buyers_write on public.buyers
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor','dispatcher','finance']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor','dispatcher','finance']::public.app_role[]));

create policy opportunities_write on public.opportunities
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

-- FIX 11: dispatcher had full write on shoots, which is wider than the role
-- definition. A dispatcher moves packages and submissions, not shoot briefs.
create policy shoots_write on public.shoots
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

-- Source protection: finance and dispatch cannot reach these rows at all.
create policy shoot_sensitive_notes_select on public.shoot_sensitive_notes
  for select to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

create policy shoot_sensitive_notes_write on public.shoot_sensitive_notes
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

create policy shoot_collaborators_write on public.shoot_collaborators
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

create policy assets_write on public.assets
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

-- Insert only. The append-only trigger stops updates and deletes regardless.
create policy asset_versions_insert on public.asset_versions
  for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

create policy asset_caption_revisions_insert on public.asset_caption_revisions
  for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

create policy packages_write on public.packages
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]));

create policy package_assets_write on public.package_assets
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]));

create policy submissions_write on public.submissions
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','dispatcher']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','dispatcher']::public.app_role[]));

create policy licenses_write on public.licenses
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]));

create policy license_assets_write on public.license_assets
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]));

create policy payments_write on public.payments
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]));

create policy payment_allocations_write on public.payment_allocations
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]));

create policy revenue_splits_write on public.revenue_splits
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]));

create policy expenses_write on public.expenses
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','finance','editor']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','finance','editor']::public.app_role[]));

-- A rights reviewer triages evidence. Escalation to a demand or takedown is a
-- separate approved workflow and is deliberately not a database permission.
create policy rights_matches_write on public.rights_matches
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','rights_reviewer']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','rights_reviewer']::public.app_role[]));

-- Activity log ---------------------------------------------------------------

create policy activity_events_select on public.activity_events
  for select to authenticated
  using (private.is_org_member(organization_id));

-- A member may only log an action as themselves. System events carry a null
-- actor and are written by the service role, which bypasses RLS entirely.
create policy activity_events_insert on public.activity_events
  for insert to authenticated
  with check (
    private.is_org_member(organization_id)
    and actor_id = (select auth.uid())
  );

-- webhook_events intentionally has no policy for authenticated. RLS is forced
-- so it already fails closed, and the grant is revoked below as well, so an
-- accidental policy in future cannot open it up on its own.

-- ---------------------------------------------------------------------------
-- Explicit Data API grants. RLS remains the row authorization layer.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.organizations, public.memberships, public.buyers, public.opportunities,
  public.shoots, public.shoot_sensitive_notes, public.shoot_collaborators,
  public.assets, public.packages, public.package_assets, public.submissions,
  public.licenses, public.license_assets, public.payments,
  public.payment_allocations, public.revenue_splits, public.expenses,
  public.rights_matches
to authenticated;

-- Append-only tables get no update or delete grant.
grant select, insert on public.asset_versions to authenticated;
grant select, insert on public.asset_caption_revisions to authenticated;
grant select, insert on public.activity_events to authenticated;

grant select on public.asset_lifetime_earnings to authenticated;

-- Supabase default privileges grant ALL on new public tables to authenticated.
-- The service-role-only table must have that grant taken back explicitly.
revoke all on public.webhook_events from authenticated;
grant select, insert, update, delete on public.webhook_events to service_role;

-- Nothing is exposed to anonymous callers.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on schema private from anon;

-- ---------------------------------------------------------------------------
-- Storage
--
-- FIX 10: the starter schema described three private buckets but created none
-- and defined no storage policies, so originals and evidence had no protection
-- at all.
--
-- Every object key begins with the organization id:
--   originals/<organization_id>/<shoot_id>/<filename>
-- Access is granted only to an active member of that organization. Nothing is
-- public; delivery uses short-lived signed URLs minted by trusted server code.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('originals',   'originals',   false, 5368709120, null),
  ('derivatives', 'derivatives', false, 1073741824, null),
  ('evidence',    'evidence',    false, 268435456,  null)
on conflict (id) do nothing;

-- The first path segment as a uuid, or null when the key is malformed.
create or replace function private.storage_org_id(object_name text)
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

revoke all on function private.storage_org_id(text) from public;
grant execute on function private.storage_org_id(text) to authenticated;

create policy mastline_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('originals','derivatives','evidence')
    and private.storage_org_id(name) is not null
    and private.is_org_member(private.storage_org_id(name))
  );

-- Editors import originals and derivatives. Rights reviewers preserve evidence.
create policy mastline_storage_insert on storage.objects
  for insert to authenticated
  with check (
    private.storage_org_id(name) is not null
    and (
      (
        bucket_id in ('originals','derivatives')
        and private.has_org_role(private.storage_org_id(name), array['owner','editor']::public.app_role[])
      )
      or (
        bucket_id = 'evidence'
        and private.has_org_role(private.storage_org_id(name), array['owner','rights_reviewer']::public.app_role[])
      )
    )
  );

-- Derivatives can be regenerated. Originals and evidence cannot be overwritten.
create policy mastline_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'derivatives'
    and private.storage_org_id(name) is not null
    and private.has_org_role(private.storage_org_id(name), array['owner','editor']::public.app_role[])
  )
  with check (
    bucket_id = 'derivatives'
    and private.storage_org_id(name) is not null
    and private.has_org_role(private.storage_org_id(name), array['owner','editor']::public.app_role[])
  );

-- Only derivatives may be deleted. An original is tombstoned, never removed,
-- and evidence is retained because it may need to support a later claim.
create policy mastline_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'derivatives'
    and private.storage_org_id(name) is not null
    and private.has_org_role(private.storage_org_id(name), array['owner','editor']::public.app_role[])
  );
