"use client";

import type { Id } from "@/lib/domain";
import { hashFile } from "@/lib/upload";
import { BrowserStorageCapacity } from "./capacity";
import { IndexedDbQueueStore } from "./indexeddb-store";
import { MemoryQueueStore } from "./memory-store";
import { OpfsStagingArea } from "./opfs";
import { ImportQueue } from "./queue";
import { ServerActionImportTransport } from "./server-transport";
import type { QueueItemView } from "./types";

/**
 * Assemble a queue for this browser, and say plainly what it cannot do.
 *
 * Every capability the queue depends on is optional in some browser somebody
 * actually uses: a private window may refuse IndexedDB, an older Safari has an
 * origin private file system it will not let the main thread write to, and a
 * quota estimate is not always given. None of those stop an import -- they stop
 * a *recoverable* import, which is a different claim and has to be made
 * differently.
 *
 * So the missing pieces are collected and returned rather than logged. What the
 * interface does with them is show them: a photographer deciding whether to
 * close a laptop deserves to know which of the two hundred frames on screen
 * would survive it.
 */
export interface CreatedImportQueue {
  readonly queue: ImportQueue;
  /** True when the queue's records survive a reload. */
  readonly durableMetadata: boolean;
  /** True when the bytes do. */
  readonly durableStaging: boolean;
  /** Plain sentences about what this browser will not do. */
  readonly limitations: readonly string[];
}

export function createImportQueue(input: {
  workspaceSlug: string;
  organizationId: Id;
  onChange?: (items: readonly QueueItemView[]) => void;
  scope?: { indexedDB?: IDBFactory; navigator?: Navigator };
}): CreatedImportQueue {
  const scope = input.scope ?? globalThis;
  const limitations: string[] = [];

  const factory = scope.indexedDB;
  const durableMetadata = Boolean(factory);
  if (!durableMetadata) {
    limitations.push(
      "This browser is not letting Mastline store the import queue, so a reload will lose anything that has not finished uploading.",
    );
  }

  const staging = OpfsStagingArea.create(scope);
  if (!staging) {
    limitations.push(
      "This browser has no private file storage, so files cannot be kept for recovery. Leave this tab open until the import finishes.",
    );
  }

  const capacity = BrowserStorageCapacity.create(scope);
  if (!capacity) {
    limitations.push(
      "This browser will not report free storage, so space cannot be checked first.",
    );
  }

  return {
    queue: new ImportQueue({
      organizationId: input.organizationId,
      store: factory ? new IndexedDbQueueStore(factory) : new MemoryQueueStore(),
      staging,
      capacity,
      server: new ServerActionImportTransport(input.workspaceSlug),
      durableMetadata,
      hash: hashFile,
      onChange: input.onChange,
    }),
    durableMetadata,
    durableStaging: Boolean(staging),
    limitations,
  };
}
