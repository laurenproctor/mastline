import { sanitizeErrorMessage } from "./errors";
import { classifyUploadFailure, type UploadFailure } from "./failure";
import type { QueueItemRecord, UploadRequest, UploadResult, UploadTransport } from "./types";

/**
 * The resumable transport, over TUS, against Supabase Storage.
 *
 * This is the only part of the import queue that knows bytes exist. It moves
 * one file and returns one classified outcome; it holds no state, decides no
 * retry policy, and never touches the queue's records. Everything durable is
 * handed back through the callbacks so the queue can persist it -- which is
 * what makes an upload resumable across a reload rather than merely across a
 * dropped packet.
 */

/**
 * The chunk size Supabase requires for resumable uploads.
 *
 * Six mebibytes, exactly, and not a tuning parameter. The storage service
 * rejects other sizes, and the documentation is explicit that it must not be
 * changed:
 * https://supabase.com/docs/guides/storage/uploads/resumable-uploads
 */
export const SUPABASE_TUS_CHUNK_SIZE = 6 * 1024 * 1024;

/**
 * How long an upload may make no progress before it is treated as timed out.
 *
 * TUS itself waits forever on a socket that has gone quiet, which on a train is
 * indistinguishable from a stalled queue. Sixty seconds is long enough that a
 * slow chunk on a bad connection is not mistaken for a stall, and short enough
 * that a photographer notices the queue moving again rather than sitting there.
 */
const STALL_TIMEOUT_MS = 60_000;

/** Cache-Control seconds sent with the object. Originals are immutable. */
const CACHE_CONTROL_SECONDS = 3600;

// ---------------------------------------------------------------------------
// The narrow shape of tus-js-client this module uses
//
// Declared structurally rather than imported as types so the upload client can
// be replaced with a double in tests without pulling the real package -- which
// resolves to its Node build outside a bundler and drags in node:http.
// ---------------------------------------------------------------------------

export interface TusPreviousUpload {
  readonly uploadUrl: string | null;
  readonly size: number | null;
  readonly creationTime: string;
}

export interface TusUploadHandle {
  readonly url: string | null;
  start(): void;
  abort(shouldTerminate?: boolean): Promise<void>;
  findPreviousUploads(): Promise<TusPreviousUpload[]>;
  resumeFromPreviousUpload(previous: TusPreviousUpload): void;
}

export interface TusUploadOptions {
  endpoint: string;
  uploadUrl?: string;
  chunkSize: number;
  retryDelays: number[];
  headers: Record<string, string>;
  uploadDataDuringCreation: boolean;
  removeFingerprintOnSuccess: boolean;
  storeFingerprintForResuming: boolean;
  metadata: Record<string, string>;
  onShouldRetry: () => boolean;
  onUploadUrlAvailable?: () => void;
  onProgress?: (bytesSent: number, bytesTotal: number) => void;
  onChunkComplete?: (chunkSize: number, bytesAccepted: number, bytesTotal: number) => void;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export type TusUploadFactory = (file: Blob, options: TusUploadOptions) => TusUploadHandle;

export interface TusTransportOptions {
  /** Built from the public Supabase URL. See resumableUploadEndpoint(). */
  readonly endpoint: string;
  /** The signed-in user's current access token, or null if there is none. */
  readonly accessToken: () => Promise<string | null>;
  /** Force a refresh. Called once, after an authorization failure. */
  readonly refreshAccessToken: () => Promise<string | null>;
  /** A ready-made factory. Tests pass one; the application passes `loadUpload`. */
  readonly createUpload?: TusUploadFactory;
  /** A loader, so the real client is imported only when it is needed. */
  readonly loadUpload?: () => Promise<TusUploadFactory>;
  readonly online?: () => boolean;
  readonly chunkSize?: number;
  readonly stallTimeoutMs?: number;
  /** Terminates a session on cancellation. Optional; failure is not fatal. */
  readonly terminate?: (uploadUrl: string, headers: Record<string, string>) => Promise<void>;
}

export class TusUploadTransport implements UploadTransport {
  private factory: TusUploadFactory | null = null;

  constructor(private readonly options: TusTransportOptions) {}

  private get chunkSize(): number {
    return this.options.chunkSize ?? SUPABASE_TUS_CHUNK_SIZE;
  }

  private online(): boolean {
    return this.options.online?.() ?? true;
  }

  private async resolveFactory(): Promise<TusUploadFactory> {
    if (this.factory) return this.factory;
    // A ready-made factory, or a loader for one. The loader form is how the
    // real client is imported lazily: nothing pulls tus into a bundle until a
    // photographer actually chooses a file.
    if (this.options.createUpload) this.factory = this.options.createUpload;
    else if (this.options.loadUpload) this.factory = await this.options.loadUpload();
    else throw new Error("The upload transport was given no TUS client.");
    return this.factory;
  }

