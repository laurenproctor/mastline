import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out. POST only, so a prefetch or an image tag cannot end a session.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
