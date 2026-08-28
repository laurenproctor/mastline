-- News Radar: one table, two kinds of opportunity.
--
-- The opportunities table was written for one job -- "current stories matched
-- to assets already owned" -- and the first release of News Radar has two:
--
--   archive_match      a story that may make owned work saleable again
--   shoot_opportunity  a story or scheduled event that may justify a new shoot
--
-- These are two modes of one radar, not two tables. A story enters by hand in
-- this release (there is no live feed yet), may exist once per kind, and moves
-- through the same lifecycle either way. Everything the system merely infers
-- about it -- signal, confidence, the stated basis -- stays labelled as a
-- suggestion and separable from the source facts somebody typed.
--
-- What this migration deliberately does NOT add: a news-provider model,
-- provider-specific identifiers, or a matched-assets column. Matched assets
-- will be a relational opportunity-assets table when archive matching is
-- built; parking asset ids inside suggestion_basis would create exactly the
-- kind of unqueryable data island the constitution forbids.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

-- Which of the two jobs this record is about. Checked text rather than an
-- enum, matching status and signal on this table: the set should widen with
-- one migration, not a type change.
alter table public.opportunities
  add column opportunity_kind text not null default 'archive_match'
    check (opportunity_kind in ('archive_match', 'shoot_opportunity'));

-- The default exists only so the rows that predate this migration read as what
-- they were -- every earlier opportunity was an archive match. New rows must
-- say what they are; the application always writes the kind explicitly.

-- Why an operator set this aside. Only meaningful on a dismissed record, and
-- the check keeps a stale reason from surviving into any other state.
alter table public.opportunities
  add column dismissal_reason text
    check (dismissal_reason is null or char_length(dismissal_reason) between 1 and 1000),
  add column acted_at timestamptz,
  add column created_by uuid references auth.users(id);

-- created_by is nullable on purpose: rows written before this migration have
-- no author to claim, and a future ingestion pass will insert stories no
-- person typed. A manual entry always records who entered it.

alter table public.opportunities
  add constraint opportunities_dismissal_reason_requires_dismissed
    check (dismissal_reason is null or status = 'dismissed'),
  add constraint opportunities_acted_at_requires_acted
    check (acted_at is null or status = 'acted');

-- A confidence with nothing behind it is a number pretending to be a reason.
-- Suggestion basis is jsonb with a human-readable `summary`; any row carrying
-- a confidence must say what the confidence is a confidence IN.
alter table public.opportunities
  add constraint opportunities_confidence_requires_basis
    check (confidence is null or coalesce(suggestion_basis ->> 'summary', '') <> '');

-- ---------------------------------------------------------------------------
-- Duplicate protection
--
-- The same story may be entered once as an archive match and once as a shoot
-- opportunity -- the two jobs are different -- but not twice as the same kind.
-- Keyed on the source URL because that is the only stable identity a manually
-- entered story has; a story entered without one cannot be deduplicated and is
-- not refused for it.
-- ---------------------------------------------------------------------------

create unique index opportunities_org_kind_source_url_key
  on public.opportunities(organization_id, opportunity_kind, source_url)
  where source_url is not null;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The overview reads one kind at a time, newest story first.
create index opportunities_org_kind_status_published_idx
  on public.opportunities(organization_id, opportunity_kind, status, source_published_at desc);

-- The useful-window sweep: what is closing, and what has already closed.
create index opportunities_org_window_idx
  on public.opportunities(organization_id, window_closes_at)
  where window_closes_at is not null;

-- Foreign keys need a supporting index or a parent delete degenerates into a
-- sequential scan. Same rule as every created_by on the initial migration.
create index opportunities_created_by_idx on public.opportunities(created_by);

-- ---------------------------------------------------------------------------
-- Row level security and grants: verified, not changed.
--
-- The initial migration already gives this table exactly the contract News
-- Radar needs, and it is restated here so a later edit to either file cannot
-- drift without contradicting the other:
--
--   * opportunities_select -- every active member of the organization reads,
--     viewer included.
--   * opportunities_write  -- owner and editor only, FOR ALL, with the same
--     has_org_role test in both USING and WITH CHECK, so a row can neither be
--     seen nor written across a role or workspace boundary.
--   * Data API grants: select, insert, update, delete to authenticated
--     (initial migration) and to service_role
--     (20260825170000_service_role_data_api_grants), with RLS -- which
--     service_role bypasses by design -- as the row authorization layer.
--   * enforce_workspace_writable already covers opportunities, so a lapsed
--     trial can read its radar but not work it.
--
-- src/lib/permissions.ts mirrors this as opportunity.read for every role and
-- opportunity.write / opportunity.review for owner and editor, and
-- tests/permissions-match-policies.test.ts asserts the two agree.
-- ---------------------------------------------------------------------------

-- Unchanged, and repeated so a later default cannot quietly reopen it.
revoke all on all tables in schema public from anon;
