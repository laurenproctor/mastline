-- Which license won the request.
--
-- Phase 1 put `won` in buyer_request_status and made it unreachable, "so that
-- Phase 2 adds a foreign key rather than a migration that rewrites an enum
-- every row, policy and index depends on" (docs/DECISIONS.md). This is that
-- foreign key. Winning a request means a person connecting it to the license
-- that closed it, and this migration is the shape of that connection.
--
-- 20260828140000_request_relationships.sql wrote "there is no request_licenses
-- table and there must not be one: the license is the canonical commercial
-- record and a second edge to it would be a second answer to 'what did this
-- earn'". That reasoning stands and this table does not contradict it, because
-- this table carries NO money. What this license earned lives on the license
-- and nowhere else; the row here answers only "which license closed this
-- request", which the derived path could not:
--
--   * request_submissions -> licenses.submission_id proves SOME qualifying
--     license exists, but cannot name the one that won. A commercial memory
--     that says "won, somehow" is not a memory.
--   * licenses.submission_id is nullable and ON DELETE SET NULL. A
--     direct-sale license never reaches the request at all through that path,
--     and a submission deleted later silently un-evidences a win that was
--     real when it was recorded.
--
-- The connection is a human act. There is no matcher, no suggestion engine,
-- and no automatic path from a license appearing to a request closing; a
-- person picks the license, confirms, and the transition to `won` follows the
-- same evidence gate as every other gated status.
--
-- ---------------------------------------------------------------------------
-- On-delete semantics
--
-- request_id  -> cascade.  The link is part of the request's record; the
--                          audited purge that removes a request takes its
--                          connections with it, exactly as the four Phase 2
--                          link tables do.
-- license_id  -> restrict. The license is the money. A license a win points
--                          at cannot vanish while the connection stands --
--                          deleting it would leave a won request pointing at
--                          nothing in the one product whose premise is that a
--                          sale connects back to the work. Same choice as
--                          license_assets.asset_id, and the same restrict-
--                          over-cascade the PR #27 review settled for
--                          provenance rows. Unlink first, deliberately.
--
-- A trigger below adds the half a foreign key cannot say: the winning
-- connection of a CLOSED request is part of what happened and cannot be
-- unlinked or edited -- only the audited purge path (mastline.allow_purge)
-- may unwind it. While the request is still open, an operator who connected
-- the wrong license may remove the link, because nothing has been recorded
-- as won yet. A cascaded delete of the whole request is not blocked: by the
-- time the cascade reaches the link, the request row is gone, which is the
-- purge path doing what a purge does.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   begin;
--     drop trigger if exists request_licenses_protect on public.request_licenses;
--     drop function if exists private.protect_request_license();
--     drop table if exists public.request_licenses;
--     -- request_has_license and request_evidence revert to the
--     -- 20260828140000 bodies (derived through request_submissions).
--     alter table public.licenses drop constraint if exists licenses_id_organization_key;
--   commit;
--
--   What is lost is the record of which license won which request. Every
--   license, payment and request survives untouched; nothing here owns money.

-- ---------------------------------------------------------------------------
-- Composite-key target
--
-- (id, organization_id) on licenses constrains nothing new -- id is already
-- the primary key -- and exists purely to be referenced, following the four
-- targets 20260828140000 added the same way.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'licenses_id_organization_key'
  ) then
    alter table public.licenses
      add constraint licenses_id_organization_key unique (id, organization_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Request -> license
-- ---------------------------------------------------------------------------
create table if not exists public.request_licenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  license_id uuid not null,
  linked_by uuid not null references auth.users(id),
  linked_at timestamptz not null default now(),

  -- Idempotency. One request, one license, one row, however many times the
  -- button is pressed or the action retried.
  unique (request_id, license_id),

  foreign key (request_id, organization_id)
    references public.buyer_requests (id, organization_id) on delete cascade,
  foreign key (license_id, organization_id)
    references public.licenses (id, organization_id) on delete restrict
);

comment on table public.request_licenses is
  'Which license closed which request. Carries no money: what the license earned lives on the license, and this row only names it. Written by a person recording a win; never by a matcher.';
comment on column public.request_licenses.linked_by is
  'The person who connected the license. A win is a human decision and the record says whose.';

create index if not exists request_licenses_request_idx on public.request_licenses (organization_id, request_id);
create index if not exists request_licenses_license_idx on public.request_licenses (organization_id, license_id);

-- ---------------------------------------------------------------------------
-- The connection of a closed request is part of its record
--
-- A closed request cannot move (buyer_requests_protect), and the evidence gate
-- is checked only on the transition INTO a status -- so without this, deleting
-- the link after the win would leave a won request pointing at no license
-- while the status stood. Updates are refused outright: a connection is
-- removed and remade while the request is open, never edited, so linked_by
-- and linked_at stay what they were when the decision happened.
--
-- The closed-request lookup deliberately tolerates the request being gone:
-- during a cascaded delete of the request itself the parent row has already
-- been removed when this fires, the EXISTS finds nothing, and the cascade
-- proceeds. That is the audited purge path, not a loophole.
-- ---------------------------------------------------------------------------
create or replace function private.protect_request_license()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'A license connection is removed and remade, never edited.'
      using errcode = 'restrict_violation';
  end if;

  if exists (
    select 1 from public.buyer_requests r
    where r.id = old.request_id and private.request_is_closed(r.status)
  ) then
    raise exception 'This connection is part of a closed request''s record and cannot be removed.'
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

