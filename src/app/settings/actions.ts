"use server";

import { redirect } from "next/navigation";
import { requireContext } from "@/lib/session-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupportedTimezone, parseWorkspaceName } from "@/lib/timezones";

/**
 * Why these actions redirect instead of calling revalidatePath.
 *
 * revalidatePath for the route an action was invoked from leaves the action's
 * promise unresolved on the client. The write lands and the server re-renders
 * in under 100ms, but the form sits on "Saving..." for ever and the person has
 * no idea whether their change took. Measured, not guessed: the buyer template
 * save hung on two of five attempts before this change.
 *
 * A redirect is a fresh request, so the screen shows the new state and the
 * confirmation rides along in the query string.
 */
const SAVED = {
  buyer: "/settings?saved=buyer",
  invite: "/settings?saved=invite",
  removed: "/settings?saved=removed",
  workspace: "/settings?saved=workspace",
} as const;

export interface BuyerState {
  readonly ok?: boolean;
  readonly message?: string;
  readonly error?: string;
}

/**
 * Record a buyer's delivery requirements once.
 *
 * These become the defaults on every package built for that buyer, so the
 * operator confirms rather than retypes. Nothing here relaxes the baseline
 * metadata rules: a buyer profile is additive.
 */
export async function saveBuyerTemplateAction(
  _previous: BuyerState,
  formData: FormData,
): Promise<BuyerState> {
  const buyerId = String(formData.get("buyerId") ?? "");
  const termsDaysRaw = String(formData.get("paymentTermsDays") ?? "").trim();
  const termsDays = termsDaysRaw === "" ? null : Number(termsDaysRaw);

  if (termsDays !== null && (!Number.isInteger(termsDays) || termsDays < 0)) {
    return { error: "Payment terms must be a whole number of days." };
  }

  const { organizationId } = await requireContext("workspace.settings");
  const supabase = await createClient();

  const { error } = await supabase
    .from("buyers")
    .update({
      default_delivery_method: String(formData.get("defaultDeliveryMethod") ?? "") || null,
      default_terms: String(formData.get("defaultTerms") ?? "") || null,
      default_restrictions: String(formData.get("defaultRestrictions") ?? "") || null,
      contact_name: String(formData.get("contactName") ?? "") || null,
      payment_terms_days: termsDays,
    })
    .eq("organization_id", organizationId)
    .eq("id", buyerId);

  if (error) return { error: `Could not save the buyer: ${error.message}` };

  redirect(SAVED.buyer);
}

export interface InviteState {
  readonly ok?: boolean;
  readonly message?: string;
  readonly error?: string;
}

const INVITABLE_ROLES = ["editor", "dispatcher", "finance", "rights_reviewer", "viewer"] as const;

/**
 * Invite someone into the workspace.
 *
 * Uses the admin client because inviting requires looking up or creating an
 * auth user, which the caller's own client cannot do. The capability check runs
 * first, and the organization comes from the session rather than the form, so
 * the elevated client is only ever used for a workspace the caller owns.
 *
 * A second owner cannot be minted through this path -- the RLS policy refuses
 * it, and so does this list.
 */
export async function inviteMemberAction(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "");

  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };
  if (!INVITABLE_ROLES.includes(role as (typeof INVITABLE_ROLES)[number])) {
    return { error: "Choose a role. An owner cannot be invited; transfer ownership instead." };
  }

  const { session, organizationId, actorId } = await requireContext("member.invite");
  const admin = createAdminClient();

  // Find the person, or create a dormant account for them.
  const { data: existing } = await admin.auth.admin.listUsers();
  let userId = existing?.users.find((user) => user.email?.toLowerCase() === email)?.id;

  if (!userId) {
    const { data: created, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { invited_to: session.activeWorkspace.name },
    });
    if (error || !created.user) {
      return { error: `Could not invite that address: ${error?.message ?? "unknown error"}` };
    }
    userId = created.user.id;
  }

  if (userId === actorId) return { error: "You are already in this workspace." };

  const { error: membershipError } = await admin.from("memberships").insert({
    organization_id: organizationId,
    user_id: userId,
    role,
    status: "invited",
    invited_by: actorId,
  });

  if (membershipError) {
    if (membershipError.code === "23505") {
      return { error: "That person is already in this workspace." };
    }
    // The seat-limit trigger speaks for itself.
    return { error: membershipError.message };
  }

  await admin.from("activity_events").insert({
    organization_id: organizationId,
    actor_id: actorId,
    entity_type: "membership",
    entity_id: null,
    action: "member.invited",
    event_data: { summary: `Invited ${email} as ${role.replace(/_/g, " ")}`, role },
  });

  // The address is deliberately not carried in the query string; it would sit
  // in browser history for a person who never chose to be listed there.
  redirect(SAVED.invite);
}

