-- A private door into one workspace, opened for one desk.
--
-- A picture desk that already works with a photographer should be able to put a
-- request into their system without an account, without an email thread, and
-- without the photographer transcribing it off a phone at 6am. That is what
-- this is: a link the photographer generates for a buyer they already have a
-- record of, which the recipient can use exactly once.
--
-- What this deliberately is NOT
--
-- Not a marketplace, not a buyer directory, not a broadcast request network,
-- not a buyer-account system. There is no sign-up, no password, no buyer-side
-- inbox, and no way to reach anything in the workspace except the one form. A
-- token is a capability to CREATE one record, not to read any.
--
-- ---------------------------------------------------------------------------
-- The token is never stored
--
-- submission_deliveries stores its token in plaintext. That was survivable for
-- a delivery link and is not the pattern to copy: a database read, a backup, or
-- a row in a log discloses every live link at once. Here only sha256(token) is
-- kept, in token_hash, and the raw value exists in exactly two places -- the
-- URL the operator copies, and the argument of the two functions below, which
-- hash it and throw it away.
--
-- The consequence worth stating: a lost link cannot be recovered, only
-- replaced. That is the correct trade and the interface says so.
--
-- ---------------------------------------------------------------------------
-- One token, one workspace, one buyer, one request
--
-- organization_id and buyer_id live on the link row and are read FROM it. No
-- submitted field influences either, so a recipient cannot post their way into
-- another workspace or attach their request to a different buyer. The composite
-- foreign key onto buyers (id, organization_id) makes the pairing unfalsifiable
-- rather than merely unlikely.
--
-- resulting_request_id is unique and paired with submitted_at, so a token
-- produces at most one request however many times it is submitted. A repeat
-- returns the original.
--
-- ---------------------------------------------------------------------------
-- A link identifies itself, never its holder
--
-- The photographer knows which link was used. They do not know who was holding
-- it, because links get forwarded -- that is why this schema records a
-- recipient_label the photographer wrote, and an asserted_submitter_name the
-- visitor typed, and never conflates the two with an identity. Same rule the
-- delivery side already follows: "the link prepared for Northstar Picture Desk
-- was used", never "Northstar submitted".
--
-- ROLLBACK
--
--   begin;
--     drop function if exists public.submit_request_link(text,text,text,text,text,timestamptz,text,timestamptz,text,text,text,text,text,text,boolean,bigint,bigint,timestamptz,text,text,inet,text);
--     drop function if exists public.open_request_link(text, inet);
--     drop function if exists private.request_link_rate_limited(inet);
--     drop table if exists public.request_link_attempts;
--     drop table if exists public.request_intake_links;
--   commit;
--
--   No buyer request depends on a link: resulting_request_id points at the
--   request, not the other way round, so dropping this loses the record of how
--   a request arrived and nothing of the request itself.

-- ---------------------------------------------------------------------------
-- The link
-- ---------------------------------------------------------------------------
create table if not exists public.request_intake_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Not nullable. A link that is not for a specific buyer is a public intake
  -- form, which is the thing this phase exists not to build.
  buyer_id uuid not null,

  created_by uuid not null references auth.users(id),

  -- What the photographer calls this recipient: "Northstar Picture Desk",
  -- "Reuters weekend desk". Shown to the visitor so a forwarded link is
  -- obviously addressed to somebody.
  recipient_label text not null
    check (char_length(trim(recipient_label)) between 2 and 120),

  -- Where they sent it, for the photographer's own memory. Never rendered on
  -- the public page and never placed in a URL.
  recipient_reference text
    check (recipient_reference is null or char_length(recipient_reference) <= 200),

  -- sha256 of the raw token. 32 bytes, unique, and the only form kept.
  token_hash bytea not null unique check (octet_length(token_hash) = 32),

  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),

  submitted_at timestamptz,
  resulting_request_id uuid unique,

  -- Access is counted, not attributed. Two timestamps and a tally answer "did
  -- this land?" without pretending to know who opened it.
  first_accessed_at timestamptz,
  last_accessed_at timestamptz,
  access_count integer not null default 0 check (access_count >= 0),

  -- What the visitor typed, held as an assertion with its evidence and time --
  -- exactly as delivery_acceptances.accepted_by is. It is a claim made by
  -- whoever held the link, not an identification of them, and nothing in the
  -- product may render it as one.
  asserted_submitter_name text
    check (asserted_submitter_name is null
           or char_length(trim(asserted_submitter_name)) between 2 and 120),
  asserted_at timestamptz,
  submitter_ip inet,
  submitter_user_agent text check (submitter_user_agent is null or char_length(submitter_user_agent) <= 500),

  created_at timestamptz not null default now(),

  check (expires_at > created_at),
  check ((revoked_at is null) = (revoked_by is null)),
  -- Submitted and its request arrive together or not at all.
  constraint request_intake_links_submission_is_whole check (
    (submitted_at is null) = (resulting_request_id is null)
  ),
  -- An asserted name carries the time it was asserted.
  constraint request_intake_links_assertion_is_timed check (
    (asserted_submitter_name is null) = (asserted_at is null)
  ),
  -- Nothing is asserted by a link nobody submitted.
  constraint request_intake_links_assertion_needs_submission check (
    asserted_submitter_name is null or submitted_at is not null
  ),

  -- Structural workspace safety, following buyers_id_organization_key.
  foreign key (buyer_id, organization_id)
    references public.buyers (id, organization_id) on delete cascade,
  foreign key (resulting_request_id, organization_id)
    references public.buyer_requests (id, organization_id) on delete set null (resulting_request_id)
);

