import type { SupabaseClient } from "@supabase/supabase-js";
import type { Asset, DispatchPackage, Id, Shoot, ShootStatus, Submission } from "../domain";
import { money } from "../money";
import { getMoneySummary, listPayments } from "./money";
import { listPackages } from "./packages";
import { createClient } from "../supabase/server";
import { listSubmissions } from "./submissions";
import { signedUrlsFor } from "./imports";
import { reviewSelection } from "../metadata-rules";
import type { WorkspaceRoutes } from "../workspace-routes";
import {
  type AccessEventRow,
  type ActiveShootSummary,
  type DeliveryRef,
  OPEN_SHOOT_STATUSES,
  type WorkPulse,
  type WorkQueueDashboard,
  type WorkQueueFacts,
  type WorkQueueItem,
  type WorkQueueShoot,
  buildMoneySummary,
  buildRecipientActivity,
  buildWorkPulse,
  buildWorkQueue,
  medianDispatchMinutes,
  workQueueCounts,
} from "./work-queue-ranking";

/**
 * The daily action queue and the dashboard built around it, read from the
 * database in a fixed number of round trips. The ranking itself, the filter
 * contract, and every other pure builder live in `work-queue-ranking.ts` and
 * are re-exported here so callers keep one import.
 */
export * from "./work-queue-ranking";

/** What the loader adds to the facts for the dashboard's other panels. */
interface LoadedFacts extends WorkQueueFacts {
  readonly deliveries: readonly DeliveryRef[];
  /** Every non-tombstoned asset of an open shoot, counted, never listed. */
  readonly assetTotalsByShoot: ReadonlyMap<string, { total: number; selected: number }>;
}

/** Only the fields the completeness rules read; the rest are placeholders. */
function toQueueAsset(row: Record<string, unknown>, organizationId: Id, shootId: string): Asset {
  return {
    id: row.id as string,
    organizationId,
    shootId,
    status: row.status as Asset["status"],
    canonicalFilename: "",
    capturedAt: (row.captured_at as string | null) ?? undefined,
    headline: (row.headline as string | null) ?? undefined,
    caption: (row.caption as string | null) ?? undefined,
    captionOrigin: row.caption_origin === "model" ? "model" : "human",
    captionDraftedAt: (row.caption_drafted_at as string | null) ?? undefined,
    captionReviewedAt: (row.caption_reviewed_at as string | null) ?? undefined,
    captionAwaitsReview: (row.caption_awaits_review as boolean | null) ?? false,
    subjects: Array.isArray(row.subjects) ? (row.subjects as string[]) : [],
    locationName: (row.location_name as string | null) ?? undefined,
    keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
    creditLine: (row.credit_line as string | null) ?? undefined,
    copyrightNotice: (row.copyright_notice as string | null) ?? undefined,
    usageRestrictions: (row.usage_restrictions as string | null) ?? undefined,
    selected: Boolean(row.selected),
    versions: [],
    captionHistory: [],
    lifetimeEarnings: money(0),
  };
}

/**
 * Everything the queue is built from, in a fixed number of round trips.
 *
 * The page an operator opens every morning must not get slower as the
 * workspace grows, so nothing here loops a query over records, and the count
 * is the same however much work there is:
 *
 * 1. shoots -- only the columns the ranking reads; the sensitive-note lookup
 *    `listShoots` performs is not one of them
 * 2. submissions
 * 3. payments, with their allocations embedded
 * 4-5. packages and their members
 * 6. the assets of the OPEN shoots -- selected or not, so the active-shoot
 *    totals come from the same rows and closed shoots, which the ranking
 *    skips anyway, cost nothing however large the archive is. Skipped, never
 *    added to, when no shoot is open.
 * 7. delivery links, as id, submission, and recipient label -- never the
 *    token: the queue needs to know a link exists and who it names, not the
 *    credential itself
 *
 * The asset query waits for the shoot ids, so it is one round trip later
 * rather than one round trip more.
 */
