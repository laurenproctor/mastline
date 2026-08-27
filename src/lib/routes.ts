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

/** Where a sign-in lands when it was not sent anywhere in particular. */
export const DEFAULT_SIGNED_IN_PATH = "/work";

/**
 * A base that exists only to be compared against. Nothing is fetched from it,
 * and it is deliberately not the real site: the question is whether a value
 * stays on whatever origin it is resolved against, not whether it matches a
 * hostname this code would have to keep in step with the deployment.
 */
const INTERNAL_BASE = "https://internal.invalid";

/**
 * A `?next=` value, reduced to somewhere on this site or thrown away.
 *
 * `next` is attacker-supplied. It arrives in a query string, survives a form
 * post through two hidden inputs, and ends at `redirect()`, so whatever it says
 * is where a freshly signed-in person is sent. The test it used to face was
 * `startsWith("/")`, which `//evil.com` passes: a protocol-relative URL is
 * absolute, the browser reads it as `https://evil.com`, and the redirect leaves
 * the site entirely -- with the credentials just typed still on screen behind
 * it. That is the whole open-redirect trick, and one character of prefix is all
 * that separated it from a legitimate path.
 *
 * So this does not pattern-match for badness. It parses the value against a
 * throwaway origin and demands the result still be on that origin, which is
 * the only test that stays true as the ways of writing a URL multiply:
 * backslashes that some browsers fold into slashes, `%2F%2Fevil.com`, embedded
 * credentials, tabs and newlines inside the scheme. Anything that resolves off
 * the origin, or fails to parse at all, is discarded rather than repaired --
 * a `next` we cannot read is not worth guessing at.
 *
 * Path and query are both preserved, because a dispatch link carries
 * `?package=...` and losing it lands somebody on the wrong screen after they
 * sign in. The fragment is dropped: it never reaches the server anyway.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return DEFAULT_SIGNED_IN_PATH;

  // A scheme-relative or absolute URL is rejected before parsing rather than
  // after, so no ambiguity about the base can make it look internal.
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_SIGNED_IN_PATH;

  // Backslashes are folded to slashes by some browsers, so "/\evil.com" would
  // become "//evil.com" after this function had already approved it.
  if (value.includes("\\")) return DEFAULT_SIGNED_IN_PATH;

  // Control characters -- the tab, newline and carriage return that can split a
  // scheme apart, and the NUL that can truncate one -- never belong in a path
  // this application generated.
  if (/[\u0000-\u001F\u007F]/.test(value)) return DEFAULT_SIGNED_IN_PATH;

  let url: URL;
  try {
    url = new URL(value, INTERNAL_BASE);
  } catch {
    return DEFAULT_SIGNED_IN_PATH;
  }

  // The parse is what catches the encoded forms: whatever "/%2F%2Fevil.com"
  // decodes to, it either stays on this origin or it does not.
  if (url.origin !== INTERNAL_BASE) return DEFAULT_SIGNED_IN_PATH;

  return `${url.pathname}${url.search}`;
}

export function isProtected(pathname: string): boolean {
  return matches(pathname, PROTECTED_ROUTES) && !matches(pathname, PROTECTED_EXCEPTIONS);
}

export function isMarketing(pathname: string): boolean {
  return matches(pathname, MARKETING_ROUTES);
}
