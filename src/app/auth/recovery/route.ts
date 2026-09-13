import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasRecoverySession } from "@/app/reset-password/recovery-session";

/**
 * Where a recovery email lands.
 *
 * This route exists because the emailed link cannot go straight to the screen
 * that asks for a new password. Verified against the installed stack
 * (@supabase/ssr 0.7.0, @supabase/auth-js 2.112.3, gotrue v2.195.0): the mail
 * carries a link to the auth server's own /auth/v1/verify, and following it
 * 303s back here with a single-use authorization code in the query string --
 *
 *     /auth/recovery?code=<authorization code>
 *
 * That code is not a session. Something has to spend it, and spending it writes
 * auth cookies, which a Server Component is not allowed to do. A page as the
 * redirect target therefore renders a password form over no session at all,
 * which is exactly what this flow did before: the form appeared, looked
 * healthy, and could not have worked.
 *
 * PKCE rather than the token_hash/verifyOtp arrangement in Supabase's guide,
 * and the choice is not ours to make: @supabase/ssr pins `flowType: "pkce"`
 * after its options spread, so every client this repository builds is a PKCE
 * client, and `resetPasswordForEmail` accordingly sends a code challenge. The
 * verifier is held in the caller's own cookies. token_hash links are what the
 * *default* email template emits for a non-PKCE client; this project's mail
 * demonstrably carries `token=pkce_...` and comes back as `?code=`. Implementing
 * both would mean shipping one path nothing exercises.
 */

/**
 * The Location is relative, and the cache header is not decoration.
 *
 * Relative for the reason /auth/sign-out already documents: an absolute URL
 * built from the request would name whatever host the server believes it is,
 * which behind a proxy is not the host the browser used, and the redirect would
 * land on an origin holding none of this person's cookies -- including the code
 * verifier this whole exchange depends on.
 *
 * No-store because the URL that reached this handler carries a credential in
 * its query string. Nothing between here and the browser should keep a copy.
 */
function see(path: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: path, "Cache-Control": "private, no-store" },
  });
}

const CHOOSE_PASSWORD = "/reset-password/update";

/**
 * Every refusal lands in the same place, saying the same thing.
 *
 * Expired, already spent, malformed, absent, or a code for some other kind of
 * flow: the person who needs this screen can do exactly one thing about any of
 * them, which is ask for a fresh link. Distinguishing the causes on screen
 * would tell somebody probing the endpoint which of their guesses was closest.
 */
const REFUSED = "/reset-password?link=invalid";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // A spent or expired link does not come back with a code. The auth server
  // redirects here with error parameters instead -- verified: a link followed
  // twice returns `error=access_denied&error_code=otp_expired`.
  if (params.has("error") || params.has("error_code")) return see(REFUSED);

  const code = params.get("code");
  if (!code) return see(REFUSED);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  // Nothing from the failure is repeated to the caller or written anywhere: the
  // messages name whether a flow state existed, which is a probing oracle, and
  // the code itself must not reach a log.
  if (error) return see(REFUSED);

  /*
   * The exchange succeeding is not proof this was a recovery.
   *
   * Any PKCE authorization code the caller can obtain would be spent here, and
   * a session for one is now established. Requiring the auth server's own
   * `recovery` stamp before continuing means a code minted by some other flow
   * cannot be walked through the password-reset screen, and the session it
   * created does not outlive the attempt.
   */
  if (!(await hasRecoverySession(supabase))) {
    await supabase.auth.signOut({ scope: "local" });
    return see(REFUSED);
  }

  return see(CHOOSE_PASSWORD);
}