export async function removeMemberAction(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const userId = String(formData.get("userId") ?? "");
  const { organizationId, actorId } = await requireContext("member.invite");

  if (userId === actorId) {
    return { error: "You cannot remove yourself and leave the workspace without an owner." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("memberships")
    .delete()
    .eq("organization_id", organizationId)
    .eq("user_id", userId);

  if (error) return { error: `Could not remove that person: ${error.message}` };

  redirect(SAVED.removed);
}

export interface WorkspaceState {
  readonly ok?: boolean;
  readonly message?: string;
  readonly error?: string;
}

/**
 * Rename a workspace or move it to another timezone.
 *
 * The slug is deliberately not editable. It is unique across every workspace
 * and it names the export file; letting it drift would rename the artefact a
 * photographer may already have filed away, for no gain, since nothing routes
 * by it. Currency is likewise fixed: money is stored per record in minor units
 * plus its currency, so changing it here would misdescribe history rather than
 * convert it.
 *
 * Only an owner reaches this. That is enforced three times over -- the button
 * is gated on the capability, requireContext refuses without it, and the
 * organizations RLS policy restricts UPDATE to an owner. The billing columns
 * are untouched, so the trigger guarding them stays quiet.
 */
export async function updateWorkspaceAction(
  _previous: WorkspaceState,
  formData: FormData,
): Promise<WorkspaceState> {
  const parsed = parseWorkspaceName(String(formData.get("name") ?? ""));
  if ("error" in parsed) return { error: parsed.error };

  const timezone = String(formData.get("timezone") ?? "");
  if (!isSupportedTimezone(timezone)) {
    return { error: "Choose a timezone from the list." };
  }

  const { session, organizationId, actorId } = await requireContext("workspace.settings");
  const supabase = await createClient();

  const previousName = session.activeWorkspace.name;
  const previousTimezone = session.activeWorkspace.timezone;

  // Nothing to record, and no reason to write an activity event for a
  // no-op save.
  // Nothing to write, but the same confirmation: from the outside, saving a
  // form that changed nothing succeeded.
  if (parsed.name === previousName && timezone === previousTimezone) {
    redirect(SAVED.workspace);
  }

  const { error } = await supabase
    .from("organizations")
    .update({ name: parsed.name, timezone })
    .eq("id", organizationId);

  if (error) return { error: `Could not save the workspace: ${error.message}` };

  const changes: string[] = [];
  if (parsed.name !== previousName) changes.push(`renamed to ${parsed.name}`);
  if (timezone !== previousTimezone) changes.push(`timezone set to ${timezone}`);

  await supabase.from("activity_events").insert({
    organization_id: organizationId,
    actor_id: actorId,
    entity_type: "organization",
    entity_id: organizationId,
    action: "workspace.updated",
    event_data: {
      summary: `Workspace ${changes.join(" and ")}`,
      previous_name: previousName,
      previous_timezone: previousTimezone,
    },
  });

  // Post/redirect/get, deliberately, and not revalidatePath.
  //
  // revalidatePath for the route an action was invoked from leaves the action's
  // promise unresolved on the client: the write lands and the server re-renders
  // in under 100ms, but the button sits on "Saving..." for ever. A
  // router.refresh() afterwards does not take effect either. A redirect is a
  // fresh request, so the new name is correct in this panel and in the shell,
  // which is the whole point of having saved it.
  redirect(SAVED.workspace);
}
