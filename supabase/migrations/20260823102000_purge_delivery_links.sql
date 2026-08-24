-- A way to clear delivery links and their access record.
--
-- The events are append-only because they are evidence, which is right for a
-- workspace and inconvenient for a test suite that creates links on every run.
-- This is the audited exception, in the same shape as the other purges: service
-- role only, and it announces itself through the purge flag rather than working
-- around the trigger.

create or replace function public.purge_delivery_links()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('mastline.allow_purge', 'on', true);
  -- The where clauses are not decoration: unqualified deletes are refused,
  -- which is a guard worth having on tables that hold evidence.
  delete from public.delivery_access_events where id is not null;
  delete from public.submission_deliveries where id is not null;
end;
$$;

revoke all on function public.purge_delivery_links() from public;
revoke all on function public.purge_delivery_links() from anon;
revoke all on function public.purge_delivery_links() from authenticated;
