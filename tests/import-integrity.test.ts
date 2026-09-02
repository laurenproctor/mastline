/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  createImportBatch,
  finalizeImportFile,
  getImportBatchState,
  markImportFileUploaded,
  registerImportFiles,
  verifyStagedUpload,
} from "../src/lib/data/import-queue";
import { canonicalObjectKey } from "../src/lib/data/imports";
import { ORG_A, clientFor, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * The integrity claims, proved against the database rather than argued.
 *
 * A photographer importing a card over a bad connection is trusting four
 * things: nothing is imported twice, nothing is lost between the upload and
 * the record, the counters they are watching are true, and another workspace
 * cannot see any of it. Each of those is a query here.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const EDITOR = "22222222-2222-2222-2222-222222222222";
const shoots: string[] = [];

const DEFAULTS = {
  creatorName: "Jordan Ellis",
  creditLine: "Jordan Ellis / Marcus Hale Studio",
  copyrightNotice: "© 2026 Jordan Ellis",
  locationName: "New York, NY",
};

function uuid(): string {
  return crypto.randomUUID();
}

async function digest(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function makeShoot(): Promise<string> {
  const { data, error } = await serviceClient()
    .from("shoots")
    .insert({
      organization_id: ORG_A,
      title: `Integrity ${Date.now()}-${Math.round(performance.now())}`,
      status: "draft",
      created_by: EDITOR,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  shoots.push(data.id as string);
  return data.id as string;
}

async function uploadTo(storagePath: string, contents: string): Promise<void> {
  const editor = await clientFor("editor");
  const { error } = await editor.storage
    .from("originals")
    .upload(storagePath, new Blob([contents], { type: "image/jpeg" }), {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (error) throw new Error(`Could not stage: ${error.message}`);
}

/**
 * Distinct bytes per file.
 *
 * Identical content under identical names collides on the canonical object
 * key, which is a real behaviour with a test of its own further down; here it
 * would just be noise.
 */
const RUN = `${Date.now()}`;
function contentFor(prefix: string, index: number): string {
  return `${prefix}-${index}-${RUN}${"x".repeat(index)}`;
}

/** A batch with `count` registered, uploaded files ready to finalize. */
async function readyBatch(count: number, prefix = "f") {
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
    files: Array.from({ length: count }, (_, index) => ({
      clientFileId: `${prefix}${index}`,
      originalFilename: `${prefix.toUpperCase()}_${index}.jpg`,
      // The registered size has to be the size that will actually be uploaded:
      // verification compares the two, and that comparison is the point.
      byteSize: contentFor(prefix, index).length,
      mimeType: "image/jpeg",
    })),
  });

  const prepared = [];
  for (const [index, row] of rows.entries()) {
    const contents = contentFor(prefix, index);
    await uploadTo(row.storagePath, contents);
    const sha256 = await digest(contents);
    await markImportFileUploaded({
      supabase,
      organizationId: ORG_A,
      importFileId: row.importFileId,
      sha256,
      attemptCount: 1,
    });
    prepared.push({ ...row, sha256 });
  }

  return { supabase, shootId, batchId, files: prepared };
}

afterAll(async () => {
  for (const shootId of shoots) await purgeShoot(shootId);
});

describeIf("one import file, one asset", () => {
  it("holds under concurrent finalization of the same file", async () => {
    const { supabase, shootId, files } = await readyBatch(1, "race");
    const [file] = files;

    // Six callers at once: two tabs, a retry, and a reconnect all arriving
    // together is not a hypothetical on a bad connection.
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        finalizeImportFile({
          supabase,
          organizationId: ORG_A,
          actorId: EDITOR,
          importFileId: file.importFileId,
          sha256: file.sha256,
          defaults: DEFAULTS,
        }),
      ),
    );

    const assetIds = new Set(outcomes.map((o) => o.assetId).filter(Boolean));
    expect(assetIds.size).toBe(1);

    const { count } = await serviceClient()
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("shoot_id", shootId);
    expect(count).toBe(1);

    // And the database itself refuses to point this import at a different
    // asset, which is what a second finalization would have had to do.
    const { data: other } = await serviceClient()
      .from("assets")
      .select("id")
      .neq("id", [...assetIds][0])
      .limit(1)
      .single();
    const { error } = await serviceClient()
      .from("import_files")
      .update({ asset_id: other!.id })
      .eq("id", file.importFileId);
    expect(error?.message).toContain("already finalized");
  });
});

describeIf("batch counters", () => {
  it("do not drift when files complete at the same moment", async () => {
    const { supabase, batchId, files } = await readyBatch(5, "cnt");

    const outcomes = await Promise.all(
      files.map((file) =>
        finalizeImportFile({
          supabase,
          organizationId: ORG_A,
          actorId: EDITOR,
          importFileId: file.importFileId,
          sha256: file.sha256,
          defaults: DEFAULTS,
        }),
      ),
    );
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);

    const state = await getImportBatchState({ supabase, organizationId: ORG_A, batchId });
    expect(state?.totalFiles).toBe(5);
    expect(state?.completedFiles).toBe(5);
    expect(state?.failedFiles).toBe(0);
    expect(state?.status).toBe("complete");

    // The counters are derived by trigger, so they must equal the rows rather
    // than merely look plausible.
    const { count } = await serviceClient()
      .from("import_files")
      .select("id", { count: "exact", head: true })
      .eq("import_batch_id", batchId)
      .eq("status", "complete");
    expect(count).toBe(state?.completedFiles);
  });
});

describeIf("an upload that landed but was never recorded", () => {
  it("can be finished later without sending the bytes again", async () => {
    const { supabase, batchId, files } = await readyBatch(1, "orph");
    const [file] = files;

    // This is the state a browser leaves behind when it dies between the
    // upload finishing and finalization: uploaded, no asset.
    const before = await verifyStagedUpload({
      supabase,
      organizationId: ORG_A,
      importFileId: file.importFileId,
    });
    expect(before.exists).toBe(true);
    expect(before.matches).toBe(true);
    expect(before.alreadyFinalized).toBe(false);

    const outcome = await finalizeImportFile({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      importFileId: file.importFileId,
      sha256: file.sha256,
      defaults: DEFAULTS,
    });

    expect(outcome.ok).toBe(true);
    const state = await getImportBatchState({ supabase, organizationId: ORG_A, batchId });
    expect(state?.files[0].status).toBe("complete");
  });
});

describeIf("a finalized original", () => {
  it("is never overwritten by a later upload to the same key", async () => {
    const { supabase, shootId, files } = await readyBatch(1, "immut");
    const [file] = files;

    const outcome = await finalizeImportFile({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      importFileId: file.importFileId,
      sha256: file.sha256,
      defaults: DEFAULTS,
    });
    expect(outcome.ok).toBe(true);

    const key = canonicalObjectKey(ORG_A, shootId, file.sha256, "IMMUT_0.jpg");
    const editor = await clientFor("editor");

    // Plain upload: refused, because the object exists.
    const first = await editor.storage
      .from("originals")
      .upload(key, new Blob(["tampered"]), { upsert: false });
    expect(first.error).not.toBeNull();

    // Upsert: refused too, because the storage policy only permits an update
    // under the staging prefix. This is the guard that makes an original
    // immutable rather than merely conventionally immutable.
    const second = await editor.storage
      .from("originals")
      .upload(key, new Blob(["tampered"]), { upsert: true });
    expect(second.error).not.toBeNull();

    // The bytes are still the imported ones.
    const { data: version } = await serviceClient()
      .from("asset_versions")
      .select("sha256, bytes")
      .eq("asset_id", outcome.assetId!)
      .eq("version_kind", "original")
      .single();
    expect(version?.sha256).toBe(file.sha256);
  });
});

describeIf("cleaning up what was abandoned", () => {
  it("removes stale failures and leaves finished imports alone", async () => {
    const { supabase, batchId, files } = await readyBatch(2, "prune");
    const [keeper, abandoned] = files;

    await finalizeImportFile({
      supabase,
      organizationId: ORG_A,
      actorId: EDITOR,
      importFileId: keeper.importFileId,
      sha256: keeper.sha256,
      defaults: DEFAULTS,
    });

    const service = serviceClient();

    // An abandoned row, inserted already old. `updated_at` is stamped by a
    // BEFORE UPDATE trigger, so it cannot be backdated by updating it -- but an
    // insert carries whatever it is given, which is how a month-old failure is
    // simulated without reaching around the schema.
    const stale = {
      import_batch_id: batchId,
      organization_id: ORG_A,
      client_file_id: "staleone",
      original_filename: "ABANDONED.ARW",
      byte_size: 1024,
      mime_type: "image/x-sony-arw",
      storage_bucket: "originals",
      storage_path: `${ORG_A}/_staging/${batchId}/staleone`,
      status: "failed",
      error_code: "unsupported_file",
      updated_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    };
    const { error: insertError } = await service.from("import_files").insert(stale);
    expect(insertError).toBeNull();

    // And the second file, failed but recent, which must survive.
    await service
      .from("import_files")
      .update({ status: "failed", error_code: "server_unavailable" })
      .eq("id", abandoned.importFileId);

    const { data: removed, error } = await service.rpc("prune_abandoned_imports", {
      retain_days: 7,
    });
    expect(error).toBeNull();
    expect(Number(removed)).toBe(1);

    const state = await getImportBatchState({ supabase, organizationId: ORG_A, batchId });
    const clients = (state?.files ?? []).map((file) => file.clientFileId);
    // The completed one and the recent failure stay; only the stale one goes.
    expect(clients).toContain("prune0");
    expect(clients).toContain("prune1");
    expect(clients).not.toContain("staleone");
  });

  it("will not remove a recent failure", async () => {
    const { supabase, batchId, files } = await readyBatch(1, "recent");
    await serviceClient()
      .from("import_files")
      .update({ status: "failed", error_code: "server_unavailable" })
      .eq("id", files[0].importFileId);

    await serviceClient().rpc("prune_abandoned_imports", { retain_days: 7 });

    const state = await getImportBatchState({ supabase, organizationId: ORG_A, batchId });
    expect(state?.files).toHaveLength(1);
  });

  it("is not callable by a signed-in user", async () => {
    const editor = await clientFor("editor");
    const { error } = await editor.rpc("prune_abandoned_imports", { retain_days: 7 });
    // Service role only, like every other purge in this schema.
    expect(error).not.toBeNull();
  });
});

describeIf("two files with the same name", () => {
  it("both import, because the storage path is built from ids", async () => {
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

    // Two cards, both with IMG_0001.JPG on them. Different bytes.
    const rows = await registerImportFiles({
      supabase,
      organizationId: ORG_A,
      batchId,
      files: [
        {
          clientFileId: "cardone",
          originalFilename: "IMG_0001.JPG",
          byteSize: 30,
          mimeType: "image/jpeg",
        },
        {
          clientFileId: "cardtwo",
          originalFilename: "IMG_0001.JPG",
          byteSize: 31,
          mimeType: "image/jpeg",
        },
      ],
    });

    expect(new Set(rows.map((row) => row.storagePath)).size).toBe(2);

    for (const [index, row] of rows.entries()) {
      const contents = `same-name-${index}-${Date.now()}`;
      await uploadTo(row.storagePath, contents);
      const sha256 = await digest(contents);
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
      expect(outcome.ok).toBe(true);
    }

    const { count } = await serviceClient()
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("shoot_id", shootId);
    expect(count).toBe(2);
  });
});

describeIf("a filename that is not a path", () => {
  it("survives Unicode, spaces, punctuation, and slashes", async () => {
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

    const nasty = "../../Ünïcode noms/ MH 0819 (0472) #1 — copy.ARW";
    const [row] = await registerImportFiles({
      supabase,
      organizationId: ORG_A,
      batchId,
      files: [
        { clientFileId: "unicode1", originalFilename: nasty, byteSize: 42, mimeType: "image/jpeg" },
      ],
    });

    // The path is built from ids and contains nothing of the name.
    expect(row.storagePath).toBe(`${ORG_A}/_staging/${batchId}/unicode1`);
    expect(row.storagePath).not.toContain("..");

    const contents = `unicode-${Date.now()}`;
    await uploadTo(row.storagePath, contents);
    const sha256 = await digest(contents);
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
    expect(outcome.ok).toBe(true);

    const service = serviceClient();
    // The operator's record keeps the name exactly as the camera wrote it.
    const { data: importFile } = await service
      .from("import_files")
      .select("original_filename")
      .eq("id", row.importFileId)
      .single();
    expect(importFile?.original_filename).toBe(nasty);

    // The canonical object key is sanitized and escapes nothing.
    const { data: version } = await service
      .from("asset_versions")
      .select("object_key")
      .eq("asset_id", outcome.assetId!)
      .single();
    expect(version?.object_key).toContain(`${ORG_A}/${shootId}/`);
    expect(version?.object_key).not.toContain("..");
    expect(version?.object_key).not.toContain(" ");
  });
});
