"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finishImportAction } from "@/app/[workspace]/shoots/actions";
import { ImportQueuePanel } from "@/components/import-queue-panel";
import { useImportSession } from "@/lib/import-queue/session";
import type { QueueItemView } from "@/lib/import-queue/types";
import { formatBytes } from "@/lib/upload";

/**
 * Choosing files, and handing them to a queue that outlives this component.
 *
 * The old version of this file held the batch in React state, which meant the
 * batch existed only for as long as the page did: a reload, a navigation, or a
 * phone locking itself lost every file that had not finished, and nothing
 * anywhere recorded that they had been chosen. What replaced it is
 * src/lib/import-queue -- records in IndexedDB, bytes in the origin private
 * file system, a server row per file, and a runner that resumes.
 *
 * So this component does three things and no more: it takes a selection, it
 * warns honestly about what this browser can and cannot promise, and it renders
 * the queue. It owns none of the state and stops none of the work when it
 * unmounts.
 */
export function ImportDropzone({
  workspaceSlug,
  organizationId,
  shootId,
  /** True once the shoot has files: the same control, taking less of the page. */
  compact = false,
}: {
  workspaceSlug: string;
  organizationId: string;
  shootId: string;
  compact?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const replacementRef = useRef<HTMLInputElement>(null);
  const replacing = useRef<QueueItemView | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Null until the browser has one: see useImportSession. Everything below
  // guards on it rather than assuming, because the first render has no queue.
  const session = useImportSession({ workspaceSlug, organizationId });

  // The queue is reconciled with the server once per tab, the moment an import
  // control is on screen. A card dump abandoned last night is back on the page
  // before anybody asks for it.
  useEffect(() => {
    void session?.ready();
  }, [session]);

  /*
   * Advancing the shoot and refreshing the sheet, once per run of completions.
   *
   * The queue finishes files one at a time and the contact sheet is server
   * rendered, so a refresh per file would re-render the page under an operator's
   * hands two hundred times. A short debounce collapses a burst into one.
   */
  const completed = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanced = useRef(false);

  useEffect(() => {
    if (!session) return;
    const unsubscribe = session.subscribe((snapshot) => {
      const done = snapshot.items.filter((item) => item.status === "complete").length;
      if (done <= completed.current) {
        completed.current = done;
        return;
      }
      completed.current = done;

      if (!advanced.current) {
        advanced.current = true;
        // The shoot only moves because something actually landed, and only once
        // for the whole batch rather than once per file.
        void finishImportAction(workspaceSlug, shootId).catch(() => {
          // The files are imported either way; the status is cosmetic here.
        });
      }

      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        startTransition(() => router.refresh());
      }, 1_200);
    });

    return () => {
      unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [router, session, shootId, startTransition, workspaceSlug]);

  const enqueue = useCallback(
    async (selected: readonly File[]) => {
      if (!session) return;
      // A directory drop reports zero files in some browsers; say so rather
      // than appearing to do nothing.
      if (selected.length === 0) {
        setNotice("Nothing to import. Drop files rather than a folder.");
        return;
      }

      setNotice(null);
      const bytes = selected.reduce((total, file) => total + file.size, 0);

      try {
        const result = await session.queue.enqueue({ shootId, files: selected });
        setBatchId(result.batchId);
        setWarnings(result.warnings);
        setNotice(
          `${selected.length} ${selected.length === 1 ? "file" : "files"} queued · ${formatBytes(bytes)}`,
        );
        void session.runner.pump();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Those files could not be queued.");
      }
    },
    [session, shootId],
  );

  /** The operator handing back a file whose local copy is gone. */
  const onFileNeeded = useCallback((item: QueueItemView) => {
    replacing.current = item;
    replacementRef.current?.click();
  }, []);

  const onReplacement = useCallback(
    async (file: File | undefined) => {
      const item = replacing.current;
      replacing.current = null;
      if (!item || !file || !session) return;

      try {
        await session.queue.provideFile(item.clientFileId, file);
        await session.runner.resumeItem(item.clientFileId);
        setNotice(`${item.originalFilename} is back in the queue.`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "That file could not be added.");
      }
    },
    [session],
  );

  return (
    <section aria-label="Import files" id="import">
      <div
        className={`dropzone${compact ? " compact" : ""}${dragging ? " dragging" : ""}`}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void enqueue([...event.dataTransfer.files]);
        }}
      >
        <div>
          <div aria-hidden="true" className="dropzone-mark">
            ＋
          </div>
          <h2>{compact ? "Import more" : "Bring in the shoot"}</h2>
          <p>
            Drop a folder, card export, JPEGs, RAW files, or video clips. Every file is hashed and
            copied to this device before it is uploaded, so an interrupted import picks up where it
            stopped instead of starting again.
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
              void enqueue(chosen);
            }}
            ref={inputRef}
            type="file"
          />

          {/* Used only when a queued file has lost its local copy. */}
          <input
            className="visually-hidden"
            id="import-replacement"
            onChange={(event) => {
              const [file] = [...(event.target.files ?? [])];
              event.target.value = "";
              void onReplacement(file);
            }}
            ref={replacementRef}
            tabIndex={-1}
            type="file"
          />

          <div className="upload-options">
            <button
              className="button primary"
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              Choose files
            </button>
          </div>

          {notice && <p className="section-note">{notice}</p>}

          <p className="section-note">
            Originals are never overwritten and never deleted. Uploads continue while Mastline is
            open in this browser, and pick up where they left off next time you open it.
          </p>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="import-warnings" role="status">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}

      {session && (
        <ImportQueuePanel
          batchId={batchId ?? undefined}
          onFileNeeded={onFileNeeded}
          session={session}
        />
      )}
    </section>
  );
}
