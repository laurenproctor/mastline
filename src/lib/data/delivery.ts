import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id, SubmissionStatus } from "../domain";
import { createClient } from "../supabase/server";
import { recordEventWith } from "./activity";

/**
 * Delivery attempts.
 *
 * The submission says what was sent and stays frozen. Attempts are the separate
 * log of trying to get it there, so a retry adds a fact rather than editing
 * history. The attempt number is derived from what already exists, which also
 * makes a concurrent double-retry collide on the unique constraint instead of
 * silently recording two attempt ones.
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

  await supabase
    .from("submissions")
    .update({
      status: submissionStatus,
      ...(status === "delivered" ? { delivered_at: new Date().toISOString() } : {}),
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

/**
 * Retry a failed delivery.
 *
 * Refuses anything that is not currently failed, so a retry cannot resend
 * something that already arrived. The submission snapshot is untouched: what
 * goes out again is exactly what went out before.
 */
export async function retryDelivery(input: {
  organizationId: Id;
  actorId: Id;
  submissionId: Id;
  client?: SupabaseClient;
}): Promise<{ attemptNumber: number }> {
  const { organizationId, actorId, submissionId } = input;
  const supabase = input.client ?? (await createClient());

  const { data: submission, error } = await supabase
    .from("submissions")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("id", submissionId)
    .maybeSingle();

  if (error) throw new Error(`Could not read the submission: ${error.message}`);
  if (!submission) throw new Error("That submission could not be found in this workspace.");
  if (submission.status !== "failed") {
    throw new Error(
      `Only a failed delivery can be retried. This submission is ${String(submission.status).replace(/_/g, " ")}.`,
    );
  }

  return recordDeliveryAttempt({
    organizationId,
    submissionId,
    status: "sending",
    actorId,
    client: supabase,
  });
}
