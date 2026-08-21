import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PASSWORD = process.env.SUPABASE_TEST_PASSWORD ?? "mastline-dev-password";

/** Seeded identities. Roles match supabase/seed.sql. */
export const USERS = {
  owner: "marcus@mastline.test",
  editor: "jordan@mastline.test",
  dispatcher: "dana@mastline.test",
  finance: "felix@mastline.test",
  rights: "rhea@mastline.test",
  viewer: "vera@mastline.test",
  otherOrgOwner: "nadia@northline.test",
} as const;

export type SeededUser = keyof typeof USERS;

export const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
export const ORG_B = "bbbbbbbb-0000-0000-0000-000000000002";

export const ORG_A_SHOOT = "a0000000-0000-0000-0000-0000000000c1";
export const ORG_A_ASSET = "a0000000-0000-0000-0000-0000000000d1";
export const ORG_A_ORIGINAL_VERSION = "a0000000-0000-0000-0000-0000000000e1";
export const ORG_A_PACKAGE_DELIVERED = "a0000000-0000-0000-0000-0000000000f1";
export const ORG_A_SUBMISSION = "a0000000-0000-0000-0000-00000000a001";
export const ORG_A_LICENSE_MASTLINE = "a0000000-0000-0000-0000-00000000b001";
export const ORG_A_PAYMENT = "a0000000-0000-0000-0000-00000000c001";

export const ORG_B_SHOOT = "b0000000-0000-0000-0000-0000000000c1";
export const ORG_B_ASSET = "b0000000-0000-0000-0000-0000000000d1";
export const ORG_B_PAYMENT = "b0000000-0000-0000-0000-00000000c001";
export const ORG_B_ORIGINAL_KEY =
  "bbbbbbbb-0000-0000-0000-000000000002/b0000000-0000-0000-0000-0000000000c1/NL_0820_0001.arw";
export const ORG_A_ORIGINAL_KEY =
  "aaaaaaaa-0000-0000-0000-000000000001/a0000000-0000-0000-0000-0000000000c1/MH_0819_0472.arw";

const cache = new Map<string, SupabaseClient>();

/** A client authenticated as one of the seeded users. */
export async function clientFor(user: SeededUser): Promise<SupabaseClient> {
  const cached = cache.get(user);
  if (cached) return cached;

  // A distinct storage key per user keeps the clients from sharing a session
  // slot, which otherwise logs a "multiple GoTrueClient instances" warning.
  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: `mastline-test-${user}` },
  });
  const { error } = await client.auth.signInWithPassword({
    email: USERS[user],
    password: PASSWORD,
  });
  if (error) throw new Error(`Could not sign in as ${user} (${USERS[user]}): ${error.message}`);

  cache.set(user, client);
  return client;
}

/** An unauthenticated client. Carries the anon key and no session. */
export function anonClient(): SupabaseClient {
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: "mastline-test-anon" },
  });
}

/** Bypasses RLS. Used only to arrange and inspect fixtures, never as a subject. */
export function serviceClient(): SupabaseClient {
  return createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: "mastline-test-service" },
  });
}

export function hasLocalSupabase(): boolean {
  return Boolean(ANON && SERVICE);
}
