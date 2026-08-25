"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { normalizeTotpCode } from "@/lib/mfa";
import { normalizeRecoveryCode } from "@/lib/recovery-codes";
import { recoveryCodeMatches } from "@/lib/recovery-codes.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface SignInState {
  readonly error?: string;
}

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/work");

  if (!email || !password) {
    return { error: "Enter an email address and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately not distinguishing "no such account" from "wrong password".
    return { error: "That email and password did not match an account." };
  }

  // A password alone is not a session when a second factor is enrolled. The
  // assurance level says so: signInWithPassword leaves it at aal1 and Supabase
  // reports that aal2 is expected, so send them to the challenge rather than on
  // to the workspace.
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const destination = next.startsWith("/") ? next : "/work";

  revalidatePath("/", "layout");

  if (assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
    redirect(`/sign-in/verify?next=${encodeURIComponent(destination)}`);
  }

  redirect(destination);
}

export interface ChallengeState {
  readonly error?: string;
}

/**
 * The second step of signing in.
 *
 * Failure says only that the code was wrong. Which factor, how many attempts
 * remain, and whether the account exists are all things an attacker would like
 * to learn from this screen.
 */
export async function verifySignIn(
  _previous: ChallengeState,
  formData: FormData,
): Promise<ChallengeState> {
  const code = normalizeTotpCode(String(formData.get("code") ?? ""));
  const next = String(formData.get("next") ?? "/work");
  if (!code) return { error: "Enter the six-digit code from the authenticator app." };

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((entry) => entry.status === "verified");
  if (!factor) redirect(next.startsWith("/") ? next : "/work");

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    return {
      error: "That code was not right. Codes change every 30 seconds; try the current one.",
    };
  }

  revalidatePath("/", "layout");
  redirect(next.startsWith("/") ? next : "/work");
}

/**
 * Sign in with a recovery code, when the authenticator is gone.
 *
 * A code cannot raise the session to aal2 -- only a real verification does that
 * -- so it does the honest thing instead: it proves who is asking, the factor
 * comes off, and they are in and asked to enrol again. That is what the code is
 * for, and the screen says so before it is used rather than after.
 *
 * The code is spent whether or not the rest succeeds. A code that could be
 * tried repeatedly is not single use.
 */
export async function verifyWithRecoveryCode(
  _previous: ChallengeState,
  formData: FormData,
): Promise<ChallengeState> {
  const code = normalizeRecoveryCode(String(formData.get("code") ?? ""));
  const next = String(formData.get("next") ?? "/work");
  if (!code) return { error: "Enter one of the saved recovery codes." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: stored } = await supabase
    .from("mfa_recovery_codes")
    .select("id, code_hash, salt")
    .eq("user_id", user.id)
    .is("used_at", null);

  let matchedId: string | null = null;
  for (const row of stored ?? []) {
    // Every unused code is checked, rather than stopping at the first miss, so
    // the time taken says nothing about which one was close.
    const matches = await recoveryCodeMatches(code, {
      hash: row.code_hash as string,
      salt: row.salt as string,
    });
    if (matches && matchedId === null) matchedId = row.id as string;
  }

  if (matchedId === null) {
    return { error: "That code was not recognised, or it has already been used." };
  }

  await supabase
    .from("mfa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", matchedId);

  // Removing the factor needs more than this session has: it is still aal1,
  // which is the whole reason we are here.
  const admin = createAdminClient();
  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  for (const factor of factors?.factors ?? []) {
    await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.id });
  }

  // The token still says a second factor is expected: assurance is baked into
  // it, and deleting the factor server-side does not reach back into a session
  // already issued. Without this refresh the next request is bounced straight
  // to the challenge that was just recovered from.
  await supabase.auth.refreshSession();

  revalidatePath("/", "layout");
  redirect(`${next.startsWith("/") ? next : "/work"}?recovered=1`);
}
