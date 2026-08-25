import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out. POST only, so a prefetch or an image tag cannot end a session.
 *
 * The Location is relative on purpose. Building it with `new URL("/sign-in",
 * request.url)` sends the browser to whatever host the server thinks it is
 * running on, which is not always the host the person is actually using: behind
 * a proxy, or on a machine reached as 127.0.0.1 while the server calls itself
 * localhost, that lands them on a different origin with none of their cookies.
 * A relative Location is resolved by the browser against the address it asked
 * for, which is the one that matters.
 */
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return new NextResponse(null, { status: 303, headers: { Location: "/sign-in" } });
}
