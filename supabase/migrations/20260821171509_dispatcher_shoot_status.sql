-- Let a dispatcher move a shoot's status, but nothing else about it.
--
-- The initial migration narrowed dispatchers out of shoots entirely, on the
-- grounds that a dispatcher moves packages and submissions rather than rewriting
-- briefs. That is still right, but it went one step too far: approving a
-- dispatch has to mark the shoot dispatched, and that is dispatch work.
--
-- Row level security cannot express "only this column", so the policy admits
-- the dispatcher and a trigger enforces the column boundary. The trigger is the
-- real guarantee: a dispatcher changing a title, a location, or a source note
-- is refused no matter which code path attempts it.

create or replace function private.restrict_dispatcher_shoot_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Owners and editors may change anything they are already permitted to.
  if private.has_org_role(new.organization_id, array['owner','editor']::public.app_role[]) then
    return new;
  end if;

  if private.has_org_role(new.organization_id, array['dispatcher']::public.app_role[]) then
    if (to_jsonb(new) - 'status' - 'updated_at') is distinct from
       (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'A dispatcher may change a shoot status but nothing else about the shoot'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  return new;
end;
$$;

create trigger shoots_restrict_dispatcher_update
before update on public.shoots
for each row execute function private.restrict_dispatcher_shoot_update();

drop policy if exists shoots_write on public.shoots;

-- Owners and editors keep full control of the brief.
create policy shoots_manage on public.shoots
  for all to authenticated
  using (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['owner','editor']::public.app_role[]));

-- Dispatchers may update, and the trigger confines that to the status column.
create policy shoots_dispatcher_status on public.shoots
  for update to authenticated
  using (private.has_org_role(organization_id, array['dispatcher']::public.app_role[]))
  with check (private.has_org_role(organization_id, array['dispatcher']::public.app_role[]));
