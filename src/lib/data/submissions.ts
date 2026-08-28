import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id, PackageAsset, Submission, SubmissionStatus } from "../domain";
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
 * How many references to try before giving up.
 *
 * The tail is one of nine thousand values, and the constraint is per workspace
 * per reference, so a collision needs the same buyer, the same day, and the
 * same draw. That is rare per dispatch and not rare at all across a busy day:
 * at forty dispatches to one agency it is roughly one run in twelve, which is a
 * birthday problem rather than bad luck. Six attempts takes the chance of
 * exhausting them to nothing a photographer will meet.
 */
const REFERENCE_ATTEMPTS = 6;

/** Postgres unique_violation. What the database says when the tail is taken. */
const UNIQUE_VIOLATION = "23505";

/** A reference a picture desk can quote back, e.g. BG-0820-4417. */
function buildReference(buyerName: string | null, sentAt: Date): string {
  const initials = (buyerName ?? "MS")
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 3);
  const month = String(sentAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(sentAt.getUTCDate()).padStart(2, "0");
  const tail = Math.floor(Math.random() * 9000 + 1000);
  return `${initials || "MS"}-${month}${day}-${tail}`;
}

/**
 * Approve a package and open a submission for it.
 *
 * This freezes the commercial package: the frames, the exact versions, their
 * ordering, the buyer, the terms, the restrictions, the exclusivity, and the
 * embargo all become permanent here, and the database enforces it from this
 * moment rather than from a send that has not happened.
 *
 * What it deliberately does NOT do is claim a transmission. It used to: it set
 * the package to `delivered`, the submission to `sent`, stamped `sent_at`,
 * wrote a `submission.sent` event reading "Sent to <buyer>", and moved the
 * shoot to `dispatched` -- all before a delivery link existed and before a
 * single byte had left Mastline. Every one of those was a claim the product
 * could not support.
 *
 * So the package becomes `approved`, the submission is created `queued` with
 * `sent_at` null, one `package.approved` event is written, and the shoot is
 * left alone. The next honest step is a recipient-specific link, which is where
 * the caller redirects to.
 *
 * The order is deliberate and it refuses to proceed if any step fails:
 *
 *   1. Re-read the package and its members. The caller's view may be stale, and
 *      what gets frozen must be what is true now.
 *   2. Stamp the approval on the package.
 *   3. Write the submission with a full snapshot of terms and membership.
 *
 * The caller must have already run the dispatch review. This re-checks the
 * things that would corrupt the record rather than trusting that it happened.
 */
