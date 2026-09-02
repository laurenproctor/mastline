import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetVersionKind, Id, PackageAsset, Submission, SubmissionStatus } from "../domain";
import { createClient } from "../supabase/server";
import { isRecordId } from "../validation";
import { recordEventWith } from "./activity";

/**
 * Submissions: the factual record of what was approved, and what became of it.
 *
 * The snapshot is immutable from the moment it is created -- not from `sent_at`,
 * which used to be the trigger's condition and was only ever right while
 * approving a package and sending it were the same motion. They are not. A
 * submission is created `queued` with `sent_at` null and stays there until a
 * person records sharing a link, or somebody opens one.
 *
 * Outcome fields stay open so a sale can be linked afterwards without rewriting
 * history, and the delivery timestamps are forward-only: each is filled in once
 * and never moved.
 *
 * Note on scope: Mastline still transmits nothing. There is no email, no SFTP,
 * no portal integration. What it now does honestly is distinguish approving a
 * package from creating a link for a recipient, sharing that link, and the
 * recipient opening it -- four separate facts that used to be recorded as one.
 */

const SUBMISSION_COLUMNS =
  "id, organization_id, package_id, buyer_id, status, recipient_snapshot, terms_snapshot, restrictions_snapshot, delivery_manifest, delivery_method, external_reference, sent_at, delivered_at, acknowledged_at, follow_up_at, outcome_note, created_at, updated_at";

interface SubmissionRow {
  id: string;
  organization_id: string;
  package_id: string;
  buyer_id: string | null;
  status: string;
  recipient_snapshot: Record<string, unknown> | null;
  terms_snapshot: string | null;
  restrictions_snapshot: string | null;
  delivery_manifest: Record<string, unknown> | null;
  delivery_method: string | null;
  external_reference: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  follow_up_at: string | null;
  outcome_note: string | null;
}

function toSubmission(row: SubmissionRow): Submission {
  const manifest = (row.delivery_manifest?.assets as PackageAsset[] | undefined) ?? [];
  return {
    id: row.id,
    organizationId: row.organization_id,
    packageId: row.package_id,
    buyerId: row.buyer_id ?? undefined,
    status: row.status as SubmissionStatus,
    reference: row.external_reference ?? row.id.slice(0, 8).toUpperCase(),
    recipientLabel: (row.recipient_snapshot?.desk as string | undefined) ?? undefined,
    termsSnapshot: row.terms_snapshot ?? undefined,
    restrictionsSnapshot: row.restrictions_snapshot ?? undefined,
    manifest,
    deliveryMethod: row.delivery_method ?? undefined,
    sentAt: row.sent_at ?? undefined,
    deliveredAt: row.delivered_at ?? undefined,
    followUpAt: row.follow_up_at ?? undefined,
    outcomeNote: row.outcome_note ?? undefined,
  };
}