async function fetchWorkQueueFacts(
  organizationId: Id,
  supabase: SupabaseClient,
): Promise<LoadedFacts> {
  const shootQuery = supabase
    .from("shoots")
    .select("id, title, status, priority, starts_at, location_name, updated_at")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });

  const [shootRows, submissions, payments, packages, deliveryRows] = await Promise.all([
    shootQuery,
    listSubmissions(organizationId, supabase),
    listPayments(organizationId, supabase),
    listPackages(organizationId, {}, supabase),
    supabase
      .from("submission_deliveries")
      .select("id, submission_id, recipient_label")
      .eq("organization_id", organizationId),
  ]);
  if (shootRows.error) throw new Error(`Could not load shoots: ${shootRows.error.message}`);
  if (deliveryRows.error)
    throw new Error(`Could not load delivery links: ${deliveryRows.error.message}`);

  const shoots: WorkQueueShoot[] = (shootRows.data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    status: row.status as ShootStatus,
    priority: row.priority as Shoot["priority"],
    startsAt: (row.starts_at as string | null) ?? undefined,
    locationName: (row.location_name as string | null) ?? undefined,
    updatedAt: row.updated_at as string,
  }));

  const openShootIds = shoots
    .filter((shoot) => OPEN_SHOOT_STATUSES.includes(shoot.status))
    .map((shoot) => shoot.id);

  const assetRows =
    openShootIds.length > 0
      ? await supabase
          .from("assets")
          .select(
            "id, shoot_id, selected, status, caption, caption_awaits_review, caption_reviewed_at, caption_origin, caption_drafted_at, headline, credit_line, copyright_notice, captured_at, location_name, subjects, usage_restrictions, keywords",
          )
          .eq("organization_id", organizationId)
          .in("shoot_id", openShootIds)
          .neq("status", "tombstoned")
      : { data: [] as Record<string, unknown>[], error: null };
  if (assetRows.error) throw new Error(`Could not load assets: ${assetRows.error.message}`);

  const selectedByShoot = new Map<string, Asset[]>();
  const assetTotalsByShoot = new Map<string, { total: number; selected: number }>();
  for (const row of assetRows.data ?? []) {
    const shootId = row.shoot_id as string | null;
    if (!shootId) continue;
    const totals = assetTotalsByShoot.get(shootId) ?? { total: 0, selected: 0 };
    totals.total += 1;
    if (row.selected) {
      totals.selected += 1;
      selectedByShoot.set(shootId, [
        ...(selectedByShoot.get(shootId) ?? []),
        toQueueAsset(row, organizationId, shootId),
      ]);
    }
    assetTotalsByShoot.set(shootId, totals);
  }

  const deliveries: DeliveryRef[] = (deliveryRows.data ?? []).map((row) => ({
    id: row.id as string,
    submissionId: row.submission_id as string,
    recipientLabel: (row.recipient_label as string | null) ?? undefined,
  }));

  const deliveryCountBySubmission = new Map<string, number>();
  for (const delivery of deliveries) {
    deliveryCountBySubmission.set(
      delivery.submissionId,
      (deliveryCountBySubmission.get(delivery.submissionId) ?? 0) + 1,
    );
  }

  return {
    shoots,
    selectedAssetsByShoot: selectedByShoot,
    packages,
    submissions,
    deliveryCountBySubmission,
    payments,
    deliveries,
    assetTotalsByShoot,
    now: new Date(),
  };
}

/**
 * The ranked queue on its own: the shape the current page reads. It shares
 * the fetch and the ranking with `getWorkQueueDashboard`, so the two can never
 * disagree about what comes first.
 */
export async function getWorkQueue(
  organizationId: Id,
  /**
   * The route builder for the workspace being read, from `workspaceRoutes()`.
   * A builder rather than a slug: two strings in a row is how an organization
   * id and an address get swapped by accident.
   */
  routes: WorkspaceRoutes,
  client?: SupabaseClient,
): Promise<readonly WorkQueueItem[]> {
  const supabase = client ?? (await createClient());
  const facts = await fetchWorkQueueFacts(organizationId, supabase);
  return buildWorkQueue(facts, routes);
}

/** How many recorded access events to read for the activity panel. */
const ACTIVITY_EVENT_WINDOW = 40;

/** How many preview derivatives to consider across the active-shoot cards. */
const PREVIEW_CANDIDATES = 48;

/** How many active shoots the dashboard summarizes. */
const ACTIVE_SHOOT_LIMIT = 2;

export interface WorkQueueDashboardOptions {
  /**
   * Signed preview URLs per active shoot. Off by default: previews cost one
   * more collection query and one storage signing call, and the screen that
   * shows them has not been built yet. Whoever turns this on takes the ninth
   * round trip knowingly.
   */
  readonly previewsPerShoot?: number;
}

