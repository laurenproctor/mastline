/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, clientFor, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * The durable queue, end to end, with the provider replaced.
 *
 * Nothing here calls a model. The whole point of the job runner is what happens
 * AROUND the call -- claiming under a lease, not spending twice on one frame,
 * retrying what is worth retrying, giving up on what is not, and noticing that
 * the photograph has been removed -- and every one of those is testable only if
 * the call itself is a value this file chooses.
 *
 * The mock is declared with vi.hoisted because vi.mock is lifted above the
 * imports; a plain `let` would still be in the temporal dead zone when the
 * factory runs.
 */
const provider = vi.hoisted(() => ({
  generate: vi.fn(),
  configured: true,
}));

vi.mock("../src/lib/data/metadata-generation", () => ({
  generationIsConfigured: () => provider.configured,
  generateMetadataForAsset: provider.generate,
  // The technical pass reads storage, which these fixtures do not have. It is
  // allowed to find nothing, exactly as it is for a RAW with no readable
  // header, and the job must still succeed.
  readOriginalFacts: async () => null,
  readExifFromOriginal: async () => null,
  failure: (code: string) => ({ code, detail: "mocked", retryable: false }),
}));

const { backoffSeconds, drainMetadataJobs, enqueueGeneration, generationIsAvailable } =
  await import("../src/lib/data/metadata-jobs");
const { ensureMetadataRecord, getMetadata, saveMetadata } =
  await import("../src/lib/data/asset-metadata");
const { resolveMetadata } = await import("../src/lib/asset-metadata");

const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const EDITOR = "22222222-2222-2222-2222-222222222222";

const shoots: string[] = [];
let shootId: string;

const GENERATED = {
  headline: "Two people leave a hotel",
  editorialCaption: "Two people walk out of a lit side entrance at night.",
  altText: "Two people walking out of a lit doorway at night.",
  scene: "walking to a waiting car",
  objects: ["car"],
  clothing: ["dark coat"],
  brands: [],
  keywords: ["hotel", "night"],
  contentCategory: "candid" as const,
  qualityEstimate: "good" as const,
  sensitivity: "none" as const,
  basis: "Read from the image.",
  confidence: 0.68,
  fieldConfidence: { editorialCaption: 0.7 },
};

const SUCCESS = {
  ok: true as const,
  generated: GENERATED,
  model: "claude-haiku-4-5",
  modelVersion: "claude-haiku-4-5-20251001",
};

