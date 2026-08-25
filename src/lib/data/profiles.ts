import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id } from "../domain";
import { createClient } from "../supabase/server";

/**
 * Names and faces.
 *
 * `public.profiles` is the readable half of an identity: the part a colleague
 * in a shared workspace is allowed to see. Row level security decides who that
 * is, so nothing here filters by organization -- a select that returns a row
 * has already been authorised.
 *
 * Avatar objects live in a private bucket, so what reaches a screen is always a
 * short-lived signed URL minted here. A public bucket would have been simpler
 * and would have left every photographer's face at a guessable address.
 */

/** Long enough to render and be reused across a page, short enough to expire. */
const AVATAR_URL_TTL_SECONDS = 600;

export interface Profile {
  readonly userId: Id;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly email?: string;
  readonly avatarPath?: string;
}

function toProfile(row: {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_path: string | null;
}): Profile {
  return {
    userId: row.id,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
    email: row.email ?? undefined,
    avatarPath: row.avatar_path ?? undefined,
  };
}

const COLUMNS = "id, first_name, last_name, email, avatar_path";

/** One profile, or null when it is not visible to the caller. */
export async function getProfile(userId: Id, client?: SupabaseClient): Promise<Profile | null> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("profiles")
    .select(COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return toProfile(data);
}

/** Several profiles at once, keyed by user id. Absent ids are simply not there. */
export async function getProfiles(
  userIds: readonly Id[],
  client?: SupabaseClient,
): Promise<Map<Id, Profile>> {
  if (userIds.length === 0) return new Map();

  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("profiles")
    .select(COLUMNS)
    .in("id", [...userIds]);

  if (error || !data) return new Map();
  return new Map(data.map((row) => [row.id as string, toProfile(row)]));
}

/**
 * Signed URLs for a set of avatar keys, keyed by the key that produced them.
 *
 * Batched in one call, the same shape as the signing helper the import path
 * uses, because People & permissions asks for every member of a workspace at
 * once and a round trip per face would be absurd.
 */
export async function signAvatarUrls(
  paths: readonly string[],
  client?: SupabaseClient,
): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter(Boolean))];
  if (wanted.length === 0) return new Map();

  const supabase = client ?? (await createClient());
  const { data, error } = await supabase.storage
    .from("avatars")
    .createSignedUrls(wanted, AVATAR_URL_TTL_SECONDS);

  // A face that cannot be signed is a face that does not render. It is never a
  // reason to fail the page it was going to sit on.
  if (error || !data) return new Map();

  const signed = new Map<string, string>();
  for (const entry of data) {
    if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
  }
  return signed;
}

/** The signed URL for one avatar, or undefined. */
export async function signAvatarUrl(
  path: string | undefined,
  client?: SupabaseClient,
): Promise<string | undefined> {
  if (!path) return undefined;
  return (await signAvatarUrls([path], client)).get(path);
}
