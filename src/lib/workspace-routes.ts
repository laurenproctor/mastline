import { WORKSPACE_SECTIONS, isWorkspaceSection } from "./routes";
import { splitWorkspacePath } from "./workspace-canonical";

/**
 * Every address inside a workspace, built in one place.
 *
 * The application used to hand-write its own paths -- `/shoots/${id}`,
 * `/dispatch/${id}?package=${id}`, `"/money"` -- and rely on the middleware to
 * put a workspace in front of them. That works only because the middleware has
 * something to guess with: the active-workspace cookie. A cookie is global to
 * the browser, so a page rendered for one workspace could send the next click
 * into another one that a second tab had switched to. The link looked right,
 * the destination was somebody else's studio, and nothing said so.
 *
 * So a path is no longer a string somebody writes. It is asked for by name,
 * from a builder that cannot be constructed without a workspace address, and
 * every destination it returns carries that address in its first segment. The
 * middleware's legacy redirect stays for bookmarks and links already shared;
 * nothing the application renders depends on it any more.
 *
 * What is deliberately NOT here: `/d/<token>`, `/sign-in`, `/auth/sign-out`,
 * the marketing pages, and `/api/...`. Those are not workspace-scoped and never
 * will be -- a delivery link is read by a buyer who has no workspace at all --
 * so putting an address in front of one would break it rather than fix it.
 */

/** Query values. `undefined` and `null` are dropped rather than serialised. */
export type RouteQuery = Readonly<Record<string, string | number | undefined | null>>;

export interface RouteOptions {
  readonly query?: RouteQuery;
  /** Without the leading "#". Never reaches the server; kept for anchors. */
  readonly hash?: string;
}

/** One path segment, cleaned of the slashes that would double up. */
function segment(value: string): string {
  return encodeURIComponent(String(value).replace(/^\/+|\/+$/g, ""));
}

function build(slug: string, parts: readonly string[], options?: RouteOptions): string {
  const cleaned = parts.map(segment).filter((part) => part.length > 0);
  const path = `/${[slug, ...cleaned].join("/")}`;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();

  return `${path}${search ? `?${search}` : ""}${options?.hash ? `#${options.hash}` : ""}`;
}

/**
 * The address a workspace holds, reduced to the one segment a path may use.
 *
 * A slug arriving with slashes, or empty, is a programming error rather than
 * bad input: this is only ever called with a `canonicalSlug` the database just
 * resolved. Failing loudly is the point -- returning `/work` for an empty slug
 * would put the application straight back on the cookie.
 */
function normalizeSlug(slug: string): string {
  const cleaned = String(slug ?? "").replace(/^\/+|\/+$/g, "");
  if (!cleaned || cleaned.includes("/")) {
    throw new Error(`Not a workspace address: ${JSON.stringify(slug)}`);
  }
  return encodeURIComponent(cleaned);
}

/**
 * Which package, on which shoot.
 *
 * Named rather than positional, because the bug this whole module exists to
 * prevent was exactly this confusion: `/dispatch/<packageId>` compiled, read
 * correctly, and 404ed, because the route's dynamic segment is a SHOOT id and
 * the package is chosen by query. Two strings in a row cannot say which is
 * which; two keys can.
 */
export interface DispatchTarget {
  readonly shootId: string;
  /** Optional: the review screen picks a sensible default without one. */
  readonly packageId?: string;
}

export interface WorkspaceRoutes {
  /** The address itself, for a bare link to the workspace. */
  readonly root: (options?: RouteOptions) => string;
  readonly work: (options?: RouteOptions) => string;
  readonly commercial: (options?: RouteOptions) => string;
  readonly opportunity: (opportunityId: string, options?: RouteOptions) => string;
  readonly news: (options?: RouteOptions) => string;
  readonly shoots: (options?: RouteOptions) => string;
  readonly newShoot: (options?: RouteOptions) => string;
  readonly shoot: (shootId: string, options?: RouteOptions) => string;
  readonly asset: (assetId: string, options?: RouteOptions) => string;
  readonly submissions: (options?: RouteOptions) => string;
  readonly submission: (submissionId: string, options?: RouteOptions) => string;
  /** The dispatch review. Keyed on the shoot; the package rides in the query. */
  readonly dispatch: (target: DispatchTarget, options?: RouteOptions) => string;
  readonly money: (options?: RouteOptions) => string;
  readonly archive: (options?: RouteOptions) => string;
  readonly rights: (options?: RouteOptions) => string;
  readonly settings: (options?: RouteOptions) => string;
  readonly billing: (options?: RouteOptions) => string;
  /** The route handler that opens Stripe's customer portal for this workspace. */
  readonly billingPortal: (options?: RouteOptions) => string;
  /** The address these routes are scoped to, already normalised. */
  readonly slug: string;
}

