/**
 * Browser-side import helpers.
 *
 * The digest is computed over the exact bytes before anything is uploaded, so
 * the hash recorded against the original is a hash of what the photographer
 * actually has, not of what survived a round trip.
 */

/** SHA-256 of a file, as lowercase hex. */
export async function hashFile(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A random token for a staging key. Not security-sensitive; just unique. */
export function uploadToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Formats the browser can decode well enough to render a preview.
 *
 * RAW files are imported and hashed like anything else; they simply have no
 * browser-generated preview until a server-side decoder exists. Which RAW
 * formats are supported at launch is still an open product decision, so nothing
 * here pretends to handle them.
 */
const PREVIEWABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);

export function canPreview(mimeType: string): boolean {
  return PREVIEWABLE.has(mimeType);
}

/**
 * A clip the browser will decode far enough to grab a frame from.
 *
 * Which codecs actually play is the browser's business and cannot be known from
 * the MIME type alone, so poster extraction is attempted and allowed to fail.
 * The original is already recorded by then; a missing poster costs a thumbnail,
 * not a file.
 */
export function isVideo(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

/** Whether a browser-generated still can be attempted for this file at all. */
export function hasBrowserPreview(mimeType: string): boolean {
  return canPreview(mimeType) || isVideo(mimeType);
}

export interface Preview {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

const PREVIEW_MAX_EDGE = 1400;

/**
 * A still for the contact sheet. Returns null if the browser cannot decode it.
 *
 * A video yields a poster frame, which is what makes a clip reviewable next to
 * the stills from the same shoot -- and is also the frame the metadata
 * suggestion reads, since a vision model needs an image, not a container.
 */
export async function makePreview(file: File): Promise<Preview | null> {
  if (isVideo(file.type)) return makeVideoPoster(file);
  if (!canPreview(file.type)) return null;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return null;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    return blob ? { blob, width, height } : null;
  } catch {
    return null;
  }
}

/**
 * How far into a clip to seek before grabbing the poster frame.
 *
 * The first frame of a paparazzi clip is usually a blur of pavement while the
 * camera comes up. A second in, there is normally something to look at.
 */
const POSTER_SEEK_SECONDS = 1;

/** Grab a frame from a video file, in the browser. Null if it cannot decode. */
async function makeVideoPoster(file: File): Promise<Preview | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.crossOrigin = "anonymous";

  try {
    const frame = await new Promise<Preview | null>((resolve) => {
      // A clip the browser will not decode must not hang the import queue.
      const timer = setTimeout(() => resolve(null), 15_000);

      const fail = () => {
        clearTimeout(timer);
        resolve(null);
      };

      const draw = () => {
        clearTimeout(timer);
        try {
          const scale = Math.min(
            1,
            PREVIEW_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight),
          );
          const width = Math.max(1, Math.round(video.videoWidth * scale));
          const height = Math.max(1, Math.round(video.videoHeight * scale));

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) return resolve(null);

          context.drawImage(video, 0, 0, width, height);
          canvas.toBlob(
            (blob) => resolve(blob ? { blob, width, height } : null),
            "image/jpeg",
            0.82,
          );
        } catch {
          resolve(null);
        }
      };

      video.addEventListener("error", fail, { once: true });
      video.addEventListener("seeked", draw, { once: true });
      video.addEventListener(
        "loadeddata",
        () => {
          if (!video.videoWidth || !video.videoHeight) return fail();
          // A clip shorter than the seek point is drawn where it already is.
          const target = Number.isFinite(video.duration)
            ? Math.min(POSTER_SEEK_SECONDS, Math.max(0, video.duration - 0.1))
            : 0;
          if (target <= 0) return draw();
          video.currentTime = target;
        },
        { once: true },
      );

      video.src = url;
      video.load();
    });

    return frame;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The edge of a stored avatar, in pixels.
 *
 * It is drawn at 34px in the sidebar, so 256 covers that on a 3x screen and
 * leaves room for somewhere larger later. Storing the camera original instead
 * would mean sending twelve megabytes to show a circle the size of a thumbnail.
 */
export const AVATAR_EDGE = 256;

/**
 * The centre square of a rectangle.
 *
 * Separated from the drawing so the geometry can be tested without a canvas.
 * Centre rather than top-left because a face is usually in the middle of a
 * frame and never in the corner of one.
 */
export function centreSquare(
  width: number,
  height: number,
): { x: number; y: number; edge: number } {
  const edge = Math.min(width, height);
  return {
    x: Math.round((width - edge) / 2),
    y: Math.round((height - edge) / 2),
    edge,
  };
}

/**
 * Square and shrink a chosen photo, in the browser, before it is uploaded.
 *
 * JPEG rather than WebP: at this size the saving is a few kilobytes and is not
 * worth depending on an encoder that older Safari does not have.
 */
export async function makeAvatar(file: File): Promise<Blob | null> {
  if (!canPreview(file.type)) return null;

  try {
    const bitmap = await createImageBitmap(file);
    const { x, y, edge } = centreSquare(bitmap.width, bitmap.height);

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_EDGE;
    canvas.height = AVATAR_EDGE;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return null;
    }

    context.drawImage(bitmap, x, y, edge, edge, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
    bitmap.close();

    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  } catch {
    return null;
  }
}

/** Natural dimensions of an image file, when the browser can read them. */
export async function readDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (!canPreview(file.type)) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/**
 * Capture time from the file.
 *
 * `lastModified` is a weak signal — it is the filesystem's idea of when the
 * file changed, not when the shutter fired — so it is offered as a starting
 * point that the operator can correct, never presented as EXIF truth. Reading
 * real EXIF requires a parser and belongs with proper RAW support.
 */
export function likelyCapturedAt(file: File): string | undefined {
  if (!file.lastModified) return undefined;
  const date = new Date(file.lastModified);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
