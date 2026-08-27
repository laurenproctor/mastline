"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { workspaceRoutes } from "@/lib/workspace-routes";

/**
 * Switch to another workspace.
 *
 * Now that the workspace is in the URL, switching is a navigation: this sets
 * the hint and sends the browser to the other workspace's address, and it is
 * that address -- not the cookie -- which decides what the next page reads and
 * writes. The cookie survives only to answer "where was I?" for a legacy path
 * or a bare sign-in, which is why it holds an id rather than a slug: an id
 * outlives a rename.
 *
 * Membership is verified here, and row level security constrains every query
 * underneath, so a forged organization id selects nothing rather than granting
 * anything.
 */
export async function switchWorkspace(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organizationId") ?? "");

  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("organization_id, organizations(slug)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (!data) return;

  const slug = (data.organizations as unknown as { slug: string } | null)?.slug;
  if (!slug) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  redirect(workspaceRoutes(slug).work());
}
