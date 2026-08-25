import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * The old sign-out address, kept because a tab left open on the previous build
 * still posts here, and a 404 would leave somebody signed in who asked not to
 * be. It ends the session itself rather than redirecting: a 303 turns a POST
 * into a GET, and the real handler is POST-only on purpose.
 */
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return new NextResponse(null, { status: 303, headers: { Location: "/sign-in" } });
}
