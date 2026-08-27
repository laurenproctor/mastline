"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/routes";
import { workspaceRoutes, workspaceSlugFromPathname } from "@/lib/workspace-routes";

/**
 * The 404 page.
 *
 * A client component for one reason: it has no `params`, and the two links on
 * it used to be bare "/work" and "/archive". Those reached a workspace only
 * because the middleware picked one from the active-workspace cookie -- so
 * missing a record in one workspace could offer a way back into another one
 * that a second tab had switched to. The address the request was made on is
 * still the answer; `usePathname()` is how it arrives here.
 *
 * When there is no workspace to read -- a mistyped marketing URL, or the static
 * prerender of this page, where the pathname is not known -- the legacy paths
 * stand. That is what the middleware's compatibility redirect is for, and it is
 * the one case where guessing is the only option available.
 */
export default function NotFound() {
  const slug = workspaceSlugFromPathname(usePathname());
  const routes = slug ? workspaceRoutes(slug) : null;

  return (
    <main className="marketing">
      <section className="marketing-section">
        <div className="eyebrow">Not found</div>
        <h2>That record does not exist in this workspace.</h2>
        <p className="muted">
          It may have been archived, moved to another workspace, or never created.
        </p>
        <div className="hero-actions">
          <Link className="button blue" href={routes ? routes.work() : DEFAULT_SIGNED_IN_PATH}>
            Back to the work queue
          </Link>
          <Link className="button" href={routes ? routes.archive() : "/archive"}>
            Search the archive
          </Link>
        </div>
      </section>
    </main>
  );
}
