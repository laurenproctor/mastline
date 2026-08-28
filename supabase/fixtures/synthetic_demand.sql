-- SYNTHETIC DEMAND. NOT PILOT DATA. NOT REAL.
--
-- Every row this file writes is invented. It exists so the matching rules and
-- the request analytics can be exercised against something with shape, because
-- the seed carries four assets and one request and you cannot rank four things
-- or take a median of one.
--
-- Read this before drawing any conclusion from it:
--
--   Nothing here measures whether suggestions are USEFUL. It measures whether
--   they are CORRECT -- that the rules fire on the signals they claim to fire
--   on, that rights are never overridden, that a workspace cannot see another
--   one. Precision, recall, and "does this help a photographer at 6am" are
--   questions only real pilot data can answer, and this file must never be
--   cited as though it had.
--
-- Everything is deliberately identifiable so it can be told apart from real
-- work and removed: shoots are titled "Synthetic —", requests are referenced
-- SYN-####, and every id is derived from md5('syn-...') so a second run
-- collides with itself rather than doubling the data.
--
-- Deterministic, not random. Values are derived from the row index, so two runs
-- produce identical data and a test can assert an exact median. Timestamps are
-- anchored to now() with fixed offsets, so the set stays realistic as it ages.
--
--   psql "$DB_URL" -f supabase/fixtures/synthetic_demand.sql
--
-- To remove it:  select public.remove_synthetic_demand();

\set ON_ERROR_STOP on

do $$
declare
  org uuid;
  owner_id uuid;
  editor_id uuid;
  buyer_ids uuid[];