comment on table public.request_intake_links is
  'A single-use, buyer-scoped door for submitting one request into a workspace without an account. Holds sha256 of the token and never the token.';
comment on column public.request_intake_links.token_hash is
  'sha256 of the raw token. The raw value is shown to the operator once and never stored; a lost link is replaced, not recovered.';
comment on column public.request_intake_links.asserted_submitter_name is
  'A name typed by whoever held the link. Evidence of an assertion, never an identification: links get forwarded.';
comment on column public.request_intake_links.recipient_label is
  'Who the photographer prepared this for. Shown to the visitor so a forwarded link is visibly addressed to somebody else.';

create index if not exists request_intake_links_workspace_idx
  on public.request_intake_links (organization_id, created_at desc);
create index if not exists request_intake_links_buyer_idx
  on public.request_intake_links (organization_id, buyer_id);
-- The open question for the management screen: what is still usable?
create index if not exists request_intake_links_live_idx
  on public.request_intake_links (organization_id, expires_at)
  where revoked_at is null and submitted_at is null;

-- ---------------------------------------------------------------------------
-- Attempts, for rate limiting
--
-- Vercel functions share no memory, so a counter has to live where the state
-- already is. One narrow row per attempt, pruned by the limiter itself.
--
-- The address is stored as inet, in plain, exactly as delivery_acceptances
-- already stores one. A sha256 of an IPv4 address is not anonymisation -- the
-- whole space is enumerable in seconds -- and storing a hash would claim a
-- protection this does not have. Better to hold the real value briefly, say so,
-- and delete it.
-- ---------------------------------------------------------------------------
create table if not exists public.request_link_attempts (
  id bigint generated always as identity primary key,
  -- Null when the token matched nothing: an unknown token has no link to blame.
  link_id uuid references public.request_intake_links(id) on delete cascade,
  caller_ip inet,
  outcome text not null check (outcome in ('opened','submitted','invalid','rate_limited')),
  attempted_at timestamptz not null default now()
);

comment on table public.request_link_attempts is
  'Bounded history of public intake attempts, for rate limiting only. Addresses are held in plain and pruned; nothing here is a record of a person.';

create index if not exists request_link_attempts_caller_idx
  on public.request_link_attempts (caller_ip, attempted_at desc);
create index if not exists request_link_attempts_prune_idx
  on public.request_link_attempts (attempted_at);

-- ---------------------------------------------------------------------------
-- Rate limiting
--
-- Bounded frequency per address, enforced where the state is rather than in a
-- function instance that forgets everything between invocations.
--
-- Being rate limited is reported honestly and separately from an invalid token.
-- That is not an oracle: it says nothing about whether any token is real, only
-- that this caller has been asked to slow down. Folding it into the generic
-- refusal would leave a legitimate desk staring at "this link is not valid"
-- when their link is fine.
-- ---------------------------------------------------------------------------
create or replace function private.request_link_rate_limited(caller inet)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  recent integer;
begin
  if caller is null then
    return false;
  end if;

  -- Opportunistic prune. Cheap, bounded, and keeps addresses from accumulating.
  delete from public.request_link_attempts
  where attempted_at < now() - interval '24 hours';

  select count(*) into recent
  from public.request_link_attempts
  where caller_ip = caller
    and attempted_at > now() - interval '15 minutes';

  return recent >= 20;
end;
$$;

