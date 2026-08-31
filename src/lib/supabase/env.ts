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

/**
 * Where a resumable upload is created.
 *
 * Supabase asks for the direct storage hostname rather than the API gateway:
 * https://<project>.storage.supabase.co/storage/v1/upload/resumable. Uploads
 * sent through the gateway work but are routed further, and the documentation
 * is explicit that this is the address to use.
 *
 * The project reference is taken from the public URL that is already configured
 * rather than written down a second time. A project id in the source would be
 * one more thing to change per environment and one more thing to get wrong: the
 * preview deployment would happily upload to production.
 *
 * Anything that is not a Supabase-hosted hostname -- a local stack on
 * 127.0.0.1, a self-hosted instance behind its own domain -- keeps its own
 * origin, because there is no separate storage host to move to.
 */
const SUPABASE_HOSTNAME = /^([a-z0-9-]{1,63})\.supabase\.(co|in|red|net)$/;

export function resumableUploadEndpoint(url: string = supabaseUrl()): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a URL.");
  }

  const match = SUPABASE_HOSTNAME.exec(parsed.hostname);
  if (match) {
    return `https://${match[1]}.storage.supabase.${match[2]}/storage/v1/upload/resumable`;
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}/storage/v1/upload/resumable`;
}
