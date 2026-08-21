import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseServiceRoleKey, supabaseUrl } from "./env";

/**
 * A Supabase client that bypasses row level security.
 *
 * `server-only` makes importing this from a client component a build error.
 *
 * Legitimate uses are narrow: processing an inbound webhook before a user
 * session exists, and writing system activity events whose actor is null. Every
 * caller must scope its own queries by organization_id, because the database
 * will not do it for you here.
 */
export function createAdminClient() {
  return createSupabaseClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