revoke all on function private.protect_request_license() from public;

drop trigger if exists request_licenses_protect on public.request_licenses;
create trigger request_licenses_protect
before update or delete on public.request_licenses
for each row execute function private.protect_request_license();

-- ---------------------------------------------------------------------------
-- Won means THIS connection, not a derivation
--
-- Replaces the 20260828140000 body, which walked request_submissions ->
-- licenses.submission_id. The qualifying rule is unchanged and worth
-- restating: a cancelled license is not a win; a proposed license with no
-- figure is an offer, not a win; an active license qualifies even at zero,
-- because a rights-for-credit deal is a real outcome somebody negotiated.
--
-- The derived path no longer unlocks `won` on its own, deliberately. A license
-- hanging off a linked submission is strong evidence, but "somebody connect
-- the winning license" is one fact entered once by the person who knows which
-- sale it was -- the same act that performs the transition -- rather than a
-- status that becomes claimable because an edge two tables away happens to
-- exist.
-- ---------------------------------------------------------------------------
create or replace function private.request_has_license(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.request_licenses rl
    join public.licenses l on l.id = rl.license_id
    where rl.request_id = target
      and l.status <> 'cancelled'
      and (l.sale_base_minor > 0 or l.status = 'active')
  )
$$;

-- Same gate, new words for the won refusal: the old message said to record the
-- license against the submission, which is no longer how a win is evidenced.
create or replace function private.request_evidence(new_status public.buyer_request_status, target uuid)
returns text language plpgsql stable set search_path = '' as $$
begin
  if new_status = 'matching' and not private.request_has_match_activity(target) then
    return 'Matching starts when a frame or a shoot is put forward. Add a candidate asset first.';
  elsif new_status = 'coverage_planned' and not private.request_has_shoot(target) then
    return 'Coverage is planned once a shoot exists to answer the request. Create the linked shoot first.';
  elsif new_status = 'preparing_response' and not private.request_has_package(target) then
    return 'Preparing a response means a package is being built. Link or create a package first.';
  elsif new_status = 'submitted' and not private.request_was_shared(target) then
    return 'Submitted means the work was actually shared with the buyer. Approve the package and mark the delivery shared first; creating a link, or a buyer opening one, is not the same thing.';
  elsif new_status = 'won' and not private.request_has_license(target) then
    return 'Won means the license that closed this request is connected to it. Connect the license first; an opened delivery link is not a sale.';
  end if;
  return null;
end;
$$;

-- Stated exhaustively because platform defaults flip, and because CREATE OR
-- REPLACE keeping old grants is a fact worth not depending on. Both roles for
-- the same reason 20260828140000 gave: the trigger that calls these is not
-- security definer, so the EXECUTE check lands on whoever writes the row, and
-- that is service_role on every trusted server path.
revoke all on function private.request_has_license(uuid) from public;
grant execute on function private.request_has_license(uuid) to authenticated;
grant execute on function private.request_has_license(uuid) to service_role;

revoke all on function private.request_evidence(public.buyer_request_status, uuid) from public;
grant execute on function private.request_evidence(public.buyer_request_status, uuid) to authenticated;
grant execute on function private.request_evidence(public.buyer_request_status, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Identical in shape to the four Phase 2 link tables: a reader who can see the
-- request can see what won it, and write is the same three roles that may
-- write the request.
--
-- Grants differ from the neighbours in one deliberate way: no UPDATE for
-- anybody. A connection is inserted, read, and (while the request is open)
-- deleted; there is nothing on the row to edit, the protect trigger refuses
-- it anyway, and a grant nothing needs is a grant something will eventually
-- misuse.
-- ---------------------------------------------------------------------------
alter table public.request_licenses enable row level security;
alter table public.request_licenses force row level security;

drop policy if exists request_licenses_select on public.request_licenses;
create policy request_licenses_select on public.request_licenses for select to authenticated
using (private.is_org_member(organization_id));

drop policy if exists request_licenses_write on public.request_licenses;
create policy request_licenses_write on public.request_licenses for all to authenticated
using (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]));

-- Explicit for both roles, and explicit about what is withheld. The Supabase
-- image grants no DML on a new public table to anybody -- see
-- 20260825170000_service_role_data_api_grants.sql -- and grants are additive,
-- so the revokes come first.
revoke all on public.request_licenses from public;
revoke all on public.request_licenses from authenticated;
revoke all on public.request_licenses from anon;
grant select, insert, delete on public.request_licenses to authenticated;
grant select, insert, delete on public.request_licenses to service_role;
