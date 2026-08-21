"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export interface ResetState {
  readonly sent?: boolean;
  readonly error?: string;
}

/**
 * Send a password reset link.
 *
 * Always reports success, whatever happened. Confirming which addresses have
 * accounts turns this form into a way to enumerate a customer list.
 */
export async function requestResetAction(
  _previous: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };

  const headerList = await headers();
  const origin =
    headerList.get("origin") ??
    (headerList.get("host") ? `https://${headerList.get("host")}` : "http://localhost:3000");

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password/update`,
  });

  return { sent: true };
}

export interface UpdatePasswordState {
  readonly ok?: boolean;
  readonly error?: string;
}

const MIN_PASSWORD = 10;

/**
 * Set a new password.
 *
 * Requires the recovery session created by following the emailed link, so this
 * cannot be used to change a password without proving control of the mailbox.
 */
export async function updatePasswordAction(
  _previous: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (password.length < MIN_PASSWORD) {
    return { error: `Use at least ${MIN_PASSWORD} characters.` };
  }
  if (password !== confirm) return { error: "Those passwords do not match." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "That reset link has expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Could not update the password. Request a new link and try again." };

  return { ok: true };
}
