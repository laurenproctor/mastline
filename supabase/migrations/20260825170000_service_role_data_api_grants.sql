-- Grant the service role the access the trusted server paths already assume.
--
-- The initial migration said, at the webhook_events grant: "Supabase default
-- privileges grant ALL on new public tables to authenticated." That was true of
-- the image it was written against. It is not true of the current one, which
-- grants only TRUNCATE, REFERENCES, TRIGGER, and MAINTAIN to anon,
-- authenticated, and service_role on a new table in public -- no SELECT,
-- INSERT, UPDATE, or DELETE at all.
--
-- authenticated survived that change because the explicit Data API grants gave
-- it the DML it needs. service_role never had an explicit grant, so on a fresh
-- database it could reach exactly one table: webhook_events. Everything else
-- returned 42501 permission denied, which broke three trusted server paths:
--
--   * inviting a teammate, which inserts the membership and its activity event
--     before that person has a session of their own
--   * the delivery webhook, which reads a submission and records the attempt
--     when no user session exists at all
--   * the billing webhook, which applies subscription state to the organization
--
-- The rule this migration establishes, so nothing depends on a platform default
-- again: service_role holds the same table privileges as authenticated. What
-- separates them is row level security, which service_role bypasses by design
-- and which remains the row authorization layer for everyone else. A grant is
-- not an authorization decision here; the policies are.
--
-- Two deliberate exceptions:
--
--   * The append-only tables get select and insert and nothing more, exactly as
--     authenticated does. Unwinding one of those rows goes through the purge
--     routines, which are security definer and already granted to service_role.
--   * webhook_events keeps its existing service-role-only grant and gains
--     nothing, because authenticated has none there and must not.
--
-- Nothing anonymous is touched. The revoke at the end of this file repeats the
-- one every migration in this repository ends with.

-- Full CRUD, mirroring the Data API grants to authenticated.
grant select, insert, update, delete on
  public.organizations, public.memberships, public.buyers, public.opportunities,
  public.shoots, public.shoot_sensitive_notes, public.shoot_collaborators,
  public.assets, public.packages, public.package_assets, public.submissions,
  public.licenses, public.license_assets, public.payments,
  public.payment_allocations, public.revenue_splits, public.expenses,
  public.rights_matches, public.statement_imports, public.statement_lines,
  public.mfa_recovery_codes
to service_role;

-- Append-only: no update, no delete. The trigger refuses them anyway; the
-- absent grant means the attempt never reaches the trigger.
grant select, insert on public.asset_versions to service_role;
grant select, insert on public.asset_caption_revisions to service_role;
grant select, insert on public.activity_events to service_role;
grant select, insert on public.submission_delivery_attempts to service_role;

-- A delivery record is created and advanced, never removed: the history of what
-- was sent to a buyer is part of the commercial record.
grant select, insert, update on public.submission_deliveries to service_role;

-- A profile row is created by the trigger on the auth user, not by hand.
grant select, update on public.profiles to service_role;

-- Written only through the security definer delivery functions, which is why
-- authenticated may read these and not write them. service_role matches.
grant select on public.delivery_acceptances to service_role;
grant select on public.delivery_access_events to service_role;

grant select on public.asset_lifetime_earnings to service_role;
grant select on public.organization_storage_usage to service_role;

-- Unchanged, and repeated so a later default cannot quietly reopen it.
revoke all on all tables in schema public from anon;
