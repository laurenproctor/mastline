import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id } from "../domain";
import type { MetadataJobStatus } from "../asset-metadata";
import { createAdminClient } from "../supabase/admin";
import { hasServiceRoleKey } from "../supabase/env";
import { recordEventWith } from "./activity";
import {
  applyGeneratedMetadata,
  applyTechnicalMetadata,
  ensureMetadataRecord,
  markGenerationFailed,
  markGenerationProcessing,
  markGenerationQueued,
} from "./asset-metadata";
import {
  generateMetadataForAsset,
  generationIsConfigured,
  readExifFromOriginal,
  readOriginalFacts,
} from "./metadata-generation";

/**
 * The queue, and the thing that drains it.
 *
 * WHY THIS SHAPE
 *
 * A photographer drops a card and expects to see frames immediately. Reading
 * twenty-four of them with a vision model takes far longer than a request may
 * take, so generation cannot happen inside the import -- and it cannot happen
 * only in the browser either, because a tab that closes must not lose work that
 * was promised.
 *
 * Vercel gives no worker process, and CLAUDE.md requires asking before adding a
 * managed queue. What it does give is `after()`: code that runs on the same
 * invocation once the response has been flushed. So the durable state lives in
 * Postgres, and the compute is borrowed from the request that enqueued the
 * work:
 *
 *   1. A Server Action inserts a job row and returns immediately.
 *   2. `after()` drains a few jobs on the same invocation, after the response.
 *   3. Anything that invocation did not reach -- a batch larger than the drain,
 *      a worker killed mid-frame -- is picked up by the sweep endpoint, which a
 *      scheduler calls, and by the next drain either way.
 *
 * THE TRADE-OFF, STATED PLAINLY
 *
 * There is no guaranteed latency. A single frame generated with nothing else
 * running is drained by its own request within seconds; a card of two hundred
 * with no scheduler configured is drained a few at a time by whatever requests
 * follow, and by the operator pressing Generate again. That is the price of not
 * adding a queue service, and it is the right price at this stage: the failure
 * mode is "slower than you would like", never "lost", because the row is in
 * Postgres and the lease expires.
 *
 * WHAT MAKES IT SAFE
 *
 *   Idempotent   A job is claimed under a lease and completed under a token. A
 *                worker whose lease expired cannot write an outcome over the
 *                run that replaced it.
 *   Deduplicated A partial unique index allows one live job per photograph, so
 *                a double click costs one model call.
 *   Retry-safe   A retryable failure returns the row to `queued` with a
 *                backoff, up to max_attempts, then stops.
 *   Bounded      A deleted or tombstoned photograph cancels its jobs by
 *                trigger, and the worker re-reads the asset before spending
 *                anything.
 *   Observable   Every terminal outcome is an activity event, and the record
 *                itself carries the status the panel renders.
 */

export interface MetadataJob {
  readonly id: Id;
  readonly organizationId: Id;
  readonly assetId: Id;
  readonly status: MetadataJobStatus;
  readonly reason: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lockToken?: string;
  readonly requestedBy?: Id;
  readonly failureCode?: string;
  readonly failureDetail?: string;
  readonly createdAt: string;
}

function toJob(row: Record<string, unknown>): MetadataJob {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    assetId: row.asset_id as string,
    status: row.status as MetadataJobStatus,
    reason: row.reason as string,
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 3),
    lockToken: (row.lock_token as string | null) ?? undefined,
    requestedBy: (row.requested_by as string | null) ?? undefined,
    failureCode: (row.failure_code as string | null) ?? undefined,
    failureDetail: (row.failure_detail as string | null) ?? undefined,
    createdAt: row.created_at as string,
  };
}

/**
 * Whether this deployment can actually run a job.
 *
 * Both halves are required and they fail differently: with no model key there
 * is nothing to ask, and with no service role key there is nothing to run the
 * ask. The interface checks this before offering the control, because a button
 * that queues work nothing will ever drain is worse than an absent button.
 */
export function generationIsAvailable(): boolean {
  return generationIsConfigured() && hasServiceRoleKey();
}

export type EnqueueOutcome =
  | { readonly ok: true; readonly jobId: Id }
  | {
      readonly ok: false;
      readonly reason: "already_queued" | "unavailable" | "failed";
      readonly message: string;
    };

/**
 * Ask for a photograph to be described.
 *
 * Inserted through the caller's own client, so row level security decides
 * whether this person may queue work in this workspace. A collision on the
 * partial unique index is the ordinary case, not an error: it means somebody
 * already asked, and the honest answer is to say so.
 */
