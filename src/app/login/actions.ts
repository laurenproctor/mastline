"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { normalizeTotpCode } from "@/lib/mfa";
import { createClient } from "@/lib/supabase/server";

export interface SignInState {
  readonly error?: string;
}

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/work");

  if (!email || !password) {
    return { error: "Enter your email and password." };
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
    redirect(`/login/verify?next=${encodeURIComponent(destination)}`);
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
  if (!code) return { error: "Enter the six-digit code from your authenticator app." };

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((entry) => entry.status === "verified");
  if (!factor) redirect(next.startsWith("/") ? next : "/work");

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    return { error: "That code was not right. Codes change every 30 seconds; try the current one." };
  }

  revalidatePath("/", "layout");
  redirect(next.startsWith("/") ? next : "/work");
}
