-- What actually happened to the requests.
--
-- Views, not materialised anything, because there is no refresh job in this
-- system and a stale number presented as current is worse than a slow one.
--
-- Every view is `security_invoker = on`. A view owned by postgres and queried
-- through the Data API would otherwise run with the OWNER's rights and hand a
-- signed-in user every workspace's figures. With security_invoker the caller's
-- own policies apply, so these are workspace-isolated by the same rules as the
-- tables underneath rather than by a WHERE clause somebody has to remember.
--
-- ---------------------------------------------------------------------------
-- Four rules that shape every figure here
--
-- 1. AN OPENED LINK IS NOT A WIN. Engagement is evidence a recipient looked. It
--    is not a submission, not a licence, and not money. Nothing in these views
--    reads delivery_access_events or delivery_view_sessions.
--
-- 2. AN UNLINKED PAYMENT IS NOT REQUEST REVENUE. Money reaches a request only
--    through payment_allocations -> licenses -> submissions ->
--    request_submissions. A payment never allocated to a licence belongs to the
--    workspace, not to a request, and summing it here would invent attribution.
--
-- 3. MISSING IS NULL, NEVER ZERO. A median over nothing is null. A win rate
--    with no decided requests is null. Zero means "measured, and it was none";
--    null means "not measured". Rendering the second as the first is how a
--    workspace concludes it never wins anything from a fortnight of no data.
--
-- 4. STATED BUDGET IS NOT REVENUE. What a desk said they might pay lives in
--    buyer_requests.budget_*; what was licensed lives in licenses. They are
--    never added together and never share a column.
--
-- ROLLBACK
--
--   begin;
--     drop view if exists public.request_closure_reasons;
--     drop view if exists public.request_revenue_by_buyer;
--     drop view if exists public.request_outcomes;
--     drop view if exists public.request_facts;
--   commit;

-- ---------------------------------------------------------------------------
-- One row per request, carrying its evidence-derived timings and money.
-- Everything else is built from this, so a definition lives in one place.
-- ---------------------------------------------------------------------------
create or replace view public.request_facts
with (security_invoker = on) as
select
  r.id,
  r.organization_id,
  r.buyer_id,
  r.status,
  r.created_at,
  r.qualified_at,
  r.closed_at,
  r.closed_reason,
  r.response_deadline,
  r.expires_at,
  r.budget_disclosed as budget_was_stated,
  r.budget_min_minor as stated_budget_min_minor,
  r.budget_max_minor as stated_budget_max_minor,
  (
    select min(coalesce(s.sent_at, d.shared_at))
    from public.request_submissions rs
    join public.submissions s on s.id = rs.submission_id
    left join public.submission_deliveries d
      on d.submission_id = s.id and d.shared_at is not null
    where rs.request_id = r.id
      and (s.sent_at is not null or d.shared_at is not null)
  ) as first_sent_at,
  (select count(*) from public.request_submissions rs where rs.request_id = r.id)
    as submission_count,
  (
    select sum(l.sale_base_minor)
    from public.request_submissions rs
    join public.licenses l on l.submission_id = rs.submission_id
    where rs.request_id = r.id and l.status <> 'cancelled'
  ) as licensed_minor,
  (
    select sum(pa.allocated_minor)
    from public.request_submissions rs
    join public.licenses l on l.submission_id = rs.submission_id
    join public.payment_allocations pa on pa.license_id = l.id
    where rs.request_id = r.id
  ) as paid_minor,
  (
    select min(p.received_at)
    from public.request_submissions rs
    join public.licenses l on l.submission_id = rs.submission_id
    join public.payment_allocations pa on pa.license_id = l.id
    join public.payments p on p.id = pa.payment_id
    where rs.request_id = r.id and p.received_at is not null
  ) as first_paid_at
from public.buyer_requests r;

comment on view public.request_facts is
  'One row per request with its evidence-derived timings and money. first_sent_at is a submission actually sent or a link a person marked shared, never a link being created or opened.';

