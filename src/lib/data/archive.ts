import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id } from "../domain";
import { type Money, money } from "../money";
import { createClient } from "../supabase/server";

/**
 * Searching the archive.
 *
 * One database call returns the page and the total. The previous version
 * fetched every asset in the workspace and filtered in JavaScript, which does
 * not survive an archive of any real size.
 */

export type EarningFilter = "all" | "unsold" | "earning";

export interface ArchiveResult {
  readonly assetId: Id;
  readonly canonicalFilename: string;
  readonly headline?: string;
  readonly caption?: string;
  readonly capturedAt?: string;
  readonly lifetimeEarnings: Money;
  readonly submissionCount: number;
  readonly previewObjectKey?: string;
}

export interface ArchivePage {
  readonly results: readonly ArchiveResult[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export const ARCHIVE_PAGE_SIZE = 24;

export async function searchArchive(
  organizationId: Id,
  options: {
    query?: string;
    filter?: EarningFilter;
    page?: number;
    pageSize?: number;
  } = {},
  client?: SupabaseClient,
): Promise<ArchivePage> {
  const supabase = client ?? (await createClient());
  const pageSize = Math.min(Math.max(options.pageSize ?? ARCHIVE_PAGE_SIZE, 1), 100);
  const page = Math.max(options.page ?? 1, 1);

  const { data, error } = await supabase.rpc("search_archive", {
    target_org: organizationId,
    search_text: options.query?.trim() || null,
    earning_filter: options.filter ?? "all",
    page_limit: pageSize,
    page_offset: (page - 1) * pageSize,
  });

  if (error) throw new Error(`Could not search the archive: ${error.message}`);

  const rows = (data ?? []) as Record<string, unknown>[];
  // Every row carries the same window count; an empty page means no matches.
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  return {
    results: rows.map((row) => ({
      assetId: row.asset_id as string,
      canonicalFilename: row.canonical_filename as string,
      headline: (row.headline as string | null) ?? undefined,
      caption: (row.caption as string | null) ?? undefined,
      capturedAt: (row.captured_at as string | null) ?? undefined,
      lifetimeEarnings: money(Number(row.lifetime_earnings_minor ?? 0), "USD"),
      submissionCount: Number(row.submission_count ?? 0),
      previewObjectKey: (row.preview_object_key as string | null) ?? undefined,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** How many assets the workspace holds, for the search field's label. */
export async function countArchive(organizationId: Id, client?: SupabaseClient): Promise<number> {
  const supabase = client ?? (await createClient());
  const { count } = await supabase
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .neq("status", "tombstoned");
  return count ?? 0;
}

/**
 * The figures the archive's insights rail shows.
 *
 * Every one of them is a fact the archive already holds, read through the same
 * search function the grid uses so the counts and the filters can never
 * disagree. Nothing is estimated: a total that would need an aggregate the
 * data API refuses (`PGRST123`) is left out rather than approximated.
 */
export interface ArchiveInsights {
  /** Live assets in the workspace: everything not tombstoned. */
  readonly totalAssets: number;
  /** Assets with a payment allocation recorded against them. */
  readonly earningAssets: number;
  /** Assets with no recorded sale, whether or not they have been sent. */
  readonly unsoldAssets: number;
  readonly oldestCapturedAt?: string;
  readonly latestCapturedAt?: string;
}

async function captureBoundary(
  supabase: SupabaseClient,
  organizationId: Id,
  end: "oldest" | "latest",
): Promise<string | undefined> {
  // (organization_id, captured_at) is indexed where status <> 'tombstoned', so
  // either end is an index read rather than a scan.
  const { data } = await supabase
    .from("assets")
    .select("captured_at")
    .eq("organization_id", organizationId)
    .neq("status", "tombstoned")
    .not("captured_at", "is", null)
    .order("captured_at", { ascending: end === "oldest" })
    .limit(1)
    .maybeSingle();
  return (data?.captured_at as string | null | undefined) ?? undefined;
}

export async function archiveInsights(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<ArchiveInsights> {
  const supabase = client ?? (await createClient());
  const [totalAssets, earning, unsold, oldestCapturedAt, latestCapturedAt] = await Promise.all([
    countArchive(organizationId, supabase),
    searchArchive(organizationId, { filter: "earning", pageSize: 1 }, supabase),
    searchArchive(organizationId, { filter: "unsold", pageSize: 1 }, supabase),
    captureBoundary(supabase, organizationId, "oldest"),
    captureBoundary(supabase, organizationId, "latest"),
  ]);

  return {
    totalAssets,
    earningAssets: earning.total,
    unsoldAssets: unsold.total,
    oldestCapturedAt,
    latestCapturedAt,
  };
}
