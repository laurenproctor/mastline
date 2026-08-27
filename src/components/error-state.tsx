"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/routes";
import { workspaceRoutes, workspaceSlugFromPathname } from "@/lib/workspace-routes";

/**
 * The way out, scoped to the workspace the broken page was in.
 *
 * An error boundary has no `params` to read a workspace from, so this used to
 * link to a bare "/work" and let the middleware pick one from the cookie --
 * which, with a second workspace open in another tab, is how somebody
 * recovering from an error ended up somewhere else entirely. The URL still
 * answers the question; it just arrives through usePathname().
 *
 * A null pathname (there is none during a static prerender of the error page)
 * falls back to the legacy path, which is what the middleware is still there
 * for. That is a fallback, not the normal case.
 */
function useWorkspaceExit(): { href: string; settingsHref: string } {
  const slug = workspaceSlugFromPathname(usePathname());
  if (!slug) return { href: DEFAULT_SIGNED_IN_PATH, settingsHref: "/settings" };
  const routes = workspaceRoutes(slug);
  return { href: routes.work(), settingsHref: routes.settings() };
}

export function useErrorExits() {
  return useWorkspaceExit();
}

/**
 * What a person sees when something breaks.
 *
 * Three things matter more than the error itself: that their work is safe, that
 * there is something to try, and that there is a way out. A stack trace serves
 * none of those, so the message stays plain and the digest is offered quietly
 * for when someone needs to report it.
 */
export function ErrorState({
  title,
  detail,
  digest,
  onRetry,
  backHref,
  backLabel = "Back to the work queue",
}: {
  title: string;
  detail: string;
  digest?: string;
  onRetry?: () => void;
  /** Defaults to the work queue of the workspace the URL names. */
  backHref?: string;
  backLabel?: string;
}) {
  const exits = useWorkspaceExit();
  const destination = backHref ?? exits.href;
  return (
    <div className="error-state" role="alert">
      <div className="eyebrow">Something went wrong</div>
      <h1>{title}</h1>
      <p>{detail}</p>
      <p className="section-note">
        Nothing imported, sent or recorded is affected. This is a problem displaying the page, not a
        problem with the records.
      </p>

      <div className="actions">
        {onRetry && (
          <button className="button primary" onClick={onRetry} type="button">
            Try again
          </button>
        )}
        <Link className="button" href={destination}>
          {backLabel}
        </Link>
      </div>

      {digest && (
        <p className="section-note error-digest">
          Reference <code>{digest}</code> — quote this when reporting it.
        </p>
      )}
    </div>
  );
}
