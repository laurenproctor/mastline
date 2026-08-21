-- Full-text search over the archive.
--
-- The archive screen was loading every asset and filtering in JavaScript. On
-- the 28,000-asset archive the product's own copy describes, that means
-- fetching the whole workspace on every search and signing a URL for each one.
-- Search belongs in the database.
--
-- The document is a generated column so it cannot drift from the row it
-- describes: there is no trigger to forget and no backfill to run.

alter table public.assets
  add column search_document tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(canonical_filename, '') || ' ' ||
      coalesce(headline, '') || ' ' ||
      coalesce(caption, '') || ' ' ||
      coalesce(location_name, '') || ' ' ||
      coalesce(creator_name, '') || ' ' ||
      -- Subjects and keywords are JSON arrays. Stripping the punctuation turns
      -- ["Avery Hart","Hotel Chelsea"] into words the index can hold.
      translate(coalesce(subjects::text, ''), '[]",', '    ') || ' ' ||
      translate(coalesce(keywords::text, ''), '[]",', '    ')
    )
  ) stored;

comment on column public.assets.search_document is
  'Generated search vector over filename, headline, caption, location, creator, subjects, and keywords. Generated rather than triggered so it cannot fall out of step with the row.';

create index assets_search_idx on public.assets using gin (search_document);

-- Ordering the archive by capture time is the common case, and pairing it with
-- the workspace makes that an index read rather than a sort over everything.
create index assets_org_captured_idx
  on public.assets(organization_id, captured_at desc nulls last)
  where status <> 'tombstoned';

-- ---------------------------------------------------------------------------
-- Searching the archive
--
-- One call returns the page and the total. Doing it in two would let the count
-- and the rows disagree, and doing it in the application would mean fetching
-- every asset to count them -- which is the problem this replaces.
--
-- security invoker so the caller's row level security decides what is visible.
-- A search must never become a way to read another workspace.
-- ---------------------------------------------------------------------------

create or replace function public.search_archive(
  target_org uuid,
  search_text text default null,
  earning_filter text default 'all',
  page_limit integer default 24,
  page_offset integer default 0
)
returns table (
  asset_id uuid,
  canonical_filename text,
  headline text,
  caption text,
  captured_at timestamptz,
  status public.asset_status,
  lifetime_earnings_minor bigint,
  submission_count bigint,
  preview_object_key text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with matched as (
    select a.id, a.canonical_filename, a.headline, a.caption, a.captured_at, a.status
    from public.assets a
    where a.organization_id = target_org
      and a.status <> 'tombstoned'
      and (
        search_text is null
        or trim(search_text) = ''
        or a.search_document @@ websearch_to_tsquery('english', search_text)
      )
  ),
  enriched as (
    select
      m.*,
      coalesce(e.lifetime_earnings_minor, 0) as earnings,
      (
        select count(*) from public.package_assets pa where pa.asset_id = m.id
      ) as submissions,
      (
        select v.object_key from public.asset_versions v
        where v.asset_id = m.id and v.version_kind = 'preview'
        limit 1
      ) as preview_key
    from matched m
    left join public.asset_lifetime_earnings e on e.asset_id = m.id
  ),
  filtered as (
    select * from enriched
    where case earning_filter
      when 'unsold' then earnings = 0
      when 'earning' then earnings > 0
      else true
    end
  )
  select
    f.id,
    f.canonical_filename,
    f.headline,
    f.caption,
    f.captured_at,
    f.status,
    f.earnings::bigint,
    f.submissions::bigint,
    f.preview_key,
    count(*) over ()::bigint as total_count
  from filtered f
  order by f.captured_at desc nulls last, f.canonical_filename
  limit greatest(1, least(page_limit, 100))
  offset greatest(0, page_offset);
$$;

revoke all on function public.search_archive(uuid, text, text, integer, integer) from public;
revoke all on function public.search_archive(uuid, text, text, integer, integer) from anon;
grant execute on function public.search_archive(uuid, text, text, integer, integer) to authenticated;

revoke all on all tables in schema public from anon;
