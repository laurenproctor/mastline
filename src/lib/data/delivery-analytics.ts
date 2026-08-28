import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id } from "../domain";
import { createClient } from "../supabase/server";

/**
 * What the photographer gets to see about a delivery link.
 *
 * Everything here is deliberately about a *link*, not a person. The link made
 * for the New York picture desk was opened, and was on screen for about four
 * minutes across two visits. Whether the editor it was addressed to is the one
 * who did that is not something Mastline knows, and the only thing that changes
 * it is the visitor typing their own name into the acceptance -- which is an
 * explicit identification and is reported separately.
 *
 * The three empty states below are distinct and must stay that way, because
 * collapsing them is how an analytics screen starts lying:
 *
 *   never opened          -- there is no evidence of anything
 *   opened, no sessions   -- the page was fetched but no heartbeats arrived:
 *                            consent withheld, a blocker, a closed tab. This is
 *                            unknown engagement, not zero engagement.
 *   sessions, no time     -- heartbeats arrived and none of them counted, which
 *                            genuinely is close to zero.
 */

export interface AssetEngagement {
  readonly assetId: string;
  readonly activeVisibleMs: number;
  readonly viewCount: number;
  readonly firstVisibleAt?: string;
  readonly lastVisibleAt?: string;
}

export type EngagementState =
  /** No open has ever been recorded against this link. */
  | "never-opened"
  /** Opened, but no viewing session was ever recorded. Unknown, not zero. */
  | "no-analytics"
  /** Sessions exist but nothing counted as active viewing yet. */
  | "opened-no-active-time"
  /** Sessions with measured time. */
  | "measured";

export interface DeliveryEngagement {
  readonly deliveryId: string;
  readonly state: EngagementState;
  readonly sessionCount: number;
  /** Distinct pseudonymous browsers, not distinct people. */
  readonly visitorCount: number;
  readonly activeVisibleMs: number;
  readonly averageSessionMs: number;
  readonly firstOpenedAt?: string;
  readonly lastOpenedAt?: string;
  readonly openCount: number;
  readonly downloadCount: number;
  readonly downloadedAssetIds: readonly string[];
  readonly assets: readonly AssetEngagement[];
}

interface OpenSummary {
  readonly openCount: number;
  readonly firstOpenedAt?: string;
  readonly lastOpenedAt?: string;
  readonly downloadCount: number;
  readonly downloadedAssetIds: readonly string[];
}

/**
 * Opens and downloads come from the append-only evidence, not from analytics.
 *
 * This matters for the empty states: a link can have been opened -- which is
 * recorded whatever the visitor's consent choice, because it is a commercial
 * fact -- while having no session rows at all, and the screen has to be able to
 * say so rather than reporting nothing happened.
 */
function summarizeOpens(
  events: readonly {
    deliveryId: string;
    kind: string;
    assetId?: string;
    occurredAt: string;
  }[],
): Map<string, OpenSummary> {
  const byDelivery = new Map<string, OpenSummary>();

  for (const event of events) {
    const current = byDelivery.get(event.deliveryId) ?? {
      openCount: 0,
      downloadCount: 0,
      downloadedAssetIds: [] as string[],
    };

    // An acceptance is an open of a sort -- somebody was on the page -- but it
    // is counted as its own kind, so only a real open moves the open count.
    const isOpen = event.kind === "opened";
    const isDownload = event.kind === "downloaded";

    const downloaded = [...current.downloadedAssetIds];
    if (isDownload && event.assetId && !downloaded.includes(event.assetId)) {
      downloaded.push(event.assetId);
    }

    const first =
      isOpen && (!current.firstOpenedAt || event.occurredAt < current.firstOpenedAt)
        ? event.occurredAt
        : current.firstOpenedAt;
    const last =
      isOpen && (!current.lastOpenedAt || event.occurredAt > current.lastOpenedAt)
        ? event.occurredAt
        : current.lastOpenedAt;

    byDelivery.set(event.deliveryId, {
      openCount: current.openCount + (isOpen ? 1 : 0),
      downloadCount: current.downloadCount + (isDownload ? 1 : 0),
      downloadedAssetIds: downloaded,
      firstOpenedAt: first,
      lastOpenedAt: last,
    });
  }

  return byDelivery;
}

/**
 * Engagement for a set of links, keyed by delivery id.
 *
 * Reads the durable rollups rather than aggregating the session rows, so the
 * numbers stay right after the retention sweep has removed the detail. The
 * per-session breakdown is a separate, deliberately optional read.
 */