/**
 * Everything the Work Queue screen renders, in one fixed-cost load: eight
 * round trips -- the seven queue facts plus the recorded access events --
 * whatever the workspace holds. The header figures, the money strip, the
 * active-shoot summaries, and the recipient rows are all computed from those
 * same records; nothing is fetched twice. No original is ever read for this
 * screen, and no delivery token leaves the data layer.
 */
export async function getWorkQueueDashboard(
  organizationId: Id,
  routes: WorkspaceRoutes,
  client?: SupabaseClient,
  options: WorkQueueDashboardOptions = {},
): Promise<WorkQueueDashboard> {
  const supabase = client ?? (await createClient());
  const previewsPerShoot = Math.max(0, Math.floor(options.previewsPerShoot ?? 0));

  const [facts, eventRows] = await Promise.all([
    fetchWorkQueueFacts(organizationId, supabase),
    supabase
      .from("delivery_access_events")
      .select("id, delivery_id, kind, occurred_at")
      .eq("organization_id", organizationId)
      .order("occurred_at", { ascending: false })
      .limit(ACTIVITY_EVENT_WINDOW),
  ]);
  if (eventRows.error)
    throw new Error(`Could not load recipient activity: ${eventRows.error.message}`);

  const queue = buildWorkQueue(facts, routes);

  // Shoots arrive most recently updated first, so these are the two with the
  // latest activity.
  const activeShootRecords = facts.shoots
    .filter((shoot) => OPEN_SHOOT_STATUSES.includes(shoot.status))
    .slice(0, ACTIVE_SHOOT_LIMIT);
  const activeShootIds = activeShootRecords.map((shoot) => shoot.id);

  const previewsByShoot =
    previewsPerShoot > 0 && activeShootIds.length > 0
      ? await loadPreviews(supabase, organizationId, activeShootIds, previewsPerShoot)
      : new Map<string, string[]>();

  const events: AccessEventRow[] = (eventRows.data ?? []).map((row) => ({
    id: row.id as string,
    deliveryId: row.delivery_id as string,
    kind: row.kind as AccessEventRow["kind"],
    occurredAt: row.occurred_at as string,
  }));

  const recipientActivity = buildRecipientActivity(
    events,
    facts.deliveries,
    facts.submissions,
    facts.packages,
    routes,
  );

  const submissionsByPackage = new Map<string, Submission[]>();
  for (const submission of facts.submissions) {
    submissionsByPackage.set(submission.packageId, [
      ...(submissionsByPackage.get(submission.packageId) ?? []),
      submission,
    ]);
  }
  const packagesByShoot = new Map<string, DispatchPackage[]>();
  for (const pkg of facts.packages) {
    packagesByShoot.set(pkg.shootId, [...(packagesByShoot.get(pkg.shootId) ?? []), pkg]);
  }

  const activeShoots: ActiveShootSummary[] = activeShootRecords.map((shoot) => {
    const totals = facts.assetTotalsByShoot.get(shoot.id) ?? { total: 0, selected: 0 };
    const selection = reviewSelection(facts.selectedAssetsByShoot.get(shoot.id) ?? []);
    const shootPackages = packagesByShoot.get(shoot.id) ?? [];
    // listPackages orders newest first, so the first is the latest.
    const latestPackage = shootPackages[0];
    const shootSubmissions = shootPackages.flatMap((pkg) => submissionsByPackage.get(pkg.id) ?? []);
    const unlinkedSubmission = shootSubmissions.find(
      (submission) =>
        submission.status === "queued" &&
        (facts.deliveryCountBySubmission.get(submission.id) ?? 0) === 0,
    );
    const linkedCount = shootSubmissions.reduce(
      (count, submission) => count + (facts.deliveryCountBySubmission.get(submission.id) ?? 0),
      0,
    );

    const action = unlinkedSubmission
      ? { label: "Create recipient link", href: routes.submission(unlinkedSubmission.id) }
      : selection.total > 0 && selection.blocked > 0
        ? { label: "Complete metadata", href: routes.shoot(shoot.id) }
        : latestPackage && ["needs_review", "ready"].includes(latestPackage.status)
          ? {
              label: "Review package",
              href: routes.dispatch({ shootId: shoot.id, packageId: latestPackage.id }),
            }
          : { label: "Open shoot", href: routes.shoot(shoot.id) };

    return {
      id: shoot.id,
      title: shoot.title,
      status: shoot.status,
      locationName: shoot.locationName,
      totalAssets: totals.total,
      selectedCount: totals.selected,
      metadataPercent: selection.completionPercent,
      blockedCount: selection.blocked,
      packageLabel: latestPackage
        ? latestPackage.status === "needs_review"
          ? "Needs review"
          : latestPackage.status.charAt(0).toUpperCase() + latestPackage.status.slice(1)
        : null,
      linkLabel:
        shootSubmissions.length === 0
          ? null
          : unlinkedSubmission
            ? "No recipient link"
            : linkedCount > 0
              ? "Recipient link created"
              : null,
      lastActivityAt: shoot.updatedAt,
      actionLabel: action.label,
      actionHref: action.href,
      previewUrls: previewsByShoot.get(shoot.id) ?? [],
    };
  });

  return {
    nextUp: queue[0] ?? null,
    queue,
    counts: workQueueCounts(queue),
    activeShoots,
    recipientActivity,
    money: buildMoneySummary(facts.payments, facts.submissions),
    pulse: buildWorkPulse(facts),
  };
}