export async function enqueueGeneration(input: {
  supabase: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  assetId: Id;
  reason?: "upload" | "manual" | "retry" | "bulk";
}): Promise<EnqueueOutcome> {
  const { supabase, organizationId, actorId, assetId, reason = "manual" } = input;

  if (!generationIsAvailable()) {
    return {
      ok: false,
      reason: "unavailable",
      message: "Metadata generation is not configured for this deployment.",
    };
  }

  const { data, error } = await supabase
    .from("asset_metadata_jobs")
    .insert({
      organization_id: organizationId,
      asset_id: assetId,
      reason,
      requested_by: actorId,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 is the partial unique index doing its job.
    if (error.code === "23505") {
      return {
        ok: false,
        reason: "already_queued",
        message: "This photograph is already in the queue.",
      };
    }
    return { ok: false, reason: "failed", message: "That could not be queued." };
  }

  if (!data) return { ok: false, reason: "failed", message: "That could not be queued." };

  await markGenerationQueued({ supabase, organizationId, assetId });

  return { ok: true, jobId: data.id as string };
}

/**
 * How long to wait before trying a failed job again.
 *
 * Exponential from thirty seconds. A rate limit clears in that order of time,
 * and a provider outage that does not is stopped by max_attempts rather than by
 * a longer wait.
 */
export function backoffSeconds(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 600);
}

interface ClaimedRow extends Record<string, unknown> {
  lock_token: string;
}

async function claim(admin: SupabaseClient, limit: number): Promise<MetadataJob[]> {
  const { data, error } = await admin.rpc("claim_metadata_jobs_admin", {
    batch_size: limit,
    lease_seconds: 300,
  });

  if (error) {
    console.warn(`Could not claim metadata jobs: ${error.message}`);
    return [];
  }

  return ((data ?? []) as ClaimedRow[]).map(toJob);
}

async function complete(
  admin: SupabaseClient,
  job: MetadataJob,
  outcome: "succeeded" | "failed" | "cancelled",
  failureDetail?: { code: string; detail: string; retryInSeconds?: number },
): Promise<void> {
  const { error } = await admin.rpc("complete_metadata_job_admin", {
    target_job: job.id,
    token: job.lockToken ?? null,
    outcome,
    code: failureDetail?.code ?? null,
    detail: failureDetail?.detail ?? null,
    retry_in_seconds: failureDetail?.retryInSeconds ?? null,
  });

  if (error) console.warn(`Could not complete metadata job ${job.id}: ${error.message}`);
}

