-- Mastline starter schema.
-- Do not apply this file directly in production.
-- First run: supabase migration new initial_commercial_graph
-- Then copy/review this SQL inside the generated migration, apply locally, test RLS,
-- and run Supabase Security and Performance Advisors.

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public;

create type public.app_role as enum ('owner','editor','dispatcher','finance','rights_reviewer','viewer');
create type public.shoot_status as enum ('draft','scheduled','active','ingesting','preparing','ready','dispatched','completed','archived','cancelled');
create type public.asset_status as enum ('ingesting','active','restricted','archived','tombstoned');
create type public.package_status as enum ('draft','needs_review','ready','approved','sending','delivered','failed','recalled');
create type public.submission_status as enum ('queued','sent','delivered','failed','acknowledged','sold','no_sale','recalled');
create type public.license_status as enum ('proposed','active','expired','cancelled','disputed');
create type public.payment_status as enum ('expected','invoiced','reported','partial','received','overdue','disputed','written_off');
create type public.rights_match_status as enum ('new','reviewing','licensed','ignored','monitoring','escalated','resolved');

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  updated_at timestamptz not null default now()
);

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
  lifetime_earnings_minor bigint not null default 0 check (lifetime_earnings_minor >= 0),
  currency char(3) not null default 'USD',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.asset_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
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
  unique (asset_id, version_kind, sha256)
);

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
  updated_at timestamptz not null default now()
);

create table public.package_assets (
  package_id uuid not null references public.packages(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  asset_version_id uuid not null references public.asset_versions(id) on delete restrict,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  primary key (package_id, asset_id),
  unique (package_id, position)
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
  unique (organization_id, external_reference)
);

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
  gross_fee_minor bigint check (gross_fee_minor is null or gross_fee_minor >= 0),
  platform_fee_minor bigint check (platform_fee_minor is null or platform_fee_minor >= 0),
  photographer_share_minor bigint check (photographer_share_minor is null or photographer_share_minor >= 0),
  currency char(3) not null default 'USD',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  gross_minor bigint not null default 0 check (gross_minor >= 0),
  deductions_minor bigint not null default 0 check (deductions_minor >= 0),
  platform_fee_minor bigint not null default 0 check (platform_fee_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  net_minor bigint not null default 0 check (net_minor >= 0),
  currency char(3) not null default 'USD',
  expected_at timestamptz,
  due_at timestamptz,
  received_at timestamptz,
  statement_payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, external_reference)
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  license_id uuid references public.licenses(id) on delete set null,
  submission_id uuid references public.submissions(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  allocated_minor bigint not null check (allocated_minor > 0),
  currency char(3) not null default 'USD',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (num_nonnulls(license_id, submission_id, asset_id) >= 1)
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

create table public.rights_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
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
  license_check text not null default 'not_checked' check (license_check in ('not_checked','linked_license_found','possible_license','no_linked_license_found')),
  decision_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, asset_id, source_url)
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index memberships_user_active_idx on public.memberships(user_id, organization_id) where status = 'active';
create index organizations_created_by_idx on public.organizations(created_by);
create index opportunities_org_status_idx on public.opportunities(organization_id, status, source_published_at desc);
create index shoots_org_status_updated_idx on public.shoots(organization_id, status, updated_at desc);
create index shoots_opportunity_id_idx on public.shoots(opportunity_id);
create index shoot_sensitive_notes_org_idx on public.shoot_sensitive_notes(organization_id);
create index shoot_collaborators_org_user_idx on public.shoot_collaborators(organization_id, user_id);
create index assets_org_shoot_captured_idx on public.assets(organization_id, shoot_id, captured_at desc);
create index assets_org_selected_idx on public.assets(organization_id, shoot_id, selected) where selected;
create index asset_versions_asset_idx on public.asset_versions(asset_id, version_kind);
create index packages_org_shoot_idx on public.packages(organization_id, shoot_id, status);
create index packages_buyer_id_idx on public.packages(buyer_id);
create index package_assets_org_asset_idx on public.package_assets(organization_id, asset_id);
create index package_assets_version_idx on public.package_assets(asset_version_id);
create index submissions_org_status_followup_idx on public.submissions(organization_id, status, follow_up_at);
create index submissions_package_id_idx on public.submissions(package_id);
create index submissions_buyer_id_idx on public.submissions(buyer_id);
create index licenses_org_status_end_idx on public.licenses(organization_id, status, ends_at);
create index licenses_submission_id_idx on public.licenses(submission_id);
create index licenses_buyer_id_idx on public.licenses(buyer_id);
create index license_assets_org_asset_idx on public.license_assets(organization_id, asset_id);
create index payments_org_status_due_idx on public.payments(organization_id, status, due_at);
create index payments_buyer_id_idx on public.payments(buyer_id);
create index payment_allocations_org_idx on public.payment_allocations(organization_id);
create index payment_allocations_payment_idx on public.payment_allocations(payment_id);
create index payment_allocations_license_idx on public.payment_allocations(license_id) where license_id is not null;
create index payment_allocations_submission_idx on public.payment_allocations(submission_id) where submission_id is not null;
create index payment_allocations_asset_idx on public.payment_allocations(asset_id) where asset_id is not null;
create index expenses_org_shoot_idx on public.expenses(organization_id, shoot_id);
create index expenses_asset_id_idx on public.expenses(asset_id) where asset_id is not null;
create index rights_matches_org_status_observed_idx on public.rights_matches(organization_id, status, first_observed_at desc);
create index activity_events_entity_idx on public.activity_events(organization_id, entity_type, entity_id, created_at desc);
create index activity_events_actor_idx on public.activity_events(actor_id) where actor_id is not null;

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['organizations','memberships','buyers','opportunities','shoots','shoot_sensitive_notes','assets','packages','submissions','licenses','payments','expenses','rights_matches']
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', table_name);
  end loop;
end $$;

create or replace function private.protect_asset_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Asset version records are append-only';
end;
$$;

create trigger asset_versions_append_only
before update or delete on public.asset_versions
for each row execute function private.protect_asset_version();

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
    new.delivery_method is distinct from old.delivery_method
  ) then
    raise exception 'Sent submission snapshots are immutable';
  end if;
  return new;
