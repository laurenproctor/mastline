import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * A Supabase client for React Server Components, Server Actions, and Route
 * Handlers.
 *
 * It uses the anon key and the caller's session cookie, so every query runs as
 * the signed-in user and row level security applies. This is the client
 * essentially all application code should use.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The middleware refreshes the
          // session instead, so this is safe to ignore here.
        }
      },
    },
  });
}
