import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id, SubmissionStatus } from "../domain";
import { createClient } from "../supabase/server";
import { recordEventWith } from "./activity";

/**
 * Delivery attempts, as reported by a provider.
 *
 * Read this narrowly. Mastline has no transmitter: no email sender, no SFTP
 * client, no agency portal integration. The only thing that can legitimately
 * write a row here is `POST /api/webhooks/delivery/<provider>`, where an
 * external system that genuinely did move a file reports what happened.
 *
 * There used to be a `retryDelivery` beside this, wired to a "Retry delivery"
 * button on the submission screen. It inserted a `sending` attempt and returned
 * "Attempt 2 recorded and queued." Nothing was queued. No worker existed to
 * drain it, and no code path anywhere would ever have moved that attempt off
 * `sending`. It was a database insert wearing the costume of a transmission,
 * and an operator watching a delivery "retry" and stay pending had no way to
 * learn that nothing had been tried. It is gone.
 *
 * What remains is the read side and the webhook side: attempts a provider
 * actually made stay visible as read-only evidence, and the submission status
 * follows what the provider says. When a real delivery provider exists, the
 * operator-facing control comes back with something behind it.
 *
 * The attempt number is derived from what already exists, which makes a
 * concurrent double-report collide on the unique constraint instead of silently
 * recording two attempt ones.
 */

export interface DeliveryAttempt {
  readonly id: Id;
  readonly submissionId: Id;
  readonly attemptNumber: number;
  readonly status: "sending" | "delivered" | "failed";
  readonly errorCode?: string;
  readonly errorDetail?: string;
  readonly attemptedBy?: Id;
  readonly attemptedAt: string;
}

export async function listDeliveryAttempts(
  organizationId: Id,
  submissionId: Id,
  client?: SupabaseClient,
): Promise<readonly DeliveryAttempt[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("submission_delivery_attempts")
    .select(
      "id, submission_id, attempt_number, status, error_code, error_detail, attempted_by, attempted_at",
    )
    .eq("organization_id", organizationId)
    .eq("submission_id", submissionId)
    .order("attempt_number", { ascending: false });

  if (error) throw new Error(`Could not load delivery attempts: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    submissionId: row.submission_id as string,
    attemptNumber: row.attempt_number as number,
    status: row.status as DeliveryAttempt["status"],
    errorCode: (row.error_code as string | null) ?? undefined,
    errorDetail: (row.error_detail as string | null) ?? undefined,
    attemptedBy: (row.attempted_by as string | null) ?? undefined,
    attemptedAt: row.attempted_at as string,
  }));
}

async function nextAttemptNumber(
  supabase: SupabaseClient,
  organizationId: Id,
  submissionId: Id,
): Promise<number> {
  const { data } = await supabase
    .from("submission_delivery_attempts")
    .select("attempt_number")
    .eq("organization_id", organizationId)
    .eq("submission_id", submissionId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data?.attempt_number as number | undefined) ?? 0) + 1;
}

/** Log an attempt and move the submission status to match. */
export async function recordDeliveryAttempt(input: {
  organizationId: Id;
  submissionId: Id;
  status: "sending" | "delivered" | "failed";
  actorId?: Id;
  errorCode?: string;
  errorDetail?: string;
  client?: SupabaseClient;
}): Promise<{ attemptNumber: number }> {
  const { organizationId, submissionId, status, actorId, errorCode, errorDetail } = input;
  const supabase = input.client ?? (await createClient());

  const attemptNumber = await nextAttemptNumber(supabase, organizationId, submissionId);

  const { error } = await supabase.from("submission_delivery_attempts").insert({
    organization_id: organizationId,
    submission_id: submissionId,
    attempt_number: attemptNumber,
    status,
    error_code: errorCode ?? null,
    error_detail: errorDetail ?? null,
    attempted_by: actorId ?? null,
  });

  if (error) throw new Error(`Could not record the delivery attempt: ${error.message}`);

  const submissionStatus: SubmissionStatus =
    status === "delivered" ? "delivered" : status === "failed" ? "failed" : "sent";

  /*
   * `delivered_at` is write-once in the database. A provider reporting a second
   * successful attempt -- a redelivery, a duplicated webhook that got past the
   * idempotency key -- must not move the first delivery time, so it is only
   * filled in when it is empty.
   */
  const { data: current } = await supabase
    .from("submissions")
    .select("delivered_at")
    .eq("organization_id", organizationId)
    .eq("id", submissionId)
    .maybeSingle();

  await supabase
    .from("submissions")
    .update({
      status: submissionStatus,
      ...(status === "delivered" && !current?.delivered_at
        ? { delivered_at: new Date().toISOString() }
        : {}),
    })
    .eq("organization_id", organizationId)
    .eq("id", submissionId);

  await recordEventWith(supabase, {
    organizationId,
    actorId: actorId ?? "",
    entityType: "submission",
    entityId: submissionId,
    action: `submission.delivery_${status}`,
    data: {
      summary:
        status === "failed"
          ? `Delivery attempt ${attemptNumber} failed${errorCode ? `: ${errorCode}` : ""}`
          : `Delivery attempt ${attemptNumber} ${status}`,
      attempt_number: attemptNumber,
      error_code: errorCode ?? null,
    },
  });

  return { attemptNumber };
}
