-- Local development seed.
--
-- Creates TWO organizations so cross-organization isolation can be proven
-- rather than assumed, and every role can be exercised against real policies.
--
-- Local development only. Passwords are deliberately well known.
--
--   Org A  Marcus Hale Studio   owner marcus@mastline.test
--                               editor jordan@mastline.test
--                               dispatcher dana@mastline.test
--                               finance felix@mastline.test
--                               rights_reviewer rhea@mastline.test
--                               viewer vera@mastline.test
--   Org B  Northline Photo      owner nadia@northline.test
--
-- All passwords: mastline-dev-password

-- ---------------------------------------------------------------------------
-- Identities
-- ---------------------------------------------------------------------------

-- GoTrue scans several of these token columns into non-nullable Go strings, so
-- they must be empty strings rather than NULL or sign-in fails with
-- "Database error querying schema".
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, email_change, phone_change, phone_change_token,
  reauthentication_token, created_at, updated_at
)
select
  u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  u.email, crypt('mastline-dev-password', gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', '', '', '', '', '', now(), now()
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'marcus@mastline.test'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'jordan@mastline.test'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'dana@mastline.test'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'felix@mastline.test'),
  ('55555555-5555-5555-5555-555555555555'::uuid, 'rhea@mastline.test'),
  ('66666666-6666-6666-6666-666666666666'::uuid, 'vera@mastline.test'),
  ('99999999-9999-9999-9999-999999999999'::uuid, 'nadia@northline.test')
) as u(id, email)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email like '%@mastline.test' or u.email like '%@northline.test'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Organizations and memberships
-- ---------------------------------------------------------------------------

-- Marcus Hale Studio is a paying Studio workspace, so local development
-- exercises the normal path rather than a trial about to lapse.
--
-- Northline Photo is deliberately left ON TRIAL, so the trial banner, the
-- storage cap, and the read-only expiry all have something real to act on
-- without anyone having to construct it by hand.
insert into public.organizations (
  id, name, slug, timezone, currency, created_by,
  plan, subscription_status, trial_started_at, trial_ends_at,
  storage_limit_bytes, seat_limit
) values
  (
    'aaaaaaaa-0000-0000-0000-000000000001', 'Marcus Hale Studio', 'marcus-hale-studio',
    'America/New_York', 'USD', '11111111-1111-1111-1111-111111111111',
    'studio', 'active', null, null,
    5 * 1024::bigint ^ 4, 10
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000002', 'Northline Photo', 'northline-photo',
    'America/Chicago', 'USD', '99999999-9999-9999-9999-999999999999',
    'pro', 'trialing', now() - interval '6 days', now() + interval '24 days',
    25 * 1024::bigint ^ 3, 1
  );

