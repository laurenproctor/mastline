/**
 * What an import failure is allowed to say.
 *
 * These messages are written to a row every member of the workspace can read,
 * and they are produced by whatever failed -- a storage client, a fetch, a
 * provider SDK -- none of which were written with that in mind. A signed URL in
 * an error string is a credential in a table; a raw provider payload is a
 * paragraph nobody can act on.
 *
 * So the message is narrowed before it is stored: no URLs, no query strings, no
 * anything that looks like a token, and short enough to read.
 */

export const MAX_ERROR_MESSAGE = 500;

const URLS = /\b(?:https?|blob|data):\S+/gi;
// The keyword, an optional scheme word after it, and the value itself: an
// "authorization: Bearer <jwt>" that only lost the word "Bearer" would have
// kept the part that mattered.
const BEARER = /\b(?:bearer|apikey|api_key|token|authorization)\b[\s:=]+(?:bearer[\s:=]+)?\S+/gi;
/** A JWT, which is shorter than the run below but is still a credential. */
const JWT = /\beyJ[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+){0,2}/g;
/** Long unbroken runs of key-ish characters: signatures, service keys. */
const SECRETS = /\b[A-Za-z0-9_-]{40,}\b/g;

export function sanitizeErrorMessage(input: unknown): string {
  const raw =
    input instanceof Error ? input.message : typeof input === "string" ? input : "Unknown error";

  const cleaned = raw
    .replace(URLS, "[link removed]")
    .replace(BEARER, "[credential removed]")
    .replace(JWT, "[redacted]")
    .replace(SECRETS, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length === 0) return "Unknown error";
  return cleaned.length > MAX_ERROR_MESSAGE
    ? `${cleaned.slice(0, MAX_ERROR_MESSAGE - 1)}…`
    : cleaned;
}

/**
 * The vocabulary of import failures.
 *
 * A code rather than a parsed message, because the queue has to decide whether
 * to retry and a person has to be told something specific, and neither should
 * depend on the wording of somebody else's exception.
 */
export const IMPORT_ERROR_CODES = [
  "staging_unavailable",
  "staging_failed",
  "quota_exceeded",
  "file_missing",
  "registration_failed",
  "upload_failed",
  "finalization_failed",
  "canceled",
  "unknown",
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export function isImportErrorCode(value: string): value is ImportErrorCode {
  return (IMPORT_ERROR_CODES as readonly string[]).includes(value);
}
