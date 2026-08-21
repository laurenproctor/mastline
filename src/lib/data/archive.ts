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
