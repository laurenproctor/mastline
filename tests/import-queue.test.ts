/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  cancelImportFiles,
  confirmImportFile,
  createImportBatch,
  finalizeImportFile,
  getImportBatchState,
  markImportFileUploaded,
  registerImportFiles,
} from "../src/lib/data/import-queue";
import { importStoragePath } from "../src/lib/import-queue/paths";
import {
  ORG_A,
  ORG_B,
  clientFor,
  hasLocalSupabase,
  purgeShoot,
  serviceClient,
} from "./helpers/supabase";

/**
 * The server half of a resumable import, against the real database.
 *
 * These run the same functions a Server Action calls, with the caller's client,
 * so row level security is in force for every step. What they are really
 * checking is that repeating a call is safe -- because the callers are a queue
 * that retries, a tab that was reopened, and sometimes both at once.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const EDITOR = "22222222-2222-2222-2222-222222222222";
const OTHER_OWNER = "99999999-9999-9999-9999-999999999999";

const shoots: string[] = [];

function uuid(): string {
  return crypto.randomUUID();
}

async function digest(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function makeShoot(organizationId = ORG_A, createdBy = EDITOR): Promise<string> {
  const { data, error } = await serviceClient()
    .from("shoots")
    .insert({
      organization_id: organizationId,
      title: `Import queue ${Date.now()}-${Math.round(performance.now())}`,
      status: "draft",
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  shoots.push(data.id as string);
  return data.id as string;
}

/** Put bytes where the queue would have uploaded them. */
async function uploadTo(storagePath: string, contents: string): Promise<void> {
  const editor = await clientFor("editor");
  const { error } = await editor.storage
    .from("originals")
    .upload(storagePath, new Blob([contents], { type: "image/jpeg" }), {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (error) throw new Error(`Could not stage the upload: ${error.message}`);
}

const DEFAULTS = {
  creatorName: "Jordan Ellis",
  creditLine: "Jordan Ellis / Marcus Hale Studio",
  copyrightNotice: "© 2026 Jordan Ellis",
  locationName: "New York, NY",
};

afterAll(async () => {
  for (const shootId of shoots) await purgeShoot(shootId);
});

describeIf("opening an import batch", () => {
  it("returns the same batch for the same idempotency key", async () => {
    const supabase = await clientFor("editor");
    const shootId = await makeShoot();
    const batchId = uuid();

    const first = await createImportBatch({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      batchId,
      idempotencyKey: batchId,
    });

    // What a reload, a retry, and a second tab all look like.
    const second = await createImportBatch({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      batchId: uuid(),
      idempotencyKey: batchId,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.batchId).toBe(first.batchId);

    const { count } = await serviceClient()
      .from("import_batches")
      .select("id", { count: "exact", head: true })
      .eq("shoot_id", shootId);
    expect(count).toBe(1);
  });

  it("counts nothing until files are registered", async () => {
    const supabase = await clientFor("editor");
    const shootId = await makeShoot();
    const batchId = uuid();
    await createImportBatch({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      batchId,
      idempotencyKey: batchId,
    });

    const state = await getImportBatchState({ supabase, organizationId: ORG_A, batchId });
    expect(state?.status).toBe("pending");
    expect(state?.totalFiles).toBe(0);
  });
});

describeIf("registering the files in a batch", () => {
  it("is repeatable, and does not disturb a file already in flight", async () => {
    const supabase = await clientFor("editor");
    const shootId = await makeShoot();
    const batchId = uuid();
    await createImportBatch({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      batchId,
      idempotencyKey: batchId,
    });

    const file = {
      clientFileId: "abc123",
      originalFilename: "MH_0819_0472.ARW",
      byteSize: 48_211_904,
      mimeType: "image/x-sony-arw",
      lastModifiedAt: "2026-08-19T18:47:18.000Z",
    };

    const [first] = await registerImportFiles({
      supabase,
      organizationId: ORG_A,
      batchId,
      files: [file],
    });

    expect(first.storagePath).toBe(importStoragePath(ORG_A, batchId, "abc123"));
    expect(first.status).toBe("pending");

    // Move it on, then register again exactly as a resumed queue would.
    await markImportFileUploaded({
      supabase,
      organizationId: ORG_A,
      importFileId: first.importFileId,
      sha256: await digest("bytes"),
    });

    const [again] = await registerImportFiles({
      supabase,
      organizationId: ORG_A,
      batchId,
      files: [file],
    });

    expect(again.importFileId).toBe(first.importFileId);
    // Registration must never knock an uploading file back to the start.
    expect(again.status).toBe("uploaded");

    const state = await getImportBatchState({ supabase, organizationId: ORG_A, batchId });
    expect(state?.totalFiles).toBe(1);
    expect(state?.status).toBe("uploading");
  });

  it("keeps the original filename and derives the path from ids", async () => {
    const supabase = await clientFor("editor");
    const shootId = await makeShoot();
    const batchId = uuid();
    await createImportBatch({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      batchId,
      idempotencyKey: batchId,
    });

    const [row] = await registerImportFiles({
      supabase,
      organizationId: ORG_A,
      batchId,
      files: [
        {
          clientFileId: "path_test",
          originalFilename: "Låt oss/gå 0472.ARW",
          byteSize: 100,
          mimeType: "image/jpeg",
        },
      ],
    });

    expect(row.storagePath).toBe(`${ORG_A}/_staging/${batchId}/path_test`);

    const { data } = await serviceClient()
      .from("import_files")
      .select("original_filename")
      .eq("id", row.importFileId)
      .single();
    expect(data?.original_filename).toBe("Låt oss/gå 0472.ARW");
  });

  it("refuses to move a storage path once it is set", async () => {
    const supabase = await clientFor("editor");
    const shootId = await makeShoot();
    const batchId = uuid();
    await createImportBatch({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      batchId,
      idempotencyKey: batchId,
    });
    const [row] = await registerImportFiles({
      supabase,
      organizationId: ORG_A,
      batchId,
      files: [
        {
          clientFileId: "immutable",
          originalFilename: "a.jpg",
          byteSize: 10,
          mimeType: "image/jpeg",
        },
      ],
    });

    const { error } = await supabase
      .from("import_files")
      .update({ storage_path: `${ORG_A}/_staging/${batchId}/somewhere-else` })
      .eq("id", row.importFileId);

    expect(error?.message).toContain("fixed at registration");
  });
});

describeIf("finalizing", () => {
  it("creates the asset once, and answers a repeat with the same one", async () => {
    const supabase = await clientFor("editor");
    const shootId = await makeShoot();
    const batchId = uuid();
    await createImportBatch({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      batchId,
      idempotencyKey: batchId,
    });

    const [row] = await registerImportFiles({
      supabase,
      organizationId: ORG_A,
      batchId,
      files: [
        {
          clientFileId: "finalonce",
          originalFilename: "MH_0819_0501.jpg",
          byteSize: 9,
          mimeType: "image/jpeg",
          lastModifiedAt: "2026-08-19T18:47:18.000Z",
        },
      ],
    });

    const contents = `bytes-${Date.now()}`;
    await uploadTo(row.storagePath, contents);
    const sha256 = await digest(contents);
    await markImportFileUploaded({
      supabase,
      organizationId: ORG_A,
      importFileId: row.importFileId,
      sha256,
    });

    const first = await finalizeImportFile({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      importFileId: row.importFileId,
      sha256,
      defaults: DEFAULTS,
    });

    expect(first.ok).toBe(true);
    expect(first.assetId).toBeTruthy();

    const second = await finalizeImportFile({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      importFileId: row.importFileId,
      sha256,
      defaults: DEFAULTS,
    });

    expect(second.ok).toBe(true);
    expect(second.alreadyComplete).toBe(true);
    expect(second.assetId).toBe(first.assetId);

    // One asset, one original version, for one import file.
    const service = serviceClient();
    const { count } = await service
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("shoot_id", shootId);
    expect(count).toBe(1);

    const { data: asset } = await service
      .from("assets")
      .select("status, canonical_filename, credit_line, location_name")
      .eq("id", first.assetId!)
      .single();
    expect(asset?.status).toBe("active");
    expect(asset?.canonical_filename).toBe("MH_0819_0501");
    // One fact entered once: the workspace and shoot supplied these.
    expect(asset?.credit_line).toBe(DEFAULTS.creditLine);
    expect(asset?.location_name).toBe(DEFAULTS.locationName);

    const state = await getImportBatchState({ supabase, organizationId: ORG_A, batchId });
    expect(state?.status).toBe("complete");
    expect(state?.completedFiles).toBe(1);
  });

  it("lets only one of two simultaneous finalizations create the asset", async () => {
    const supabase = await clientFor("editor");
    const shootId = await makeShoot();
    const batchId = uuid();
    await createImportBatch({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      batchId,
      idempotencyKey: batchId,
    });
    const [row] = await registerImportFiles({
      supabase,
      organizationId: ORG_A,
      batchId,
      files: [
        {
          clientFileId: "racetwice",
          originalFilename: "race.jpg",
          byteSize: 9,
          mimeType: "image/jpeg",
        },
      ],
    });

    const contents = `race-${Date.now()}`;
    await uploadTo(row.storagePath, contents);
    const sha256 = await digest(contents);
    await markImportFileUploaded({
      supabase,
      organizationId: ORG_A,
      importFileId: row.importFileId,
      sha256,
    });

    const call = () =>
      finalizeImportFile({
        supabase,
        organizationId: ORG_A,
        actorId: EDITOR,
        importFileId: row.importFileId,
        sha256,
        defaults: DEFAULTS,
      });

    const [a, b] = await Promise.all([call(), call()]);

    // One does the work; the other is told to wait or is handed the result.
    const assetIds = [a.assetId, b.assetId].filter(Boolean);
    expect(assetIds.length).toBeGreaterThanOrEqual(1);
    if (assetIds.length === 2) expect(assetIds[0]).toBe(assetIds[1]);
    expect(a.ok || b.ok).toBe(true);
    if (!a.ok && !a.assetId) expect(a.inProgress).toBe(true);
    if (!b.ok && !b.assetId) expect(b.inProgress).toBe(true);

    const { count } = await serviceClient()
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("shoot_id", shootId);
    expect(count).toBe(1);
  });

  it("will not finalize a file whose bytes were never uploaded", async () => {
    const supabase = await clientFor("editor");
    const shootId = await makeShoot();
    const batchId = uuid();
    await createImportBatch({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      batchId,
      idempotencyKey: batchId,
    });
    const [row] = await registerImportFiles({
      supabase,
      organizationId: ORG_A,
      batchId,
      files: [
        {
          clientFileId: "nobytes",
          originalFilename: "missing.jpg",
          byteSize: 9,
          mimeType: "image/jpeg",
        },
      ],
    });

    // Nothing has been uploaded, so there is nothing to claim. The file is
    // left exactly where it was rather than being marked failed for a step
    // that was never attempted.
    const outcome = await finalizeImportFile({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      importFileId: row.importFileId,
      sha256: await digest("never uploaded"),
      defaults: DEFAULTS,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("not_ready");

    const { data } = await serviceClient()
      .from("import_files")
      .select("status, asset_id")
      .eq("id", row.importFileId)
      .single();
    expect(data?.status).toBe("pending");
    expect(data?.asset_id).toBeNull();
  });

  it("records a sanitized failure when the bytes are not where they should be", async () => {
    const supabase = await clientFor("editor");
    const shootId = await makeShoot();
    const batchId = uuid();
    await createImportBatch({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      batchId,
      idempotencyKey: batchId,
    });
    const [row] = await registerImportFiles({
      supabase,
      organizationId: ORG_A,
      batchId,
      files: [
        {
          clientFileId: "lyingclient",
          originalFilename: "gone.jpg",
          byteSize: 9,
          mimeType: "image/jpeg",
        },
      ],
    });

    // The client claims the upload landed. It did not: nothing was ever put at
    // the storage path, which is what a connection dropping mid-PUT looks like
    // from here.
    const sha256 = await digest("claimed but absent");
    await markImportFileUploaded({
      supabase,
      organizationId: ORG_A,
      importFileId: row.importFileId,
      sha256,
    });

    const outcome = await finalizeImportFile({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      importFileId: row.importFileId,
      sha256,
      defaults: DEFAULTS,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.assetId).toBeUndefined();

    const { data } = await serviceClient()
      .from("import_files")
      .select("status, error_code, error_message, asset_id")
      .eq("id", row.importFileId)
      .single();

    expect(data?.status).toBe("failed");
    expect(data?.asset_id).toBeNull();
    // Readable by everybody in the workspace, so it carries no link or key.
    expect(String(data?.error_message ?? "")).not.toContain("http");
    expect(String(data?.error_message ?? "").length).toBeLessThanOrEqual(500);
  });
});

describeIf("confirming before cleanup", () => {
  it("reports the object, the finalization, and the asset together", async () => {
    const supabase = await clientFor("editor");
    const shootId = await makeShoot();
    const batchId = uuid();
    await createImportBatch({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      batchId,
      idempotencyKey: batchId,
    });
    const [row] = await registerImportFiles({
      supabase,
      organizationId: ORG_A,
      batchId,
      files: [
        {
          clientFileId: "confirmme",
          originalFilename: "confirm.jpg",
          byteSize: 9,
          mimeType: "image/jpeg",
        },
      ],
    });

    // Before anything has happened, nothing may be deleted.
    const early = await confirmImportFile({
      supabase,
      organizationId: ORG_A,
      importFileId: row.importFileId,
    });
    expect(early).toEqual({
      complete: false,
      assetExists: false,
      objectExists: false,
      assetId: undefined,
    });

    const contents = `confirm-${Date.now()}`;
    await uploadTo(row.storagePath, contents);
    const sha256 = await digest(contents);
    await markImportFileUploaded({
      supabase,
      organizationId: ORG_A,
      importFileId: row.importFileId,
      sha256,
    });
    await finalizeImportFile({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      importFileId: row.importFileId,
      sha256,
      defaults: DEFAULTS,
    });

    const confirmed = await confirmImportFile({
      supabase,
      organizationId: ORG_A,
      importFileId: row.importFileId,
    });

    expect(confirmed.complete).toBe(true);
    expect(confirmed.assetExists).toBe(true);
    // Checked against storage itself, not against the version row that claims it.
    expect(confirmed.objectExists).toBe(true);
  });
});

describeIf("cancelling", () => {
  it("abandons an unfinished file and never touches a finished one", async () => {
    const supabase = await clientFor("editor");
    const shootId = await makeShoot();
    const batchId = uuid();
    await createImportBatch({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      batchId,
      idempotencyKey: batchId,
    });

    const rows = await registerImportFiles({
      supabase,
      organizationId: ORG_A,
      batchId,
      files: [
        {
          clientFileId: "keeper",
          originalFilename: "keep.jpg",
          byteSize: 9,
          mimeType: "image/jpeg",
        },
        {
          clientFileId: "dropme",
          originalFilename: "drop.jpg",
          byteSize: 9,
          mimeType: "image/jpeg",
        },
      ],
    });

    const keeper = rows.find((row) => row.clientFileId === "keeper")!;
    const contents = `keep-${Date.now()}`;
    await uploadTo(keeper.storagePath, contents);
    const sha256 = await digest(contents);
    await markImportFileUploaded({
      supabase,
      organizationId: ORG_A,
      importFileId: keeper.importFileId,
      sha256,
    });
    await finalizeImportFile({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      importFileId: keeper.importFileId,
      sha256,
      defaults: DEFAULTS,
    });

    const { canceled } = await cancelImportFiles({
      supabase,
      organizationId: ORG_A,
      importFileIds: rows.map((row) => row.importFileId),
    });

    // The completed one is excluded, not merely left as it is by accident.
    expect(canceled).toBe(1);

    const state = await getImportBatchState({ supabase, organizationId: ORG_A, batchId });
    const byClient = new Map(state!.files.map((file) => [file.clientFileId, file.status]));
    expect(byClient.get("keeper")).toBe("complete");
    expect(byClient.get("dropme")).toBe("canceled");
    // Everything terminal, one asset made: the batch is done.
    expect(state?.status).toBe("complete");
  });
});

describeIf("another workspace", () => {
  it("cannot see, register into, or cancel this workspace's imports", async () => {
    const editor = await clientFor("editor");
    const intruder = await clientFor("otherOrgOwner");
    const shootId = await makeShoot();
    const batchId = uuid();
    await createImportBatch({
      supabase: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      batchId,
      idempotencyKey: batchId,
    });
    const [row] = await registerImportFiles({
      supabase: editor,
      organizationId: ORG_A,
      batchId,
      files: [
        {
          clientFileId: "private1",
          originalFilename: "p.jpg",
          byteSize: 9,
          mimeType: "image/jpeg",
        },
      ],
    });

    // Reading it at all.
    const { data: batches } = await intruder.from("import_batches").select("id").eq("id", batchId);
    expect(batches ?? []).toHaveLength(0);
    const { data: files } = await intruder
      .from("import_files")
      .select("id")
      .eq("id", row.importFileId);
    expect(files ?? []).toHaveLength(0);

    // Registering a file into it, which would put bytes in another studio's shoot.
    const { error: insertError } = await intruder.from("import_files").insert({
      import_batch_id: batchId,
      organization_id: ORG_A,
      client_file_id: "intruder",
      original_filename: "x.jpg",
      byte_size: 10,
      mime_type: "image/jpeg",
      storage_path: `${ORG_A}/_staging/${batchId}/intruder`,
    });
    expect(insertError).not.toBeNull();

    // Cancelling it. The update matches no rows it can see, so nothing changes.
    await cancelImportFiles({
      supabase: intruder,
      organizationId: ORG_A,
      importFileIds: [row.importFileId],
    });
    const { data: after } = await serviceClient()
      .from("import_files")
      .select("status")
      .eq("id", row.importFileId)
      .single();
    expect(after?.status).toBe("pending");

    // And a batch of their own cannot be hung off this workspace's shoot.
    const foreignShoot = await makeShoot(ORG_B, OTHER_OWNER);
    const { error: crossError } = await intruder.from("import_batches").insert({
      id: uuid(),
      organization_id: ORG_A,
      shoot_id: foreignShoot,
      created_by: OTHER_OWNER,
      idempotency_key: uuid(),
    });
    expect(crossError).not.toBeNull();
  });
});
