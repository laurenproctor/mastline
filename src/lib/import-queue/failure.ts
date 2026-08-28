import { sanitizeErrorMessage } from "./errors";

/**
 * Why an upload stopped, in terms somebody can act on.
 *
 * A queue that reports "upload failed" forty times is a queue nobody can use:
 * the photographer cannot tell a tunnel from an expired session from a file the
 * bucket will never accept, and those need three different responses -- wait,
 * retry, and stop retrying. So every failure is classified before it is
 * recorded, and the classification decides both what the operator is told and
 * whether the runner tries again.
 *
 * The categories are deliberately about causes rather than about HTTP. A 403
 * from storage and a row level security refusal are the same fact to the person
 * holding the camera: this account may not put that file there.
 */

export const UPLOAD_FAILURE_CODES = [
  /** No connection. Not a failure of the file; the queue waits. */
  "offline",
  /** The request went out and nothing came back in time. */
  "timeout",
  /** 5xx, 429, or a connection the server dropped. Retryable, with backoff. */
  "server_unavailable",
  /** The access token has expired. Refresh the session and try once more. */
  "authentication_expired",
  /** Signed in, and not allowed. Retrying cannot fix this. */
  "authorization_denied",
  /** The workspace or the bucket is out of room. */
  "quota_exceeded",
  /** The TUS upload URL is gone. Supabase expires them after ~24 hours. */
  "upload_session_expired",
  /** Something already occupies the object path this upload was creating. */
  "object_conflict",
  /** The bucket will not take this file: too large, or a refused MIME type. */
  "unsupported_file",
  /** The staged copy on this machine is gone. Only the operator can fix it. */
  "file_missing",
  "unknown",
] as const;

export type UploadFailureCode = (typeof UPLOAD_FAILURE_CODES)[number];

export interface UploadFailure {
  readonly code: UploadFailureCode;
  /** Sanitized, and written for the person who has to decide what to do. */
  readonly message: string;
  /** Whether the runner may try again on its own. */
  readonly retryable: boolean;
  /**
   * Whether this needs the upload session rebuilt rather than resumed. An
   * expired URL is not a broken file, and the difference matters: one is a new
   * PATCH to a new URL, the other is a photographer being told to give up.
   */
  readonly restartSession?: boolean;
  /** Whether a token refresh should be attempted before the retry. */
  readonly refreshSession?: boolean;
}

/**
 * The codes the runner will keep retrying, and the codes it will not.
 *
 * Retrying an authorization refusal or a rejected file type forever is how a
 * queue burns a mobile data allowance overnight and still has nothing to show
 * for it. Those stop and wait for a person.
 */
const RETRYABLE: readonly UploadFailureCode[] = [
  "offline",
  "timeout",
  "server_unavailable",
  "authentication_expired",
  "upload_session_expired",
  "unknown",
];

export function isRetryable(code: UploadFailureCode): boolean {
  return RETRYABLE.includes(code);
}

/** Plain sentences. No URLs, no status codes, no provider wording. */
const MESSAGES: Record<UploadFailureCode, string> = {
  offline: "Waiting for a connection.",
  timeout: "The upload timed out. It will start again from where it stopped.",
  server_unavailable: "Mastline storage did not respond. Trying again shortly.",
  authentication_expired: "The session expired. Signing back in and continuing.",
  authorization_denied: "This account is not allowed to import into this workspace.",
  quota_exceeded: "This workspace is out of storage. Free some space or upgrade the plan.",
  upload_session_expired: "The upload session expired. Starting a fresh one for this file.",
  object_conflict: "A file is already stored at this location. Checking it before continuing.",
  unsupported_file: "Storage refused this file. It may be larger than the plan allows.",
  file_missing: "The local copy of this file is gone. Select it again to finish importing it.",
  unknown: "The upload stopped for an unknown reason.",
};

export function messageFor(code: UploadFailureCode): string {
  return MESSAGES[code];
}

/** Everything known about what went wrong, in one place. */
export interface FailureContext {
  readonly error?: unknown;
  /** The HTTP status, when there was a response at all. */
  readonly status?: number;
  /** The response body, read only to tell an expired token from a refusal. */
  readonly body?: string;
  /** Whether the browser believes it has a connection. */
  readonly online?: boolean;
  /** True when the failure happened against an existing upload URL. */
  readonly resuming?: boolean;
}

/**
 * Turn whatever came back into one of the categories above.
 *
 * The order matters. Connectivity is checked first because a browser that has
 * gone offline produces a network error indistinguishable from a server that
 * has fallen over, and telling somebody in a car park that Mastline is down
 * would be both wrong and alarming.
 */
export function classifyUploadFailure(context: FailureContext): UploadFailure {
  const { status, online = true, resuming = false } = context;
  const body = (context.body ?? "").toLowerCase();

  if (!online) return failure("offline");

  if (status === undefined) {
    const raw = sanitizeErrorMessage(context.error).toLowerCase();
    if (raw.includes("timeout") || raw.includes("timed out")) return failure("timeout");
    if (raw.includes("abort")) return failure("timeout");
    // A fetch that never got a status, with a connection: the far end.
    return failure("server_unavailable");
  }

  if (status === 401) return failure("authentication_expired", { refreshSession: true });

  if (status === 403) {
    // Supabase returns 403 both for an expired JWT and for a policy refusal.
    // The body is the only thing that separates them, and getting it wrong in
    // the safe direction means one wasted refresh rather than a file that
    // silently stops.
    return body.includes("jwt") || body.includes("expired") || body.includes("token")
      ? failure("authentication_expired", { refreshSession: true })
      : failure("authorization_denied");
  }

  // TUS answers an unknown or expired upload URL with 404, and 410 once it has
  // been terminated. Neither says anything about the file.
  if ((status === 404 || status === 410) && resuming) {
    return failure("upload_session_expired", { restartSession: true });
  }
  if (status === 404 || status === 410) return failure("server_unavailable");

  if (status === 409) return failure("object_conflict");
  if (status === 413 || status === 415) return failure("unsupported_file");
  if (status === 507) return failure("quota_exceeded");

  if (status === 429 || status >= 500) return failure("server_unavailable");
  if (status === 408) return failure("timeout");

  if (status >= 400) {
    // A 4xx nobody anticipated is a validation problem, and validation problems
    // do not improve by being asked again.
    return {
      code: "unknown",
      message: MESSAGES.unknown,
      retryable: false,
    };
  }

  return failure("unknown");
}

function failure(
  code: UploadFailureCode,
  extra: { refreshSession?: boolean; restartSession?: boolean } = {},
): UploadFailure {
  return { code, message: MESSAGES[code], retryable: isRetryable(code), ...extra };
}
