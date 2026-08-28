"use server";

import { redirect } from "next/navigation";
import { normalizeTotpCode, otpauthUri } from "@/lib/mfa";
import { type QrCode, qrCode } from "@/lib/qr.server";
import { hashRecoveryCode, newRecoveryCodes } from "@/lib/recovery-codes.server";
import { requireSession, requireSessionForEnrollment } from "@/lib/auth";
import { requireWorkspaceContext } from "@/lib/session-context";
import { workspaceContext } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/server";
import { workspaceRoutes } from "@/lib/workspace-routes";

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
  /** The same URI as something a camera can read. Absent if encoding failed. */
  readonly qr?: QrCode;
  readonly error?: string;
}

export interface ConfirmState {
  readonly ok?: boolean;
  readonly error?: string;
  /** Shown once, at the moment they are made. Never retrievable afterwards. */
  readonly codes?: readonly string[];
}

/**
 * Start enrolment: Supabase generates the secret and the otpauth URI.
 *
 * An unverified factor is left behind if someone abandons this halfway, so any
 * previous unverified attempt is cleared first rather than accumulating.
 */
export async function startEnrollmentAction(): Promise<EnrollState> {
  const session = await requireSessionForEnrollment();
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

  // Supabase's own URI when it sends one, ours from the same secret when it
  // does not. Both name the same factor; ours only differs in labelling the
  // entry "Mastline" in the authenticator's list rather than a project ref.
  const uri = data.totp.uri || otpauthUri({ secret: data.totp.secret, account: session.email });

  // A QR that cannot be drawn must not cost someone their enrolment: the typed
  // key below it still works, so a failure here is silent rather than fatal.
  let qr: QrCode | undefined;
  try {
    qr = await qrCode(uri);
  } catch {
    qr = undefined;
  }

  return { factorId: data.id, secret: data.totp.secret, uri, qr };
}

/**
 * Confirm enrolment with a code from the authenticator app.
 *
 * A factor is not in force until this succeeds, so a mistyped code costs
 * nothing and an abandoned setup leaves the account exactly as it was.
 */
export async function confirmEnrollmentAction(
  workspaceSlug: string,
  _previous: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const factorId = String(formData.get("factorId") ?? "");
  const code = normalizeTotpCode(String(formData.get("code") ?? ""));

  if (!factorId) return { error: "Start the setup again." };
  if (!code) return { error: "Enter the six-digit code from the authenticator app." };

  await requireSessionForEnrollment();
  const supabase = await createClient();

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    // A wrong code and an expired code are the same mistake to the person
    // typing: look at the app again and use the number showing now.
    return {
      error: "That code was not right. Codes change every 30 seconds; try the current one.",
    };
  }

  // Recovery codes are issued here rather than offered later, because the
  // moment someone has just locked their account to a device is the moment they
  // need a way back from losing it. Returned rather than redirected to, since
  // this is the only time they can be read.
  const issued = await generateRecoveryCodesAction();
  if (issued.error) return { ok: true, error: issued.error };
  return { ok: true, codes: issued.codes };
}

/**
 * Remove a factor.
 *
 * Guarded by a current code rather than by the password alone: someone holding
 * a borrowed session should not be able to strip the protection off an account
 * on their way to its contents.
 */
export async function disableMfaAction(
  workspaceSlug: string,
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

  // Resolved rather than echoed: the bound address is a hint, and this is the
  // one place in the function that builds a URL from it.
  const { canonicalSlug } = await workspaceContext(workspaceSlug);
  redirect(workspaceRoutes(canonicalSlug).settings({ query: { saved: "mfa-off" } }));
}

/**
 * Turn the workspace requirement on or off.
 *
 * Owner only, and deliberately not something that can be switched on for other
 * people from a distance without consequence: the moment it is on, any owner or
 * finance member without a factor is locked out until they enrol. The screen
 * says so before it asks.
 *
 * The one person that is not a fair warning to is the owner pressing the
 * button, who would be locked out by their own click before reading the
 * consequence. So the switch asks them to go first.
 */
export async function setMfaPolicyAction(
  workspaceSlug: string,
  _previous: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const required = String(formData.get("required") ?? "") === "on";

  const { organizationId, actorId, session, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "workspace.settings",
  );

  if (required && !session.hasVerifiedFactor) {
    return {
      error:
        "Set up your own authenticator first. Requiring it while your account has none would lock you out of this workspace on the next request.",
    };
  }

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

  // Resolved rather than bare: "/settings?saved=..." reached the right screen
  // only by way of the cookie-driven legacy redirect.
  redirect(
    workspaceRoutes(canonicalSlug).settings({
      query: { saved: required ? "mfa-required" : "mfa-optional" },
    }),
  );
}

export interface RecoveryCodesState {
  readonly codes?: readonly string[];
  readonly error?: string;
}

/**
 * Issue a fresh set of recovery codes.
 *
 * Any earlier set stops working, because a code someone wrote down two years
 * ago is a credential nobody is tracking. The plaintext is returned once, to be
 * shown once; only hashes are stored, each with a salt of its own.
 */
export async function generateRecoveryCodesAction(): Promise<RecoveryCodesState> {
  const session = await requireSessionForEnrollment();
  const supabase = await createClient();

  const codes = newRecoveryCodes();
  const rows = await Promise.all(
    codes.map(async (code) => {
      const { hash, salt } = await hashRecoveryCode(code);
      return { user_id: session.userId, code_hash: hash, salt };
    }),
  );

  // Replace rather than add: a set is a set.
  const { error: clearError } = await supabase
    .from("mfa_recovery_codes")
    .delete()
    .eq("user_id", session.userId);
  if (clearError) return { error: `Could not replace the old codes: ${clearError.message}` };

  const { error } = await supabase.from("mfa_recovery_codes").insert(rows);
  if (error) return { error: `Could not create recovery codes: ${error.message}` };

  return { codes };
}
