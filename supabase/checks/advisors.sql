-- Supabase Security and Performance Advisor rules, run locally.
--
-- The hosted Advisors API only covers linked projects, so the equivalent rule
-- set is expressed here as SQL and run against the local stack. Each query
-- returns rows ONLY when something is wrong.

\echo '--- SECURITY: tables in public without RLS ---'
select tablename
from pg_tables
where schemaname = 'public' and not rowsecurity;

\echo '--- SECURITY: tables with a policy but RLS disabled ---'
select distinct p.tablename
from pg_policies p
join pg_tables t on t.schemaname = p.schemaname and t.tablename = p.tablename
where p.schemaname = 'public' and not t.rowsecurity;

\echo '--- SECURITY: RLS enabled but no policy and still granted to authenticated ---'
select t.tablename
from pg_tables t
where t.schemaname = 'public'
  and t.rowsecurity
  and not exists (
    select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename
  )
  and exists (
    select 1 from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = t.tablename and g.grantee = 'authenticated'
  );

\echo '--- SECURITY: security definer views (bypass caller RLS) ---'
select c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  -- reloptions stores this as security_invoker=on, not =true.
  and coalesce(
    (select option_value from pg_options_to_table(c.reloptions)
     where option_name = 'security_invoker'), 'off') not in ('on','true');

\echo '--- SECURITY: functions with a mutable search_path ---'
select n.nspname || '.' || p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private')
  and p.prokind = 'f'
  and not exists (
    select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg
    where cfg like 'search_path=%'
  );

\echo '--- SECURITY: anything granted to anon in public ---'
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon';

\echo '--- SECURITY: extensions installed in the public schema ---'
select extname
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where n.nspname = 'public' and extname not in ('plpgsql');

\echo '--- SECURITY: public buckets ---'
select id from storage.buckets where public;

\echo '--- PERFORMANCE: auth function re-evaluated per row in a policy ---'
-- auth.uid() must be wrapped as (select auth.uid()) so the planner runs it once.
-- Postgres regex has no lookbehind, so the wrapped form is removed first and
-- anything still calling an auth function is a genuine per-row evaluation.
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and (
    regexp_replace(coalesce(qual, ''), '\( *SELECT +auth\.[a-z]+\(\)[^)]*\)', '', 'gi')
      ~* 'auth\.(uid|jwt|role)\('
    or regexp_replace(coalesce(with_check, ''), '\( *SELECT +auth\.[a-z]+\(\)[^)]*\)', '', 'gi')
      ~* 'auth\.(uid|jwt|role)\('
  );

\echo '--- PERFORMANCE: foreign keys with no supporting index ---'
select
  c.conrelid::regclass::text as table_name,
  c.conname as constraint_name
from pg_constraint c
join pg_namespace n on n.oid = c.connamespace
where c.contype = 'f' and n.nspname = 'public'
  and not exists (
    select 1 from pg_index i
    where i.indrelid = c.conrelid
      and (c.conkey::smallint[]) <@ (i.indkey::smallint[])
  );

\echo '--- PERFORMANCE: duplicate indexes ---'
select
  indrelid::regclass::text as table_name,
  array_agg(indexrelid::regclass::text) as duplicates
from pg_index
join pg_class c on c.oid = pg_index.indexrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
group by indrelid, indkey, indclass, indexprs, indpred
having count(*) > 1;

\echo '--- PERFORMANCE: multiple permissive policies for one role and action ---'
select tablename, cmd, roles::text, count(*)
from pg_policies
where schemaname = 'public' and permissive = 'PERMISSIVE'
group by tablename, cmd, roles
having count(*) > 1;
