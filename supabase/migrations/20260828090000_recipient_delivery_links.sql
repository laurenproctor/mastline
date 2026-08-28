-- A link is made for somebody, and sharing it is a thing a person does.
--
-- Two separate untruths lived in this table. The first: a delivery had a
-- `recipient_label` and nothing else, so a photographer who sent the same
-- package to four desks could not tell which desk opened it -- every open
-- landed on whichever link happened to be first. The second: there was no
-- record of the photographer ever passing a link on. Creating a link and
-- sharing it were the same moment as far as the database was concerned, which
-- meant the product could not distinguish "I made a link" from "the New York
-- picture desk has it".
--
-- So: a link now carries who it was made for (in protected columns, never in
-- the URL), an optional internal contact reference, an immutable snapshot of
-- the attribution parameters the photographer chose, and its own share
-- timestamp. Each link accumulates its own opens, sessions, views, acceptances,
-- and downloads, and can be withdrawn on its own.
--
-- The parameters are deliberately weak. They are for the photographer's own
-- record-keeping -- campaign, channel, desk -- and nothing reads them to decide
-- whether a request is allowed. The token is the only credential, and that is
-- enforced here by refusing to store a key that could be mistaken for one.

-- ---------------------------------------------------------------------------
-- Same-organization parents
--
-- Every one of these tables already carried an organization_id AND a parent id,
-- and nothing made the two agree. A row could name organization A and a
-- submission belonging to organization B, and Postgres would take it: the
-- foreign keys were on the parent id alone. Row level security then read the
-- organization_id it was handed, so the forged row was visible to A and
-- attached to B's submission.
--
-- Server-action validation was the only thing standing in the way, which is
-- exactly the kind of check that is correct until somebody adds a second
-- caller. Composite foreign keys move it into the database, where it holds for
-- every writer including the service role.
--
-- The unique constraints below are redundant with the primary keys and exist
-- only because a composite foreign key needs a unique constraint to point at.
-- ---------------------------------------------------------------------------

alter table public.submissions
  add constraint submissions_org_id_key unique (organization_id, id);

alter table public.packages
  add constraint packages_org_id_key unique (organization_id, id);

alter table public.submission_deliveries
  add constraint submission_deliveries_org_id_key unique (organization_id, id);

alter table public.assets
  add constraint assets_org_id_key unique (organization_id, id);

-- A delivery's submission must be in the delivery's own organization.
alter table public.submission_deliveries
  add constraint submission_deliveries_submission_same_org
  foreign key (organization_id, submission_id)
  references public.submissions(organization_id, id)
  on delete cascade;

-- An access event's delivery must be in the event's own organization.
alter table public.delivery_access_events
  add constraint delivery_access_events_delivery_same_org
  foreign key (organization_id, delivery_id)
  references public.submission_deliveries(organization_id, id)
  on delete cascade;

-- ...and so must an acceptance's delivery and submission.
alter table public.delivery_acceptances
  add constraint delivery_acceptances_delivery_same_org
  foreign key (organization_id, delivery_id)
  references public.submission_deliveries(organization_id, id)
  on delete cascade;

alter table public.delivery_acceptances
  add constraint delivery_acceptances_submission_same_org
  foreign key (organization_id, submission_id)
  references public.submissions(organization_id, id)
  on delete cascade;

-- A submission's package, too. This one was reachable from the dispatch path.
alter table public.submissions
  add constraint submissions_package_same_org
  foreign key (organization_id, package_id)
  references public.packages(organization_id, id);

-- ---------------------------------------------------------------------------
-- Who the link was made for
--
-- These columns hold personal information -- a desk name, an internal contact
-- id -- and they are the reason the URL holds none. The token identifies the
-- link; the database says who it was for. A recipient's name never travels in a
-- query string where it would land in browser history, a referrer header, and
-- every proxy log between here and the desk.
-- ---------------------------------------------------------------------------

alter table public.submission_deliveries
  add column contact_reference text
    check (contact_reference is null or char_length(contact_reference) between 1 and 200),
  -- The attribution the photographer chose, normalised and frozen once shared.
  add column custom_parameters jsonb not null default '{}'::jsonb,
  add column shared_at timestamptz,
  add column shared_by uuid references auth.users(id) on delete set null;

-- Sharing is a single fact: both columns are set, or neither is. Without this a
-- link could claim a share time with nobody attached to it, which is precisely
-- the kind of half-truth this whole migration exists to remove.
alter table public.submission_deliveries
  add constraint submission_deliveries_share_is_paired
  check ((shared_at is null) = (shared_by is null));

alter table public.submission_deliveries
  add constraint submission_deliveries_share_after_creation
  check (shared_at is null or shared_at >= created_at);

create index submission_deliveries_shared_idx
  on public.submission_deliveries(submission_id, shared_at desc)
  where shared_at is not null;

create index submission_deliveries_shared_by_idx
  on public.submission_deliveries(shared_by) where shared_by is not null;

comment on column public.submission_deliveries.contact_reference is
  'An internal contact or buyer-contact id for this link. Protected: never rendered into the delivery URL.';
