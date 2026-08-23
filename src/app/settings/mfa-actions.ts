"use server";

import { redirect } from "next/navigation";
import { normalizeTotpCode } from "@/lib/mfa";
import { requireSession } from "@/lib/auth";
import { requireContext } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/server";

/**
 * Enrolling, confirming, and removing a second factor.
 *
 * Supabase owns the secret and the verification; nothing here stores or
 * validates a code itself. What this file owns is the sequence and the wording,
 * because a person setting up two-factor authentication is one wrong turn away
 * from locking themselves out of their own archive.
 *
 * Every action works on the caller's own account. There is no path here to
 * touch anyone else's factors, deliberately: an owner who could strip a
 * colleague's second factor would be a way around it rather than an
 * administrator.
 */

export interface EnrollState {
  readonly factorId?: string;
  readonly secret?: string;
  readonly uri?: string;
  readonly error?: string;
}

export interface ConfirmState {
  readonly ok?: boolean;
  readonly error?: string;
}

/**
 * Start enrolment: Supabase generates the secret and the otpauth URI.
 *
 * An unverified factor is left behind if someone abandons this halfway, so any
 * previous unverified attempt is cleared first rather than accumulating.
 */
export async function startEnrollmentAction(): Promise<EnrollState> {
  await requireSession();
  const supabase = await createClient();

  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    if (factor.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
  });

  if (error || !data) {
    return { error: `Could not start setup: ${error?.message ?? "unknown error"}` };
  }

  return {
    factorId: data.id,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

/**
 * Confirm enrolment with a code from the authenticator app.
 *
 * A factor is not in force until this succeeds, so a mistyped code costs
 * nothing and an abandoned setup leaves the account exactly as it was.
 */
export async function confirmEnrollmentAction(
  _previous: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const factorId = String(formData.get("factorId") ?? "");
  const code = normalizeTotpCode(String(formData.get("code") ?? ""));

  if (!factorId) return { error: "Start the setup again." };
  if (!code) return { error: "Enter the six-digit code from your authenticator app." };

  await requireSession();
  const supabase = await createClient();

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    // A wrong code and an expired code are the same mistake to the person
    // typing: look at the app again and use the number showing now.
    return { error: "That code was not right. Codes change every 30 seconds; try the current one." };
  }

  redirect("/settings?saved=mfa-on");
}

/**
 * Remove a factor.
 *
 * Guarded by a current code rather than by the password alone: someone holding
 * a borrowed session should not be able to strip the protection off an account
 * on their way to its contents.
 */
export async function disableMfaAction(
  _previous: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const code = normalizeTotpCode(String(formData.get("code") ?? ""));
  if (!code) return { error: "Enter a current code to turn two-factor authentication off." };

  await requireSession();
  const supabase = await createClient();

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp?.find((factor) => factor.status === "verified");
  if (!verified) return { error: "There is no authenticator to remove." };

  const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
    factorId: verified.id,
    code,
  });
  if (verifyError) {
    return { error: "That code was not right, so nothing was changed." };
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId: verified.id });
  if (error) return { error: `Could not remove it: ${error.message}` };

  redirect("/settings?saved=mfa-off");
}

/**
 * Turn the workspace requirement on or off.
 *
 * Owner only, and deliberately not something that can be switched on for other
 * people from a distance without consequence: the moment it is on, any owner or
 * finance member without a factor is locked out until they enrol. The screen
 * says so before it asks.
 */
export async function setMfaPolicyAction(
  _previous: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const required = String(formData.get("required") ?? "") === "on";

  const { organizationId, actorId } = await requireContext("workspace.settings");
  const supabase = await createClient();

  const { error } = await supabase
    .from("organizations")
    .update({ require_mfa: required })
    .eq("id", organizationId);

  if (error) return { error: `Could not change the policy: ${error.message}` };

  await supabase.from("activity_events").insert({
    organization_id: organizationId,
    actor_id: actorId,
    entity_type: "organization",
    entity_id: organizationId,
    action: "workspace.mfa_policy_changed",
    event_data: {
      summary: required
        ? "Two-factor required for owners and finance"
        : "Two-factor no longer required",
      required,
    },
  });

  redirect(required ? "/settings?saved=mfa-required" : "/settings?saved=mfa-optional");
}
