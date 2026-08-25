import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refreshes the Supabase session on every request and gates the application.
 *
 * getUser() is used rather than getSession() because it revalidates the token
 * with the auth server; getSession() trusts whatever the cookie says.
 *
 * This is a convenience gate, not the security boundary. Row level security is
 * the boundary. A route that slipped past this matcher would still return
 * nothing to a caller with no membership.
 */

const MARKETING_ROUTES = [
  "/",
  "/welcome",
  "/pricing",
  "/product",
  "/how-it-works",
  "/trust",
  "/company",
  "/early-access",
  "/teams",
  "/commercial",
  "/editors",
  "/press",
  "/copyright",
  "/subjects",
  "/acceptable-use",
  "/privacy",
  "/terms",
  "/security",
  "/accessibility",
];

/**
 * Routes that do not require a session.
 *
 * /api/webhooks is here because an inbound provider callback has no session to
 * present. It is NOT unauthenticated: the handler verifies an HMAC signature
 * and refuses outright when no secret is configured. Everything else under
 * /api stays gated -- /api/export in particular must never be public.
 */
const PUBLIC_ROUTES = [
  "/sign-in",
  "/sign-up",
  // The addresses these two used to have. They only redirect, but they have to
  // be reachable without a session to do it, or somebody following an old
  // bookmark is bounced through a sign-in they may not need.
  "/login",
  "/signup",
  "/reset-password",
  "/auth",
  "/api/webhooks",
  // A delivery link is held by a picture desk with no account. The token is the
  // credential, and the security-definer functions behind the page check it
  // before returning anything.
  "/d",
  // Every marketing page is public by definition.
  ...MARKETING_ROUTES,
];

function isPublic(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * The public marketing site: pages that never vary by who is looking.
 *
 * These are served before a Supabase client is built, so the public site does
 * not depend on the database being reachable or the environment being
 * configured. A missing key should cost you the application, not the front
 * door -- previously it returned MIDDLEWARE_INVOCATION_FAILED for every route,
 * including these.
 *
 * /login and /signup are deliberately NOT here: they redirect an already
 * signed-in visitor onward, which needs the session.
 */

function isMarketing(pathname: string): boolean {
  return MARKETING_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export async function middleware(request: NextRequest) {
  if (isMarketing(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    // Come back here after signing in.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // A second factor that could be walked around by typing an address would not
  // be a second factor. The assurance level comes from the token itself, so
  // this costs no round trip: aal1 with aal2 expected means the password was
  // accepted and the code has not been.
  if (user && !isPublic(pathname)) {
    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in/verify";
      url.search = "";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  // Somebody already signed in has no use for the sign-in or sign-up screens.
  if (user && (pathname === "/sign-in" || pathname === "/sign-up")) {
    const url = request.nextUrl.clone();
    url.pathname = "/work";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets. Auth routes are
     * matched deliberately so the session cookie is refreshed there too.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
