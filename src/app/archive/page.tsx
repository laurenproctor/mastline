import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, Field, PageHeader, PhotoTile } from "@/components/primitives";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getAssetLifetimeEarnings, listAssets, listSubmissions } from "@/lib/mock/queries";

export default async function ArchivePage() {
  const [assets, submissions] = await Promise.all([listAssets(), listSubmissions()]);
  const earnings = await Promise.all(assets.map((asset) => getAssetLifetimeEarnings(asset.id)));

  const submissionCounts = new Map<string, number>();
  for (const submission of submissions) {
    for (const entry of submission.manifest) {
      submissionCounts.set(entry.assetId, (submissionCounts.get(entry.assetId) ?? 0) + 1);
    }
  }

  const shown = assets.slice(0, 8);

  return (
    <AppShell active="Archive">
      <div className="page">
        <PageHeader
          action="Import archive"
          description="Search by subject, event, place, buyer, submission, license, usage, or earnings."
          eyebrow="Commercial memory"
          href="/shoots/new"
          title="Archive"
        />

        <Field
          hint="Results expose commercial state, not only visual similarity."
          label={`Search ${assets.length} assets`}
          name="archiveSearch"
          placeholder="Try “Avery Hart in New York, unsold, worldwide editorial”"
          type="search"
        />

        <div className="split-heading">
          <h2>Recently active</h2>
          <div className="actions">
            <Badge tone="neutral">All assets</Badge>
            <Badge tone="neutral">Unsold</Badge>
            <Badge tone="neutral">Rights cleared</Badge>
          </div>
        </div>

        <ul className="archive-grid">
          {shown.map((asset, index) => {
            const earned = earnings[index];
            const submissionCount = submissionCounts.get(asset.id) ?? 0;
            return (
              <li key={asset.id}>
                <Link className="asset-card" href={`/assets/${asset.id}`}>
                  <PhotoTile index={index + 31} selected={earned.minor > 0} />
                  <div className="asset-card-body">
                    <strong>{asset.headline ?? asset.canonicalFilename}</strong>
                    <small>
                      {earned.minor > 0
                        ? `${formatMoney(earned)} lifetime · ${submissionCount} ${
                            submissionCount === 1 ? "submission" : "submissions"
                          }`
                        : "No recorded sale"}
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
      </div>
    </AppShell>
  );
}