  /**
   * Send one file, resuming wherever the server says it had got to.
   *
   * The resume is not this client's opinion. TUS asks the server for the
   * offset before it sends anything, so a file that was 80% uploaded before a
   * tunnel continues at 80% -- and a file the server never actually received,
   * despite what this device recorded, starts again from zero without anybody
   * having to work out which of the two happened.
   */
  async upload(request: UploadRequest): Promise<UploadResult> {
    const first = await this.attempt(request, { refreshed: false });

    // One refresh, then one more go. An expired token is the single most
    // common failure on a long card dump -- an hour of uploading outlives an
    // access token -- and it is not a reason to make somebody press retry.
    if (!first.ok && first.failure.refreshSession) {
      const token = await this.options.refreshAccessToken();
      if (token) return this.attempt(request, { refreshed: true, token });
    }

    return first;
  }

  private async attempt(
    request: UploadRequest,
    context: { refreshed: boolean; token?: string },
  ): Promise<UploadResult> {
    const { item, blob } = request;

    if (!this.online()) {
      return { ok: false, failure: classify({ online: false }), bytesUploaded: 0 };
    }

    const token = context.token ?? (await this.options.accessToken());
    if (!token) {
      return {
        ok: false,
        failure: {
          code: "authentication_expired",
          message: "The session expired. Sign in again to continue this import.",
          retryable: true,
          refreshSession: !context.refreshed,
        },
        bytesUploaded: 0,
      };
    }

    const factory = await this.resolveFactory();
    let bytesUploaded = 0;
    let uploadUrl = request.resumeUrl;
    let resuming = Boolean(request.resumeUrl);

    return new Promise<UploadResult>((resolve) => {
      let settled = false;
      let stall: ReturnType<typeof setTimeout> | undefined;

      const finish = (result: UploadResult) => {
        if (settled) return;
        settled = true;
        if (stall) clearTimeout(stall);
        request.signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };

      const armStall = () => {
        if (stall) clearTimeout(stall);
        stall = setTimeout(() => {
          // Paused rather than terminated: the session stays valid, so the
          // retry resumes instead of starting the file again.
          void handle.abort(false).catch(() => {});
          finish({
            ok: false,
            failure: classify({ error: new Error("The upload timed out."), online: this.online() }),
            uploadUrl,
            bytesUploaded,
          });
        }, this.options.stallTimeoutMs ?? STALL_TIMEOUT_MS);
      };

      const onAbort = () => {
        void handle.abort(false).catch(() => {});
        finish({
          ok: false,
          failure: {
            code: "offline",
            message: "Paused.",
            retryable: true,
          },
          uploadUrl,
          bytesUploaded,
        });
      };

      /**
       * Persist the session URL the moment it exists, however we learn of it.
       *
       * onUploadUrlAvailable is the documented hook and it did not fire here --
       * the queue stored no URL at all, so a reload could not resume and
       * re-uploaded the file from zero. Rather than depend on one callback,
       * every callback that runs after creation checks the handle. Whichever
       * fires first wins; the rest are no-ops.
       */
      const noteUrl = () => {
        const current = handle?.url;
        if (!current || current === uploadUrl) return;
        uploadUrl = current;
        resuming = true;
        request.onUploadUrl?.(current);
      };

      const handle = factory(blob, {
        endpoint: this.options.endpoint,
        ...(request.resumeUrl ? { uploadUrl: request.resumeUrl } : {}),
        chunkSize: this.chunkSize,
        // Empty on purpose. Retry policy lives in the queue runner, once,
        // where it can be bounded, jittered, and shown to the operator. Two
        // layers of retries would multiply into delays nobody chose.
        retryDelays: [],
        onShouldRetry: () => false,
        headers: {
          authorization: `Bearer ${token}`,
          // No x-upsert. An original is written once, to a path derived from
          // ids that cannot collide, so anything already there is a fact to be
          // reconciled rather than something to overwrite.
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        storeFingerprintForResuming: true,
        metadata: metadataFor(item),
        onUploadUrlAvailable: noteUrl,
        onProgress: (sent, total) => {
          noteUrl();
          bytesUploaded = sent;
          armStall();
          request.onProgress?.(sent, total);
        },
        onChunkComplete: (_chunk, accepted) => {
          noteUrl();
          bytesUploaded = accepted;
          request.onChunk?.(accepted);
        },
        // handle.url is the authority at the end: a session resumed from the
        // client's own discovery never fires onUploadUrlAvailable, so reading
        // the local variable alone would report no session for an upload that
        // plainly had one.
        onSuccess: () => {
          noteUrl();
          finish({ ok: true, uploadUrl: handle.url ?? uploadUrl, bytesUploaded });
        },
        onError: (error) =>
          finish({
            ok: false,
            failure: classify({ ...describe(error), online: this.online(), resuming }),
            uploadUrl: handle.url ?? uploadUrl,
            bytesUploaded,
          }),
      });

      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) return onAbort();

      void this.begin(handle, request).then(() => {
        // A session found by discovery is recorded like any other, so the next
        // attempt resumes from the queue's own record rather than depending on
        // the client's fingerprint store still being there.
        if (handle.url && handle.url !== uploadUrl) {
          uploadUrl = handle.url;
          resuming = true;
          request.onUploadUrl?.(handle.url);
        }
        armStall();
        handle.start();
      });
    });
  }