begin
  select id into org from public.organizations where name = 'Marcus Hale Studio';
  if org is null then
    raise exception 'No seeded workspace. Run supabase db reset first.';
  end if;

  select user_id into owner_id from public.memberships
   where organization_id = org and role = 'owner' limit 1;
  select coalesce(
    (select user_id from public.memberships where organization_id = org and role = 'editor' limit 1),
    owner_id) into editor_id;

  select array_agg(id order by created_at) into buyer_ids
    from public.buyers where organization_id = org;
  if array_length(buyer_ids, 1) is null then
    raise exception 'No buyers in the seeded workspace.';
  end if;

  -- -------------------------------------------------------------------------
  -- Shoots. Eight, spread over eighteen months.
  -- -------------------------------------------------------------------------
  insert into public.shoots (id, organization_id, title, created_by, created_at)
  select
    md5('syn-shoot-' || i)::uuid,
    org,
    'Synthetic — ' || (array[
      'Soho departures','LAX arrivals','Tribeca premiere','Cannes red carpet',
      'Mayfair restaurant','JFK arrivals','Courthouse steps','Filming, Southbank'
    ])[i],
    owner_id,
    now() - ((18 - i * 2) || ' months')::interval
  from generate_series(1, 8) as i
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- Assets. Two hundred, with the signals deterministic matching runs on:
  -- subject, keyword, capture date, location, kind, and a rights note on a
  -- deliberate slice so the clearance rules have something to refuse.
  -- -------------------------------------------------------------------------
  insert into public.assets (
    id, organization_id, shoot_id, status, asset_kind, canonical_filename,
    captured_at, headline, caption, subjects, location_name, keywords,
    usage_restrictions, created_by, created_at
  )
  select
    md5('syn-asset-' || i)::uuid,
    org,
    md5('syn-shoot-' || (1 + (i % 8)))::uuid,
    -- One in nine is restricted, so relevance and clearance are separable:
    -- a restricted frame is still the right picture, and still not sendable.
    case when i % 9 = 0 then 'restricted' else 'active' end::public.asset_status,
    case when i % 11 = 0 then 'video' else 'image' end,
    'SYN_' || lpad(i::text, 4, '0') || case when i % 11 = 0 then '.mp4' else '.jpg' end,
    now() - ((540 - i * 2) || ' days')::interval,
    (array['Departure','Arrival','Premiere','Red carpet','Dinner','Filming'])[1 + (i % 6)]
      || ' — frame ' || i,
    null,
    to_jsonb(array[(array[
      'Julian Cross','Nadia Sol','Marcus Reed','Elena Vos','Theo Bright','Ivy Chan'
    ])[1 + (i % 6)]]),
    (array[
      'Soho, London','LAX, Los Angeles','Tribeca, New York','Cannes',
      'Mayfair, London','JFK, New York','Southbank, London','Downtown, Los Angeles'
    ])[1 + (i % 8)],
    to_jsonb(array[
      (array['departure','arrival','premiere','carpet','dinner','filming'])[1 + (i % 6)],
      (array['night','day','rain','crowd','solo','paparazzi'])[1 + (i % 6)],
      (array['london','losangeles','newyork','cannes'])[1 + (i % 4)]
    ]),
    -- One in nine carries a restriction. The matcher must still surface these
    -- as relevant and must never present them as clear to send.
    case when i % 9 = 0 then 'Editorial use only. No merchandising, no endorsement.' end,
    case when i % 2 = 0 then owner_id else editor_id end,
    now() - ((540 - i * 2) || ' days')::interval
  from generate_series(1, 200) as i
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- An original for every frame.
  --
  -- Not decoration. The import path hashes bytes before anything leaves the
  -- machine and writes exactly one immutable original per asset, so an asset
  -- with no version is a state this system cannot produce. A fixture that
  -- contains one is not a smaller version of reality, it is a different
  -- database -- and it broke the export test, which reasonably assumes every
  -- asset carries a digest.
  --
  -- The digest is md5-derived rather than a hash of real bytes: 64 hex
  -- characters that satisfy the column and are stable per asset. There are no
  -- bytes behind these rows and nothing should try to fetch them.
  -- -------------------------------------------------------------------------
  insert into public.asset_versions (
    id, organization_id, asset_id, version_kind, storage_bucket, object_key,
    sha256, bytes, mime_type, created_by, created_at
  )
  select
    md5('syn-version-' || i)::uuid,
    org,
    md5('syn-asset-' || i)::uuid,
    'original',
    'originals',
    org::text || '/' || md5('syn-shoot-' || (1 + (i % 8)))::uuid::text
      || '/SYN_' || lpad(i::text, 4, '0') || case when i % 11 = 0 then '.mp4' else '.jpg' end,
    md5('syn-sha-a-' || i) || md5('syn-sha-b-' || i),
    2000000 + (i * 137),
    case when i % 11 = 0 then 'video/mp4' else 'image/jpeg' end,
    owner_id,
    now() - ((540 - i * 2) || ' days')::interval
  from generate_series(1, 200) as i
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- Requests. Thirty, spread across the lifecycle, with the evidence each
  -- status needs actually present -- the gate refuses anything else, which is
  -- exactly why this fixture is a fair exercise of it.
  -- -------------------------------------------------------------------------
  insert into public.buyer_requests (
    id, organization_id, buyer_id, created_by, idempotency_key, reference,
    source, received_via, request_type, status, title, brief,
    subject_or_event, subject_names, topics, event_at, location_name,
    response_deadline, requested_formats,
    usage_media, territory, budget_disclosed, budget_min_minor, budget_max_minor,
    currency, created_at
  )
  select
    md5('syn-request-' || i)::uuid,
    org,
    buyer_ids[1 + (i % array_length(buyer_ids, 1))],
    owner_id,
    'syn-request-' || i,
    'SYN-' || lpad(i::text, 4, '0'),
    (array['manual','portal','email'])[1 + (i % 3)]::public.buyer_request_source,
    'buyer_relationship',
    (array['archive','coverage','commission','exclusive'])[1 + (i % 4)]::public.buyer_request_type,
    'new',
    (array['Departure','Arrival','Premiere','Red carpet','Dinner','Filming'])[1 + (i % 6)]
      || ' — ' || (array[
        'Julian Cross','Nadia Sol','Marcus Reed','Elena Vos','Theo Bright','Ivy Chan'
      ])[1 + (i % 6)],
    'Synthetic brief. Not a real request.',
    (array['Departure','Arrival','Premiere','Red carpet','Dinner','Filming'])[1 + (i % 6)],
    array[(array[
      'Julian Cross','Nadia Sol','Marcus Reed','Elena Vos','Theo Bright','Ivy Chan'
    ])[1 + (i % 6)]],
    array[(array['departure','arrival','premiere','carpet','dinner','filming'])[1 + (i % 6)]],
    now() - ((200 - i * 5) || ' days')::interval,
    (array[
      'Soho, London','LAX, Los Angeles','Tribeca, New York','Cannes',
      'Mayfair, London','JFK, New York','Southbank, London','Downtown, Los Angeles'
    ])[1 + (i % 8)],
    now() - ((197 - i * 5) || ' days')::interval,
    case when i % 11 = 0 then array['Video'] else array['JPEG'] end,
    -- Two in five say nothing about usage or territory. Absence has to survive
    -- into the analytics as "not stated", never as a value.
    case when i % 5 < 3 then 'Online editorial' end,
    case when i % 5 < 3 then 'UK' end,
    i % 3 = 0,
    case when i % 3 = 0 then 25000 + (i * 1000) end,
    case when i % 3 = 0 then 80000 + (i * 1000) end,
    'USD',
    now() - ((210 - i * 5) || ' days')::interval
  from generate_series(1, 30) as i
  on conflict (id) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- The work that answered them, and the money some of it earned.
