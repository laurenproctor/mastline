-- A way to clear imports that were never going to finish.
--
-- The import queue records intent, which means it also records intent that came
-- to nothing: a card dump abandoned in a car park, a file the bucket refused, a
-- batch cancelled halfway. Those rows are useful for days and clutter for
-- months, and nothing in the product deletes them -- the client removes its own
-- local copy on cancellation, but the server record is deliberately kept so the
-- operator can still see what happened.
--
-- This is the same shape as prune_delivery_analytics and the purge routines:
-- security definer, service role only, and it refuses to touch anything that
-- matters.
--
-- What it will never remove, and why the guards are worth reading:
--
--   * anything `complete`, and anything holding an asset_id. A completed import
--     points at a photograph. Removing the row would not harm the asset, but it
--     would remove the only record of how that asset arrived, and the whole
--     point of these tables is to be able to answer that.
--   * anything still in flight. `uploading` and `finalizing` mean a browser
--     somewhere believes it owns this file.
--   * anything touched recently. The default is a week, which is far longer
--     than an import takes and long enough that somebody who left a shoot
--     mid-upload on Friday still finds it on Monday.
--
-- NOT SCHEDULED. Nothing in this repository runs on a timer; like
-- prune_delivery_analytics, this is a function an operator or a future
-- scheduled task calls. See docs/IMPORT_QUEUE.md for the intended cadence.
--
-- Staged objects in storage are a separate matter and are NOT removed here. A
-- completed import's bytes were moved to their canonical key, so nothing is
-- left behind; a cancelled one is removed by the browser that cancelled it. The
-- residue is the case where a tab died mid-upload, and that is swept from the
-- storage side rather than from SQL -- again, see the runbook.
--
-- ROLLBACK
--
--   begin;
--     drop function if exists public.prune_abandoned_imports(integer);
--   commit;

create or replace function public.prune_abandoned_imports(retain_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz;
  removed integer;
begin
  if retain_days is null or retain_days < 1 then
    raise exception 'A retention window of at least one day is required.';
  end if;

  cutoff := now() - make_interval(days => retain_days);

  -- Files first, then the batches left holding nothing. The composite foreign
  -- key would cascade, but deleting the files explicitly is what lets the
  -- guards below apply per file rather than per batch: a batch with one
  -- completed frame in it keeps that frame's row.
  delete from public.import_files
  where status in ('failed', 'canceled')
    and asset_id is null
    and updated_at < cutoff;

  get diagnostics removed = row_count;

  delete from public.import_batches b
  where b.updated_at < cutoff
    and b.status in ('failed', 'canceled')
    and not exists (select 1 from public.import_files f where f.import_batch_id = b.id);

  return removed;
end;
$$;

comment on function public.prune_abandoned_imports(integer) is
  'Removes failed and cancelled import records older than the retention window. Never removes a completed import or one holding an asset. Not scheduled: called by an operator or a future task.';

revoke all on function public.prune_abandoned_imports(integer) from public;
revoke all on function public.prune_abandoned_imports(integer) from anon;
revoke all on function public.prune_abandoned_imports(integer) from authenticated;
grant execute on function public.prune_abandoned_imports(integer) to service_role;

-- Unchanged, and repeated so a later default cannot quietly reopen it.
revoke all on all tables in schema public from anon;
