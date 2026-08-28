"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Field } from "@/components/primitives";
import {
  type StagedOriginal,
  type StagedPreview,
  stageOriginal,
  stagePreview,
} from "@/components/upload-staging";
import type { DraftPhotograph } from "@/lib/shoot-draft";
import { formatBytes } from "@/lib/upload";

/**
 * Photographs on the creation page, before there is a shoot to put them in.
 *
 * The shoot workspace's ImportDropzone registers each file the moment it lands,
 * because there the shoot already exists. Here it cannot: the record is created
 * when the photographer presses Create shoot, and registering a file against a
 * shoot that does not exist is not a thing that can be done. So the bytes go as
 * far as the workspace's staging area -- hashed on this machine, uploaded to a
 * private path the server chose -- and wait there. createShootAction registers
 * them, with the shoot, in one motion.
 *
 * Nothing staged here is an asset yet. Removing a photograph from this list
 * before creating leaves the staged bytes unreferenced, which is what the
 * staging area is for; no record ever pointed at them.
 */

export interface Photograph extends DraftPhotograph {
  readonly file: File;
  /** A local object URL for the thumbnail. Revoked when the row goes. */
  readonly thumbnailUrl?: string;
  readonly staged?: StagedOriginal;
  readonly stagedPreview?: StagedPreview;
  readonly error?: string;
  /** True when the same bytes were already added to this form. */
  readonly duplicate?: boolean;
}

const STATE_LABELS: Record<Photograph["state"], string> = {
  queued: "Waiting",
  hashing: "Hashing",
  uploading: "Uploading",
  staged: "Ready",
  failed: "Failed",
};

/** Matches the shoot workspace's queue: fast without saturating a kerbside uplink. */
const CONCURRENCY = 3;