export async function listSubmissions(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<readonly Submission[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("submissions")
    .select(SUBMISSION_COLUMNS)
    .eq("organization_id", organizationId)
    .order("sent_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load submissions: ${error.message}`);
  return (data ?? []).map((row) => toSubmission(row as unknown as SubmissionRow));
}

export async function getSubmission(
  organizationId: Id,
  submissionId: Id,
): Promise<Submission | null> {
  // A malformed id is "no such record", not a database error.
  if (!isRecordId(submissionId)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("submissions")
    .select(SUBMISSION_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", submissionId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the submission: ${error.message}`);
  return data ? toSubmission(data as unknown as SubmissionRow) : null;
}

/**
 * The submission a package's approval opened, if any.
 *
 * Approval creates exactly one submission per package, so this is how the
 * delivery flow resumes after a partial failure: the approve succeeded, the
 * link did not, and the retry must find the submission rather than approve
 * again.
 */
export async function getSubmissionForPackage(
  organizationId: Id,
  packageId: Id,
  client?: SupabaseClient,
): Promise<Submission | null> {
  if (!isRecordId(packageId)) return null;
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("submissions")
    .select(SUBMISSION_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("package_id", packageId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not load the submission: ${error.message}`);
  return data ? toSubmission(data as unknown as SubmissionRow) : null;
}

/**
 * A frame as it was approved: the exact version and object, and the editorial
 * facts frozen at that moment. Read from `submission_assets`, which is what a
 * recipient link renders and downloads from.
 */
export interface SubmissionFrame {
  /** The snapshot row itself. Never rendered; used to key caches and tests. */
  readonly id: Id;
  readonly assetId: Id;
  readonly assetVersionId: Id;
  readonly position: number;
  readonly filename: string;
  readonly headline?: string;
  readonly caption?: string;
  readonly people: readonly string[];
  readonly creditLine?: string;
  readonly copyrightNotice?: string;
  readonly copyrightOwner?: string;
  readonly capturedAt?: string;
  readonly location?: string;
  readonly usageRestrictions?: string;
  /** The approved object: which kind of version, and its identity. */
  readonly versionKind: AssetVersionKind;
  readonly storageBucket: string;
  readonly sha256: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
  /**
   * The preview derivative the reviewer was shown at approval, when one
   * existed. Absent means the recipient preview is rendered from the approved
   * object itself, or not at all -- never from a preview made later.
   */
  readonly previewVersionId?: Id;
  readonly previewSha256?: string;
  /** Where the frozen preview object lives, for the internal rehearsal only. */
  readonly previewObjectKey?: string;
  readonly previewStorageBucket?: string;
  /**
   * "approval": written by the approval transaction. "legacy_backfill": written
   * by the snapshot migration from the manifest, with the metadata as it stood
   * at migration time -- not provably what the recipient saw at approval.
   */
  readonly origin: "approval" | "legacy_backfill";
  /** When the snapshot was taken: the approval instant, or the migration run. */
  readonly createdAt: string;
}

const FRAME_COLUMNS =
  "id, submission_id, asset_id, asset_version_id, position, filename_snapshot, headline_snapshot, caption_snapshot, people_snapshot, credit_line_snapshot, copyright_notice_snapshot, copyright_owner_snapshot, captured_at_snapshot, location_snapshot, usage_restrictions_snapshot, version_kind_snapshot, storage_bucket_snapshot, sha256_snapshot, mime_type_snapshot, bytes_snapshot, width_snapshot, height_snapshot, preview_asset_version_id, preview_sha256_snapshot, preview_object_key_snapshot, preview_storage_bucket_snapshot, snapshot_origin, created_at";

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

function toFrame(row: Record<string, unknown>): SubmissionFrame {
  const people = row.people_snapshot;
  return {
    id: row.id as string,
    assetId: row.asset_id as string,
    assetVersionId: row.asset_version_id as string,
    position: row.position as number,
    filename: row.filename_snapshot as string,
    headline: text(row.headline_snapshot),
    caption: text(row.caption_snapshot),
    people: Array.isArray(people) ? people.filter((p): p is string => typeof p === "string") : [],
    creditLine: text(row.credit_line_snapshot),
    copyrightNotice: text(row.copyright_notice_snapshot),
    copyrightOwner: text(row.copyright_owner_snapshot),
    capturedAt: text(row.captured_at_snapshot),
    location: text(row.location_snapshot),
    usageRestrictions: text(row.usage_restrictions_snapshot),
    versionKind: row.version_kind_snapshot as AssetVersionKind,
    storageBucket: row.storage_bucket_snapshot as string,
    sha256: row.sha256_snapshot as string,
    mimeType: row.mime_type_snapshot as string,
    bytes: Number(row.bytes_snapshot),
    width: (row.width_snapshot as number | null) ?? undefined,
    height: (row.height_snapshot as number | null) ?? undefined,
    previewVersionId: text(row.preview_asset_version_id),
    previewSha256: text(row.preview_sha256_snapshot),
    previewObjectKey: text(row.preview_object_key_snapshot),
    previewStorageBucket: text(row.preview_storage_bucket_snapshot),
    origin: row.snapshot_origin as SubmissionFrame["origin"],
    createdAt: row.created_at as string,
  };
}

/**
 * Manifest entries the snapshot does not cover.
 *
 * For a submission approved through `approve_package()` this is always empty:
 * the manifest and the rows are written from one read. For a submission that
 * predates the record, the backfill wrote a row per manifest entry it could
 * resolve to a version of its own asset, and skipped -- never substituted --
 * the rest. Those frames are unavailable to every recipient link, and the
 * submission screen says which ones and why.
 */
export function unresolvedManifestEntries(
  manifest: readonly PackageAsset[],
  frames: readonly SubmissionFrame[],
): readonly PackageAsset[] {
  const covered = new Set(frames.map((frame) => `${frame.assetId}:${frame.assetVersionId}`));
  return manifest.filter((entry) => !covered.has(`${entry.assetId}:${entry.assetVersionId}`));
}

/** The approved frames of one submission, in order. Empty for a legacy submission the backfill could not resolve. */
export async function listSubmissionAssets(
  organizationId: Id,
  submissionId: Id,
  client?: SupabaseClient,
): Promise<readonly SubmissionFrame[]> {
  if (!isRecordId(submissionId)) return [];
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("submission_assets")
    .select(FRAME_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("submission_id", submissionId)
    .order("position");

  if (error) throw new Error(`Could not load the approved frames: ${error.message}`);
  return (data ?? []).map((row) => toFrame(row as Record<string, unknown>));
}

/**
 * How many approved submissions each asset appears in.
 *
 * One query for a whole contact sheet, so the inspector can say "this frame is
 * in two approved submissions; editing it here changes neither" without a
 * lookup per frame.
 */
export async function countApprovedSubmissionsByAsset(
  organizationId: Id,
  assetIds: readonly Id[],
  client?: SupabaseClient,
): Promise<ReadonlyMap<Id, number>> {
  const counts = new Map<Id, number>();
  if (assetIds.length === 0) return counts;
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("submission_assets")
    .select("asset_id")
    .eq("organization_id", organizationId)
    .in("asset_id", [...assetIds]);

  if (error) throw new Error(`Could not count approved submissions: ${error.message}`);
  for (const row of data ?? []) {
    const assetId = row.asset_id as string;
    counts.set(assetId, (counts.get(assetId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Approve a package and open a submission for it.
 *
 * One database transaction, inside `approve_package()`: the package and its
 * membership are locked and re-read, every referenced version is verified to
 * belong to its asset and this workspace, the editorial metadata being approved
 * is read behind that lock, the package becomes `approved`, the submission is
 * created with its manifest, one `submission_assets` row is written per frame
 * from the same read, and the approval event is recorded. If any of that
 * fails, none of it happened: there is no partially approved package to put
 * back, which is why the compensating "return it to review" update this
 * function used to make is gone.
 *
 * What it deliberately does NOT do is claim a transmission. The package becomes
 * `approved`, the submission is created `queued` with `sent_at` null, and the
 * shoot is left alone. The next honest step is a recipient-specific link.
 *
 * The caller's client is used so the function runs as the signed-in operator:
 * the database decides membership and role, and a package in another
 * workspace comes back as "could not be found" rather than as anything else.
 */
export async function approvePackageAndCreateSubmission(input: {
  organizationId: Id;
  actorId: Id;
  packageId: Id;
  recipientLabel?: string;
  followUpAt?: string;
  /** The caller's client, so the database authorises the caller. */
  client?: SupabaseClient;
}): Promise<{ submissionId: Id; reference: string }> {
  const { organizationId, packageId, recipientLabel, followUpAt } = input;
  const supabase = input.client ?? (await createClient());

  /*
   * A package outside the caller's workspace must read as "not found" here as
   * well as inside the function. Resolving it through the caller's own client
   * first keeps that answer identical to every other screen's, and a malformed
   * id is "no such record" rather than a database error.
   */
  if (!isRecordId(packageId)) throw new Error("That package could not be found in this workspace.");
  const { data: pkg, error: readError } = await supabase
    .from("packages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", packageId)
    .maybeSingle();
  if (readError) throw new Error(`Could not read the package: ${readError.message}`);
  if (!pkg) throw new Error("That package could not be found in this workspace.");

  const { data, error } = await supabase.rpc("approve_package", {
    target_package: packageId,
    recipient_label: recipientLabel?.trim() || null,
    follow_up_at: followUpAt ? new Date(followUpAt).toISOString() : null,
  });

  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as { submission_id: string; reference: string } | undefined;
  if (!row) throw new Error("Could not record the submission.");

  return { submissionId: row.submission_id, reference: row.reference };
}

/**
 * Set or clear the follow-up reminder on a submission.
 *
 * The one field on the record that is expected to keep moving after the
 * snapshot froze: it is about the photographer's own attention, not about
 * what was sent, which is why the protect trigger leaves it alone.
 */
export async function setSubmissionFollowUp(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  submissionId: Id;
  followUpAt: string | null;
}): Promise<void> {
  const { organizationId, actorId, submissionId, followUpAt } = input;
  const supabase = input.client ?? (await createClient());

  const { error } = await supabase
    .from("submissions")
    .update({ follow_up_at: followUpAt })
    .eq("organization_id", organizationId)
    .eq("id", submissionId);

  if (error) throw new Error(`Could not set the follow-up: ${error.message}`);

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "submission",
    entityId: submissionId,
    action: "submission.follow_up_set",
    data: {
      summary: followUpAt
        ? `Follow-up set for ${followUpAt.slice(0, 10)}`
        : "Follow-up reminder cleared",
    },
  });
}

/**
 * Record what happened to a submission.
 *
 * Outcome fields only. The delivery snapshot is protected by the database, so
 * an attempt to change what was sent fails here rather than quietly succeeding.
 */
export async function recordSubmissionOutcome(input: {
  organizationId: Id;
  actorId: Id;
  submissionId: Id;
  status: SubmissionStatus;
  outcomeNote?: string;
  followUpAt?: string | null;
  client?: SupabaseClient;
}): Promise<void> {
  const { organizationId, actorId, submissionId, status, outcomeNote, followUpAt } = input;
  const supabase = input.client ?? (await createClient());

  /*
   * The delivery timestamps are write-once in the database now, so restating an
   * outcome must not restate them. Recording "delivered" twice used to overwrite
   * the first delivery time with the second; it now raises instead, which is
   * correct but is not what an operator pressing the button again deserves. So
   * they are only ever filled in when they are empty.
   */
  const { data: current, error: readError } = await supabase
    .from("submissions")
    .select("delivered_at, acknowledged_at, sent_at")
    .eq("organization_id", organizationId)
    .eq("id", submissionId)
    .maybeSingle();

  if (readError) throw new Error(`Could not read the submission: ${readError.message}`);
  if (!current) throw new Error("That submission could not be found in this workspace.");

  const now = new Date().toISOString();
  const firstDelivery =
    status === "delivered" && !current.delivered_at ? { delivered_at: now } : {};
  const firstAcknowledgement =
    status === "acknowledged" && !current.acknowledged_at ? { acknowledged_at: now } : {};

  const { error } = await supabase
    .from("submissions")
    .update({
      status,
      outcome_note: outcomeNote ?? null,
      ...(followUpAt !== undefined ? { follow_up_at: followUpAt } : {}),
      ...firstDelivery,
      ...firstAcknowledgement,
    })
    .eq("organization_id", organizationId)
    .eq("id", submissionId);

  if (error) throw new Error(`Could not record the outcome: ${error.message}`);

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "submission",
    entityId: submissionId,
    action: `submission.${status}`,
    data: { summary: `Outcome recorded: ${status.replace(/_/g, " ")}`, status },
  });
}