async function makeAsset(filename: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("assets")
    .insert({
      organization_id: ORG_A,
      shoot_id: shootId,
      status: "active",
      canonical_filename: `${filename}_${Math.round(performance.now())}`,
      created_by: OWNER,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await ensureMetadataRecord({
    supabase: serviceClient(),
    organizationId: ORG_A,
    assetId: data!.id as string,
  });
  return data!.id as string;
}

async function jobFor(assetId: string) {
  const { data } = await serviceClient()
    .from("asset_metadata_jobs")
    .select("id, status, attempts, run_after, lock_token, failure_code, finished_at")
    .eq("asset_id", assetId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Nothing else's work may be claimed by this file's drains.
 *
 * The claim is deliberately global -- a worker takes whatever is runnable, not
 * whatever belongs to one workspace -- so the fixtures have to start from an
 * empty queue or a stray row from another test would be picked up first.
 */
async function clearQueue(): Promise<void> {
  await serviceClient().from("asset_metadata_jobs").delete().in("status", ["queued", "processing"]);
}

beforeAll(async () => {
  if (!hasLocalSupabase()) return;
  const { data } = await serviceClient()
    .from("shoots")
    .insert({
      organization_id: ORG_A,
      title: `Metadata jobs ${Date.now()}`,
      status: "preparing",
      location_name: "Dean Street, London",
      created_by: OWNER,
    })
    .select("id")
    .single();
  shootId = data!.id as string;
  shoots.push(shootId);
});

beforeEach(async () => {
  if (!hasLocalSupabase()) return;
  provider.configured = true;
  provider.generate.mockReset();
  provider.generate.mockResolvedValue(SUCCESS);
  await clearQueue();
});

afterAll(async () => {
  if (!hasLocalSupabase()) return;
  await clearQueue();
  for (const id of shoots) await purgeShoot(id);
});

// ---------------------------------------------------------------------------

describeIf("queueing work", () => {
  it("enqueues a job and says so on the record straight away", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("JOB_0001");

    const outcome = await enqueueGeneration({
      supabase: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId,
    });

    expect(outcome.ok).toBe(true);
    // The photographer sees "Queued" before any work has been done, which is
    // the whole reason the upload is not blocked.
    expect((await getMetadata(ORG_A, assetId, editor))?.generationStatus).toBe("queued");
  });

  it("costs one model call when the button is pressed twice", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("JOB_0002");

    const first = await enqueueGeneration({
      supabase: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId,
    });
    const second = await enqueueGeneration({
      supabase: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.reason).toBe("already_queued");

    await drainMetadataJobs(10);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it("refuses to queue anything when nothing could ever drain it", async () => {
    provider.configured = false;
    const editor = await clientFor("editor");
    const assetId = await makeAsset("JOB_0003");

    const outcome = await enqueueGeneration({
      supabase: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe("unavailable");
    expect(generationIsAvailable()).toBe(false);
  });

  it("does not move a confirmed record back into a queue", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("JOB_0004");

    await saveMetadata({
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId,
      values: {
        headline: "Confirmed by a person",
        subjects: [],
        objects: [],
        clothing: [],
        brands: [],
        keywords: [],
        sensitivity: "none",
        editorialUseOnly: true,
        commercialUseEligible: "unknown",
        modelReleaseStatus: "unknown",
        propertyReleaseStatus: "unknown",
        sensitiveOrMinor: false,
      },
      expectedVersion: 1,
      shoot: null,
      confirm: true,
      client: editor,
    });

    await enqueueGeneration({
      supabase: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      assetId,
    });

    // Asking for a second opinion does not un-confirm anything.
    expect((await getMetadata(ORG_A, assetId, editor))?.generationStatus).toBe("confirmed");

    await drainMetadataJobs(10);

    const record = await getMetadata(ORG_A, assetId, editor);
    expect(record?.generationStatus).toBe("confirmed");
    expect(record?.editorial.headline).toBe("Confirmed by a person");
    // The opinion is recorded, just not applied.
    expect(record?.generatedValues).toMatchObject({ headline: "Two people leave a hotel" });
  });
});

// ---------------------------------------------------------------------------

describeIf("draining the queue", () => {
  it("runs a job and leaves the record needing review", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("RUN_0001");
    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });

    const report = await drainMetadataJobs(10);
    expect(report.claimed).toBe(1);

    const record = await getMetadata(ORG_A, assetId, editor);
    expect(record?.generationStatus).toBe("needs_review");
    expect(record?.editorial.editorialCaption).toBe(
      "Two people walk out of a lit side entrance at night.",
    );
    expect(record?.aiModel).toBe("claude-haiku-4-5");

    // And the values are labelled as the machine's until somebody says otherwise.
    expect(resolveMetadata(record, null).needsReview).toContain("editorialCaption");

    const job = await jobFor(assetId);
    expect(job?.status).toBe("succeeded");
    expect(job?.finished_at).toBeTruthy();
  });

  it("records what happened as an activity event", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("RUN_0002");
    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });
    await drainMetadataJobs(10);

    const { data } = await serviceClient()
      .from("activity_events")
      .select("action")
      .eq("entity_id", assetId);
    expect((data ?? []).map((row) => row.action)).toContain("asset.metadata_generated");
  });

  it("does nothing, and claims nothing, when the queue is empty", async () => {
    expect(await drainMetadataJobs(10)).toEqual({ claimed: 0, succeeded: 0, failed: 0 });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("is safe to run twice: the second drain finds the job already finished", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("RUN_0003");
    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });

    await drainMetadataJobs(10);
    const second = await drainMetadataJobs(10);

    expect(second.claimed).toBe(0);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------

describeIf("failure and retry", () => {
  it("puts a retryable failure back in the queue rather than telling anybody it failed", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("FAIL_0001");
    provider.generate.mockResolvedValue({
      ok: false,
      failure: { code: "rate_limited", detail: "Too many frames at once.", retryable: true },
    });

    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });
    await drainMetadataJobs(10);

    const job = await jobFor(assetId);
    expect(job?.status).toBe("queued");
    expect(job?.attempts).toBe(1);
    expect(new Date(job!.run_after as string).getTime()).toBeGreaterThan(Date.now());

    // Saying "failed" to somebody whose frame is about to be retried is a lie
    // they would act on.
    expect((await getMetadata(ORG_A, assetId, editor))?.generationStatus).toBe("queued");
  });

  it("succeeds on the retry, which is what the backoff is for", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("FAIL_0002");
    provider.generate.mockResolvedValueOnce({
      ok: false,
      failure: { code: "provider_error", detail: "The service was unavailable.", retryable: true },
    });
    provider.generate.mockResolvedValue(SUCCESS);

    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });
    await drainMetadataJobs(10);

    // Bring the retry forward rather than waiting out the backoff.
    await serviceClient()
      .from("asset_metadata_jobs")
      .update({ run_after: new Date(Date.now() - 1000).toISOString() })
      .eq("asset_id", assetId);

    await drainMetadataJobs(10);

    expect((await jobFor(assetId))?.status).toBe("succeeded");
    expect((await getMetadata(ORG_A, assetId, editor))?.generationStatus).toBe("needs_review");
  });

  it("gives up after max_attempts and says so on the record", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("FAIL_0003");
    provider.generate.mockResolvedValue({
      ok: false,
      failure: { code: "provider_error", detail: "The service was unavailable.", retryable: true },
    });

    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });

    // Three attempts is the default ceiling; the fourth drain finds nothing.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await serviceClient()
        .from("asset_metadata_jobs")
        .update({ run_after: new Date(Date.now() - 1000).toISOString() })
        .eq("asset_id", assetId);
      await drainMetadataJobs(10);
    }

    const job = await jobFor(assetId);
    expect(job?.status).toBe("failed");
    expect(job?.attempts).toBe(3);

    const record = await getMetadata(ORG_A, assetId, editor);
    expect(record?.generationStatus).toBe("failed");
    expect(record?.failureCode).toBe("provider_error");
  });

  it("stops immediately on a failure no retry could fix", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("FAIL_0004");
    provider.generate.mockResolvedValue({
      ok: false,
      failure: {
        code: "no_frame",
        detail: "There is no readable preview for this file.",
        retryable: false,
      },
    });

    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });
    await drainMetadataJobs(10);

    expect((await jobFor(assetId))?.status).toBe("failed");
    expect(provider.generate).toHaveBeenCalledTimes(1);

    const record = await getMetadata(ORG_A, assetId, editor);
    expect(record?.generationStatus).toBe("failed");
    // A photographer reads this. It carries no provider text, no request id.
    expect(record?.failureDetail).toBe("There is no readable preview for this file.");
  });

  it("survives an unexpected throw by putting the job back rather than losing it", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("FAIL_0005");
    provider.generate.mockRejectedValue(new Error("something nobody anticipated"));

    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });
    const report = await drainMetadataJobs(10);

    expect(report.failed).toBe(1);
    const job = await jobFor(assetId);
    expect(job?.status).toBe("queued");
    expect(job?.failure_code).toBe("unexpected_error");
  });

  it("backs off further each time, and stops growing", async () => {
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(2)).toBe(60);
    expect(backoffSeconds(3)).toBe(120);
    expect(backoffSeconds(20)).toBe(600);
  });
});