end;
$$;

create trigger submissions_protect_snapshot
before update on public.submissions
for each row execute function private.protect_submission_snapshot();

create or replace function private.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.memberships m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create or replace function private.has_org_role(target_org uuid, allowed_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.buyers enable row level security;
alter table public.opportunities enable row level security;
alter table public.shoots enable row level security;
alter table public.shoot_sensitive_notes enable row level security;
alter table public.shoot_collaborators enable row level security;
alter table public.assets enable row level security;
alter table public.asset_versions enable row level security;
alter table public.packages enable row level security;
alter table public.package_assets enable row level security;
alter table public.submissions enable row level security;
alter table public.licenses enable row level security;
alter table public.license_assets enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.expenses enable row level security;
alter table public.rights_matches enable row level security;
alter table public.activity_events enable row level security;

create policy organizations_select on public.organizations for select to authenticated using (private.is_org_member(id) or created_by = (select auth.uid()));
create policy organizations_insert on public.organizations for insert to authenticated with check (created_by = (select auth.uid()));
create policy organizations_update on public.organizations for update to authenticated using (private.has_org_role(id, array['owner']::public.app_role[])) with check (private.has_org_role(id, array['owner']::public.app_role[]));

create policy memberships_select on public.memberships for select to authenticated using (private.is_org_member(organization_id));
create policy memberships_insert_initial_owner on public.memberships for insert to authenticated with check (
  user_id = (select auth.uid()) and role = 'owner' and exists (
    select 1 from public.organizations o where o.id = organization_id and o.created_by = (select auth.uid())
  )
);
create policy memberships_owner_update on public.memberships for update to authenticated using (private.has_org_role(organization_id, array['owner']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner']::public.app_role[]));
create policy memberships_owner_delete on public.memberships for delete to authenticated using (private.has_org_role(organization_id, array['owner']::public.app_role[]));

do $$
declare table_name text;
begin
  foreach table_name in array array['buyers','opportunities','shoots','shoot_collaborators','assets','asset_versions','packages','package_assets','submissions','licenses','license_assets','payments','payment_allocations','expenses','rights_matches']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', table_name || '_select', table_name);
  end loop;
end $$;

create policy buyers_manage on public.buyers for all to authenticated using (private.has_org_role(organization_id, array['owner','editor','dispatcher','finance']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','editor','dispatcher','finance']::public.app_role[]));
create policy opportunities_manage on public.opportunities for all to authenticated using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));
create policy shoots_manage on public.shoots for all to authenticated using (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]));
create policy shoot_sensitive_notes_select on public.shoot_sensitive_notes for select to authenticated using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));
create policy shoot_sensitive_notes_manage on public.shoot_sensitive_notes for all to authenticated using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));
create policy shoot_collaborators_manage on public.shoot_collaborators for all to authenticated using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));
create policy assets_manage on public.assets for all to authenticated using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));
create policy asset_versions_insert on public.asset_versions for insert to authenticated with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));
create policy packages_manage on public.packages for all to authenticated using (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]));
create policy package_assets_manage on public.package_assets for all to authenticated using (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]));
create policy submissions_manage on public.submissions for all to authenticated using (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]));
create policy licenses_manage on public.licenses for all to authenticated using (private.has_org_role(organization_id, array['owner','finance','rights_reviewer']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','finance','rights_reviewer']::public.app_role[]));
create policy license_assets_manage on public.license_assets for all to authenticated using (private.has_org_role(organization_id, array['owner','finance','rights_reviewer']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','finance','rights_reviewer']::public.app_role[]));
create policy payments_manage on public.payments for all to authenticated using (private.has_org_role(organization_id, array['owner','finance']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]));
create policy payment_allocations_manage on public.payment_allocations for all to authenticated using (private.has_org_role(organization_id, array['owner','finance']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','finance']::public.app_role[]));
create policy expenses_manage on public.expenses for all to authenticated using (private.has_org_role(organization_id, array['owner','finance','editor']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','finance','editor']::public.app_role[]));
create policy rights_matches_manage on public.rights_matches for all to authenticated using (private.has_org_role(organization_id, array['owner','rights_reviewer']::public.app_role[])) with check (private.has_org_role(organization_id, array['owner','rights_reviewer']::public.app_role[]));

create policy activity_events_select on public.activity_events for select to authenticated using (private.is_org_member(organization_id));
create policy activity_events_insert on public.activity_events for insert to authenticated with check (private.is_org_member(organization_id) and actor_id = (select auth.uid()));

-- Explicit Data API grants. RLS remains the authorization layer for rows.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.organizations, public.memberships, public.buyers, public.opportunities, public.shoots, public.shoot_collaborators, public.assets, public.packages, public.package_assets, public.submissions, public.licenses, public.license_assets, public.payments, public.payment_allocations, public.expenses, public.rights_matches to authenticated;
grant select, insert, update, delete on public.shoot_sensitive_notes to authenticated;
grant select, insert on public.asset_versions to authenticated;
grant select, insert on public.activity_events to authenticated;

-- No grants to anon. Storage bucket creation and storage.objects policies belong
-- in a reviewed follow-up migration because their exact upload flow is unresolved.