  /**
   * Find an unfinished session for this file before starting a new one.
   *
   * The queue's own record of the upload URL is preferred and is passed in as
   * `resumeUrl`; this is the fallback for the case where that record is gone
   * but the TUS client still remembers the session -- a queue cleared while an
   * upload was in flight, most often. Discovery is best effort: if it finds
   * nothing, or throws, a fresh session is created and no bytes are lost.
   */
  private async begin(handle: TusUploadHandle, request: UploadRequest): Promise<void> {
    if (request.resumeUrl) return;
    try {
      const previous = await handle.findPreviousUploads();
      const usable = previous
        .filter((candidate) => candidate.uploadUrl && candidate.size === request.blob.size)
        .sort((a, b) => (a.creationTime < b.creationTime ? 1 : -1))[0];
      if (usable) handle.resumeFromPreviousUpload(usable);
    } catch {
      // No discovery available. A new session is correct, not a failure.
    }
  }

  /**
   * Give up a session for good.
   *
   * Called when a file is cancelled, so a half-uploaded object is not left
   * occupying storage until Supabase expires it.
   */
  async discard(input: { uploadUrl: string }): Promise<void> {
    if (!this.options.terminate) return;
    const token = await this.options.accessToken();
    if (!token) return;
    try {
      await this.options.terminate(input.uploadUrl, { authorization: `Bearer ${token}` });
    } catch {
      // The session expires by itself within a day. Nothing to report.
    }
  }
}

/**
 * What Supabase is told about the object being created.
 *
 * `objectName` is the storage path the server chose at registration -- immutable,
 * workspace-scoped, and derived from ids. The camera's filename is not here and
 * must not be: it is the operator's record, not a path.
 */
export function metadataFor(item: QueueItemRecord): Record<string, string> {
  return {
    bucketName: item.storageBucket,
    objectName: item.storagePath,
    contentType: item.mimeType || "application/octet-stream",
    cacheControl: String(CACHE_CONTROL_SECONDS),
  };
}

/** Pull the status, body, and Retry-After out of whatever tus threw. */
function describe(error: unknown): {
  error: unknown;
  status?: number;
  body?: string;
  retryAfter?: string;
} {
  const detailed = error as {
    originalResponse?: {
      getStatus?: () => number;
      getBody?: () => string;
      getHeader?: (name: string) => string | undefined;
    } | null;
  };
  const response = detailed?.originalResponse;
  if (!response || typeof response.getStatus !== "function") return { error };

  let body = "";
  try {
    body = response.getBody?.() ?? "";
  } catch {
    body = "";
  }

  let retryAfter: string | undefined;
  try {
    retryAfter = response.getHeader?.("retry-after") ?? undefined;
  } catch {
    retryAfter = undefined;
  }

  return { error, status: response.getStatus(), body, retryAfter };
}

function classify(context: Parameters<typeof classifyUploadFailure>[0]): UploadFailure {
  const failure = classifyUploadFailure(context);
  // The classified sentence is what the operator sees. The original wording is
  // kept only when there is nothing better, and is sanitized on the way.
  if (failure.code !== "unknown" || !context.error) return failure;
  return { ...failure, message: `${failure.message} (${sanitizeErrorMessage(context.error)})` };
}

/**
 * The real client, imported only when a file is actually being uploaded.
 *
 * A dynamic import keeps tus out of the first load of every page that happens
 * to render an import control, and keeps its Node build out of test runs that
 * never upload anything.
 */
export async function loadTusFactory(): Promise<TusUploadFactory> {
  const tus = await import("tus-js-client");
  return (file, options) => new tus.Upload(file, options as never) as unknown as TusUploadHandle;
}

/** Terminate a session, using the same client. */
export async function terminateTusUpload(
  uploadUrl: string,
  headers: Record<string, string>,
): Promise<void> {
  const tus = await import("tus-js-client");
  await tus.Upload.terminate(uploadUrl, { headers });
}