export async function listDeliveryEngagement(
  organizationId: Id,
  deliveryIds: readonly Id[],
  client?: SupabaseClient,
): Promise<ReadonlyMap<string, DeliveryEngagement>> {
  const result = new Map<string, DeliveryEngagement>();
  if (deliveryIds.length === 0) return result;

  const supabase = client ?? (await createClient());
  const ids = [...deliveryIds];

  const [totals, assetTotals, events] = await Promise.all([
    supabase
      .from("delivery_engagement_totals")
      .select("delivery_id, session_count, visitor_count, active_visible_ms")
      .eq("organization_id", organizationId)
      .in("delivery_id", ids),
    supabase
      .from("delivery_asset_engagement_totals")
      .select(
        "delivery_id, asset_id, active_visible_ms, view_count, first_visible_at, last_visible_at",
      )
      .eq("organization_id", organizationId)
      .in("delivery_id", ids),
    supabase
      .from("delivery_access_events")
      .select("delivery_id, kind, asset_id, occurred_at")
      .eq("organization_id", organizationId)
      .in("delivery_id", ids),
  ]);

  if (totals.error) throw new Error(`Could not load engagement: ${totals.error.message}`);
  if (assetTotals.error) {
    throw new Error(`Could not load frame engagement: ${assetTotals.error.message}`);
  }
  if (events.error) throw new Error(`Could not load the access record: ${events.error.message}`);

  const opens = summarizeOpens(
    (events.data ?? []).map((row) => ({
      deliveryId: row.delivery_id as string,
      kind: row.kind as string,
      assetId: (row.asset_id as string | null) ?? undefined,
      occurredAt: row.occurred_at as string,
    })),
  );

  const assetsByDelivery = new Map<string, AssetEngagement[]>();
  for (const row of assetTotals.data ?? []) {
    const deliveryId = row.delivery_id as string;
    const list = assetsByDelivery.get(deliveryId) ?? [];
    list.push({
      assetId: row.asset_id as string,
      activeVisibleMs: Number(row.active_visible_ms ?? 0),
      viewCount: Number(row.view_count ?? 0),
      firstVisibleAt: (row.first_visible_at as string | null) ?? undefined,
      lastVisibleAt: (row.last_visible_at as string | null) ?? undefined,
    });
    assetsByDelivery.set(deliveryId, list);
  }

  const totalsById = new Map(
    (totals.data ?? []).map((row) => [row.delivery_id as string, row] as const),
  );

  for (const deliveryId of ids) {
    const total = totalsById.get(deliveryId);
    const open = opens.get(deliveryId);
    const sessionCount = Number(total?.session_count ?? 0);
    const activeVisibleMs = Number(total?.active_visible_ms ?? 0);
    const openCount = open?.openCount ?? 0;

    const state: EngagementState =
      openCount === 0 && sessionCount === 0
        ? "never-opened"
        : sessionCount === 0
          ? "no-analytics"
          : activeVisibleMs === 0
            ? "opened-no-active-time"
            : "measured";

    result.set(deliveryId, {
      deliveryId,
      state,
      sessionCount,
      visitorCount: Number(total?.visitor_count ?? 0),
      activeVisibleMs,
      averageSessionMs: sessionCount > 0 ? Math.round(activeVisibleMs / sessionCount) : 0,
      firstOpenedAt: open?.firstOpenedAt,
      lastOpenedAt: open?.lastOpenedAt,
      openCount,
      downloadCount: open?.downloadCount ?? 0,
      downloadedAssetIds: open?.downloadedAssetIds ?? [],
      assets: (assetsByDelivery.get(deliveryId) ?? []).sort(
        (a, b) => b.activeVisibleMs - a.activeVisibleMs,
      ),
    });
  }

  return result;
}

/**
 * Roughly how long, in words a person would use.
 *
 * Always approximate, and labelled as such wherever it is rendered. The
 * measurement is a series of bounded heartbeats from a browser: it is good
 * enough to tell four minutes from four seconds and was never good enough to
 * report a number to the second, so it does not.
 */
export function describeActiveTime(milliseconds: number): string {
  if (milliseconds <= 0) return "none recorded";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `about ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) {
    return remainder >= 5 ? `about ${minutes}m ${remainder}s` : `about ${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `about ${hours}h ${minutes % 60}m`;
}
