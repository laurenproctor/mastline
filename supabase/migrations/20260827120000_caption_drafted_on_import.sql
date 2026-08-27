-- The caption writer runs at import, and the caption it writes says so.
--
-- Until now a caption could only be drafted by a person clicking "Suggest from
-- the image" in the inspector, one frame at a time, and the draft lived in
-- React state until they saved it. That is the wrong shape for the moment it
-- matters: a photographer who has just dumped a card is not sitting in the
-- inspector, and the frames a picture desk wants are wanted in the next ten
-- minutes.
--
-- So the draft now lands in assets.caption the moment a preview exists for the
-- frame. The columns here are what stop that from being a lie.
--
-- The problem being solved is not "where do we put the text". It is that
-- assets.caption is a commercial fact -- it is what a buyer reads, what an
-- export carries, and what the dispatch gate checks. A sentence a model wrote
-- and nobody has read is not the same kind of fact as a sentence the
-- photographer typed, and a schema that cannot tell them apart will eventually
-- deliver the first while everyone believes it delivered the second.
--
-- Hence provenance stored beside the text rather than a separate drafts table:
--
--   * The caption is immediately real. It is searchable, exportable, and
--     visible in the archive from the moment the file lands, which is the whole
--     point of drafting it at import.
--   * caption_origin says who wrote it. caption_reviewed_at says whether a
--     person has since read it and stood behind it.
--   * caption_awaits_review is those two facts combined, generated rather than
--     maintained, because a boolean anyone can set independently of the columns
--     that justify it is a boolean that will one day disagree with them.
--
-- src/lib/metadata-rules.ts reads that generated column: an unread draft does
-- not satisfy the caption requirement, so a frame captioned only by the model
-- is never dispatch ready. The draft saves the typing, not the judgement.
--
-- ROLLBACK
--
--   begin;
--     alter table public.assets
--       drop column if exists caption_awaits_review,
--       drop column if exists caption_origin,
--       drop column if exists caption_drafted_at,
--       drop column if exists caption_reviewed_at,
--       drop column if exists caption_reviewed_by,
--       drop column if exists caption_basis,
--       drop column if exists caption_confidence,
--       drop column if exists caption_model;
--     alter table public.organizations
--       drop column if exists auto_caption_on_import;
--   commit;
--
--   Dropping these keeps every caption and loses only the knowledge of which
--   ones nobody has read. That is a one-way loss: after the rollback, drafted
--   captions are indistinguishable from typed ones and would pass the dispatch
--   gate. Read the report below before rolling back, and clear the unread
--   drafts first if the answer is not zero:
--
--     select count(*) from public.assets where caption_awaits_review;

-- ---------------------------------------------------------------------------
-- Whether a workspace wants this at all
-- ---------------------------------------------------------------------------

-- Defaulting to true, which is the opposite of require_mfa's default and for
-- the opposite reason: turning this on costs a fraction of a cent a frame and
-- can be ignored, while turning MFA on can lock an owner out of their own
-- workspace. The failure mode of being wrong here is a caption nobody wanted,
-- sitting in a field they can overwrite.
--
-- It is a workspace decision rather than a per-person one because it spends
-- the workspace's money and fills the workspace's records.
alter table public.organizations
  add column auto_caption_on_import boolean not null default true;

comment on column public.organizations.auto_caption_on_import is
  'Whether the caption writer drafts a caption for each frame as it is imported. The draft is always marked unreviewed and never satisfies the dispatch gate on its own.';

-- ---------------------------------------------------------------------------
-- Where a caption came from, and whether anyone has read it
-- ---------------------------------------------------------------------------

alter table public.assets
  -- 'human' is the default because every caption that exists today was typed
  -- by one, and a backfill that guessed otherwise would mark real work as
  -- unread and block dispatches that were already approved.
  add column caption_origin text not null default 'human'
    check (caption_origin in ('human', 'model')),

  -- When the model wrote it. Distinct from created_at, which is when the file
  -- arrived, and from updated_at, which moves for any edit at all.
  add column caption_drafted_at timestamptz,

  -- When a person read it and saved it. Set by the inspector's save, which is
  -- the confirm step in suggest -> explain -> confirm. Deliberately NOT set by
  -- a bulk metadata apply: filling a credit line across two hundred frames is
  -- not reading two hundred captions.
  add column caption_reviewed_at timestamptz,
  add column caption_reviewed_by uuid references auth.users(id),

  -- What the draft was made from and how sure the model was, shown next to the
  -- field in the inspector. Kept after review as well: how a caption started is
  -- part of its history, and the caption revisions table records the text but
  -- not its provenance.
  add column caption_basis text,
  add column caption_confidence numeric(3, 2)
    check (caption_confidence is null or caption_confidence between 0 and 1),
  add column caption_model text,

  -- Both or neither. A review with no reviewer is an audit record that cannot
  -- answer the only question anyone asks of it.
  add constraint assets_caption_review_is_attributable
    check ((caption_reviewed_at is null) = (caption_reviewed_by is null));

-- The question every consumer actually asks, answered in one place.
--
-- Generated and stored rather than a view or a repeated predicate: the dispatch
-- gate, the inspector, and the shoot header all need it, and the Data API can
-- filter and count on it directly.
alter table public.assets
  add column caption_awaits_review boolean
    generated always as (
      caption_origin = 'model' and caption_reviewed_at is null
    ) stored;

comment on column public.assets.caption_origin is
  'Who wrote the caption currently in this row: a person, or the caption writer at import.';
comment on column public.assets.caption_awaits_review is
  'True while a model-written caption has not been read and saved by a person. Such a caption never satisfies the dispatch gate.';

-- Finding the unread drafts is the shoot screen's main new question, and it is
-- always asked within one workspace.
create index if not exists assets_awaiting_caption_review_idx
  on public.assets (organization_id, shoot_id)
  where caption_awaits_review;

-- No grants below, and that is not an omission. These are columns on existing
-- tables, and both organizations and assets already carry table-level DML
-- grants for authenticated and service_role from
-- 20260825170000_service_role_data_api_grants.sql. A new table would need its
-- own; a new column inherits.
