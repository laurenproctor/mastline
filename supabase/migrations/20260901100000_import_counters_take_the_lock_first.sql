-- Batch counters that survive five files finishing at once.
--
-- THE DEFECT
--
-- private.refresh_import_batch() counted first and locked second:
--
--   select count(*) ... into totals from public.import_files where ...;
--   update public.import_batches set completed_files = totals.completed ...;
--
-- Under READ COMMITTED that is the oldest race there is. Five files in one
-- batch finalising concurrently each ran the count against their own snapshot
-- -- before the others had committed -- and then queued on the batch row's
-- lock. Each in turn wrote the number it had computed while waiting. The last
-- one to get the lock had the oldest count, and it won.
--
-- Observed, not theorised: five files, five assets, every import_files row
-- `complete`, and a batch reporting `completed_files = 2` and still
-- `uploading`. A photographer watching that screen is told two of five landed
-- when all five did, and the batch never announces itself finished.
--
-- THE FIX
--
-- Take the lock first, then count. Once the row is locked, every later
-- statement in this transaction gets a fresh snapshot -- which, having waited
-- for the other transaction to commit, includes its work. The counting becomes
-- serialised per batch, which is what it always needed to be: these are
-- derived totals, and a derived total computed from a stale read is just a
-- number that happens to be wrong.
--
-- The cost is one row lock per completion, held for the length of the count.
-- That is already the shape of the write it was doing.
--
-- ROLLBACK
--
--   Restore the body from 20260829090000_resumable_field_imports.sql. Doing so
--   reintroduces the drift, so check for it first:
--
--     select b.id, b.completed_files, count(f.*) filter (where f.status = 'complete')
--     from public.import_batches b
--     join public.import_files f on f.import_batch_id = b.id
--     group by b.id having b.completed_files
--       <> count(f.*) filter (where f.status = 'complete');

create or replace function private.refresh_import_batch(target_batch uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  totals record;
  current_status public.import_batch_status;
  next_status public.import_batch_status;
begin
  -- The lock comes first. Everything below depends on it: the count is only
  -- meaningful if nothing else can be committing files while it runs.
  select status into current_status
  from public.import_batches
  where id = target_batch
  for update;

  -- The batch is being deleted underneath us; there is nothing to keep in step.
  if not found then return; end if;

  select
    count(*)::int                                                as total,
    count(*) filter (where status = 'complete')::int             as completed,
    count(*) filter (where status = 'failed')::int               as failed,
    count(*) filter (where status = 'canceled')::int             as canceled,
    count(*) filter (
      where status not in ('complete','failed','canceled')
    )::int                                                       as outstanding,
    count(*) filter (
      where status in ('staged','uploading','uploaded','finalizing','retrying')
    )::int                                                       as started
  into totals
  from public.import_files
  where import_batch_id = target_batch;

  -- paused and canceled are decisions a person made about the whole batch. The
  -- counters follow the files; the status does not overrule the operator.
  if current_status in ('paused','canceled') then
    next_status := current_status;
  elsif totals.total = 0 then
    next_status := 'pending';
  elsif totals.canceled = totals.total then
    next_status := 'canceled';
  elsif totals.outstanding > 0 then
    next_status := case when totals.started > 0 then 'uploading' else 'pending' end;
  elsif totals.failed > 0 then
    next_status := 'failed';
  else
    next_status := 'complete';
  end if;

  update public.import_batches set
    total_files     = totals.total,
    completed_files = totals.completed,
    failed_files    = totals.failed,
    status          = next_status,
    completed_at    = case
                        when next_status = 'complete' then coalesce(completed_at, now())
                        else null
                      end
  where id = target_batch;
end;
$$;

revoke all on function private.refresh_import_batch(uuid) from public;
