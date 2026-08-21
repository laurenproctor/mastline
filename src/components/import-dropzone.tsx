"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  finishImportAction,
  prepareUploadAction,
  registerImportAction,
  registerPreviewAction,
} from "@/app/shoots/actions";
import { createClient } from "@/lib/supabase/client";
import {
  canPreview,
  formatBytes,
  hashFile,
  likelyCapturedAt,
  makePreview,
  readDimensions,
  uploadToken,
} from "@/lib/upload";

type FileState = "queued" | "hashing" | "uploading" | "recording" | "done" | "failed";

interface FileProgress {
  readonly id: string;
  readonly name: string;
  readonly bytes: number;
  readonly state: FileState;
  readonly detail?: string;
  readonly duplicate?: boolean;
}

const STATE_LABELS: Record<FileState, string> = {
  queued: "Waiting",
  hashing: "Hashing",
  uploading: "Uploading",
  recording: "Recording",
  done: "Imported",
  failed: "Failed",
};

/**
 * Import files into a shoot.
 *
 * Each file is hashed in the browser, staged, registered as an immutable
 * original, and only then promoted to its canonical key. Files are processed
 * one at a time so that a card dump does not saturate the connection and so
 * progress is honest rather than optimistic.
 */
export function ImportDropzone({ shootId }: { shootId: string }) {
  const [files, setFiles] = useState<readonly FileProgress[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const update = useCallback((id: string, patch: Partial<FileProgress>) => {
    setFiles((current) => current.map((file) => (file.id === id ? { ...file, ...patch } : file)));
  }, []);

  const importFiles = useCallback(
    async (selected: File[]) => {
      if (selected.length === 0 || busy) return;

      setBusy(true);
      setSummary(null);

      const queued: FileProgress[] = selected.map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        bytes: file.size,
        state: "queued",
      }));
      setFiles((current) => [...current, ...queued]);

      const supabase = createClient();
      let imported = 0;
      let failed = 0;
      let duplicates = 0;

      for (const [index, file] of selected.entries()) {
        const progress = queued[index];

        try {
          update(progress.id, { state: "hashing" });
          const sha256 = await hashFile(file);
          const dimensions = await readDimensions(file);

          update(progress.id, { state: "uploading" });
          const { stagingKey } = await prepareUploadAction(uploadToken());
          const upload = await supabase.storage.from("originals").upload(stagingKey, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false,
          });
          if (upload.error) throw new Error(upload.error.message);

          update(progress.id, { state: "recording" });
          const result = await registerImportAction({
            shootId,
            filename: file.name,
            sha256,
            bytes: file.size,
            mimeType: file.type || "application/octet-stream",
            capturedAt: likelyCapturedAt(file),
            width: dimensions?.width,
            height: dimensions?.height,
            stagingKey,
          });

          if (!result.ok || !result.assetId) throw new Error(result.error ?? "Import failed.");

          // A preview makes the contact sheet usable. Its absence never fails
          // the import: the original is already safely recorded.
          if (canPreview(file.type)) {
            const preview = await makePreview(file);
            if (preview) {
              const previewKey = `${stagingKey}-preview`;
              const previewUpload = await supabase.storage
                .from("derivatives")
                .upload(previewKey, preview.blob, { contentType: "image/jpeg", upsert: true });
              if (!previewUpload.error) {
                await registerPreviewAction({
                  assetId: result.assetId,
                  sha256: await hashFile(preview.blob),
                  bytes: preview.blob.size,
                  width: preview.width,
                  height: preview.height,
                  stagingKey: previewKey,
                });
              }
            }
          }

          imported += 1;
          if (result.duplicateOf) duplicates += 1;
          update(progress.id, {
            state: "done",
            duplicate: Boolean(result.duplicateOf),
            detail: result.duplicateOf
              ? "Same bytes already in this workspace"
              : canPreview(file.type)
                ? undefined
                : "Original preserved; no browser preview for this format",
          });
        } catch (error) {
          failed += 1;
          update(progress.id, {
            state: "failed",
            detail: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      if (imported > 0) {
        await finishImportAction(shootId);
      }

      const parts = [`${imported} imported`];
      if (duplicates > 0) parts.push(`${duplicates} already in the archive`);
      if (failed > 0) parts.push(`${failed} failed`);
      setSummary(parts.join(" · "));
      setBusy(false);
      startTransition(() => router.refresh());
    },
    [busy, router, shootId, update],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      void importFiles([...event.dataTransfer.files]);
    },
    [importFiles],
  );

  const done = files.filter((file) => file.state === "done").length;

  return (
    <section aria-label="Import files">
      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDrop={onDrop}
      >
        <div>
          <div aria-hidden="true" className="dropzone-mark">
            ＋
          </div>
          <h2>Bring in the shoot</h2>
          <p>
            Drop a folder, card export, JPEGs, RAW files, or video clips. Each file is hashed before
            it leaves this machine, and the original is stored untouched.
          </p>

          <input
            accept="image/*,video/*,.arw,.cr2,.cr3,.nef,.raf,.orf,.dng"
            className="visually-hidden"
            disabled={busy}
            id="import-files"
            multiple
            onChange={(event) => {
              void importFiles([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
            ref={inputRef}
            type="file"
          />

          <div className="upload-options">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              {busy ? "Importing…" : "Choose files"}
            </button>
          </div>

          <p className="section-note">
            Originals are never overwritten and never deleted. Delivery derivatives are created as
            separate files.
          </p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="import-progress">
          <div className="split-heading">
            <h3>
              Import · {done} of {files.length}
            </h3>
            {summary && <span className="muted">{summary}</span>}
          </div>
          <ul aria-live="polite" className="import-list">
            {files.map((file) => (
              <li className={`import-row ${file.state}`} key={file.id}>
                <span className="import-name">{file.name}</span>
                <span className="import-size">{formatBytes(file.bytes)}</span>
                <span className="import-state">
                  {STATE_LABELS[file.state]}
                  {file.duplicate ? " · duplicate" : ""}
                </span>
                {file.detail && <span className="import-detail">{file.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