// ---------------------------------------------------------------------------

describeIf("a photograph that goes away", () => {
  it("cancels queued work the moment the photograph is tombstoned", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("GONE_0001");
    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });

    await serviceClient()
      .from("assets")
      .update({ status: "tombstoned", tombstone_reason: "Removed by the operator" })
      .eq("id", assetId);

    // The trigger reached it before any worker did.
    expect((await jobFor(assetId))?.status).toBe("cancelled");

    await drainMetadataJobs(10);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("spends nothing on a photograph tombstoned after its job was claimed", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("GONE_0002");
    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });

    // Claim it by hand, the way a worker does, then remove the photograph. The
    // trigger cannot reach a job already leased, so the worker's own re-read is
    // the only thing standing between this and a wasted model call.
    const { data: claimed } = await serviceClient().rpc("claim_metadata_jobs_admin", {
      batch_size: 5,
      lease_seconds: 300,
    });
    expect((claimed ?? []).length).toBe(1);

    await serviceClient()
      .from("assets")
      .update({ status: "tombstoned", tombstone_reason: "Removed mid-flight" })
      .eq("id", assetId);

    // Expire the lease so the next drain reclaims the same job.
    await serviceClient()
      .from("asset_metadata_jobs")
      .update({ locked_until: new Date(Date.now() - 1000).toISOString() })
      .eq("asset_id", assetId);

    await drainMetadataJobs(10);

    expect(provider.generate).not.toHaveBeenCalled();
    expect((await jobFor(assetId))?.status).toBe("cancelled");
  });

  it("takes the metadata and the jobs with it when the photograph is purged", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("GONE_0003");
    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });

    await serviceClient().from("payment_allocations").delete().eq("asset_id", assetId);
    const { error } = await serviceClient().rpc("purge_asset_admin", { target_asset: assetId });
    expect(error).toBeNull();

    expect(await getMetadata(ORG_A, assetId, serviceClient())).toBeNull();
    expect(await jobFor(assetId)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describeIf("the lease", () => {
  it("reclaims a job whose worker died, instead of stranding it in processing", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("LEASE_0001");
    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });

    await serviceClient().rpc("claim_metadata_jobs_admin", { batch_size: 5, lease_seconds: 300 });
    await serviceClient()
      .from("asset_metadata_jobs")
      .update({ locked_until: new Date(Date.now() - 1000).toISOString() })
      .eq("asset_id", assetId);

    const report = await drainMetadataJobs(10);
    expect(report.claimed).toBe(1);
    expect((await jobFor(assetId))?.status).toBe("succeeded");
  });

  it("refuses an outcome from a worker whose lease was taken away", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("LEASE_0002");
    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });

    const service = serviceClient();
    const { data: first } = await service.rpc("claim_metadata_jobs_admin", {
      batch_size: 5,
      lease_seconds: 300,
    });
    const staleToken = (first ?? [])[0].lock_token as string;
    const jobId = (first ?? [])[0].id as string;

    // The lease expires and somebody else takes the job.
    await service
      .from("asset_metadata_jobs")
      .update({ locked_until: new Date(Date.now() - 1000).toISOString() })
      .eq("id", jobId);
    const { data: second } = await service.rpc("claim_metadata_jobs_admin", {
      batch_size: 5,
      lease_seconds: 300,
    });
    expect((second ?? [])[0].lock_token).not.toBe(staleToken);

    // The first worker wakes up and tries to write its outcome anyway.
    const { data: refused } = await service.rpc("complete_metadata_job_admin", {
      target_job: jobId,
      token: staleToken,
      outcome: "succeeded",
      code: null,
      detail: null,
      retry_in_seconds: null,
    });

    /*
     * The function returns SQL NULL, which PostgREST materialises as a record
     * of nulls rather than as null. That is a wire-format detail and not a
     * result: `id` being null is what says no job was touched. The worker
     * ignores the return value entirely, so nothing depends on telling the two
     * apart -- but a future caller might, which is why it is pinned here.
     */
    expect((refused as { id: string | null } | null)?.id ?? null).toBeNull();

    // What actually matters: the stale worker did not overwrite the run that
    // replaced it.
    expect((await jobFor(assetId))?.status).toBe("processing");
  });

  it("does not hand the same job to two workers at once", async () => {
    const editor = await clientFor("editor");
    const assetId = await makeAsset("LEASE_0003");
    await enqueueGeneration({ supabase: editor, organizationId: ORG_A, actorId: EDITOR, assetId });

    const service = serviceClient();
    const [a, b] = await Promise.all([
      service.rpc("claim_metadata_jobs_admin", { batch_size: 5, lease_seconds: 300 }),
      service.rpc("claim_metadata_jobs_admin", { batch_size: 5, lease_seconds: 300 }),
    ]);

    const claimed = [...(a.data ?? []), ...(b.data ?? [])];
    expect(claimed).toHaveLength(1);
  });
});