/** The technical half. Never fatal: a missing tag is not a failed job. */
async function extractTechnical(admin: SupabaseClient, job: MetadataJob): Promise<void> {
  try {
    const original = await readOriginalFacts(admin, job.organizationId, job.assetId);
    if (!original) return;

    const exif = await readExifFromOriginal(admin, original);

    await applyTechnicalMetadata({
      supabase: admin,
      organizationId: job.organizationId,
      assetId: job.assetId,
      exif,
      seed: {
        originalFilename: original.originalFilename,
        mimeType: original.mimeType,
        fileBytes: original.bytes,
        width: original.width,
        height: original.height,
        checksumSha256: original.sha256,
      },
    });
  } catch (error) {
    console.warn(
      `Technical metadata could not be read for ${job.assetId}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
}

async function recordJobEvent(
  admin: SupabaseClient,
  job: MetadataJob,
  action: string,
  summary: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  if (!job.requestedBy) return;
  await recordEventWith(admin, {
    organizationId: job.organizationId,
    actorId: job.requestedBy,
    entityType: "asset",
    entityId: job.assetId,
    action,
    data: { summary, job_id: job.id, ...data },
  });
}

/**
 * One job, start to finish.
 *
 * The asset is re-read first and every time. A frame tombstoned between the
 * enqueue and the claim must cost nothing, and the trigger that cancels its
 * jobs cannot reach one already leased.
 */
async function runOne(admin: SupabaseClient, job: MetadataJob): Promise<void> {
  const { data: asset } = await admin
    .from("assets")
    .select("id, status")
    .eq("organization_id", job.organizationId)
    .eq("id", job.assetId)
    .maybeSingle();

  if (!asset || asset.status === "tombstoned") {
    await complete(admin, job, "cancelled", {
      code: "asset_unavailable",
      detail: "The photograph was removed before this ran.",
    });
    return;
  }

  // The record may not exist if a job was queued by a path that did not create
  // one. Cheap, idempotent, and it means the writes below always have a row.
  await ensureMetadataRecord({
    supabase: admin,
    organizationId: job.organizationId,
    assetId: job.assetId,
  });

  await markGenerationProcessing({
    supabase: admin,
    organizationId: job.organizationId,
    assetId: job.assetId,
  });

  await extractTechnical(admin, job);

  const outcome = await generateMetadataForAsset({
    organizationId: job.organizationId,
    assetId: job.assetId,
    client: admin,
  });

  if (!outcome.ok) {
    await handleFailure(admin, job, outcome.failure);
    return;
  }

  const applied = await applyGeneratedMetadata({
    supabase: admin,
    organizationId: job.organizationId,
    assetId: job.assetId,
    generated: outcome.generated,
    model: outcome.model,
    modelVersion: outcome.modelVersion,
  });

  await complete(admin, job, "succeeded");

  await recordJobEvent(
    admin,
    job,
    "asset.metadata_generated",
    applied.status === "confirmed"
      ? "Metadata suggested against a confirmed record; nothing was overwritten"
      : "Metadata generated and is waiting for review",
    {
      written: applied.written,
      skipped: applied.skipped,
      model: outcome.model,
      confidence: outcome.generated.confidence,
    },
  );
}

async function handleFailure(
  admin: SupabaseClient,
  job: MetadataJob,
  // Structural rather than the generation module's own union, so the drain can
  // report a throw it could not classify without inventing a code for it there.
  failure: { code: string; detail: string; retryable: boolean },
): Promise<void> {
  const willRetry = failure.retryable && job.attempts < job.maxAttempts;

  if (willRetry) {
    // Back in the queue, and the record says so. Telling a photographer a frame
    // failed when it is about to be tried again is a lie they would act on.
    await markGenerationQueued({
      supabase: admin,
      organizationId: job.organizationId,
      assetId: job.assetId,
    });
    await complete(admin, job, "failed", {
      code: failure.code,
      detail: failure.detail,
      retryInSeconds: backoffSeconds(job.attempts),
    });
    return;
  }

  await markGenerationFailed({
    supabase: admin,
    organizationId: job.organizationId,
    assetId: job.assetId,
    code: failure.code,
    detail: failure.detail,
  });
  await complete(admin, job, "failed", { code: failure.code, detail: failure.detail });

  await recordJobEvent(admin, job, "asset.metadata_generation_failed", failure.detail, {
    code: failure.code,
  });
}

/**
 * How many frames one invocation will read.
 *
 * Serial rather than parallel, and small. Each job is a model call plus a
 * storage read; running a card's worth at once inside a request that has
 * already responded is how a serverless invocation is killed halfway through
 * one, which then costs a lease expiry rather than nothing.
 */
const DRAIN_LIMIT = 3;

export interface DrainReport {
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
}

/**
 * Take some work and do it.
 *
 * Safe to call from anywhere and at any time, including concurrently: the claim
 * is atomic, so two callers take different rows. Never throws -- it runs after
 * a response has already gone out, where an exception has nobody to tell.
 */
export async function drainMetadataJobs(limit = DRAIN_LIMIT): Promise<DrainReport> {
  if (!generationIsAvailable()) return { claimed: 0, succeeded: 0, failed: 0 };

  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return { claimed: 0, succeeded: 0, failed: 0 };
  }

  const jobs = await claim(admin, limit);
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await runOne(admin, job);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        `Metadata job ${job.id} threw: ${error instanceof Error ? error.message : "unknown"}`,
      );
      // An unexpected throw is retryable by definition: nothing here decided it
      // was not. The lease would expire anyway; releasing it now is faster.
      await handleFailure(admin, job, {
        code: "unexpected_error",
        detail: "The metadata could not be generated.",
        retryable: true,
      });
    }
  }

  return { claimed: jobs.length, succeeded, failed };
}

/** Jobs waiting or running for a workspace. Drives the "N queued" line. */
export async function countPendingJobs(
  organizationId: Id,
  assetIds: readonly Id[],
  client: SupabaseClient,
): Promise<number> {
  if (assetIds.length === 0) return 0;
  const { count } = await client
    .from("asset_metadata_jobs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("asset_id", [...assetIds])
    .in("status", ["queued", "processing"]);
  return count ?? 0;
}
