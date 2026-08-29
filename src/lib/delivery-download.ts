/**
 * Releasing a download: authorise, sign, record, release -- in that order.
 *
 * The record has to say what happened. The old route asked the database to
 * write `downloaded` and hand back a key in one call, then signed the key; a
 * signing failure left an event claiming a download that never was, and there
 * was no way to fail the other way round. So the steps are separate and each
 * gates the next:
 *
 *   1. authorize  -- the token, the expiry, the withdrawal, the acceptance, and
 *                    that the frame is in this submission's approved snapshot.
 *                    Refusals are recorded here. No download is.
 *   2. sign       -- a short-lived URL for exactly the object the snapshot
 *                    names. Fails closed: nothing is substituted.
 *   3. record     -- the append-only `downloaded` event, re-validated.
 *   4. release    -- only once the record exists.
 *
 * Nothing here touches a database or a bucket; the dependencies are handed in
 * so the route can be tested with a signer that fails on command. Nothing it
 * returns names a bucket, a key, or a token.
 */

export interface DownloadAuthorization {
  readonly objectKey: string;
  readonly storageBucket: string;
  readonly filename: string;
}

export interface DownloadDependencies {
  /** Null when the link, the frame, or the acceptance does not check out. */
  authorize(): Promise<DownloadAuthorization | null>;
  /** Null when the exact frozen object could not be signed. */
  sign(target: DownloadAuthorization): Promise<{ url: string } | null>;
  /** True when the `downloaded` event was written. */
  record(): Promise<boolean>;
}

export type DownloadOutcome =
  /** Refused by the delivery record: unknown, closed, unaccepted, or not this frame. */
  | { readonly kind: "refused" }
  /** Authorised, but the object could not be signed or the download could not be recorded. */
  | { readonly kind: "unavailable"; readonly reason: "unsigned" | "unrecorded" }
  | { readonly kind: "released"; readonly url: string };

export async function serveDeliveryDownload(deps: DownloadDependencies): Promise<DownloadOutcome> {
  const authorization = await deps.authorize();
  if (!authorization) return { kind: "refused" };

  let signed: { url: string } | null;
  try {
    signed = await deps.sign(authorization);
  } catch {
    signed = null;
  }
  if (!signed) return { kind: "unavailable", reason: "unsigned" };

  let recorded: boolean;
  try {
    recorded = await deps.record();
  } catch {
    recorded = false;
  }
  if (!recorded) return { kind: "unavailable", reason: "unrecorded" };

  return { kind: "released", url: signed.url };
}
