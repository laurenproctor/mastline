/**
 * The route classifications shared by the middleware gate, robots.txt, and the
 * tests that keep both honest.
 *
 * These lists live here rather than inside the middleware so that a route added
 * to one consumer cannot quietly disagree with another: the same names decide
 * what is gated, what search engines are told to skip, and what the sitemap
 * test expects to be absent.
 */

/**
 * The public marketing site: pages that never vary by who is looking.
 *
 * These are served before a Supabase client is built, so the public site does
 * not depend on the database being reachable or the environment being
 * configured. A missing key should cost you the application, not the front
 * door.
 */
export const MARKETING_ROUTES = [
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
 * The areas that require a session.
 *
 * This is deliberately an allowlist of what is GATED rather than a list of what
 * is public. The inverse -- redirect anything not recognised -- meant an
 * address matching no route at all counted as protected, so a signed-out
 * visitor who mistyped a URL was sent to /sign-in instead of the 404 page. An
 * unknown path has to fall through to Next for not-found.tsx to render.
 *
 * A route missing from this list costs a redirect, not a disclosure. Row level
 * security is the boundary: a gated page reached without membership still
 * returns nothing.
 */
export const PROTECTED_ROUTES = [
  "/archive",
  "/assets",
  "/billing",
  "/dispatch",
  "/money",
  "/news",
  "/onboarding",
  "/rights",
  "/secure-your-account",
  "/settings",
  "/shoots",
  "/submissions",
  "/work",
  "/workspace",
  // The API surface stays deny-by-default. It is a machine surface with no 404
  // page to show, so a handler added later is gated until somebody decides
  // otherwise, and /api/export in particular must never be public.
  "/api",
];

/**
 * The one carve-out inside /api: an inbound provider callback has no session to
 * present. It is NOT unauthenticated -- the handler verifies an HMAC signature
 * and refuses outright when no secret is configured.
 */
export const PROTECTED_EXCEPTIONS = ["/api/webhooks"];

export function matches(pathname: string, routes: string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function isProtected(pathname: string): boolean {
  return matches(pathname, PROTECTED_ROUTES) && !matches(pathname, PROTECTED_EXCEPTIONS);
}

export function isMarketing(pathname: string): boolean {
  return matches(pathname, MARKETING_ROUTES);
}