export function PhotographPicker({
  workspaceSlug,
  photographs,
  onChange,
  disabled,
}: {
  workspaceSlug: string;
  photographs: readonly Photograph[];
  onChange: (update: (current: readonly Photograph[]) => readonly Photograph[]) => void;
  /** True while the form is submitting: the list must stop moving. */
  disabled: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The queue and the drain flag live in refs so a drain loop started in one
  // render picks up files appended during a later one, and is not restarted by
  // a re-render partway through. This mirrors ImportDropzone deliberately.
  const queueRef = useRef<Photograph[]>([]);
  const drainingRef = useRef(false);
  const nextIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const patch = useCallback(
    (id: string, changes: Partial<Photograph>) => {
      if (!mountedRef.current) return;
      onChange((current) =>
        current.map((photograph) =>
          photograph.id === id ? { ...photograph, ...changes } : photograph,
        ),
      );
    },
    [onChange],
  );

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;

    const worker = async () => {
      for (;;) {
        const entry = queueRef.current.shift();
        if (!entry) return;
        try {
          const staged = await stageOriginal(workspaceSlug, entry.file, (phase) =>
            patch(entry.id, { state: phase }),
          );
          const preview = await stagePreview(entry.file, staged.stagingKey);
          patch(entry.id, {
            state: "staged",
            staged,
            stagedPreview: preview ?? undefined,
            capturedAt: staged.capturedAt,
          });
        } catch (error) {
          patch(entry.id, {
            state: "failed",
            error: error instanceof Error ? error.message : "Upload failed.",
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queueRef.current.length) }, worker),
    );
    drainingRef.current = false;
  }, [patch, workspaceSlug]);

  const enqueue = useCallback(
    (selected: readonly File[]) => {
      if (selected.length === 0) return;

      const entries: Photograph[] = selected.map((file) => ({
        id: `photograph-${(nextIdRef.current += 1)}`,
        filename: file.name,
        bytes: file.size,
        state: "queued" as const,
        file,
        thumbnailUrl: thumbnailFor(file),
        subjects: [],
        keywords: [],
      }));

      queueRef.current.push(...entries);
      onChange((current) => [...current, ...entries]);
      void drain();
    },
    [drain, onChange],
  );

  const remove = useCallback(
    (id: string) => {
      // A file still in the queue is pulled out of it too, or it would be
      // staged after its row had gone.
      queueRef.current = queueRef.current.filter((entry) => entry.id !== id);
      onChange((current) => {
        const going = current.find((photograph) => photograph.id === id);
        if (going?.thumbnailUrl) URL.revokeObjectURL?.(going.thumbnailUrl);
        return current.filter((photograph) => photograph.id !== id);
      });
    },
    [onChange],
  );

  const staged = photographs.filter((photograph) => photograph.state === "staged").length;
  const failed = photographs.filter((photograph) => photograph.state === "failed").length;

  return (
    <div>
      <div
        className={`dropzone${photographs.length > 0 ? " compact" : ""}${dragging ? " dragging" : ""}`}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) enqueue([...event.dataTransfer.files]);
        }}
      >
        <div>
          <div aria-hidden="true" className="dropzone-mark">
            ＋
          </div>
          <h3>{photographs.length > 0 ? "Add more photographs" : "Add the photographs"}</h3>
          <p>
            Drop JPEGs, RAW files, or clips here. Every file is hashed on this machine before it
            leaves it, and the original is stored untouched. Photographs are optional — a shoot can
            be created before the first frame exists.
          </p>

          {/* The control is styled away, not hidden from anyone: the button
              below opens it, and a keyboard or screen reader reaches the input
              itself by its label. */}
          <label className="visually-hidden" htmlFor="photographs-input">
            Add photographs
          </label>
          <input
            accept="image/*,video/*,.arw,.cr2,.cr3,.nef,.raf,.orf,.dng"
            className="visually-hidden"
            disabled={disabled}
            id="photographs-input"
            multiple
            onChange={(event) => {
              const chosen = [...(event.target.files ?? [])];
              event.target.value = "";
              enqueue(chosen);
            }}
            ref={inputRef}
            type="file"
          />

          <div className="upload-options">
            <button
              className="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              Choose files
            </button>
          </div>
        </div>
      </div>

      <p aria-live="polite" className="section-note">
        {photographs.length === 0
          ? "No photographs added yet."
          : `${staged} of ${photographs.length} ready${failed > 0 ? ` · ${failed} failed` : ""}. Nothing is saved until you create the shoot.`}
      </p>

      {photographs.length > 0 && (
        <ul className="staged-list">
          {photographs.map((photograph) => (
            <li className={`staged-row ${photograph.state}`} key={photograph.id}>
              <div className="staged-head">
                {photograph.thumbnailUrl ? (
                  // Decorative: the filename beside it is the accessible name.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" className="staged-thumb" src={photograph.thumbnailUrl} />
                ) : (
                  <span aria-hidden="true" className="staged-thumb empty" />
                )}
                <div className="staged-facts">
                  <strong>{photograph.filename}</strong>
                  <small>
                    {formatBytes(photograph.bytes)} · {STATE_LABELS[photograph.state]}
                    {photograph.error ? ` · ${photograph.error}` : ""}
                  </small>
                </div>
                <button
                  className="button small"
                  disabled={disabled}
                  onClick={() => remove(photograph.id)}
                  type="button"
                >
                  Remove
                </button>
              </div>

              <details className="staged-metadata">
                <summary>
                  Metadata for {photograph.filename}
                  {photograph.caption ? "" : " — no caption yet"}
                </summary>
                <div className="form-grid">
                  <Field
                    full
                    label="Headline"
                    name={`headline-${photograph.id}`}
                    onChange={(event) => patch(photograph.id, { headline: event.target.value })}
                    placeholder="A short line a desk can scan"
                    value={photograph.headline ?? ""}
                  />
                  <Field
                    control="textarea"
                    full
                    hint="What is happening, who is in frame, where, and when. Required before dispatch, not before saving."
                    label="Caption"
                    name={`caption-${photograph.id}`}
                    onChange={(event) => patch(photograph.id, { caption: event.target.value })}
                    value={photograph.caption ?? ""}
                  />
                  <Field
                    hint="Comma separated. Leave empty rather than guessing."
                    label="People in frame"
                    name={`subjects-${photograph.id}`}
                    onChange={(event) =>
                      patch(photograph.id, { subjects: splitList(event.target.value) })
                    }
                    value={(photograph.subjects ?? []).join(", ")}
                  />
                  <Field
                    hint="Comma separated. Added to the shoot's shared keywords."
                    label="Keywords"
                    name={`keywords-${photograph.id}`}
                    onChange={(event) =>
                      patch(photograph.id, { keywords: splitList(event.target.value) })
                    }
                    value={(photograph.keywords ?? []).join(", ")}
                  />
                  <Field
                    full
                    hint="Overrides the shoot location for this frame only."
                    label="Location"
                    name={`locationName-${photograph.id}`}
                    onChange={(event) => patch(photograph.id, { locationName: event.target.value })}
                    value={photograph.locationName ?? ""}
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A local preview of the file the operator just chose.
 *
 * Object URLs are a browser API, and one that is absent in a test environment
 * and in anything rendering this without a DOM. A thumbnail is a convenience;
 * failing to make one must not stop a file being staged, so this returns
 * nothing rather than throwing.
 */
function thumbnailFor(file: File): string | undefined {
  if (!file.type.startsWith("image/")) return undefined;
  try {
    return URL.createObjectURL?.(file);
  } catch {
    return undefined;
  }
}

/**
 * A comma-separated field, split but not de-duplicated.
 *
 * De-duplicating while somebody is typing would delete the characters under
 * their cursor. The server-side parser de-duplicates on the way in, which is
 * the only place it matters.
 */
function splitList(value: string): string[] {
  return value.split(",").map((part) => part.trim());
}
