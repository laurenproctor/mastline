import type { Id } from "@/lib/domain";

/**
 * What the import queue reports about itself.
 *
 * The queue is the one part of Mastline that runs unattended on somebody
 * else's machine, over a connection nobody controls, holding the only copy of
 * work that cannot be reshot. When it goes wrong the photographer is at a kerb
 * and not in a position to describe what happened. So it says what it is doing
 * as it does it.
 *
 * Two rules shape the payloads, and the second is the important one:
 *
 *   1. Operational facts only -- ids, sizes as buckets, attempt numbers,
 *      durations, normalised error codes.
 *   2. Nothing about the photograph. No filename, no bytes, no capture
 *      metadata, no upload URL, no token, no local path. A filename in a
 *      paparazzi workflow is not neutral: "harry-heathrow-arrivals.arw" names a
 *      subject and a location, and an analytics vendor is the wrong place for
 *      either. The queue's own records hold the filename; telemetry does not.
 */

export const IMPORT_EVENTS = [
  "import_batch_created",
  "import_file_staged",
  "upload_started",
  "upload_paused",
  "upload_resumed",
  "upload_retry_scheduled",
  "upload_failed",
  "upload_completed",
  "finalization_failed",
  "import_file_completed",
  "import_batch_completed",
  "import_recovered_after_reload",
] as const;

export type ImportEventName = (typeof IMPORT_EVENTS)[number];

/**
 * The complete vocabulary a payload may use.
 *
 * Deliberately a closed shape rather than a record of unknowns: an open bag is
 * how a filename ends up in an analytics dashboard six months from now,
 * added by somebody debugging in a hurry.
 */
export interface ImportEventPayload {
  readonly workspaceId?: Id;
  readonly batchId?: Id;
  /** The server's import file id. Never the client's local file handle. */
  readonly importFileId?: Id;
  /** A bucket, not a size: an exact byte count is a fingerprint of a file. */
  readonly sizeBucket?: SizeBucket;
  readonly attempt?: number;
  readonly durationMs?: number;
  /** One of the normalised codes from failure.ts. Never a server message. */
  readonly errorCode?: string;
  /** Whether this upload continued an existing session or started a new one. */
  readonly resumed?: boolean;
  /** "online" | "offline", and the effective connection type when offered. */
  readonly connection?: string;
  readonly fileCount?: number;
  readonly completedCount?: number;
  readonly failedCount?: number;
}

export type SizeBucket = "<1MB" | "1-8MB" | "8-32MB" | "32-128MB" | "128MB+";

/**
 * Sizes as ranges.
 *
 * A card dump's exact byte counts, in order, identify the shoot as reliably as
 * the filenames would. Buckets answer every operational question worth asking
 * -- do large files fail more often, does the median duration track size --
 * without carrying that.
 */
export function sizeBucket(bytes: number): SizeBucket {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return "<1MB";
  if (mb < 8) return "1-8MB";
  if (mb < 32) return "8-32MB";
  if (mb < 128) return "32-128MB";
  return "128MB+";
}

/** Where events go. Swappable so tests observe rather than transmit. */
export interface TelemetrySink {
  emit(name: ImportEventName, payload: ImportEventPayload): void;
}

/** Drops everything. The default, so telemetry is never load-bearing. */
export const silentSink: TelemetrySink = { emit: () => {} };

const ALLOWED_KEYS: readonly (keyof ImportEventPayload)[] = [
  "workspaceId",
  "batchId",
  "importFileId",
  "sizeBucket",
  "attempt",
  "durationMs",
  "errorCode",
  "resumed",
  "connection",
  "fileCount",
  "completedCount",
  "failedCount",
];

/**
 * Strip anything not on the list.
 *
 * A second gate behind the type, because the type is gone at runtime and the
 * failure mode -- a filename reaching a vendor -- is not one to leave to
 * review. Anything unrecognised is dropped rather than passed through.
 */
export function scrub(payload: ImportEventPayload): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const key of ALLOWED_KEYS) {
    const value = payload[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return safe;
}

/** How the browser describes the connection, when it will. */
export function connectionState(scope: { navigator?: Navigator } = globalThis): string | undefined {
  const nav = scope.navigator as
    (Navigator & { connection?: { effectiveType?: string } }) | undefined;
  if (!nav) return undefined;
  if (nav.onLine === false) return "offline";
  const effective = nav.connection?.effectiveType;
  return effective ? `online:${effective}` : "online";
}

export interface ImportTelemetry {
  emit(name: ImportEventName, payload?: ImportEventPayload): void;
  /** Starts a timer; the returned function reports the elapsed milliseconds. */
  timer(): () => number;
}

export function createTelemetry(
  sink: TelemetrySink = silentSink,
  now: () => number = () => Date.now(),
): ImportTelemetry {
  return {
    emit(name, payload = {}) {
      try {
        sink.emit(name, payload);
      } catch {
        // Telemetry never fails an import. This is the whole reason it is
        // wrapped: a vendor script that throws must not lose a photograph.
      }
    },
    timer() {
      const started = now();
      return () => Math.max(0, Math.round(now() - started));
    },
  };
}

/**
 * The sink that ships events, using the collector this application already has.
 *
 * Vercel Analytics, and nothing new. It is already loaded on every page, it
 * writes nothing to the visitor's device -- which is why layout.tsx keeps it
 * outside the Consent Mode gate -- and it takes custom events with flat
 * properties, which is exactly the shape above.
 *
 * Server-side finalization failures are not routed here. They are logged as
 * structured JSON on the server, the same way the caption writer's failures
 * are, and are read from the platform's logs.
 */
export function vercelSink(
  track: (name: string, payload: Record<string, string | number | boolean>) => void,
): TelemetrySink {
  return {
    emit(name, payload) {
      track(name, scrub(payload));
    },
  };
}