comment on column public.submission_deliveries.custom_parameters is
  'Normalised attribution chosen by the photographer (campaign, channel, desk). Never an authorization input. Frozen once the link is shared.';
comment on column public.submission_deliveries.shared_at is
  'When the photographer recorded that they passed this link on. Null means created but never shared.';

-- ---------------------------------------------------------------------------
-- What a custom parameter may be
--
-- Validated in the database as well as in the server action, because "the
-- application checks it" stops being true the first time something else writes
-- a row. The rules are deliberately narrow:
--
--   * at most eight parameters, so a URL stays a URL
--   * keys are lowercase, start with a letter, and hold only letters, digits,
--     underscore and hyphen
--   * values are short and are text, never nested objects
--   * nothing that could be read as a credential, an expiry, or an identity
--   * nothing that could poison a JavaScript prototype on the way through
--
-- The reserved list is the load-bearing part. A parameter named `token` would
-- sit in the same query string as nothing else -- the real token is a path
-- segment -- but it would read, to a person and to a future maintainer, as
-- though it meant something. The answer to "could a parameter override
-- authorization" should be "there is no parameter by that name", not "the code
-- happens to ignore it".
-- ---------------------------------------------------------------------------

create or replace function private.delivery_parameter_key_is_reserved(candidate text)
returns boolean language sql immutable set search_path = '' as $$
  select candidate in (
    -- Anything that could be mistaken for the credential or its lifetime.
    'token', 'delivery_token', 't', 'key', 'secret', 'sig', 'signature',
    'auth', 'authorization', 'access_token', 'bearer', 'password', 'pw',
    'expires', 'expires_at', 'exp', 'ttl', 'window', 'window_days',
    -- Identity belongs in the protected columns, not in a URL.
    'recipient', 'recipient_label', 'contact', 'contact_reference',
    'email', 'e_mail', 'mail', 'phone', 'tel', 'name', 'full_name',
    'user', 'user_id', 'person', 'organization', 'organization_id', 'org',
    'submission', 'submission_id', 'delivery', 'delivery_id',
    -- Prototype pollution, if any of this is ever spread into an object.
    '__proto__', 'constructor', 'prototype', '__defineGetter__',
    '__defineSetter__', '__lookupGetter__', '__lookupSetter__'
  );
$$;