-- ---------------------------------------------------------------------------
-- The operational roll-up. A table of numbers somebody acts on, not a chart.
-- ---------------------------------------------------------------------------
create or replace view public.request_outcomes
with (security_invoker = on) as
select
  f.organization_id,
  count(*) as requests_received,
  count(*) filter (
    where f.status not in ('won','lost','expired','declined','cancelled')
  ) as requests_open,
  percentile_cont(0.5) within group (
    order by extract(epoch from (f.qualified_at - f.created_at))
  ) filter (where f.qualified_at is not null) as median_seconds_to_qualification,
  percentile_cont(0.5) within group (
    order by extract(epoch from (f.first_sent_at - f.created_at))
  ) filter (where f.first_sent_at is not null) as median_seconds_to_first_response,
  percentile_cont(0.5) within group (
    order by extract(epoch from (f.first_paid_at - f.first_sent_at))
  ) filter (where f.first_paid_at is not null and f.first_sent_at is not null)
    as median_seconds_to_payment,
  count(*) filter (where f.first_sent_at is not null) as requests_responded,
  case when count(*) > 0
    then count(*) filter (where f.first_sent_at is not null)::numeric / count(*)
  end as submission_rate,
  count(*) filter (where f.status = 'won') as requests_won,
  count(*) filter (where f.status in ('won','lost','declined','expired')) as requests_decided,
  case when count(*) filter (where f.status in ('won','lost','declined','expired')) > 0
    then count(*) filter (where f.status = 'won')::numeric
       / count(*) filter (where f.status in ('won','lost','declined','expired'))
  end as win_rate,
  sum(f.licensed_minor) filter (where f.status = 'won') as licensed_minor_from_won,
  sum(f.paid_minor) as paid_minor,
  sum(f.stated_budget_max_minor) filter (where f.budget_was_stated)
    as stated_budget_ceiling_minor,
  count(*) filter (where not f.budget_was_stated) as requests_with_no_stated_budget,
  count(*) filter (
    where f.expires_at is not null
      and f.expires_at < now()
      and f.first_sent_at is null
      and f.status not in ('won','lost','expired','declined','cancelled')
  ) as expiring_without_action
from public.request_facts f
group by f.organization_id;

comment on view public.request_outcomes is
  'Operational totals per workspace. Rates and medians are null when there is nothing to measure; zero means measured and none.';

-- ---------------------------------------------------------------------------
-- Revenue and repeat behaviour, by buyer.
-- ---------------------------------------------------------------------------
create or replace view public.request_revenue_by_buyer
with (security_invoker = on) as
select
  f.organization_id,
  f.buyer_id,
  count(*) as requests,
  count(*) filter (where f.status = 'won') as won,
  count(*) filter (where f.first_sent_at is not null) as responded,
  sum(f.licensed_minor) as licensed_minor,
  sum(f.paid_minor) as paid_minor,
  percentile_cont(0.5) within group (
    order by extract(epoch from (f.first_paid_at - f.first_sent_at))
  ) filter (where f.first_paid_at is not null and f.first_sent_at is not null)
    as median_seconds_to_payment,
  min(f.created_at) as first_request_at,
  max(f.created_at) as latest_request_at
from public.request_facts f
where f.buyer_id is not null
group by f.organization_id, f.buyer_id;

comment on view public.request_revenue_by_buyer is
  'Per-buyer request history and the money that reached those requests through the licence chain. Never includes an unallocated payment.';

-- ---------------------------------------------------------------------------
-- Why requests ended. Grouped by the reason somebody typed, because a count of
-- "lost" teaches nobody anything.
-- ---------------------------------------------------------------------------
create or replace view public.request_closure_reasons
with (security_invoker = on) as
select
  f.organization_id,
  f.status,
  coalesce(nullif(trim(f.closed_reason), ''), '(no reason recorded)') as reason,
  count(*) as requests,
  max(f.closed_at) as most_recent_at
from public.request_facts f
where f.status in ('lost','declined','expired','cancelled')
group by
  f.organization_id,
  f.status,
  coalesce(nullif(trim(f.closed_reason), ''), '(no reason recorded)');

comment on view public.request_closure_reasons is
  'Closed requests grouped by the reason somebody gave.';

grant select on public.request_facts to authenticated;
grant select on public.request_outcomes to authenticated;
grant select on public.request_revenue_by_buyer to authenticated;
grant select on public.request_closure_reasons to authenticated;

revoke all on public.request_facts from anon;
revoke all on public.request_outcomes from anon;
revoke all on public.request_revenue_by_buyer from anon;
revoke all on public.request_closure_reasons from anon;
revoke all on all tables in schema public from anon;
