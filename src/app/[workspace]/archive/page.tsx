import { AppShell } from "@/components/app-shell";
import { Badge, PageHeader } from "@/components/primitives";
import { archiveInsights, searchArchive } from "@/lib/data/archive";
import { signedUrlsFor } from "@/lib/data/imports";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/server";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { ArchiveActiveFilters } from "./_components/archive-active-filters";
import { ArchiveEmptyState } from "./_components/archive-empty-state";
import { ArchiveGrid, ArchiveList } from "./_components/archive-grid";
import { ArchiveInsights } from "./_components/archive-insights";
import { ArchivePagination } from "./_components/archive-pagination";
import { ArchiveSearch } from "./_components/archive-search";
import { ArchiveToolbar } from "./_components/archive-toolbar";
import styles from "./archive.module.css";
import { archiveHref, parseArchiveState, toArchiveCard } from "./archive-view-model";

/**
 * The archive: what the workspace has, and what has happened to it.
 *
 * Search is the way in. Who, where, what, and when are the things a
 * photographer remembers a picture by, and there are too many of each to offer
 * as menus, so the field takes them as words and the database finds them. The
 * three commercial states are few enough to stay on screen. Everything shown
 * on a card or in the rail is a stored fact: capture time, headline, caption,
 * packages it went out in, payments allocated to it.
 */
export default async function ArchivePage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ q?: string; filter?: string; page?: string; view?: string }>;
}) {
  const { workspace: requestedWorkspace } = await routeParams;
  const state = parseArchiveState(await searchParams);
  const { organizationId, canonicalSlug, workspace } = await workspaceContext(requestedWorkspace);
  const routes = workspaceRoutes(canonicalSlug);
  /*
   * Everything below builds on the address the workspace holds NOW, not the one
   * the request arrived on. A request may land on a retired address, and a link
   * rendered from that would send the next click back through the rename
   * redirect; a slug that was never resolved at all would be a value the
   * browser supplied, sitting in a destination.
   */
  const workspaceSlug = canonicalSlug;

  const [results, insights] = await Promise.all([
    searchArchive(organizationId, { query: state.query, filter: state.filter, page: state.page }),
    archiveInsights(organizationId),
  ]);

  // Only the page being shown gets a signed URL, rather than the whole archive.
  const previewKeys = results.results
    .map((result) => result.previewObjectKey)
    .filter((key): key is string => Boolean(key));
  const previewUrls = await signedUrlsFor(await createClient(), "derivatives", previewKeys, 600);

  const cards = results.results.map((result) => toArchiveCard(result, routes, previewUrls));
  // The same gate the Shoots screen applies to creating one: the import route
  // refuses anyone without it, so nobody is offered a button that will fail.
  const mayImport = can(workspace.role, "shoot.write");
  const importHref = routes.newShoot();
  const archiveIsEmpty = insights.totalAssets === 0;
  const pastEnd = results.results.length === 0 && results.total > 0;

  return (
    <AppShell active="Archive" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          action={mayImport ? "Import a shoot" : undefined}
          description="Search by subject, place, caption, or keyword. Results carry commercial state, not just pixels."
          eyebrow="Commercial memory"
          href={importHref}
          title="Archive"
        />

        {archiveIsEmpty ? (
          <ArchiveEmptyState
            importHref={mayImport ? importHref : undefined}
            kind="empty"
            state={state}
          />
        ) : (
          <div className={styles.archive}>
            <ArchiveSearch
              hidden={{
                filter: state.filter === "all" ? undefined : state.filter,
                view: state.view === "grid" ? undefined : state.view,
              }}
              query={state.query}
            />
            <ArchiveToolbar routes={routes} state={state} />
            <ArchiveActiveFilters routes={routes} state={state} total={results.total} />

            <div className={styles.body}>
              <section aria-label="Results" className={styles.results}>
                {results.results.length === 0 ? (
                  <ArchiveEmptyState
                    clearFilterHref={
                      state.filter !== "all"
                        ? archiveHref(routes, state, { filter: "all" })
                        : undefined
                    }
                    clearSearchHref={
                      state.query ? archiveHref(routes, state, { query: "" }) : undefined
                    }
                    firstPageHref={archiveHref(routes, state, { page: 1 })}
                    kind={pastEnd ? "past-end" : "no-results"}
                    state={state}
                  />
                ) : state.view === "list" ? (
                  <ArchiveList cards={cards} />
                ) : (
                  <ArchiveGrid cards={cards} />
                )}

                {results.totalPages > 1 && (
                  <ArchivePagination
                    page={results.page}
                    pageSize={results.pageSize}
                    routes={routes}
                    state={state}
                    total={results.total}
                    totalPages={results.totalPages}
                  />
                )}
              </section>

              <ArchiveInsights insights={insights} routes={routes} state={state} />
            </div>

            <div className={styles.privacy}>
              <Badge tone="neutral">Private</Badge>
              <p>
                Previews are served through short-lived signed links, and only for the page being
                looked at. Originals are never publicly readable.
              </p>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