/**
 * Up to `perShoot` signed preview URLs for each active shoot, selected frames
 * first. One collection query over derivative versions and one storage
 * signing call; never an original.
 */
async function loadPreviews(
  supabase: SupabaseClient,
  organizationId: Id,
  shootIds: readonly string[],
  perShoot: number,
): Promise<Map<string, string[]>> {
  const { data } = await supabase
    .from("asset_versions")
    .select("asset_id, version_kind, object_key, storage_bucket, assets!inner(shoot_id, selected)")
    .eq("organization_id", organizationId)
    .in("version_kind", ["preview", "thumbnail"])
    .eq("storage_bucket", "derivatives")
    .in("assets.shoot_id", [...shootIds])
    .order("created_at", { ascending: true })
    .limit(PREVIEW_CANDIDATES);

  const records = (data ?? []).map((row) => {
    const rel = row.assets as unknown as { shoot_id: string; selected: boolean } | null;
    return {
      objectKey: row.object_key as string,
      shootId: rel?.shoot_id ?? "",
      selected: Boolean(rel?.selected),
    };
  });

  const keysByShoot = new Map<string, string[]>();
  for (const pass of [true, false]) {
    for (const version of records) {
      if (version.selected !== pass || !version.shootId) continue;
      const bucket = keysByShoot.get(version.shootId) ?? [];
      if (bucket.length >= perShoot || bucket.includes(version.objectKey)) continue;
      bucket.push(version.objectKey);
      keysByShoot.set(version.shootId, bucket);
    }
  }

  const signed = await signedUrlsFor(
    supabase,
    "derivatives",
    [...keysByShoot.values()].flat(),
    600,
  );
  const urlsByShoot = new Map<string, string[]>();
  for (const [shootId, keys] of keysByShoot) {
    urlsByShoot.set(
      shootId,
      keys.map((key) => signed.get(key)).filter((url): url is string => Boolean(url)),
    );
  }
  return urlsByShoot;
}

/** Median minutes from the start of a shoot to its first dispatch. */
export async function getMedianDispatchMinutes(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<number> {
  const supabase = client ?? (await createClient());
  const [submissions, shootRows, packages] = await Promise.all([
    listSubmissions(organizationId, supabase),
    supabase.from("shoots").select("id, starts_at").eq("organization_id", organizationId),
    listPackages(organizationId, {}, supabase),
  ]);
  const shoots = (shootRows.data ?? []).map((row) => ({
    id: row.id as string,
    startsAt: (row.starts_at as string | null) ?? undefined,
  }));
  return medianDispatchMinutes(submissions, shoots, packages);
}

export async function getWorkPulse(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<WorkPulse> {
  const supabase = client ?? (await createClient());
  const [summary, dispatchMinutes] = await Promise.all([
    getMoneySummary(organizationId, supabase),
    getMedianDispatchMinutes(organizationId, supabase),
  ]);

  return {
    netReceived: summary.netReceived,
    outstanding: summary.outstanding,
    unmatched: summary.unallocatedStatementTotal,
    overdueCount: summary.overdueCount,
    medianDispatchMinutes: dispatchMinutes,
  };
}
