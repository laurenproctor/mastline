"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ACTIVE_WORKSPACE_COOKIE, requireUser } from "@/lib/auth";
import { ONBOARDING_VERSION, SALES_ENGINE_TERMS_VERSION } from "@/lib/onboarding";
import { TRIAL_DAYS, TRIAL_STORAGE_BYTES } from "@/lib/pricing";
import { PLAN_SEATS, TRIAL_PLAN } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/server";
import { type FieldErrors, type OnboardingInput, parseOnboarding } from "@/lib/validation";

export interface OnboardingState {
  readonly error?: string;
  readonly errors?: FieldErrors<OnboardingInput>;
}

/**
 * Create the first workspace, with what onboarding learned.
 *
 * The organization, the founding owner's membership, the trial dates, the
 * onboarding profile, and the activity events are written by one database
 * function, so there is no window where a workspace exists that nobody can
 * reach, and none where a workspace exists without the answers that shaped it.
 *
 * The function is idempotent on ownership, so a double-submitted form resolves
 * to the workspace that already exists rather than making a second one with a
 * second 30-day trial. That guard lives in the database because the interface
 * cannot win a race against itself.
 */
export async function createWorkspaceAction(
  _previous: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = parseOnboarding(formData);
  if (!parsed.ok) {
    return {
      error: "Some answers still need attention.",
      errors: parsed.errors,
    };
  }
  const input = parsed.value;

  await requireUser();
  const supabase = await createClient();

  // Consent is stamped by the database with its own clock. What travels here is
  // only which terms were on screen; `sales_engine_enabled_at` is not a value a
  // client gets to supply.
  const profile = {
    work_style: input.workStyle,
    base_city: input.baseCity,
    specialties: input.specialties,
    goals: input.goals,
    sales_engine_enabled: input.salesEngineEnabled,
    sales_engine_terms_version: input.salesEngineEnabled ? SALES_ENGINE_TERMS_VERSION : null,
    onboarding_version: ONBOARDING_VERSION,
  };

  /*
   * The address is the photographer's choice now, so a collision is reported
   * rather than worked around.
   *
   * This used to retry with a random suffix, which was right while the slug was
   * derived from the workspace name and nobody had seen it. It is the wrong
   * thing to do to an address somebody typed on a step of its own: quietly
   * handing them "hale-studio-k3f9" when they asked for "hale-studio" is a
   * decision about their own URL made without them.
   *
   * 23505 covers both senses of unavailable -- held by another workspace now,
   * or held by one at some point in the past, since an address is never
   * released. Which of the two it is is not something to tell somebody who is
   * not in that workspace, so both read the same way here.
   */
  const { data, error } = await supabase.rpc("create_workspace", {
    workspace_name: input.name,
    workspace_slug: input.workspaceSlug,
    workspace_timezone: input.timezone,
    trial_days: TRIAL_DAYS,
    trial_storage_bytes: TRIAL_STORAGE_BYTES,
    trial_seats: PLAN_SEATS[TRIAL_PLAN] ?? 1,
    onboarding_profile: profile,
  });

  if (error || !data) {
    if (error?.code === "23505") {
      return {
        error: "That workspace address is already taken.",
        errors: { workspaceSlug: "Choose a different address." },
      };
    }
    return { error: `Could not create the workspace: ${error?.message ?? "Unknown error"}` };
  }

  const organizationId = data as string;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  // Onboarding ends at the real first shoot, not a simulation of one. The
  // parameter lets that screen introduce itself to somebody who has never seen
  // it without duplicating any of the import system.
  redirect("/shoots/new?source=onboarding");
}