create or replace function private.delivery_parameters_ok(candidate jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  entry record;
begin
  if candidate is null then return false; end if;
  if jsonb_typeof(candidate) <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(candidate)) > 8 then return false; end if;

  for entry in select key, value from jsonb_each(candidate) loop
    -- Scalars only. A nested object is a shape nothing here promises to render.
    if jsonb_typeof(entry.value) <> 'string' then return false; end if;
    if entry.key !~ '^[a-z][a-z0-9_-]{0,31}$' then return false; end if;
    if private.delivery_parameter_key_is_reserved(entry.key) then return false; end if;
    if char_length(entry.value #>> '{}') = 0 then return false; end if;
    if char_length(entry.value #>> '{}') > 120 then return false; end if;
  end loop;

  return true;
end;
$$;

/*
 * A check constraint is evaluated as whoever is doing the insert, so every
 * writer has to be able to call the validator.
 *
 * `authenticated` already holds USAGE on `private`, because the row level
 * security helpers live there. `service_role` did not: it bypasses RLS, so it
 * had never needed to call into the schema at all. A CHECK constraint is not
 * something it bypasses, and without this the webhook path and every
 * service-role fixture would fail on "permission denied for schema private" --
 * which reads like a policy problem and is nothing of the kind.
 */
grant usage on schema private to service_role;
grant execute on function private.delivery_parameter_key_is_reserved(text)
  to authenticated, service_role;
grant execute on function private.delivery_parameters_ok(jsonb)
  to authenticated, service_role;

alter table public.submission_deliveries
  add constraint submission_deliveries_parameters_valid
  check (private.delivery_parameters_ok(custom_parameters));

-- ---------------------------------------------------------------------------
-- A shared link stops being editable
--
-- Before it is shared the photographer may still fix a typo in a campaign name.
-- The moment they record that it left Mastline, the attribution is part of the
-- evidence: it is what the desk was told, and rewriting it afterwards would let
-- a link be re-labelled to match whatever outcome turned up. The share
-- timestamp itself is write-once for the same reason.
-- ---------------------------------------------------------------------------

create or replace function private.protect_shared_delivery()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('mastline.allow_purge', true), 'off') = 'on' then
    return new;
  end if;

  if old.shared_at is not null then
    if new.custom_parameters is distinct from old.custom_parameters then
      raise exception 'The attribution on a shared delivery link is part of the record and cannot be changed.'
        using errcode = 'restrict_violation';
    end if;
    if new.recipient_label is distinct from old.recipient_label
       or new.contact_reference is distinct from old.contact_reference then
      raise exception 'The recipient on a shared delivery link is part of the record and cannot be changed.'
        using errcode = 'restrict_violation';
    end if;
    -- Marking a link shared twice is the same act, so it must be idempotent
    -- rather than an error -- but it must never move the original timestamp.
    if new.shared_at is distinct from old.shared_at
       or new.shared_by is distinct from old.shared_by then
      raise exception 'A delivery link records when it was first shared, and that does not move.'
        using errcode = 'restrict_violation';
    end if;
  end if;

  -- The token and its parent never change, shared or not.
  if new.token is distinct from old.token
     or new.submission_id is distinct from old.submission_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'A delivery link cannot be repointed after it is created.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger submission_deliveries_protect_shared
before update on public.submission_deliveries
for each row execute function private.protect_shared_delivery();

-- ---------------------------------------------------------------------------
-- Recording the share
--
-- A security-definer function so the whole lifecycle move is one statement that
-- either happens or does not: the link is stamped, the submission becomes sent,
-- the package moves to sending, and the shoot becomes dispatched. Done as four
-- separate updates from the application this could half-succeed and leave a
-- shared link on a queued submission.
--
-- It is idempotent. Pressing the button twice is one share, and the second
-- press returns the first timestamp rather than raising.
--
-- Note what it does NOT do: it does not set the package to `delivered`. Nothing
-- has been delivered. The package is `sending` because a link is out and
-- nobody has opened it yet.
-- ---------------------------------------------------------------------------

create or replace function public.mark_delivery_shared(target_delivery uuid)
returns table (shared_at timestamptz, already_shared boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  link record;
  actor uuid := (select auth.uid());
  stamped timestamptz;
  was_shared boolean;
begin
  if actor is null then
    raise exception 'Only a signed-in operator can mark a link as shared.'
      using errcode = 'insufficient_privilege';
  end if;

  select d.id, d.organization_id, d.submission_id, d.shared_at,
         d.revoked_at, d.expires_at, s.package_id, s.status as submission_status,
         p.shoot_id, p.status as package_status
    into link
  from public.submission_deliveries d
  join public.submissions s
    on s.id = d.submission_id and s.organization_id = d.organization_id
  join public.packages p
    on p.id = s.package_id and p.organization_id = s.organization_id
  where d.id = target_delivery;

  if not FOUND then
    raise exception 'That delivery link could not be found.' using errcode = 'no_data_found';
  end if;

  -- The caller must be able to send in the link's own organization. This is
  -- the same rule the row level security policy applies, restated because a
  -- security-definer function bypasses it.
  if not private.has_org_role(
    link.organization_id, array['owner','dispatcher']::public.app_role[]
  ) then
    raise exception 'This role cannot share a delivery link.'
      using errcode = 'insufficient_privilege';
  end if;

  if link.package_status not in ('approved', 'sending', 'delivered') then
    raise exception 'Approve the package before sharing a link for it.'
      using errcode = 'check_violation';
  end if;

  if link.revoked_at is not null then
    raise exception 'That link has been withdrawn.' using errcode = 'check_violation';
  end if;

  was_shared := link.shared_at is not null;

  if was_shared then
    stamped := link.shared_at;
  else
    stamped := now();
    update public.submission_deliveries d
       set shared_at = stamped, shared_by = actor
     where d.id = link.id;
  end if;

  -- Forward only, and only from the states that precede it. A submission that
  -- has already been opened, accepted, or sold is not walked back because a
  -- second link was shared.
  update public.submissions s
     set status = 'sent',
         sent_at = coalesce(s.sent_at, stamped)
   where s.id = link.submission_id
     and s.status = 'queued';

  -- ...but sent_at is the evidence that something left Mastline, so it is
  -- filled in even when a later status has already been reached without it.
  update public.submissions s
     set sent_at = stamped
   where s.id = link.submission_id
     and s.sent_at is null;

  update public.packages p
     set status = 'sending'
   where p.id = link.package_id
     and p.status = 'approved';

  update public.shoots sh
     set status = 'dispatched'
   where sh.id = link.shoot_id
     and sh.organization_id = link.organization_id
     and sh.status <> 'dispatched';

  if not was_shared then
    insert into public.activity_events
      (organization_id, actor_id, entity_type, entity_id, action, event_data)
    values (
      link.organization_id, actor, 'submission', link.submission_id,
      'delivery.link_shared',
      jsonb_build_object(
        'summary', 'Delivery link marked as shared',
        'delivery_id', link.id
      )
    );
  end if;

  return query select stamped, was_shared;
end;
$$;

revoke all on function public.mark_delivery_shared(uuid) from public;
revoke all on function public.mark_delivery_shared(uuid) from anon;
grant execute on function public.mark_delivery_shared(uuid) to authenticated;

comment on function public.mark_delivery_shared(uuid) is
  'The photographer recording that they passed a specific link on. Idempotent; never moves the first share timestamp; does not send anything.';

-- Supabase stopped granting DML on new public tables, and a column added to an
-- existing one inherits whatever that table already had -- but the purge and
-- analytics work below adds tables, so the grant discipline is restated here
-- and in every migration that follows.
grant select, insert, update on public.submission_deliveries to authenticated;
revoke all on all tables in schema public from anon;
