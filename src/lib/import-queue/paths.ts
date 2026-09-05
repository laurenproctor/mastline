import type { Id } from "@/lib/domain";

/**
 * Where a queued file lives, on this machine and in the workspace's bucket.
 *
 * Both paths are derived from the same three facts -- workspace, batch, and the
 * client's id for the file -- and from nothing else. In particular neither is
 * derived from the original filename, which is the operator's record of what
 * they shot and is not a safe path component: two cards produce IMG_0001.CR3
 * twice before lunch, and a filename can carry a slash, a NUL, or four hundred
 * characters of Unicode a filesystem will not take.
 *
 * The name is preserved separately, on the import file row, where it can say
 * whatever the camera said.
 *
 * This module is imported by both the browser queue and the server data layer
 * on purpose. A path built two ways is a path that will be built two different
 * ways the first time one of them is edited.
 */

/** The prefix the storage policies key on. Shared with src/lib/data/imports.ts. */
export const STAGING_PREFIX = "_staging";

/** Where the local copy of a card dump lives inside the origin private file system. */
export const OPFS_ROOT = "mastline-imports";

const CLIENT_FILE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isClientFileId(value: string): boolean {
  return CLIENT_FILE_ID.test(value);
}

/** A fresh identifier for one selected file. Stable for the life of the item. */
export function newClientFileId(randomUuid: () => string = () => crypto.randomUUID()): string {
  return randomUuid().replace(/-/g, "");
}

/**
 * The staging key for one queued file.
 *
 * `_staging` as the second segment is load-bearing rather than descriptive:
 * private.is_staging_object() reads exactly that segment, and it is what lets
 * this object be renamed when it is promoted while a promoted original stays
 * immutable. The first segment is the organization id, which every storage
 * policy keys on.
 *
 * Deterministic, so a retry addresses the object it already uploaded instead of
 * leaving an orphan beside it. Collision-safe, because (batch, client file id)
 * is unique in the database and both are in the key.
 */
export function importStoragePath(organizationId: Id, batchId: Id, clientFileId: string): string {
  if (!UUID.test(organizationId)) throw new Error("An import path needs a workspace id.");
  if (!UUID.test(batchId)) throw new Error("An import path needs an import batch id.");
  if (!isClientFileId(clientFileId)) {
    throw new Error("A client file id may only contain letters, digits, dash, and underscore.");
  }
  return `${organizationId}/${STAGING_PREFIX}/${batchId}/${clientFileId}`;
}

/**
 * The local staged copy's path, as directory segments plus a filename.
 *
 * Returned in parts because that is how the origin private file system is
 * navigated -- one getDirectoryHandle per segment -- and joining them into a
 * string only to split it again is how a path separator ends up inside a name.
 */
export interface StagedFilePath {
  readonly directories: readonly string[];
  readonly filename: string;
}

export function opfsPathFor(organizationId: Id, batchId: Id, clientFileId: string): StagedFilePath {
  if (!isClientFileId(clientFileId)) {
    throw new Error("A client file id may only contain letters, digits, dash, and underscore.");
  }
  return {
    directories: [OPFS_ROOT, organizationId, batchId],
    filename: clientFileId,
  };
}

/** The same path as one string. For logging and for test assertions only. */
export function opfsPathString(path: StagedFilePath): string {
  return [...path.directories, path.filename].join("/");
}