insert into public.memberships (organization_id, user_id, role, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner',           'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'editor',          'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'dispatcher',      'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'finance',         'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'rights_reviewer', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', 'viewer',          'active'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999999', 'owner',           'active');

-- ---------------------------------------------------------------------------
-- Org A: the Hotel Chelsea loop, end to end
-- ---------------------------------------------------------------------------

insert into public.buyers (id, organization_id, name, buyer_type, contact_name, delivery_profile, default_terms) values
  ('a0000000-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Backgrid', 'agency', 'New York picture desk', '{"method":"sftp","profile":"Backgrid Editorial"}', 'Standard agency distribution; non-exclusive; photographer retains copyright.'),
  ('a0000000-0000-0000-0000-0000000000b2', 'aaaaaaaa-0000-0000-0000-000000000001', 'The Mega Agency', 'agency', null, '{"method":"sftp"}', null),
  ('a0000000-0000-0000-0000-0000000000b3', 'aaaaaaaa-0000-0000-0000-000000000001', 'Getty Images', 'agency', null, '{"method":"api"}', null),
  ('a0000000-0000-0000-0000-0000000000b4', 'aaaaaaaa-0000-0000-0000-000000000001', 'The City Paper', 'publisher', 'Picture editor', '{"method":"signed_url"}', null);

insert into public.shoots (id, organization_id, title, story_angle, status, priority, starts_at, location_name, assignment_label, exclusivity, sensitive_content, created_by) values
  ('a0000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Hotel Chelsea departure', 'Departure after the Midnight Hotel cast announcement.', 'preparing', 'high', '2026-08-19T18:30:00Z', '222 W 23rd St, New York, NY', 'Direct', 'None', false, '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'NYFW Street Style', null, 'dispatched', 'standard', '2026-08-18T14:00:00Z', 'SoHo, New York, NY', 'Backgrid', null, false, '11111111-1111-1111-1111-111111111111');

-- Confidential source note. Finance, dispatch, and viewer cannot read this row.
insert into public.shoot_sensitive_notes (shoot_id, organization_id, source_note, confidential_location, created_by) values
  ('a0000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Tip from hotel staff; do not attribute.', 'Service entrance on 23rd', '11111111-1111-1111-1111-111111111111');

insert into public.assets (id, organization_id, shoot_id, status, canonical_filename, captured_at, headline, caption, subjects, keywords, creator_name, copyright_notice, credit_line, usage_restrictions, selected, rating, created_by) values
  ('a0000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c1', 'active', 'MH_0819_0472', '2026-08-19T18:47:18Z', 'Avery Hart departs Hotel Chelsea', 'Avery Hart is seen leaving Hotel Chelsea in New York City on August 19, 2026.', '["Avery Hart"]', '["Avery Hart","Hotel Chelsea","departure"]', 'Marcus Hale', E'© 2026 Marcus Hale', 'Marcus Hale / Mastline', 'Editorial use only. No commercial use.', true, 5, '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c1', 'active', 'MH_0819_0473', '2026-08-19T18:47:22Z', null, null, '["Avery Hart"]', '[]', 'Marcus Hale', E'© 2026 Marcus Hale', 'Marcus Hale / Mastline', 'Editorial use only. No commercial use.', true, 4, '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-0000000000d3', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c2', 'active', 'MH_0818_0221', '2026-08-18T14:02:00Z', 'Street style outside the Mercer', 'A model is seen during New York Fashion Week on August 18, 2026.', '["Maya Chen"]', '["NYFW","street style"]', 'Marcus Hale', E'© 2026 Marcus Hale', 'Marcus Hale / Mastline', 'Editorial use only.', true, 5, '11111111-1111-1111-1111-111111111111');

insert into public.asset_versions (id, organization_id, asset_id, version_kind, storage_bucket, object_key, sha256, bytes, mime_type, width, height, created_by) values
  ('a0000000-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1', 'original', 'originals',   'aaaaaaaa-0000-0000-0000-000000000001/a0000000-0000-0000-0000-0000000000c1/MH_0819_0472.arw', repeat('a',64), 52428800, 'image/x-sony-arw', 8640, 5760, '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-0000000000e2', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1', 'delivery', 'derivatives', 'aaaaaaaa-0000-0000-0000-000000000001/a0000000-0000-0000-0000-0000000000c1/MH_0819_0472_delivery.jpg', repeat('b',64), 6291456, 'image/jpeg', 5760, 3840, '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-0000000000e5', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d2', 'original', 'originals',   'aaaaaaaa-0000-0000-0000-000000000001/a0000000-0000-0000-0000-0000000000c1/MH_0819_0473.arw', repeat('f',64), 51500000, 'image/x-sony-arw', 8640, 5760, '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-0000000000e3', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d3', 'original', 'originals',   'aaaaaaaa-0000-0000-0000-000000000001/a0000000-0000-0000-0000-0000000000c2/MH_0818_0221.arw', repeat('c',64), 51000000, 'image/x-sony-arw', 8640, 5760, '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-0000000000e4', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d3', 'delivery', 'derivatives', 'aaaaaaaa-0000-0000-0000-000000000001/a0000000-0000-0000-0000-0000000000c2/MH_0818_0221_delivery.jpg', repeat('d',64), 6000000, 'image/jpeg', 5760, 3840, '11111111-1111-1111-1111-111111111111');

insert into public.asset_caption_revisions (organization_id, asset_id, headline, caption, edited_by, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1', 'Avery Hart leaves hotel', 'Avery Hart leaving a hotel in New York.', '22222222-2222-2222-2222-222222222222', '2026-08-20T11:05:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1', 'Avery Hart departs Hotel Chelsea', 'Avery Hart is seen leaving Hotel Chelsea in New York City on August 19, 2026.', '11111111-1111-1111-1111-111111111111', '2026-08-20T14:22:00Z');

-- One package already delivered, one still needing review.
insert into public.packages (id, organization_id, shoot_id, buyer_id, name, status, delivery_method, proposed_terms, restrictions, package_note, approved_by, approved_at, created_by) values
  ('a0000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000b1', 'Hotel Chelsea departure - Package 01', 'delivered', 'SFTP', 'Standard agency distribution; non-exclusive; photographer retains copyright.', 'Editorial use only. No commercial use.', 'First frames, sent while the story was breaking.', '11111111-1111-1111-1111-111111111111', '2026-08-19T18:50:00Z', '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000b2', 'Hotel Chelsea departure - Package 02', 'needs_review', 'SFTP', 'Standard agency distribution; non-exclusive; photographer retains copyright.', 'Editorial use only. No commercial use.', 'Second buyer package; captions incomplete.', null, null, '11111111-1111-1111-1111-111111111111');

insert into public.package_assets (package_id, organization_id, asset_id, asset_version_id, position) values
  ('a0000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000e2', 0),
  -- Package 02 also carries the uncaptioned frame, so the dispatch gate has a
  -- genuine reason to block in the seeded workspace.
  ('a0000000-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000e2', 0),
  ('a0000000-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000e5', 1);

insert into public.submissions (id, organization_id, package_id, buyer_id, status, recipient_snapshot, terms_snapshot, restrictions_snapshot, delivery_manifest, delivery_method, external_reference, sent_at, delivered_at, follow_up_at, created_by) values
  ('a0000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000b1', 'delivered',
   '{"desk":"New York picture desk"}', 'Standard agency distribution; non-exclusive; photographer retains copyright.', 'Editorial use only. No commercial use.',
   '{"assets":[{"assetId":"a0000000-0000-0000-0000-0000000000d1","assetVersionId":"a0000000-0000-0000-0000-0000000000e2","position":0}],"asset_count":1}', 'SFTP', 'BG-0819-441', '2026-08-19T18:52:00Z', '2026-08-19T18:53:00Z', '2026-08-22T14:00:00Z', '11111111-1111-1111-1111-111111111111');

-- One Mastline-generated license (30% share applies) and one external (no share).
insert into public.licenses (id, organization_id, submission_id, buyer_id, status, licensee_name, media, territory, starts_at, ends_at, origin, sale_base_minor, sales_engine_share_minor, photographer_share_minor, created_by) values
  ('a0000000-0000-0000-0000-00000000b001', 'aaaaaaaa-0000-0000-0000-000000000001', null, 'a0000000-0000-0000-0000-0000000000b4', 'active', 'The City Paper', 'US editorial, web and print', 'United States', '2026-08-20T00:00:00Z', '2026-09-19T00:00:00Z', 'mastline_sales_engine', 64000, 19200, 44800, '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-00000000b002', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000a001', 'a0000000-0000-0000-0000-0000000000b1', 'active', 'Backgrid syndication', 'Worldwide editorial', 'Worldwide', '2026-08-19T00:00:00Z', null, 'external', 62000, 0, 62000, '11111111-1111-1111-1111-111111111111');

insert into public.license_assets (license_id, organization_id, asset_id) values
  ('a0000000-0000-0000-0000-00000000b001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1'),
  ('a0000000-0000-0000-0000-00000000b002', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d3');

insert into public.payments (id, organization_id, buyer_id, status, source, external_reference, gross_minor, deductions_minor, platform_fee_minor, tax_minor, net_minor, expected_at, due_at, received_at, created_by) values
  ('a0000000-0000-0000-0000-00000000c001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000b1', 'received', 'statement', 'BG-882341', 390000, 156000, 0, 0, 234000, '2026-07-25T00:00:00Z', '2026-08-15T00:00:00Z', '2026-08-18T00:00:00Z', '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-00000000c002', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000b4', 'received', 'checkout',  'MS-DIRECT-1042', 64000, 0, 19200, 0, 44800, '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z', '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-00000000c003', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000b2', 'overdue',  'invoice',   'MEGA-5610', 120000, 0, 0, 0, 120000, '2026-08-01T00:00:00Z', '2026-08-16T00:00:00Z', null, '11111111-1111-1111-1111-111111111111');

insert into public.payment_allocations (organization_id, payment_id, license_id, submission_id, asset_id, allocated_minor, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000c001', 'a0000000-0000-0000-0000-00000000b002', 'a0000000-0000-0000-0000-00000000a001', 'a0000000-0000-0000-0000-0000000000d3', 62000, '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000c002', 'a0000000-0000-0000-0000-00000000b001', null, 'a0000000-0000-0000-0000-0000000000d1', 44800, '11111111-1111-1111-1111-111111111111');

insert into public.rights_matches (organization_id, asset_id, status, source_url, publisher_name, publisher_domain, page_title, first_observed_at, last_observed_at, match_method, confidence, license_check, evidence_bucket, evidence_object_key) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1', 'new', 'https://thedailyedit.example/avery-hart-new-york-era', 'The Daily Edit', 'thedailyedit.example', E'Avery Hart’s New York era begins', '2026-08-20T13:02:00Z', '2026-08-20T16:02:00Z', 'Perceptual hash + crop tolerance', 0.9400, 'no_linked_license_found', 'evidence', 'aaaaaaaa-0000-0000-0000-000000000001/rights/thedailyedit-0820.png');

insert into public.expenses (organization_id, shoot_id, category, amount_minor, incurred_at, note, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c1', 'Transport', 8500, '2026-08-19T18:00:00Z', 'Car to and from 23rd St.', '11111111-1111-1111-1111-111111111111');

insert into public.activity_events (organization_id, actor_id, entity_type, entity_id, action, event_data, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'shoot', 'a0000000-0000-0000-0000-0000000000c1', 'shoot.created', '{}', '2026-08-19T19:20:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'package', 'a0000000-0000-0000-0000-0000000000f1', 'package.approved', '{}', '2026-08-19T18:50:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'submission', 'a0000000-0000-0000-0000-00000000a001', 'submission.sent', '{}', '2026-08-19T18:52:00Z');

-- ---------------------------------------------------------------------------
-- Org B: a separate workspace that Org A must never be able to see
-- ---------------------------------------------------------------------------

insert into public.buyers (id, organization_id, name, buyer_type) values
  ('b0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000002', 'Northline Wire', 'agency');

insert into public.shoots (id, organization_id, title, status, priority, starts_at, location_name, sensitive_content, created_by) values
  ('b0000000-0000-0000-0000-0000000000c1', 'bbbbbbbb-0000-0000-0000-000000000002', 'Northline exclusive', 'preparing', 'urgent', '2026-08-20T12:00:00Z', 'Chicago, IL', true, '99999999-9999-9999-9999-999999999999');

insert into public.shoot_sensitive_notes (shoot_id, organization_id, source_note, created_by) values
  ('b0000000-0000-0000-0000-0000000000c1', 'bbbbbbbb-0000-0000-0000-000000000002', 'Northline confidential source. Must never leak to another workspace.', '99999999-9999-9999-9999-999999999999');

insert into public.assets (id, organization_id, shoot_id, status, canonical_filename, captured_at, headline, selected, created_by) values
  ('b0000000-0000-0000-0000-0000000000d1', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000c1', 'active', 'NL_0820_0001', '2026-08-20T12:05:00Z', 'Northline exclusive frame', true, '99999999-9999-9999-9999-999999999999');

insert into public.asset_versions (id, organization_id, asset_id, version_kind, storage_bucket, object_key, sha256, bytes, mime_type, created_by) values
  ('b0000000-0000-0000-0000-0000000000e1', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000d1', 'original', 'originals', 'bbbbbbbb-0000-0000-0000-000000000002/b0000000-0000-0000-0000-0000000000c1/NL_0820_0001.arw', repeat('e',64), 48000000, 'image/x-sony-arw', '99999999-9999-9999-9999-999999999999');

insert into public.payments (id, organization_id, buyer_id, status, source, external_reference, gross_minor, net_minor, received_at, created_by) values
  ('b0000000-0000-0000-0000-00000000c001', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'received', 'statement', 'NL-0001', 500000, 300000, '2026-08-19T00:00:00Z', '99999999-9999-9999-9999-999999999999');
