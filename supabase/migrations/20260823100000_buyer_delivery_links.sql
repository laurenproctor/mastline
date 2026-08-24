-- Sending a package to a desk, and knowing what happened to it.
--
-- `docs/DECISIONS.md` records the gap this closes: "Mastline records a
-- dispatch; it does not yet transmit to a buyer's systems." A picture editor
-- does not adopt software, they open a link, so this is a link -- signed, dated,
-- revocable, and watched.
--
-- Two tables. A delivery is the offer: who it went to, when it stops working,
-- and whether it has been withdrawn. An access event is what the recipient did
-- with it. The second is append-only, because it is evidence: it is how a
-- photographer answers "did they even look at it" and, later, "when did they
-- first hold this frame".
--
-- Nothing here is sent automatically. The operator creates a link and passes it
-- on themselves, which keeps `CLAUDE.md`'s rule that a buyer communication is
-- never dispatched without a person deciding to.

create table public.submission_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  -- Opaque, high-entropy, and unique: this is the only credential the recipient
  -- has, so it must not be guessable and must not collide.
  token text not null unique check (char_length(token) between 32 and 128),
  -- Who it was meant for. Free text because a desk is often an alias rather
  -- than a person, and the snapshot on the submission is the fuller record.
  recipient_label text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index submission_deliveries_submission_idx
  on public.submission_deliveries(submission_id, created_at desc);
create index submission_deliveries_org_idx
  on public.submission_deliveries(organization_id, created_at desc);
create index submission_deliveries_created_by_idx on public.submission_deliveries(created_by);
create index submission_deliveries_revoked_by_idx
  on public.submission_deliveries(revoked_by) where revoked_by is not null;

comment on table public.submission_deliveries is
  'A signed, expiring link handed to a buyer. Created by a person and passed on by them; nothing here sends anything.';

-- ---------------------------------------------------------------------------
-- What the recipient did
--
-- Append-only. A record that can be tidied afterwards is not evidence, and the
-- security page tells people every download is logged.
-- ---------------------------------------------------------------------------

create table public.delivery_access_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_id uuid not null references public.submission_deliveries(id) on delete cascade,
  kind text not null check (kind in ('opened', 'downloaded', 'refused')),
  -- Null for an open, set for a download.
  asset_id uuid references public.assets(id) on delete set null,
  ip_address inet,
  user_agent text,
  detail text,
  occurred_at timestamptz not null default now()
);

create index delivery_access_events_delivery_idx
  on public.delivery_access_events(delivery_id, occurred_at desc);
create index delivery_access_events_org_idx
  on public.delivery_access_events(organization_id, occurred_at desc);
-- Removing a user or tombstoning an asset would otherwise scan these whole.
create index delivery_access_events_asset_idx
  on public.delivery_access_events(asset_id) where asset_id is not null;

comment on table public.delivery_access_events is
  'Append-only record of what a recipient did with a delivery link: opened, downloaded, or was refused. Evidence, not analytics.';

create or replace function private.forbid_access_event_rewrite()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception 'Delivery access events are evidence and cannot be % once written.', lower(tg_op)
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger delivery_access_events_append_only
before update or delete on public.delivery_access_events
for each row execute function private.forbid_access_event_rewrite();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- The workspace reads its own deliveries and their events. The recipient reads
-- nothing directly: they hold a token, not an account, and everything they see
-- arrives through the security-definer functions below.
-- ---------------------------------------------------------------------------

alter table public.submission_deliveries enable row level security;
alter table public.submission_deliveries force row level security;
alter table public.delivery_access_events enable row level security;
alter table public.delivery_access_events force row level security;

create policy submission_deliveries_select on public.submission_deliveries
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy submission_deliveries_insert on public.submission_deliveries
  for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner','dispatcher','editor']::public.app_role[]));

create policy submission_deliveries_update on public.submission_deliveries
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner','dispatcher']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','dispatcher']::public.app_role[]));

create policy delivery_access_events_select on public.delivery_access_events
  for select to authenticated
  using (private.is_org_member(organization_id));

grant select, insert, update on public.submission_deliveries to authenticated;
grant select on public.delivery_access_events to authenticated;

revoke all on all tables in schema public from anon;
