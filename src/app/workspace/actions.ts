"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Switch the active workspace.
 *
 * The cookie is only a preference. Membership is verified here, and every query
 * is still constrained by row level security, so a forged cookie selects
 * nothing rather than granting anything.
 */
export async function switchWorkspace(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organizationId") ?? "");

  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (!data) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
}
