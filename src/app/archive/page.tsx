import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, Field, PageHeader, PhotoTile } from "@/components/primitives";
import { listAssets } from "@/lib/data/assets";
import { signedUrlsFor } from "@/lib/data/imports";
import { getAssetEarnings } from "@/lib/data/money";
import { listSubmissions } from "@/lib/data/submissions";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { currentContext } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/server";

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const { q, filter } = await searchParams;
  const { organizationId } = await currentContext();

  const [allAssets, submissions] = await Promise.all([
    listAssets(organizationId),
    listSubmissions(organizationId),
  ]);
  const earnings = await getAssetEarnings(organizationId);

  const submissionCounts = new Map<string, number>();
  for (const submission of submissions) {
    for (const entry of submission.manifest) {
      submissionCounts.set(entry.assetId, (submissionCounts.get(entry.assetId) ?? 0) + 1);
    }
  }

  const query = (q ?? "").trim().toLowerCase();
  let assets = allAssets;

  if (query) {
    assets = assets.filter((asset) =>
      [
        asset.canonicalFilename,
        asset.headline,
        asset.caption,
        asset.locationName,
        ...asset.subjects,
        ...asset.keywords,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }

  if (filter === "unsold") {
    assets = assets.filter((asset) => (earnings.get(asset.id)?.minor ?? 0) === 0);
  } else if (filter === "earning") {
    assets = assets.filter((asset) => (earnings.get(asset.id)?.minor ?? 0) > 0);
  }

  const previewKeys = assets
    .map((asset) => asset.versions.find((version) => version.versionKind === "preview")?.objectKey)
    .filter((key): key is string => Boolean(key));
  const previewUrls = await signedUrlsFor(await createClient(), "derivatives", previewKeys, 600);

  const shown = assets.slice(0, 24);

  return (
    <AppShell active="Archive">
      <div className="page">
        <PageHeader
          action="Import a shoot"
          description="Search by subject, place, caption, or keyword. Results carry commercial state, not just pixels."
          eyebrow="Commercial memory"
          href="/shoots/new"
          title="Archive"
        />

        <form className="archive-search" method="get">
          <Field
            defaultValue={q ?? ""}
            hint={`${allAssets.length} assets in this workspace.`}
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
          <h2>{query || filter ? `${assets.length} matching` : "Recently active"}</h2>
          <div className="actions">
            <Link
              className={`badge ${!filter ? "blue" : "neutral"}`}
              href={q ? `/archive?q=${encodeURIComponent(q)}` : "/archive"}
            >
              All assets
            </Link>
            <Link
              className={`badge ${filter === "unsold" ? "blue" : "neutral"}`}
              href={`/archive?filter=unsold${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            >
              No recorded sale
            </Link>
            <Link
              className={`badge ${filter === "earning" ? "blue" : "neutral"}`}
              href={`/archive?filter=earning${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            >
              Has earned
            </Link>
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="empty-sheet">
            {allAssets.length === 0
              ? "No assets yet. Import a shoot to start building the archive."
              : "Nothing matches that search."}
          </p>
        ) : (
          <ul className="archive-grid">
            {shown.map((asset, index) => {
              const earned = earnings.get(asset.id);
              const count = submissionCounts.get(asset.id) ?? 0;
              const previewKey = asset.versions.find(
                (version) => version.versionKind === "preview",
              )?.objectKey;
              const previewUrl = previewKey ? previewUrls.get(previewKey) : undefined;

              return (
                <li key={asset.id}>
                  <Link className="asset-card" href={`/assets/${asset.id}`}>
                    {previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" className="asset-card-image" loading="lazy" src={previewUrl} />
                    ) : (
                      <PhotoTile index={index + 31} selected={(earned?.minor ?? 0) > 0} />
                    )}
                    <div className="asset-card-body">
                      <strong>{asset.headline ?? asset.canonicalFilename}</strong>
                      <small>
                        {(earned?.minor ?? 0) > 0
                          ? `${formatMoney(earned!)} lifetime · ${count} ${count === 1 ? "submission" : "submissions"}`
                          : count > 0
                            ? `No recorded sale · ${count} ${count === 1 ? "submission" : "submissions"}`
                            : "Never sent"}
                      </small>
                      <small className="muted">
                        {asset.capturedAt ? formatDate(asset.capturedAt, { withYear: true }) : "—"}
                      </small>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {assets.length > shown.length && (
          <p className="section-note">
            Showing {shown.length} of {assets.length}. Refine the search to narrow it.
          </p>
        )}

        <div className="spacer" />
        <Badge tone="neutral">Private</Badge>
        <p className="section-note">
          Previews are served through short-lived signed links. Originals are never publicly
          readable.
        </p>
      </div>
    </AppShell>
  );
}
