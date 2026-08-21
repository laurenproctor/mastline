"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/session-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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

  revalidatePath("/settings");
  return { ok: true, message: "Buyer template saved." };
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

  revalidatePath("/settings");
  return { ok: true, message: `${email} has been invited as ${role.replace(/_/g, " ")}.` };
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

  revalidatePath("/settings");
  return { ok: true, message: "Removed from the workspace." };
}
