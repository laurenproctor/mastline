import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { FilterLink } from "@/components/filter-chip";
import { Badge, Field, PageHeader, PhotoTile } from "@/components/primitives";
import {
  ARCHIVE_PAGE_SIZE,
  countArchive,
  searchArchive,
  type EarningFilter,
} from "@/lib/data/archive";
import { signedUrlsFor } from "@/lib/data/imports";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { workspaceContext } from "@/lib/session-context";
import { type WorkspaceRoutes, workspaceRoutes } from "@/lib/workspace-routes";
import { createClient } from "@/lib/supabase/server";

const FILTERS: readonly { value: EarningFilter; label: string }[] = [
  { value: "all", label: "All assets" },
  { value: "unsold", label: "No recorded sale" },
  { value: "earning", label: "Has earned" },
];

function linkTo(
  routes: WorkspaceRoutes,
  query: string,
  filter: EarningFilter,
  page: number,
): string {
  return routes.archive({
    query: {
      q: query || undefined,
      filter: filter === "all" ? undefined : filter,
      page: page > 1 ? page : undefined,
    },
  });
}

export default async function ArchivePage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  const { workspace: requestedWorkspace } = await routeParams;
  const params = await searchParams;
  const { organizationId, canonicalSlug } = await workspaceContext(requestedWorkspace);
  const routes = workspaceRoutes(canonicalSlug);
  /*
   * Everything below builds on the address the workspace holds NOW, not the one
   * the request arrived on. A request may land on a retired address, and a link
   * rendered from that would send the next click back through the rename
   * redirect; a slug that was never resolved at all would be a value the
   * browser supplied, sitting in a destination.
   */
  const workspaceSlug = canonicalSlug;

  const query = (params.q ?? "").trim();
  const filter = (FILTERS.find((entry) => entry.value === params.filter)?.value ??
    "all") as EarningFilter;
  const page = Math.max(Number(params.page ?? 1) || 1, 1);

  const [results, total] = await Promise.all([
    searchArchive(organizationId, { query, filter, page }),
    countArchive(organizationId),
  ]);

  // Only the page being shown gets a signed URL, rather than the whole archive.
  const previewKeys = results.results
    .map((result) => result.previewObjectKey)
    .filter((key): key is string => Boolean(key));
  const previewUrls = await signedUrlsFor(await createClient(), "derivatives", previewKeys, 600);

  const searching = Boolean(query) || filter !== "all";

  return (
    <AppShell active="Archive" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          action="Import a shoot"
          description="Search by subject, place, caption, or keyword. Results carry commercial state, not just pixels."
          eyebrow="Commercial memory"
          href={routes.newShoot()}
          title="Archive"
        />

        <form className="archive-search" method="get">
          {filter !== "all" && <input name="filter" type="hidden" value={filter} />}
          <Field
            defaultValue={query}
            hint={`${total} ${total === 1 ? "asset" : "assets"} in this workspace. Searched in the database, not in the browser.`}
            label="Search the archive"
            name="q"
            placeholder="Avery Hart, Hotel Chelsea, New York…"
            type="search"
          />
          <button className="button" type="submit">
            Search
          </button>
        </form>

        <div className="split-heading">
          <h2>
            {searching
              ? `${results.total} ${results.total === 1 ? "match" : "matches"}`
              : "Recently active"}
          </h2>
          <div className="actions">
            {FILTERS.map((entry) => (
              <FilterLink
                current={filter === entry.value}
                href={linkTo(routes, query, entry.value, 1)}
                key={entry.value}
              >
                {entry.label}
              </FilterLink>
            ))}
          </div>
        </div>

        {results.results.length === 0 ? (
          <p className="empty-sheet">
            {total === 0
              ? "No assets yet. Import a shoot to start building the archive."
              : "Nothing matches that search."}
          </p>
        ) : (
          <ul className="archive-grid">
            {results.results.map((result, index) => {
              const previewUrl = result.previewObjectKey
                ? previewUrls.get(result.previewObjectKey)
                : undefined;
              const earned = result.lifetimeEarnings.minor > 0;

              return (
                <li key={result.assetId}>
                  <Link className="asset-card" href={routes.asset(result.assetId)}>
                    {previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" className="asset-card-image" loading="lazy" src={previewUrl} />
                    ) : (
                      <PhotoTile index={index + 31} selected={earned} />
                    )}
                    <div className="asset-card-body">
                      <strong>{result.headline ?? result.canonicalFilename}</strong>
                      <small>
                        {earned
                          ? `${formatMoney(result.lifetimeEarnings)} lifetime · ${result.submissionCount} ${result.submissionCount === 1 ? "package" : "packages"}`
                          : result.submissionCount > 0
                            ? `No recorded sale · ${result.submissionCount} ${result.submissionCount === 1 ? "package" : "packages"}`
                            : "Never sent"}
                      </small>
                      <small className="muted">
                        {result.capturedAt
                          ? formatDate(result.capturedAt, { withYear: true })
                          : "—"}
                      </small>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {results.totalPages > 1 && (
          <nav aria-label="Archive pages" className="pagination">
            <Link
              aria-disabled={page <= 1}
              className={`button small${page <= 1 ? " disabled" : ""}`}
              href={linkTo(routes, query, filter, Math.max(1, page - 1))}
            >
              Previous
            </Link>
            <span className="muted">
              Page {results.page} of {results.totalPages} · showing{" "}
              {(results.page - 1) * ARCHIVE_PAGE_SIZE + 1}–
              {Math.min(results.page * ARCHIVE_PAGE_SIZE, results.total)} of {results.total}
            </span>
            <Link
              aria-disabled={page >= results.totalPages}
              className={`button small${page >= results.totalPages ? " disabled" : ""}`}
              href={linkTo(routes, query, filter, Math.min(results.totalPages, page + 1))}
            >
              Next
            </Link>
          </nav>
        )}

        <div className="spacer" />
        <Badge tone="neutral">Private</Badge>
        <p className="section-note">
          Previews are served through short-lived signed links, and only for the page being looking
          at. Originals are never publicly readable.
        </p>
      </div>
    </AppShell>
  );
}