export async function approvePackageAndCreateSubmission(input: {
  organizationId: Id;
  actorId: Id;
  packageId: Id;
  recipientLabel?: string;
  followUpAt?: string;
  /** The caller's client, so row level security applies to every step. */
  client?: SupabaseClient;
}): Promise<{ submissionId: Id; reference: string }> {
  const { organizationId, actorId, packageId, recipientLabel, followUpAt } = input;
  const supabase = input.client ?? (await createClient());

  const { data: pkg, error: pkgError } = await supabase
    .from("packages")
    .select(
      "id, status, buyer_id, delivery_method, proposed_terms, restrictions, exclusivity, embargo_until, package_note, shoot_id, buyers(name, contact_name)",
    )
    .eq("organization_id", organizationId)
    .eq("id", packageId)
    .maybeSingle();

  if (pkgError) throw new Error(`Could not read the package: ${pkgError.message}`);
  if (!pkg) throw new Error("That package could not be found in this workspace.");

  if (["approved", "sending", "delivered"].includes(pkg.status as string)) {
    throw new Error("This package has already been approved.");
  }
  if (!pkg.buyer_id) throw new Error("Set a buyer before approving.");
  if (!pkg.delivery_method) throw new Error("Record a delivery method before approving.");
  if (!pkg.proposed_terms) throw new Error("Record the proposed terms before approving.");

  const { data: members, error: memberError } = await supabase
    .from("package_assets")
    .select("asset_id, asset_version_id, position")
    .eq("organization_id", organizationId)
    .eq("package_id", packageId)
    .order("position");

  if (memberError) throw new Error(`Could not read the package contents: ${memberError.message}`);
  if (!members || members.length === 0) throw new Error("The package is empty.");

  const approvedAt = new Date();
  const buyer = pkg.buyers as unknown as { name: string; contact_name: string | null } | null;
  let reference = buildReference(buyer?.name ?? null, approvedAt);

  // The package records that it was approved, by whom, and when. `approved`,
  // not `delivered`: nothing has been delivered.
  const { error: approveError } = await supabase
    .from("packages")
    .update({
      status: "approved",
      approved_by: actorId,
      approved_at: approvedAt.toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("id", packageId);

  if (approveError) throw new Error(`Could not approve the package: ${approveError.message}`);

  const manifest = members.map((row) => ({
    assetId: row.asset_id as string,
    assetVersionId: row.asset_version_id as string,
    position: row.position as number,
  }));

  /**
   * Everything about the approval except the reference, which is the one field
   * that may have to be drawn again.
   *
   * `sent_at` is absent rather than null-by-omission: there is no send. It is
   * filled in later by the share, or by a recipient opening the link.
   */
  const record = {
    organization_id: organizationId,
    package_id: packageId,
    buyer_id: pkg.buyer_id,
    status: "queued",
    recipient_snapshot: {
      desk: recipientLabel ?? buyer?.contact_name ?? null,
      buyer_name: buyer?.name ?? null,
    },
    terms_snapshot: pkg.proposed_terms,
    restrictions_snapshot: pkg.restrictions,
    // Exactly which versions were approved, frozen at this moment.
    delivery_manifest: {
      assets: manifest,
      asset_count: manifest.length,
      exclusivity: pkg.exclusivity,
      embargo_until: pkg.embargo_until,
      package_note: pkg.package_note,
    },
    delivery_method: pkg.delivery_method,
    follow_up_at: followUpAt ?? null,
    created_by: actorId,
  };

  /*
   * Draw a reference, and let the database be the one that says it is free.
   *
   * The tail was a single random draw with no second chance, so two dispatches
   * to the same agency on the same day that happened to draw the same number
   * ended here: "duplicate key value violates unique constraint", raised at the
   * point of no return, with the package rolled back and nothing the
   * photographer could do differently. It is not a rare shape either -- same
   * buyer, same day is the ordinary case, and the numbers collide long before
   * anybody would expect them to.
   *
   * Checking first would not fix it. Between a select and an insert another
   * dispatch can take the number, and this is exactly the moment not to have a
   * race. So the insert is the check: a unique violation means that reference
   * is taken, and only that, so it draws another and tries again. Any other
   * error is a real failure and breaks out immediately rather than being
   * retried into a storm.
   */
  let submission: { id: string } | null = null;
  let submissionError: { code?: string; message: string } | null = null;

  for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
    const result = await supabase
      .from("submissions")
      .insert({ ...record, external_reference: reference })
      .select("id")
      .single();

    if (!result.error && result.data) {
      submission = result.data as { id: string };
      submissionError = null;
      break;
    }

    submissionError = result.error;
    if (result.error?.code !== UNIQUE_VIOLATION) break;

    // Taken. The next draw is independent, so this converges quickly.
    reference = buildReference(buyer?.name ?? null, approvedAt);
  }

  if (submissionError || !submission) {
    // Put the package back so the operator can try again rather than being
    // left with an approved -- and therefore frozen -- package and no record of
    // what it was approved for.
    await supabase
      .from("packages")
      .update({ status: "needs_review", approved_by: null, approved_at: null })
      .eq("id", packageId);
    throw new Error(`Could not record the submission: ${submissionError?.message}`);
  }

  const submissionId = submission.id as string;

  /*
   * The shoot is NOT moved to `dispatched` here. Nothing has been dispatched.
   * That happens when a link for this submission is marked shared, which is the
   * first moment anybody can honestly say the work left.
   */

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "package",
    entityId: packageId,
    action: "package.approved",
    data: {
      summary: `Package approved · ${manifest.length} ${manifest.length === 1 ? "frame" : "frames"} · nothing sent yet`,
      count: manifest.length,
      submission_id: submissionId,
      reference,
    },
  });

  return { submissionId, reference };
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
