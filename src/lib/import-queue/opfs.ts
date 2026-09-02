import type { Id } from "@/lib/domain";
import { OPFS_ROOT, opfsPathString } from "./paths";
import type { StagedPath, StagingArea } from "./types";

/**
 * The local copy of a card dump, in the origin private file system.
 *
 * This is what makes a reload survivable. A File handed over by a picker or a
 * drop is a reference to something on the operator's disk that the page loses
 * the moment it navigates -- and re-acquiring it is not possible without asking
 * them to find the file again, which at four in the morning outside a hotel is
 * not a recovery story. Copying the bytes into storage this origin owns is.
 *
 * OPFS rather than a Blob in IndexedDB: it is designed for exactly this, the
 * files can be read back as streams rather than whole, and the directory
 * layout can mirror workspace and batch so cancelling a batch is one recursive
 * remove rather than three hundred deletes.
 *
 * Paths are built from ids only -- see paths.ts. The original filename is
 * recorded in the queue metadata and never used to name anything.
 */
export class OpfsStagingArea implements StagingArea {
  readonly available = true;

  constructor(private readonly getDirectory: () => Promise<FileSystemDirectoryHandle>) {}

  /**
   * The staging area for this browser, or null if it has none.
   *
   * Null rather than a throwing stub: an origin private file system is missing
   * in some private windows and in older browsers, and the queue's job there is
   * to keep working and be honest about what it cannot promise.
   */
  static create(scope: { navigator?: Navigator } = globalThis): OpfsStagingArea | null {
    const storage = scope.navigator?.storage;
    if (!storage || typeof storage.getDirectory !== "function") return null;
    return new OpfsStagingArea(() => storage.getDirectory());
  }

  private async directoryFor(
    path: StagedPath,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    let handle = await this.getDirectory();
    for (const segment of path.directories) {
      try {
        handle = await handle.getDirectoryHandle(segment, { create });
      } catch {
        return null;
      }
    }
    return handle;
  }

  async stage(path: StagedPath, blob: Blob): Promise<void> {
    const directory = await this.directoryFor(path, true);
    if (!directory) throw new Error("Could not open the local staging folder.");

    const file = await directory.getFileHandle(path.filename, { create: true });

    // Safari before 17 exposes the handle but not createWritable outside a
    // worker. Saying so is better than a TypeError the caller has to guess at:
    // the queue turns this into "reload recovery cannot be guaranteed".
    if (typeof file.createWritable !== "function") {
      throw new Error("This browser cannot write to its private file system on this thread.");
    }

    const writable = await file.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }

    // Written is not the same as readable. The copy is the entire promise this
    // module makes, so it is verified before anyone is told it exists.
    const written = await file.getFile();
    if (written.size !== blob.size) {
      await directory.removeEntry(path.filename).catch(() => {});
      throw new Error(
        `The staged copy of ${opfsPathString(path)} is ${written.size} bytes, not ${blob.size}.`,
      );
    }
  }

  async read(path: StagedPath): Promise<Blob | null> {
    const directory = await this.directoryFor(path, false);
    if (!directory) return null;
    try {
      const handle = await directory.getFileHandle(path.filename, { create: false });
      return await handle.getFile();
    } catch {
      return null;
    }
  }

  async exists(path: StagedPath): Promise<boolean> {
    const directory = await this.directoryFor(path, false);
    if (!directory) return false;
    try {
      await directory.getFileHandle(path.filename, { create: false });
      return true;
    } catch {
      return false;
    }
  }

  async remove(path: StagedPath): Promise<void> {
    const directory = await this.directoryFor(path, false);
    if (!directory) return;
    try {
      await directory.removeEntry(path.filename);
    } catch {
      // Already gone. Removing what is not there is the outcome asked for.
    }
  }

  async removeBatch(organizationId: Id, batchId: Id): Promise<void> {
    try {
      const root = await this.getDirectory();
      const imports = await root.getDirectoryHandle(OPFS_ROOT, { create: false });
      const workspace = await imports.getDirectoryHandle(organizationId, { create: false });
      await workspace.removeEntry(batchId, { recursive: true });
    } catch {
      // Nothing staged for that batch.
    }
  }
}
