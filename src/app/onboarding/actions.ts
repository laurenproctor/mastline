"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ACTIVE_WORKSPACE_COOKIE, requireUser } from "@/lib/auth";
import { TRIAL_DAYS, TRIAL_STORAGE_BYTES } from "@/lib/pricing";
import { PLAN_SEATS, TRIAL_PLAN } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/server";
import { slugifyWorkspace } from "@/lib/validation";

export interface OnboardingState {
  readonly error?: string;
}

/**
 * Create the first workspace.
 *
 * The organization, the founding owner's membership, the trial dates, and the
 * activity event are written by one database function, so there is no window
 * where a workspace exists that nobody can reach.
 */
export async function createWorkspaceAction(
  _previous: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "America/New_York");

  if (!name) return { error: "Give the workspace a name." };
  if (name.length > 120) return { error: "Keep the name under 120 characters." };

  await requireUser();
  const supabase = await createClient();

  // The slug has to be unique across every workspace, so a collision retries
  // with a suffix rather than failing in front of someone on their first screen.
  let organizationId: string | null = null;
  let lastError = "";

  for (let attempt = 0; attempt < 4 && !organizationId; attempt += 1) {
    const slug =
      attempt === 0
        ? slugifyWorkspace(name)
        : `${slugifyWorkspace(name)}-${Math.random().toString(36).slice(2, 6)}`;

    const { data, error } = await supabase.rpc("create_workspace", {
      workspace_name: name,
      workspace_slug: slug,
      workspace_timezone: timezone,
      trial_days: TRIAL_DAYS,
      trial_storage_bytes: TRIAL_STORAGE_BYTES,
      trial_seats: PLAN_SEATS[TRIAL_PLAN] ?? 1,
    });

    if (!error && data) {
      organizationId = data as string;
      break;
    }
    lastError = error?.message ?? "Unknown error";
    if (!lastError.includes("duplicate key")) break;
  }

  if (!organizationId) {
    return { error: `Could not create the workspace: ${lastError}` };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  redirect("/work");
}