/**
 * The routes for one workspace.
 *
 * Pass the `canonicalSlug` from `workspaceContext()` or
 * `requireWorkspaceContext()`, never the slug that arrived in the request. A
 * request may land on an address the workspace used to hold; echoing it back
 * into a link sends the next click through the rename redirect again, and
 * echoing a slug that was never resolved at all would put a value the browser
 * supplied into a destination.
 */
export function workspaceRoutes(canonicalSlug: string): WorkspaceRoutes {
  const slug = normalizeSlug(canonicalSlug);

  return Object.freeze({
    slug,
    root: (options?: RouteOptions) => build(slug, [], options),
    work: (options?: RouteOptions) => build(slug, ["work"], options),
    commercial: (options?: RouteOptions) => build(slug, ["work", "commercial"], options),
    opportunity: (opportunityId: string, options?: RouteOptions) =>
      build(slug, ["work", "commercial", opportunityId], options),
    news: (options?: RouteOptions) => build(slug, ["news"], options),
    shoots: (options?: RouteOptions) => build(slug, ["shoots"], options),
    newShoot: (options?: RouteOptions) => build(slug, ["shoots", "new"], options),
    shoot: (shootId: string, options?: RouteOptions) => build(slug, ["shoots", shootId], options),
    asset: (assetId: string, options?: RouteOptions) => build(slug, ["assets", assetId], options),
    submissions: (options?: RouteOptions) => build(slug, ["submissions"], options),
    submission: (submissionId: string, options?: RouteOptions) =>
      build(slug, ["submissions", submissionId], options),
    dispatch: (target: DispatchTarget, options?: RouteOptions) =>
      build(slug, ["dispatch", target.shootId], {
        ...options,
        query: { ...(target.packageId ? { package: target.packageId } : {}), ...options?.query },
      }),
    money: (options?: RouteOptions) => build(slug, ["money"], options),
    archive: (options?: RouteOptions) => build(slug, ["archive"], options),
    rights: (options?: RouteOptions) => build(slug, ["rights"], options),
    settings: (options?: RouteOptions) => build(slug, ["settings"], options),
    billing: (options?: RouteOptions) => build(slug, ["billing"], options),
    billingPortal: (options?: RouteOptions) => build(slug, ["billing", "portal"], options),
  });
}

/**
 * The workspace a path is already inside, or null.
 *
 * For the two screens that have no params to read one from -- the error
 * boundary and the not-found page -- and that would otherwise have to fall back
 * on the cookie. The URL is still the answer; it just arrives through
 * `usePathname()` instead of through `params`.
 */
export function workspaceSlugFromPathname(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const parts = splitWorkspacePath(pathname);
  if (!parts || !isWorkspaceSection(parts.rest)) return null;
  return parts.slug;
}

/**
 * Paths that are correct without a workspace in front of them.
 *
 * This exists so the link-coverage guard can tell "not scoped" from "not
 * scopeable". A delivery link is read by a buyer with no workspace, sign-in
 * happens before there is one to name, and `/api/...` is a machine surface with
 * its own structure.
 */
export const PUBLIC_PATH_PREFIXES = [
  "/d/",
  "/sign-in",
  "/sign-up",
  "/signup",
  "/login",
  "/auth/",
  "/reset-password",
  "/onboarding",
  "/secure-your-account",
  "/welcome",
  "/api/",
  "/workspace",
] as const;

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) =>
    prefix.endsWith("/")
      ? path.startsWith(prefix)
      : path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Every workspace section reachable through this builder.
 *
 * Compared against WORKSPACE_SECTIONS in the tests, so a section added to the
 * middleware's idea of a workspace path cannot be one the application has no
 * way to link to.
 */
export const ROUTED_SECTIONS: readonly (typeof WORKSPACE_SECTIONS)[number][] = WORKSPACE_SECTIONS;