--
-- Built in evidence order, because it has to be: the gate refuses
-- coverage_planned without a linked shoot, preparing_response without a
-- package, submitted without a submission somebody sent, and won without a
-- licence. Arranging the evidence first and moving the statuses last is not a
-- workaround -- it is the only order the schema permits, which is the point.
--
-- The funnel, by request index:
--
--   1-5    new                 nothing yet
--   6-8    qualified           read and judged worth answering
--   9-12   matching            candidate frames put forward
--   13-15  coverage_planned    a shoot exists
--   16-18  preparing_response  a package is being built
--   19-23  submitted           a submission was actually sent
--   24-25  negotiating         a human said so
--   26-29  won                 a licence connects back
--   30     lost                with a reason, as the trigger demands
-- ---------------------------------------------------------------------------
do $$
declare
  org uuid;
  owner_id uuid;
  i integer;
  req uuid;
  pkg uuid;
  sub uuid;
  lic uuid;
  pay uuid;
  base bigint;
  engine bigint;
begin
  select id into org from public.organizations where name = 'Marcus Hale Studio';
  select user_id into owner_id from public.memberships
   where organization_id = org and role = 'owner' limit 1;

  for i in 1..30 loop
    req := md5('syn-request-' || i)::uuid;

    -- Candidate and selected frames, from index 9 on. Deterministically drawn
    -- so the same request always carries the same frames.
    if i >= 9 then
      insert into public.request_assets
        (id, organization_id, request_id, asset_id, state, match_origin,
         matched_by, matched_at, decided_by, decided_at)
      select
        md5('syn-ra-' || i || '-' || k)::uuid,
        org, req, md5('syn-asset-' || ((i * 7 + k * 13) % 200 + 1))::uuid,
        case when k <= 2 then 'selected' else 'candidate' end::public.request_asset_state,
        'human', owner_id, now() - ((100 - i) || ' days')::interval,
        case when k <= 2 then owner_id end,
        case when k <= 2 then now() - ((99 - i) || ' days')::interval end
      from generate_series(1, 4) as k
      on conflict (request_id, asset_id) do nothing;
    end if;

    if i >= 13 then
      insert into public.request_shoots (id, organization_id, request_id, shoot_id, linked_by, linked_at)
      values (md5('syn-rs-' || i)::uuid, org, req,
              md5('syn-shoot-' || (1 + (i % 8)))::uuid, owner_id,
              now() - ((95 - i) || ' days')::interval)
      on conflict (request_id, shoot_id) do nothing;
    end if;

    if i >= 16 then
      pkg := md5('syn-package-' || i)::uuid;
      insert into public.packages (id, organization_id, shoot_id, name, status, created_by, created_at)
      values (pkg, org, md5('syn-shoot-' || (1 + (i % 8)))::uuid,
              'Synthetic package ' || i, 'draft'::public.package_status, owner_id,
              now() - ((90 - i) || ' days')::interval)
      on conflict (id) do nothing;

      insert into public.request_packages (id, organization_id, request_id, package_id, linked_by, linked_at)
      values (md5('syn-rp-' || i)::uuid, org, req, pkg, owner_id, now() - ((90 - i) || ' days')::interval)
      on conflict (request_id, package_id) do nothing;
    end if;

    -- A submission that was actually sent. sent_at is the fact the status
    -- rests on; a delivery link that merely exists, or one a buyer opened,
    -- would not do and must not.
    if i >= 19 then
      sub := md5('syn-submission-' || i)::uuid;
      insert into public.submissions
        (id, organization_id, package_id, buyer_id, status, created_by, sent_at, created_at)
      select sub, org, md5('syn-package-' || i)::uuid, br.buyer_id,
             'sent'::public.submission_status, owner_id,
             now() - ((85 - i) || ' days')::interval,
             now() - ((86 - i) || ' days')::interval
      from public.buyer_requests br where br.id = req
      on conflict (id) do nothing;

      insert into public.request_submissions (id, organization_id, request_id, submission_id, linked_by, linked_at)
      values (md5('syn-rsub-' || i)::uuid, org, req, sub, owner_id, now() - ((85 - i) || ' days')::interval)
      on conflict (request_id, submission_id) do nothing;
    end if;

    -- Licences, and the payments against some of them.
    --
    -- Bounded at 29, not left open. Request 30 is the lost one, and a lost
    -- request carrying an active licence is a contradiction that would show up
    -- as a win in every figure derived from it.
    if i between 26 and 29 then
      lic := md5('syn-licence-' || i)::uuid;
      base := 120000 + (i * 5000);
      -- Half the wins go through the Sales Engine, half are the photographer's
      -- own. An external licence may not carry a Mastline fee, and the schema
      -- refuses one that does.
      engine := case when i % 2 = 0 then round(base * 0.30) else 0 end;

      insert into public.licenses
        (id, organization_id, submission_id, buyer_id, status, licensee_name, origin,
         sale_base_minor, sales_engine_share_minor, photographer_share_minor,
         currency, created_by, created_at)
      select lic, org, md5('syn-submission-' || i)::uuid, br.buyer_id, 'active'::public.license_status,
             'Synthetic licensee ' || i,
             case when i % 2 = 0 then 'mastline_sales_engine' else 'external' end::public.license_origin,
             base, engine, base - engine, 'USD', owner_id,
             now() - ((70 - i) || ' days')::interval
      from public.buyer_requests br where br.id = req
      on conflict (id) do nothing;

      -- Three of the four wins are paid; one is still owed, so "median time to
      -- payment" has something genuinely missing to refuse to count.
      if i <= 28 then
        pay := md5('syn-payment-' || i)::uuid;
        insert into public.payments
          (id, organization_id, buyer_id, status, gross_minor, net_minor, currency,
           created_by, received_at, created_at)
        select pay, org, br.buyer_id, 'received'::public.payment_status, base, base, 'USD',
               owner_id, now() - ((40 - i) || ' days')::interval,
               now() - ((60 - i) || ' days')::interval
        from public.buyer_requests br where br.id = req
        on conflict (id) do nothing;

        insert into public.payment_allocations
          (id, organization_id, payment_id, license_id, submission_id, allocated_minor, currency, created_by)
        values (md5('syn-alloc-' || i)::uuid, org, pay, lic,
                md5('syn-submission-' || i)::uuid, base, 'USD', owner_id)
        on conflict (id) do nothing;
      end if;
    end if;
  end loop;

  -- Statuses last, now that each one has the record that makes it true.
  for i in 1..30 loop
    req := md5('syn-request-' || i)::uuid;
    update public.buyer_requests set
      -- Supplied, not left to the trigger. protect_buyer_request coalesces
      -- old, then new, then now(); handing it a value is what gives these a
      -- past. Without it every request qualified the instant this file ran and
      -- "median time to qualification" measured the fixture's age.
      qualified_at = case when i >= 6 then now() - ((205 - i * 5) || ' days')::interval end,
      closed_at = case when i >= 27 then now() - ((30 - i) || ' days')::interval end,
      -- Two requests ran out with nothing done about them, so the metric that
      -- counts those has something to count.
      expires_at = case when i <= 2 then now() - ((10 - i) || ' days')::interval end,
      status = case
        when i between 6 and 8 then 'qualified'
        when i between 9 and 12 then 'matching'
        when i between 13 and 15 then 'coverage_planned'
        when i between 16 and 18 then 'preparing_response'
        when i between 19 and 23 then 'submitted'
        when i between 24 and 25 then 'negotiating'
        when i between 26 and 29 then 'won'
        when i = 30 then 'lost'
        -- Three closed early, before anything was sent. A funnel that only
        -- ever loses at the last step is not a funnel anybody would recognise,
        -- and win rate computed against one is flattering nonsense.
        when i = 3 then 'declined'
        when i = 4 then 'lost'
        when i = 5 then 'lost'
        else 'new'
      end::public.buyer_request_status,
      closed_reason = case
        when i = 30 then 'Desk went with a wire picture.'
        when i = 3 then 'Nobody free to cover it.'
        when i = 4 then 'Another agency got there first.'
        when i = 5 then 'Budget pulled before we answered.'
      end
    where id = req and status = 'new';
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Removing it again.
--
-- Everything is identifiable, so this is exact rather than a guess: the ids are
-- all derived from md5('syn-...'), and nothing real shares them.
-- ---------------------------------------------------------------------------
create or replace function public.remove_synthetic_demand()
returns void language plpgsql security definer set search_path = '' as $$
declare
  i integer;
