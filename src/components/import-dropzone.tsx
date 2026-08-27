"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  finishImportAction,
  registerImportAction,
  registerPreviewAction,
} from "@/app/[workspace]/shoots/actions";
import { stageOriginal, stagePreview } from "@/components/upload-staging";
import { formatBytes, hasBrowserPreview } from "@/lib/upload";

type FileState = "queued" | "hashing" | "uploading" | "recording" | "done" | "failed";

interface FileProgress {
  readonly id: string;
  readonly name: string;
  readonly bytes: number;
  readonly state: FileState;
  readonly detail?: string;
  readonly duplicate?: boolean;
}

interface QueuedFile {
  readonly id: string;
  readonly file: File;
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
 * How many files are in flight at once.
 *
 * One at a time made a card dump take as long as the sum of its parts, and
 * every file waited on the round trip of the one before it. More than a handful
 * saturates an uplink at a kerbside and makes every bar move at once, which is
 * worse than useless. Three is fast without lying about progress.
 */
const CONCURRENCY = 3;

/**
 * Import files into a shoot.
 *
 * Each file is hashed in the browser, staged, registered as an immutable
 * original, and only then promoted to its canonical key.
 *
 * Selections accumulate. A second drop, or a second trip to the file picker
 * while the first batch is still running, is appended to the queue rather than
 * discarded -- the earlier version returned early whenever it was busy, so the
 * files were silently dropped and the operator was told nothing.
 */
export function ImportDropzone({
  workspaceSlug,
  shootId,
  /** True once the shoot has files: the same control, taking less of the page. */
  compact = false,
}: {
  workspaceSlug: string;
  shootId: string;
  compact?: boolean;
}) {
  const [files, setFiles] = useState<readonly FileProgress[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  // The queue and the drain flag live in refs: a drain loop started in one
  // render must see files appended during a later one, and must not be
  // restarted by a re-render partway through.
  const queueRef = useRef<QueuedFile[]>([]);
  const drainingRef = useRef(false);
  const nextIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const update = useCallback((id: string, patch: Partial<FileProgress>) => {
    if (!mountedRef.current) return;
    setFiles((current) => current.map((file) => (file.id === id ? { ...file, ...patch } : file)));
  }, []);

  /** Everything that happens to one file, start to finish. */
  const importOne = useCallback(
    async (entry: QueuedFile): Promise<"imported" | "duplicate" | "failed"> => {
      const { id, file } = entry;

      try {
        // Hashing and the upload are one call now, shared with the creation
        // page, which reports each phase back rather than swallowing it.
        const staged = await stageOriginal(workspaceSlug, file, (phase) =>
          update(id, { state: phase }),
        );

        update(id, { state: "recording" });
        const result = await registerImportAction(workspaceSlug, {
          shootId,
          filename: staged.filename,
          sha256: staged.sha256,
          bytes: staged.bytes,
          mimeType: staged.mimeType,
          capturedAt: staged.capturedAt,
          width: staged.width,
          height: staged.height,
          stagingKey: staged.stagingKey,
        });

        if (!result.ok || !result.assetId) throw new Error(result.error ?? "Import failed.");

        // A preview makes the contact sheet usable, and for a clip it is the
        // poster frame. Its absence never fails the import: the original is
        // already safely recorded.
        const preview = await stagePreview(file, staged.stagingKey);
        if (preview) {
          await registerPreviewAction(workspaceSlug, {
            assetId: result.assetId,
            sha256: preview.sha256,
            bytes: preview.bytes,
            width: preview.width,
            height: preview.height,
            stagingKey: preview.stagingKey,
          });
        }

        update(id, {
          state: "done",
          duplicate: Boolean(result.duplicateOf),
          detail: result.duplicateOf
            ? "Same bytes already in this workspace"
            : hasBrowserPreview(file.type)
              ? undefined
              : "Original preserved; no browser preview for this format",
        });

        return result.duplicateOf ? "duplicate" : "imported";
      } catch (error) {
        update(id, {
          state: "failed",
          detail: error instanceof Error ? error.message : "Unknown error",
        });
        return "failed";
      }
    },
    /*
     * workspaceSlug is read three times in here -- prepare, register, and the
     * preview -- so leaving it out of the dependencies let one captured value
     * outlive a workspace change and address every upload in a batch to the
     * workspace that was open when the component first rendered.
     */
    [shootId, update, workspaceSlug],
  );

  /**
   * Work the queue until it is empty, a few files at a time.
   *
   * The workers re-read the shared queue on every iteration, so files added
   * while this is running are picked up by whichever worker frees up first.
   */
  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setBusy(true);
    setSummary(null);

    let imported = 0;
    let duplicates = 0;
    let failed = 0;

    const worker = async () => {
      for (;;) {
        const entry = queueRef.current.shift();
        if (!entry) return;
        const outcome = await importOne(entry);
        if (outcome === "failed") failed += 1;
        else {
          imported += 1;
          if (outcome === "duplicate") duplicates += 1;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queueRef.current.length) }, worker),
    );

    drainingRef.current = false;

    // The shoot only advances if something actually landed, and only once for
    // the whole batch rather than once per file.
    if (imported > 0) {
      try {
        await finishImportAction(workspaceSlug, shootId);
      } catch {
        // The files are imported either way; the status is cosmetic here.
      }
    }

    if (!mountedRef.current) return;

    const parts = [`${imported} imported`];
    if (duplicates > 0) parts.push(`${duplicates} already in the archive`);
    if (failed > 0) parts.push(`${failed} failed`);
    setSummary(parts.join(" · "));
    setBusy(false);
    startTransition(() => router.refresh());
  }, [importOne, router, shootId, workspaceSlug]);

  const enqueue = useCallback(
    (selected: readonly File[]) => {
      // A directory drop reports zero files in some browsers; say so rather
      // than appearing to do nothing.
      if (selected.length === 0) {
        setSummary("Nothing to import. Drop files rather than a folder.");
        return;
      }

      const entries: QueuedFile[] = selected.map((file) => ({
        id: `import-${(nextIdRef.current += 1)}`,
        file,
      }));

      queueRef.current.push(...entries);
      setFiles((current) => [
        ...current,
        ...entries.map((entry) => ({
          id: entry.id,
          name: entry.file.name,
          bytes: entry.file.size,
          state: "queued" as const,
        })),
      ]);

      void drain();
    },
    [drain],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      enqueue([...event.dataTransfer.files]);
    },
    [enqueue],
  );

  const done = files.filter((file) => file.state === "done").length;
  const failedCount = files.filter((file) => file.state === "failed").length;

  return (
    <section aria-label="Import files" id="import">
      <div
        className={`dropzone${compact ? " compact" : ""}${dragging ? " dragging" : ""}`}
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
          <h2>{compact ? "Import more" : "Bring in the shoot"}</h2>
          <p>
            Drop a folder, card export, JPEGs, RAW files, or video clips. Select as many as you like
            — every file is hashed before it leaves this machine, and the original is stored
            untouched.
          </p>

          <input
            accept="image/*,video/*,.arw,.cr2,.cr3,.nef,.raf,.orf,.dng"
            className="visually-hidden"
            id="import-files"
            multiple
            onChange={(event) => {
              // The FileList is copied before the input is cleared, and the
              // input is cleared so choosing the same file twice still fires.
              const chosen = [...(event.target.files ?? [])];
              event.target.value = "";
              enqueue(chosen);
            }}
            ref={inputRef}
            type="file"
          />

          <div className="upload-options">
            <button
              className="button primary"
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              {busy ? "Add more files" : "Choose files"}
            </button>
          </div>

          <p className="section-note">
            {busy
              ? "More files can be added while these upload; they join the queue."
              : "Originals are never overwritten and never deleted. Delivery derivatives are created as separate files."}
          </p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="import-progress">
          <div className="split-heading">
            <h3>
              Import · {done} of {files.length}
              {failedCount > 0 ? ` · ${failedCount} failed` : ""}
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