-- ---------------------------------------------------------------------------
-- Opening a link
--
-- Returns only what the page may render. No workspace id, no buyer id, no
-- archive, no other request. `status` collapses expired, revoked, unknown and
-- malformed into one value on purpose: a caller learns nothing from the
-- difference, and there is nothing they could do differently.
-- ---------------------------------------------------------------------------
create or replace function public.open_request_link(link_token text, caller inet default null)
returns table (
  status text,
  workspace_name text,
  recipient_label text,
  expires_at timestamptz,
  already_submitted boolean,
  request_reference text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.request_intake_links;
  hashed bytea;
begin
  if private.request_link_rate_limited(caller) then
    insert into public.request_link_attempts (caller_ip, outcome) values (caller, 'rate_limited');
    return query select 'rate_limited'::text, null::text, null::text, null::timestamptz, false, null::text;
    return;
  end if;

  -- A token that is not even the right shape never reaches the table.
  if link_token is null or char_length(link_token) not between 32 and 128 then
    insert into public.request_link_attempts (caller_ip, outcome) values (caller, 'invalid');
    return query select 'invalid'::text, null::text, null::text, null::timestamptz, false, null::text;
    return;
  end if;

  hashed := sha256(convert_to(link_token, 'UTF8'));

  select * into link from public.request_intake_links l where l.token_hash = hashed;

  if not found or link.revoked_at is not null or link.expires_at <= now() then
    insert into public.request_link_attempts (link_id, caller_ip, outcome)
    values (link.id, caller, 'invalid');
    return query select 'invalid'::text, null::text, null::text, null::timestamptz, false, null::text;
    return;
  end if;

  update public.request_intake_links
  set access_count = access_count + 1,
      first_accessed_at = coalesce(first_accessed_at, now()),
      last_accessed_at = now()
  where id = link.id;

  insert into public.request_link_attempts (link_id, caller_ip, outcome)
  values (link.id, caller, 'opened');

  return query
  select
    'ok'::text,
    o.name,
    link.recipient_label,
    link.expires_at,
    link.submitted_at is not null,
    r.reference
  from public.organizations o
  left join public.buyer_requests r on r.id = link.resulting_request_id
  where o.id = link.organization_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Submitting
--
-- Creates at most one request per token, ever. A resubmission -- a double tap,
-- a retried fetch, a forwarded link opened twice -- returns the request that
-- already exists rather than making a second.
--
-- Two things are taken from the LINK and never from the payload: which
-- workspace this lands in, and which buyer it is attributed to. A submitter
-- cannot post their way into another workspace or reattribute their request,
-- because neither value is theirs to send.
--
-- created_by is the photographer who opened the link. The submitter has no
-- account -- that is the point -- and buyer_requests.created_by references
-- auth.users. Recording the workspace member who created the door is both true
-- and the only available answer.
-- ---------------------------------------------------------------------------
create or replace function public.submit_request_link(
  link_token text,
  payload jsonb,
  caller inet default null,
  caller_user_agent text default null
)
returns table (status text, request_reference text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.request_intake_links;
  hashed bytea;
  new_reference text;
  new_id uuid;
  attempts integer := 0;
  asserted text;
begin
  if private.request_link_rate_limited(caller) then
    insert into public.request_link_attempts (caller_ip, outcome) values (caller, 'rate_limited');
    return query select 'rate_limited'::text, null::text;
    return;
  end if;

  if link_token is null or char_length(link_token) not between 32 and 128 then
    insert into public.request_link_attempts (caller_ip, outcome) values (caller, 'invalid');
    return query select 'invalid'::text, null::text;
    return;
  end if;

  hashed := sha256(convert_to(link_token, 'UTF8'));

  -- Locked, so two submissions racing each other cannot both pass the
  -- already-submitted check below.
  select * into link from public.request_intake_links l
  where l.token_hash = hashed for update;

  if not found or link.revoked_at is not null or link.expires_at <= now() then
    insert into public.request_link_attempts (link_id, caller_ip, outcome)
    values (link.id, caller, 'invalid');
    return query select 'invalid'::text, null::text;
    return;
  end if;

  -- Already used. Hand back the original rather than making a second.
  if link.resulting_request_id is not null then
    insert into public.request_link_attempts (link_id, caller_ip, outcome)
    values (link.id, caller, 'submitted');
    return query
      select 'already_submitted'::text, r.reference
      from public.buyer_requests r where r.id = link.resulting_request_id;
    return;
  end if;

  -- A human reference, redrawn until the workspace has a free one.
  loop
    attempts := attempts + 1;
    new_reference := 'REQ-' || to_char(now(), 'MMDD') || '-' ||
      lpad(floor(random() * 10000)::int::text, 4, '0');
    exit when not exists (
      select 1 from public.buyer_requests r
      where r.organization_id = link.organization_id and r.reference = new_reference
    );
    if attempts > 25 then
      raise exception 'Could not allocate a request reference.' using errcode = 'internal_error';
    end if;
  end loop;

  asserted := nullif(trim(payload->>'asserted_submitter_name'), '');

  insert into public.buyer_requests (
    organization_id, buyer_id, created_by, idempotency_key, reference,
    source, received_via, request_type, status,
    title, brief, subject_or_event, event_at, location_name,
    response_deadline, deliverables, requested_formats,
    usage_media, territory, usage_duration, exclusivity,
    budget_disclosed, budget_min_minor, budget_max_minor, currency,
    embargo_until, usage_restrictions
  ) values (
    link.organization_id, link.buyer_id, link.created_by,
    -- Derived from the link, so Phase 1's unique (organization_id,
    -- idempotency_key) settles a race in the database rather than in a
    -- read-then-write that loses it by construction.
    'intake-' || link.id::text,
    new_reference,
    'portal',
    'buyer_relationship',
    coalesce(nullif(payload->>'request_type',''), 'other')::public.buyer_request_type,
    'new',
    payload->>'title',
    nullif(payload->>'brief',''),
    nullif(payload->>'subject_or_event',''),
    (nullif(payload->>'event_at',''))::timestamptz,
    nullif(payload->>'location_name',''),
    (nullif(payload->>'response_deadline',''))::timestamptz,
    nullif(payload->>'deliverables',''),
    coalesce(
      (select array_agg(value::text) from jsonb_array_elements_text(
        case when jsonb_typeof(payload->'requested_formats') = 'array'
             then payload->'requested_formats' else '[]'::jsonb end) as value),
      '{}'
    ),
    nullif(payload->>'usage_media',''),
    nullif(payload->>'territory',''),
    nullif(payload->>'usage_duration',''),
    nullif(payload->>'exclusivity',''),
    coalesce((payload->>'budget_disclosed')::boolean, false),
    (nullif(payload->>'budget_min_minor',''))::bigint,
    (nullif(payload->>'budget_max_minor',''))::bigint,
    coalesce(nullif(payload->>'currency',''), 'USD'),
    (nullif(payload->>'embargo_until',''))::timestamptz,
    nullif(payload->>'usage_restrictions','')
  )
  returning id into new_id;

  update public.request_intake_links
  set submitted_at = now(),
      resulting_request_id = new_id,
      asserted_submitter_name = asserted,
      asserted_at = case when asserted is null then null else now() end,
      submitter_ip = caller,
      submitter_user_agent = left(caller_user_agent, 500),
      access_count = access_count + 1,
      first_accessed_at = coalesce(first_accessed_at, now()),
      last_accessed_at = now()
  where id = link.id;

  -- Append-only, and phrased as what is actually known: which link was used.
  insert into public.activity_events (organization_id, actor_id, entity_type, entity_id, action, event_data)
  values (
    link.organization_id, link.created_by, 'request', new_id, 'request.submitted_through_link',
    jsonb_build_object(
      'link_id', link.id,
      'recipient_label', link.recipient_label,
      'asserted_submitter_name', asserted
    )
  );

  insert into public.request_link_attempts (link_id, caller_ip, outcome)
  values (link.id, caller, 'submitted');

  return query select 'created'::text, new_reference;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilege
--
-- The two public functions are the entire anonymous surface. anon holds no
-- table grant of any kind -- the blanket revoke at the end of every migration
-- in this schema stays true -- so the only thing an unauthenticated caller can
-- do is call these, and the only thing they can achieve is creating one request
-- behind a token they must already hold.
-- ---------------------------------------------------------------------------
revoke all on function private.request_link_rate_limited(inet) from public;
revoke all on function public.open_request_link(text, inet) from public;
revoke all on function public.submit_request_link(text, jsonb, inet, text) from public;

grant execute on function public.open_request_link(text, inet) to anon, authenticated;
grant execute on function public.submit_request_link(text, jsonb, inet, text) to anon, authenticated;

alter table public.request_intake_links enable row level security;
alter table public.request_intake_links force row level security;
alter table public.request_link_attempts enable row level security;
alter table public.request_link_attempts force row level security;

drop policy if exists request_intake_links_select on public.request_intake_links;
create policy request_intake_links_select on public.request_intake_links
  for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists request_intake_links_write on public.request_intake_links;
create policy request_intake_links_write on public.request_intake_links
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor','dispatcher']::public.app_role[]));

-- No policy on attempts. It is limiter state, reachable only by the security
-- definer functions above; force row level security with no policy means every
-- direct read returns nothing, for every role that is not the table's owner.

grant select, insert, update on public.request_intake_links to authenticated;
grant select, insert, update, delete on public.request_intake_links to service_role;
grant select, insert, update, delete on public.request_link_attempts to service_role;

revoke all on public.request_intake_links from anon;
revoke all on public.request_link_attempts from anon;
revoke all on all tables in schema public from anon;
