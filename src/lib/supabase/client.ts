"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * A Supabase client for client components.
 *
 * Anon key only. Row level security is the authorization boundary; nothing here
 * is trusted.
 */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