begin
  -- The purge flag is what the protective triggers honour; a synthetic
  -- request recorded as won or lost cannot be deleted without it.
  perform set_config('mastline.allow_purge', 'on', true);

  for i in 1..30 loop
    delete from public.payment_allocations where id = md5('syn-alloc-' || i)::uuid;
    delete from public.payments where id = md5('syn-payment-' || i)::uuid;
    delete from public.licenses where id = md5('syn-licence-' || i)::uuid;
    delete from public.request_submissions where id = md5('syn-rsub-' || i)::uuid;
    delete from public.submissions where id = md5('syn-submission-' || i)::uuid;
    delete from public.request_packages where id = md5('syn-rp-' || i)::uuid;
    delete from public.packages where id = md5('syn-package-' || i)::uuid;
    delete from public.request_shoots where id = md5('syn-rs-' || i)::uuid;
    delete from public.request_assets where request_id = md5('syn-request-' || i)::uuid;
    delete from public.buyer_requests where id = md5('syn-request-' || i)::uuid;
  end loop;

  for i in 1..200 loop
    delete from public.asset_versions where id = md5('syn-version-' || i)::uuid;
    delete from public.assets where id = md5('syn-asset-' || i)::uuid;
  end loop;
  for i in 1..8 loop
    delete from public.shoots where id = md5('syn-shoot-' || i)::uuid;
  end loop;

  perform set_config('mastline.allow_purge', 'off', true);
end;
$$;

revoke all on function public.remove_synthetic_demand() from public;
