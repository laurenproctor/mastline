"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImportSession } from "@/lib/import-queue/session";
import { needsPerson } from "@/lib/import-queue/runner";
import type { QueueSnapshot } from "@/lib/import-queue/runner";
import type { QueueItemView } from "@/lib/import-queue/types";
import type { ImportFileStatus } from "@/lib/domain";
import { canPreview, formatBytes, makePreview } from "@/lib/upload";

/**
 * What the import queue looks like while it is working.
 *
 * The screen a photographer watches at four in the morning, so it answers the
 * questions asked at four in the morning: how many are left, is anything stuck,
 * can I close this yet. Every row says what it is doing and what can be done to
 * it, and nothing says a file is safe unless it is.
 *
 * The progress numbers come from the runner, which holds live per-file byte
 * counts in memory. They are not read from the database and are not persisted
 * per byte: the record of an import is its lifecycle, not its telemetry.
 */

const STATE_LABELS: Record<ImportFileStatus, string> = {
  pending: "Waiting",
  staged: "Ready",
  uploading: "Uploading",
  uploaded: "Uploaded",
  finalizing: "Recording",
  complete: "Imported",
  paused: "Paused",
  retrying: "Retrying",
  failed: "Failed",
  canceled: "Canceled",
};

/** Rows the runner is still working on, for the pause and cancel controls. */
const IN_FLIGHT: readonly ImportFileStatus[] = [
  "pending",
  "staged",
  "uploading",
  "uploaded",
  "retrying",
];

/**
 * How many thumbnails are drawn.
 *
 * Each one decodes a full frame to make a small one. Two hundred raws would be
 * two hundred decodes and a gigabyte of bitmaps for a strip of images nobody
 * has scrolled to, so the first dozen get pictures and the rest get their
 * filenames, which is what the operator is reading anyway.
 */
const THUMBNAIL_LIMIT = 12;

/** Frames larger than this are not decoded for a 44px square. */
const THUMBNAIL_MAX_BYTES = 24 * 1024 * 1024;

function percentFor(item: QueueItemView, uploaded: number): number {
  if (item.status === "complete") return 100;
  if (!item.byteSize) return 0;
  return Math.min(100, Math.round((uploaded / item.byteSize) * 100));
}

