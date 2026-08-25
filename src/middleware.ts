import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isMarketing, isProtected } from "@/lib/routes";
import { COUNTRY_COOKIE } from "@/lib/consent";

/**
 * Refreshes the Supabase session on every request and gates the application.
 *
 * getUser() is used rather than getSession() because it revalidates the token
 * with the auth server; getSession() trusts whatever the cookie says.
 *
 * This is a convenience gate, not the security boundary. Row level security is
 * the boundary. A route that slipped past this matcher would still return
 * nothing to a caller with no membership.
 *
 * Which paths are gated and which are public marketing lives in @/lib/routes,
 * shared with robots.txt so the two cannot drift apart.
 */

/**
 * Stamps the visitor's country so the consent banner can decide whether to
 * appear.
 *
 * The geo header exists only at the edge, and reading it inside a layout would
 * turn every static marketing page dynamic. A cookie carries it to the client
 * instead: two letters, no identifier, gone with the session, and strictly
 * necessary for operating the consent mechanism itself.
 *
 * The header is absent in local development and for any request Vercel cannot
 * place, and the banner treats an unknown country as one that needs asking.
 */
function stampCountry(request: NextRequest, response: NextResponse): NextResponse {
  const country = request.headers.get("x-vercel-ip-country");
  if (country) {
    response.cookies.set(COUNTRY_COOKIE, country, {
      path: "/",
      sameSite: "lax",
      httpOnly: false,
    });
  }
  return response;
}

export async function middleware(request: NextRequest) {
  if (isMarketing(request.nextUrl.pathname)) {
    return stampCountry(request, NextResponse.next({ request }));
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

  if (!user && isProtected(pathname)) {
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
  if (user && isProtected(pathname)) {
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

  return stampCountry(request, response);
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets. Auth routes are
     * matched deliberately so the session cookie is refreshed there too.
     *
     * robots.txt, the sitemap, and the social cards are excluded because they
     * are crawler surface: there is no session to refresh on them, and every
     * request would otherwise cost a Supabase getUser() round trip. They are
     * generated statically and carry nothing session-dependent.
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|opengraph-image|twitter-image|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
