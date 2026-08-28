"use client";

import { registerPreviewAction } from "@/app/[workspace]/shoots/actions";
import { stagePreview } from "@/components/upload-staging";
import type { Id } from "@/lib/domain";
import { resumableUploadEndpoint } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/client";
import { hashFile } from "@/lib/upload";
import { BrowserStorageCapacity } from "./capacity";
import { BrowserQueueCoordinator } from "./coordination";
import { IndexedDbQueueStore } from "./indexeddb-store";
import { MemoryQueueStore } from "./memory-store";
import { OpfsStagingArea } from "./opfs";
import { ImportQueue } from "./queue";
import { ImportQueueRunner, type QueueSnapshot } from "./runner";
import { ServerActionImportTransport } from "./server-transport";
import { loadTusFactory, terminateTusUpload, TusUploadTransport } from "./tus-transport";

/**
 * The import queue, alive for as long as the tab is.
 *
 * A queue that belongs to a React component dies when that component unmounts,
 * and in an app router every navigation unmounts something. A photographer who
 * starts a card dump and then goes to look at a submission would come back to
 * find the uploads had stopped -- which is precisely the failure this whole
 * feature exists to remove.
 *
 * So the queue, the runner, and the cross-tab coordinator live here, in a
 * module, keyed by workspace. Components subscribe and unsubscribe; the work
 * carries on underneath them. The one thing that does stop it is closing the
 * tab, and the interface says so rather than implying otherwise.
 */

export interface ImportSession {
  readonly workspaceSlug: string;
  readonly organizationId: Id;
  readonly queue: ImportQueue;
  readonly runner: ImportQueueRunner;
  /** True when the queue's records survive a reload. */
  readonly durableMetadata: boolean;
  /** True when the bytes do. */
  readonly durableStaging: boolean;
  /** How uploads are kept from colliding between tabs. */
  readonly coordination: "web-locks" | "lease" | "none";
  readonly limitations: readonly string[];
  subscribe(listener: (snapshot: QueueSnapshot) => void): () => void;
  /** The most recent snapshot, or null before the first one. */
  latest(): QueueSnapshot | null;
  /** Reconcile with the server. Runs once per session, on demand. */
  ready(): Promise<void>;
}

const sessions = new Map<string, ImportSession>();

export function importSession(input: {
  workspaceSlug: string;
  organizationId: Id;
}): ImportSession {
  const key = `${input.workspaceSlug}:${input.organizationId}`;
  const existing = sessions.get(key);
  if (existing) return existing;

  const created = build(input);
  sessions.set(key, created);
  return created;
}

/** For tests and for signing out: drop everything this tab was holding. */
export async function endImportSessions(): Promise<void> {
  for (const session of sessions.values()) await session.runner.stop();
  sessions.clear();
}

function build(input: { workspaceSlug: string; organizationId: Id }): ImportSession {
  const scope = globalThis as typeof globalThis & {
    indexedDB?: IDBFactory;
    navigator?: Navigator;
  };
  const limitations: string[] = [];

  const factory = scope.indexedDB;
  const durableMetadata = Boolean(factory);
  if (!durableMetadata) {
    limitations.push(
      "This browser is not storing the import queue, so a reload will lose anything that has not finished uploading.",
    );
  }

  const staging = OpfsStagingArea.create(scope);
  if (!staging) {
    limitations.push(
      "This browser has no private file storage, so files cannot be kept for recovery. Leave this tab open until the import finishes.",
    );
  }

  const capacity = BrowserStorageCapacity.create(scope);
  const server = new ServerActionImportTransport(input.workspaceSlug);

  const queue = new ImportQueue({
    organizationId: input.organizationId,
    store: factory ? new IndexedDbQueueStore(factory) : new MemoryQueueStore(),
    staging,
    capacity,
    server,
    durableMetadata,
    hash: hashFile,
  });

  const supabase = createClient();

  const transport = new TusUploadTransport({
    endpoint: resumableUploadEndpoint(),
    // The signed-in user's own token, never a service key. Storage policies
    // decide what it may write, exactly as they do for every other request.
    accessToken: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
    // An hour of uploading outlives an access token. Refreshing is the normal
    // course of a long card dump, not an error worth showing anybody.
    refreshAccessToken: async () => {
      const { data } = await supabase.auth.refreshSession();
      return data.session?.access_token ?? null;
    },
    loadUpload: loadTusFactory,
    terminate: terminateTusUpload,
    online: () => scope.navigator?.onLine ?? true,
  });

  const coordinator = new BrowserQueueCoordinator(scope);
  if (coordinator.kind === "none") {
    limitations.push(
      "This browser cannot coordinate between tabs, so keep Mastline open in one tab while importing.",
    );
  }

  const listeners = new Set<(snapshot: QueueSnapshot) => void>();
  let latest: QueueSnapshot | null = null;

  const runner = new ImportQueueRunner({
    queue,
    transport,
    coordinator,
    online: () => scope.navigator?.onLine ?? true,
    watchOnline: (handler) => {
      const online = () => handler(true);
      const offline = () => handler(false);
      addEventListener("online", online);
      addEventListener("offline", offline);
      return () => {
        removeEventListener("online", online);
        removeEventListener("offline", offline);
      };
    },
    // The last moment the bytes are on this machine is the right moment to make
    // the preview: it is what the contact sheet shows and what the caption
    // writer reads, and after cleanup there is nothing left to make it from.
    onFinalized: async ({ item, blob, assetId }) => {
      if (!blob) return;
      const file = new File([blob], item.originalFilename, { type: item.mimeType });
      const preview = await stagePreview(file, item.storagePath);
      if (!preview) return;
      await registerPreviewAction(input.workspaceSlug, {
        assetId,
        sha256: preview.sha256,
        bytes: preview.bytes,
        width: preview.width,
        height: preview.height,
        stagingKey: preview.stagingKey,
      });
    },
    onChange: (snapshot) => {
      latest = snapshot;
      for (const listener of listeners) listener(snapshot);
    },
  });

  runner.start();

  let restored: Promise<void> | null = null;

  return {
    workspaceSlug: input.workspaceSlug,
    organizationId: input.organizationId,
    queue,
    runner,
    durableMetadata,
    durableStaging: Boolean(staging),
    coordination: coordinator.kind,
    limitations,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    latest: () => latest,
    ready() {
      // Once per tab: reconcile what this device remembers with what the server
      // knows, then let the runner pick up whatever is still outstanding.
      restored ??= (async () => {
        await queue.restore();
        const snapshot = await runner.snapshot();
        latest = snapshot;
        for (const listener of listeners) listener(snapshot);
        void runner.pump();
      })();
      return restored;
    },
  };
}
