"use server";

import { redirect } from "next/navigation";
import { requireWorkspaceContext } from "@/lib/session-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { RENAME_LIMIT_PER_YEAR, type RenameOutcome, SLUG_MAX_LENGTH, slugProblem } from "@/lib/slug";
import { isSupportedTimezone, parseWorkspaceName } from "@/lib/timezones";
import { workspaceRoutes } from "@/lib/workspace-routes";

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
/**
 * Where each confirmation lands.
 *
 * These were bare "/settings?saved=...", which only reached the right screen
 * because the middleware put a workspace in front of them using the
 * active-workspace cookie -- so saving in one tab could confirm in another
 * workspace's settings. The address is now a required argument, and it is the
 * canonical one the action just resolved.
 */
type SavedReason = "buyer" | "invite" | "removed" | "workspace" | "address";

function savedAt(canonicalSlug: string, reason: SavedReason): string {
  return workspaceRoutes(canonicalSlug).settings({ query: { saved: reason } });
}

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
  workspaceSlug: string,
  _previous: BuyerState,
  formData: FormData,
): Promise<BuyerState> {
  const buyerId = String(formData.get("buyerId") ?? "");
  const termsDaysRaw = String(formData.get("paymentTermsDays") ?? "").trim();
  const termsDays = termsDaysRaw === "" ? null : Number(termsDaysRaw);

  if (termsDays !== null && (!Number.isInteger(termsDays) || termsDays < 0)) {
    return { error: "Payment terms must be a whole number of days." };
  }

  const { organizationId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "workspace.settings");
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

  redirect(savedAt(canonicalSlug, "buyer"));
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
  workspaceSlug: string,
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

  const { session, organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "member.invite");
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

  if (userId === actorId) return { error: "That person is already in this workspace." };

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
  redirect(savedAt(canonicalSlug, "invite"));
}

export async function removeMemberAction(
  workspaceSlug: string,
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const userId = String(formData.get("userId") ?? "");
  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "member.invite");

  if (userId === actorId) {
    return { error: "A workspace cannot be left without an owner." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("memberships")
    .delete()
    .eq("organization_id", organizationId)
    .eq("user_id", userId);

  if (error) return { error: `Could not remove that person: ${error.message}` };

  redirect(savedAt(canonicalSlug, "removed"));
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
  workspaceSlug: string,
  _previous: WorkspaceState,
  formData: FormData,
): Promise<WorkspaceState> {
  const parsed = parseWorkspaceName(String(formData.get("name") ?? ""));
  if ("error" in parsed) return { error: parsed.error };

  const timezone = String(formData.get("timezone") ?? "");
  if (!isSupportedTimezone(timezone)) {
    return { error: "Choose a timezone from the list." };
  }

  const { session, organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "workspace.settings");
  const supabase = await createClient();

  const previousName = session.activeWorkspace.name;
  const previousTimezone = session.activeWorkspace.timezone;

  // Nothing to record, and no reason to write an activity event for a
  // no-op save.
  // Nothing to write, but the same confirmation: from the outside, saving a
  // form that changed nothing succeeded.
  if (parsed.name === previousName && timezone === previousTimezone) {
    redirect(savedAt(canonicalSlug, "workspace"));
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
  redirect(savedAt(canonicalSlug, "workspace"));
}

export interface AddressState {
  readonly error?: string;
}

/**
 * What each outcome of rename_workspace_slug means to the person who asked.
 *
 * The database returns a value rather than raising, so nothing here parses an
 * error message to decide what to say. `taken` deliberately does not
 * distinguish "somebody holds it" from "somebody held it once and let it go":
 * an address is never released, the remedy is the same either way, and which of
 * the two it is would say something about a workspace the asker is not in.
 */
const REFUSALS: Record<Exclude<RenameOutcome, "renamed" | "unchanged">, string> = {
  invalid: `Use lowercase letters, numbers and hyphens, up to ${SLUG_MAX_LENGTH} characters.`,
  reserved: "That address is reserved for Mastline. Choose another.",
  taken: "That address is not available.",
  rate_limited: `A workspace address can change ${RENAME_LIMIT_PER_YEAR} times a year. That is used up for now.`,
  not_found: "That workspace could not be found.",
};

/**
 * Change the workspace's address.
 *
 * Almost nothing happens here, and that is the design. Ownership, the reserved
 * list, the rolling limit, retiring the old address, taking the new one,
 * updating the mirror and writing the audit event are one transaction inside
 * rename_workspace_slug, because half of that having happened is not a state
 * worth being able to reach. This function's whole job is to ask, and to turn
 * the answer into a sentence.
 *
 * The checks repeated before the call are a courtesy -- they save a round trip
 * on an address that could never have worked. Availability is not among them:
 * it can change between asking and submitting, so it is left to the one place
 * that can answer it and commit in the same breath.
 */
export async function renameWorkspaceAddressAction(
  workspaceSlug: string,
  _previous: AddressState,
  formData: FormData,
): Promise<AddressState> {
  const requested = String(formData.get("slug") ?? "")
    .trim()
    .toLowerCase();

  if (!requested) return { error: "Enter a workspace address." };
  const problem = slugProblem(requested);
  if (problem) return { error: REFUSALS[problem] };

  const { session, organizationId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "workspace.settings");

  // The capability is held by admins too; moving the address is an owner's
  // decision, and the database refuses anyone else regardless of this.
  if (session.activeWorkspace.role !== "owner") {
    return { error: "Only an owner can change the workspace address." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rename_workspace_slug", {
    target_org: organizationId,
    new_slug: requested,
  });

  if (error) return { error: `Could not change the address: ${error.message}` };

  const outcome = data as RenameOutcome;
  /*
   * A rename changes the address these very routes are built from, so the
   * confirmation has to land on the NEW one. The context was resolved before
   * the call, so its canonicalSlug is the address the workspace has just left;
   * redirecting there would bounce through the historical-address redirect on
   * the way back, and read as though the change had not taken.
   */
  if (outcome === "renamed") redirect(savedAt(requested, "address"));
  if (outcome === "unchanged") redirect(savedAt(canonicalSlug, "address"));

  return { error: REFUSALS[outcome] ?? "That address could not be used." };
}
