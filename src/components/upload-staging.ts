"use client";

import { prepareUploadAction } from "@/app/[workspace]/shoots/actions";
import { createClient } from "@/lib/supabase/client";
import {
  hashFile,
  hasBrowserPreview,
  likelyCapturedAt,
  makePreview,
  readDimensions,
  uploadToken,
} from "@/lib/upload";

/**
 * Getting bytes as far as the staging area, and no further.
 *
 * Two screens now put files into storage: the shoot workspace, which registers
 * each one against a shoot that already exists, and the creation page, which
 * has no shoot to register against until the photographer presses Create shoot.
 * The half they share is everything up to registration -- hash the bytes,
 * ask the server where this workspace may stage them, upload, and make a
 * preview -- so that half lives here rather than being written twice.
 *
 * Nothing in this module is authoritative. A staged object is bytes in a
 * workspace-scoped holding area with no record pointing at it; registerImport()
 * on the server is what turns it into an asset, and only that.
 */

/** What the server needs to register one staged original. */
export interface StagedOriginal {
  readonly filename: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly mimeType: string;
  readonly capturedAt?: string;
  readonly width?: number;
  readonly height?: number;
  /** Where the bytes are, relative to the originals bucket. */
  readonly stagingKey: string;
}

/** The same for a browser-generated preview, which lives in another bucket. */
export interface StagedPreview {
  readonly sha256: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly stagingKey: string;
}

/** The two phases a caller may want to show a progress bar for. */
export type StagingPhase = "hashing" | "uploading";

/**
 * Hash a file and put it in this workspace's staging area.
 *
 * The digest is computed over the exact bytes on this machine, before anything
 * leaves it. The staging key is built server-side from the session's
 * organization, so a client cannot choose a path in someone else's workspace;
 * the storage policies enforce the same thing independently.
 */
export async function stageOriginal(
  workspaceSlug: string,
  file: File,
  onPhase?: (phase: StagingPhase) => void,
): Promise<StagedOriginal> {
  onPhase?.("hashing");
  const sha256 = await hashFile(file);
  const dimensions = await readDimensions(file);
  const mimeType = file.type || "application/octet-stream";

  onPhase?.("uploading");
  const { stagingKey } = await prepareUploadAction(workspaceSlug, uploadToken());
  const upload = await createClient()
    .storage.from("originals")
    .upload(stagingKey, file, { contentType: mimeType, upsert: false });
  if (upload.error) throw new Error(upload.error.message);

  return {
    filename: file.name,
    sha256,
    bytes: file.size,
    mimeType,
    capturedAt: likelyCapturedAt(file),
    width: dimensions?.width,
    height: dimensions?.height,
    stagingKey,
  };
}

/**
 * Stage a preview beside an already-staged original.
 *
 * Returns null rather than throwing for anything the browser cannot decode: a
 * missing preview costs a thumbnail, never a file. RAW frames take this path
 * today and are imported exactly like everything else.
 *
 * The key is derived from the original's, which the server already scoped to
 * this workspace, so no second round trip is needed to find a safe place.
 */
export async function stagePreview(
  file: File,
  originalStagingKey: string,
): Promise<StagedPreview | null> {
  if (!hasBrowserPreview(file.type)) return null;

  try {
    const preview = await makePreview(file);
    if (!preview) return null;

    const stagingKey = `${originalStagingKey}-preview`;
    const upload = await createClient()
      .storage.from("derivatives")
      .upload(stagingKey, preview.blob, { contentType: "image/jpeg", upsert: true });
    if (upload.error) return null;

    return {
      sha256: await hashFile(preview.blob),
      bytes: preview.blob.size,
      width: preview.width,
      height: preview.height,
      stagingKey,
    };
  } catch {
    return null;
  }
}
