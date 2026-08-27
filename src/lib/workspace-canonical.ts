/**
 * Sending an old workspace address to the current one.
 *
 * A workspace's address can change, and the promise made when it does is that
 * links already shared keep working. Keeping that promise means noticing that
 * `/hale-studio/shoots/abc?tab=assets` names an address the workspace used to
 * hold, and answering with the same path under the address it holds now.
 *
 * Two properties this has to get right, and both are why the decision lives
 * here rather than inline:
 *
 *   - The whole path survives. A workspace address is the first segment and
 *     nothing else: the asset id, the sub-page, the query a dispatch link
 *     carries are all downstream of it, and losing them turns a precise link
 *     into a landing page.
 *   - Nothing is disclosed. The addresses considered are only those of
 *     workspaces the caller is a member of, so a stranger guessing at a retired
 *     address learns nothing -- it is unknown to them, exactly as a made-up one
 *     would be.
 */

/** One workspace's addresses: the one it holds, and the ones it used to. */
export interface WorkspaceAddresses {
  readonly currentSlug: string;
  readonly historicalSlugs: readonly string[];
}

export type SlugStanding =
  /** The address is the one that workspace holds now. Nothing to do. */
  | { readonly standing: "current" }
  /** The workspace has moved. Send them on, preserving everything else. */
  | { readonly standing: "historical"; readonly currentSlug: string }
  /** Not an address this caller can resolve. Let the route 404 on its own. */
  | { readonly standing: "unknown" };

/**
 * Current addresses are checked before historical ones, deliberately.
 *
 * A workspace may return to an address it held before, at which point that
 * string is both its current address and one of its historical ones. Looking at
 * history first would answer "redirect to the current address" for a request
 * that is already there, and the browser would follow it back to itself for as
 * long as it had patience.
 */
export function slugStanding(
  requested: string,
  addresses: readonly WorkspaceAddresses[],
): SlugStanding {
  if (!requested) return { standing: "unknown" };

  for (const workspace of addresses) {
    if (workspace.currentSlug === requested) return { standing: "current" };
  }

  for (const workspace of addresses) {
    if (workspace.historicalSlugs.includes(requested)) {
      return { standing: "historical", currentSlug: workspace.currentSlug };
    }
  }

  return { standing: "unknown" };
}

/**
 * The leading segment of a workspace-scoped path, and everything after it.
 *
 * `rest` keeps its leading slash, or is empty for a bare `/<slug>`, so that
 * putting a path back together is concatenation rather than a special case.
 */
export interface WorkspacePath {
  readonly slug: string;
  readonly rest: string;
}

export function splitWorkspacePath(pathname: string): WorkspacePath | null {
  if (!pathname.startsWith("/")) return null;

  const withoutLeading = pathname.slice(1);
  if (!withoutLeading) return null;

  const boundary = withoutLeading.indexOf("/");
  if (boundary === -1) return { slug: withoutLeading, rest: "" };

  return {
    slug: withoutLeading.slice(0, boundary),
    rest: withoutLeading.slice(boundary),
  };
}

/** The same path under a different workspace address. */
export function withWorkspaceSlug(pathname: string, slug: string): string {
  const parts = splitWorkspacePath(pathname);
  if (!parts) return `/${slug}`;
  return `/${slug}${parts.rest}`;
}
