"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface SignUpState {
  readonly error?: string;
  readonly checkEmail?: boolean;
  readonly email?: string;
}

const MIN_PASSWORD = 10;

/**
 * Create an account.
 *
 * Deliberately does not create a workspace: the next screen does that, so the
 * person names their studio rather than having one named for them.
 *
 * Whether a confirmation email is required depends on the Supabase project's
 * settings, so both outcomes are handled -- a session straight away, or a
 * "check your email" state.
 */
export async function signUpAction(
  _previous: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();

  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };
  if (password.length < MIN_PASSWORD) {
    return { error: `Use at least ${MIN_PASSWORD} characters for your password.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: fullName ? { full_name: fullName } : {} },
  });

  if (error) {
    // Deliberately generic. Telling an anonymous caller which addresses already
    // have accounts is a way to enumerate a customer list.
    return { error: "That account could not be created. Try a different email address." };
  }

  if (!data.session) {
    return { checkEmail: true, email };
  }

  revalidatePath("/", "layout");
  redirect("/onboarding");
}