export function ImportQueuePanel({
  session,
  batchId,
  onFileNeeded,
}: {
  session: ImportSession;
  /** Limits the panel to one selection. Omitted, it shows everything queued. */
  batchId?: string;
  /** Opens a picker so a file with no local copy can be handed back. */
  onFileNeeded: (item: QueueItemView) => void;
}) {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(session.latest());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = session.subscribe(setSnapshot);
    void session.ready();
    void session.runner.snapshot(batchId).then(setSnapshot);
    return unsubscribe;
  }, [batchId, session]);

  const items = useMemo(() => {
    const all = snapshot?.items ?? [];
    return batchId ? all.filter((item) => item.batchId === batchId) : all;
  }, [batchId, snapshot]);

  const thumbnails = useThumbnails(session, items);

  const act = useCallback(
    async (clientFileId: string, work: () => Promise<unknown>) => {
      setBusy(clientFileId);
      try {
        await work();
        setSnapshot(await session.runner.snapshot(batchId));
      } finally {
        setBusy(null);
      }
    },
    [batchId, session],
  );

  if (items.length === 0) return null;

  const online = snapshot?.online ?? true;
  const complete = items.filter((item) => item.status === "complete").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const uploading = items.filter((item) => item.status === "uploading").length;
  const waiting = items.filter(
    (item) => item.status === "staged" || item.status === "pending" || item.status === "retrying",
  ).length;
  const paused = items.filter((item) => item.status === "paused").length;

  const totalBytes = items.reduce((total, item) => total + item.byteSize, 0);
  const uploadedBytes = items.reduce((total, item) => {
    if (item.status === "complete") return total + item.byteSize;
    const live = snapshot?.progress.get(item.clientFileId);
    return total + (live?.uploadedBytes ?? item.uploadedBytes ?? 0);
  }, 0);

  const retryable = items.filter((item) => item.status === "failed" && !item.needsFile).length;

  return (
    <section aria-label="Import queue" className="import-progress">
      <div className="split-heading">
        <h3>
          Import · {complete} of {items.length}
          {failed > 0 ? ` · ${failed} failed` : ""}
        </h3>
        <span className="muted">
          {formatBytes(uploadedBytes)} of {formatBytes(totalBytes)}
        </span>
      </div>

      {/* One live region for the batch. Announcing every row would talk over
          itself on a card dump; the summary is what somebody needs to hear. */}
      <p aria-live="polite" className="visually-hidden">
        {complete} of {items.length} imported, {uploading} uploading, {waiting} waiting
        {failed > 0 ? `, ${failed} failed` : ""}
        {online ? "" : ", waiting for a connection"}.
      </p>

      <div className="import-summary">
        <span className={`import-chip${online ? "" : " offline"}`}>
          {online ? `${uploading} uploading · ${waiting} waiting` : "Offline — waiting to resume"}
        </span>
        {paused > 0 && <span className="import-chip">{paused} paused</span>}
        <div className="import-batch-actions">
          {batchId && (
            <>
              <button
                className="button small"
                onClick={() => void act("batch", () => session.runner.pauseBatch(batchId))}
                type="button"
              >
                Pause all
              </button>
              <button
                className="button small"
                onClick={() => void act("batch", () => session.runner.resumeBatch(batchId))}
                type="button"
              >
                Resume all
              </button>
            </>
          )}
          <button
            className="button small"
            disabled={retryable === 0}
            onClick={() => void act("batch", () => session.runner.retryFailed(batchId))}
            type="button"
          >
            Retry failed{retryable > 0 ? ` (${retryable})` : ""}
          </button>
        </div>
      </div>

      <ul className="import-list">
        {items.map((item) => {
          const live = snapshot?.progress.get(item.clientFileId);
          const uploaded = live?.uploadedBytes ?? item.uploadedBytes ?? 0;
          const percent = percentFor(item, uploaded);
          const thumbnail = thumbnails.get(item.clientFileId);
          const working = busy === item.clientFileId;

          return (
            <li className={`import-row ${item.status}`} key={item.clientFileId}>
              <span aria-hidden="true" className="import-thumb">
                {thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={thumbnail} />
                ) : (
                  <span className="import-thumb-blank" />
                )}
              </span>

              <span className="import-name" title={item.originalFilename}>
                {item.originalFilename}
              </span>
              <span className="import-size">{formatBytes(item.byteSize)}</span>
              <span className="import-state">
                {STATE_LABELS[item.status]}
                {item.status === "uploading" || item.status === "retrying"
                  ? ` · ${percent}%`
                  : ""}
                {item.attemptCount > 1 && item.status !== "complete"
                  ? ` · attempt ${item.attemptCount}`
                  : ""}
              </span>

              <span className="import-bar">
                <span
                  aria-label={`${item.originalFilename}: ${percent}% uploaded`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={percent}
                  className="import-bar-fill"
                  role="progressbar"
                  style={{ width: `${percent}%` }}
                />
              </span>

              {item.needsFile ? (
                <span className="import-detail import-detail-alert">
                  File needed. The local copy is gone — select it again to finish importing it.
                </span>
              ) : (
                item.errorMessage &&
                item.status !== "complete" && (
                  <span
                    className={`import-detail${needsPerson(item.errorCode) ? " import-detail-alert" : ""}`}
                  >
                    {item.errorMessage}
                  </span>
                )
              )}

              <span className="import-actions">
                {item.needsFile && (
                  <button
                    className="button small"
                    onClick={() => onFileNeeded(item)}
                    type="button"
                  >
                    Choose file
                  </button>
                )}

                {!item.needsFile && IN_FLIGHT.includes(item.status) && (
                  <button
                    className="button small quiet"
                    disabled={working}
                    onClick={() => void act(item.clientFileId, () => session.runner.pauseItem(item.clientFileId))}
                    type="button"
                  >
                    <span className="visually-hidden">Pause {item.originalFilename}</span>
                    <span aria-hidden="true">Pause</span>
                  </button>
                )}

                {item.status === "paused" && (
                  <button
                    className="button small"
                    disabled={working}
                    onClick={() => void act(item.clientFileId, () => session.runner.resumeItem(item.clientFileId))}
                    type="button"
                  >
                    <span className="visually-hidden">Resume {item.originalFilename}</span>
                    <span aria-hidden="true">Resume</span>
                  </button>
                )}

                {item.status === "failed" && !item.needsFile && (
                  <button
                    className="button small"
                    disabled={working}
                    onClick={() => void act(item.clientFileId, () => session.runner.retryItem(item.clientFileId))}
                    type="button"
                  >
                    <span className="visually-hidden">Retry {item.originalFilename}</span>
                    <span aria-hidden="true">Retry</span>
                  </button>
                )}

                {item.status !== "complete" && item.status !== "canceled" && (
                  <button
                    className="button small quiet"
                    disabled={working}
                    onClick={() => void act(item.clientFileId, () => session.runner.cancelItem(item.clientFileId))}
                    type="button"
                  >
                    <span className="visually-hidden">Cancel {item.originalFilename}</span>
                    <span aria-hidden="true">Cancel</span>
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Small pictures for the first few rows.
 *
 * Read from the staged copy, which is the only place the bytes are: the
 * original has not reached storage yet, and once it has, the local copy is
 * deleted. A frame the browser cannot decode -- most raws -- simply has no
 * thumbnail, which is the same thing the contact sheet does.
 */
function useThumbnails(
  session: ImportSession,
  items: readonly QueueItemView[],
): ReadonlyMap<string, string> {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const made = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;

    const wanted = items
      .filter(
        (item) =>
          canPreview(item.mimeType) &&
          item.byteSize <= THUMBNAIL_MAX_BYTES &&
          item.stagingState === "staged" &&
          !made.current.has(item.clientFileId),
      )
      .slice(0, Math.max(0, THUMBNAIL_LIMIT - made.current.size));

    void (async () => {
      for (const item of wanted) {
        if (cancelled) return;
        const blob = await session.queue.bytesFor(item.clientFileId);
        if (!blob || cancelled) continue;
        const preview = await makePreview(
          new File([blob], item.originalFilename, { type: item.mimeType }),
        );
        if (!preview || cancelled) continue;
        made.current.set(item.clientFileId, URL.createObjectURL(preview.blob));
        setUrls(new Map(made.current));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [items, session]);

  // Object URLs are revoked when the panel goes, not when a row does: a row can
  // disappear and come back as the queue re-renders, and revoking on every
  // change would blank the strip.
  useEffect(() => {
    const drawn = made.current;
    return () => {
      for (const url of drawn.values()) URL.revokeObjectURL(url);
      drawn.clear();
    };
  }, []);

  return urls;
}
