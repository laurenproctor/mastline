/**
 * Environment access for Supabase.
 *
 * The service role key is read through a function that throws if it is ever
 * reached from a browser bundle. Reading it at module scope would let a stray
 * client import pull the value into the bundle graph.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabaseAnonKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * The service role key bypasses row level security completely.
 *
 * Only trusted server code may call this: webhook handlers, and the admin paths
 * that write system activity events. Never a Server Action that acts on behalf
 * of a signed-in user, and never a client component.
 */
export function supabaseServiceRoleKey(): string {
  if (typeof window !== "undefined") {
    throw new Error("The Supabase service role key must never be read in the browser.");
  }
  return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}
