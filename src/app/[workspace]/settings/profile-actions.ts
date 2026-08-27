"use server";

import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * A person's own name and face.
 *
 * Every action here works on the caller's own profile row and on objects under
 * their own prefix in the avatars bucket. There is deliberately no path to edit
 * anyone else's: a workspace owner who could change a colleague's face would be
 * impersonating them, not administering them.
 *
 * The image itself is uploaded straight from the browser, the same way an
 * original is, because the storage policy already limits a caller to their own
 * prefix. What these actions own is the record of which object is current, and
 * the removal of the one it replaced.
 */

export interface ProfileState {
  readonly ok?: boolean;
  readonly error?: string;
}

/** Where this user's next avatar goes. The prefix is what the policy checks. */
export async function avatarUploadKeyAction(): Promise<{ key: string }> {
  const session = await requireSession();
  // A new key per upload rather than a fixed name: a CDN or a browser holding
  // the previous image would otherwise keep showing a face that was replaced.
  const token = crypto.randomUUID().replace(/-/g, "");
  return { key: `${session.userId}/${token}.jpg` };
}

/**
 * Point the profile at a newly uploaded object, and drop the old one.
 *
 * The row is updated before the old file is removed. If the removal fails the
 * result is one orphaned object, which costs a few kilobytes; doing it the
 * other way round risks a profile pointing at something already deleted.
 */
export async function setAvatarAction(
  workspaceSlug: string,
  key: string,
): Promise<ProfileState> {
  const session = await requireSession();

  if (!key.startsWith(`${session.userId}/`)) {
    return { error: "That image was not uploaded to your own account." };
  }

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", session.userId)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_path: key })
    .eq("id", session.userId);

  if (error) return { error: `Could not save the photo: ${error.message}` };

  const previous = existing?.avatar_path as string | null | undefined;
  if (previous && previous !== key) {
    await supabase.storage.from("avatars").remove([previous]);
  }

  const { canonicalSlug } = await workspaceContext(workspaceSlug);
  revalidatePath(workspaceRoutes(canonicalSlug).settings());
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Take the photo off, and delete the object behind it. */
export async function removeAvatarAction(workspaceSlug: string): Promise<ProfileState> {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", session.userId)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_path: null })
    .eq("id", session.userId);

  if (error) return { error: `Could not remove the photo: ${error.message}` };

  const previous = existing?.avatar_path as string | null | undefined;
  if (previous) await supabase.storage.from("avatars").remove([previous]);

  const { canonicalSlug } = await workspaceContext(workspaceSlug);
  revalidatePath(workspaceRoutes(canonicalSlug).settings());
  revalidatePath("/", "layout");
  return { ok: true };
}
