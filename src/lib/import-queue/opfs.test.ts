import { describe, expect, it } from "vitest";
import { OpfsStagingArea } from "./opfs";
import { opfsPathFor, opfsPathString } from "./paths";

/**
 * The staging area, against a directory tree in memory.
 *
 * The origin private file system is injected as a function returning a root
 * handle, so this exercises the real class -- every getDirectoryHandle, the
 * writable stream, and the read-back check -- without a browser.
 */

const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
const BATCH = "b1111111-0000-4000-8000-000000000001";

interface FakeOptions {
  /** Reproduces Safari before 17: a handle with no createWritable. */
  readonly noWritable?: boolean;
  /** Reproduces a write that stops partway through. */
  readonly truncateTo?: number;
}

class FakeDirectory {
  readonly directories = new Map<string, FakeDirectory>();
  readonly files = new Map<string, Blob>();

  constructor(private readonly options: FakeOptions = {}) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options?.create) throw new Error(`NotFoundError: ${name}`);
    const created = new FakeDirectory(this.options);
    this.directories.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw new Error(`NotFoundError: ${name}`);
      this.files.set(name, new Blob([]));
    }

    const files = this.files;
    const truncateTo = this.options.truncateTo;

    const handle: Record<string, unknown> = {
      getFile: async () => files.get(name)!,
    };

    if (!this.options.noWritable) {
      handle.createWritable = async () => ({
        write: async (blob: Blob) => {
          files.set(name, truncateTo === undefined ? blob : blob.slice(0, truncateTo));
        },
        close: async () => {},
      });
    }

    return handle;
  }

  async removeEntry(name: string, options?: { recursive?: boolean }) {
    if (this.files.delete(name)) return;
    if (options?.recursive) {
      if (this.directories.delete(name)) return;
    }
    throw new Error(`NotFoundError: ${name}`);
  }

  /** Every file in the tree, as slash-joined paths. For assertions. */
  paths(prefix = ""): string[] {
    const here = [...this.files.keys()].map((name) => `${prefix}${name}`);
    const below = [...this.directories.entries()].flatMap(([name, directory]) =>
      directory.paths(`${prefix}${name}/`),
    );
    return [...here, ...below];
  }
}

/**
 * jsdom's Blob has neither text() nor arrayBuffer(), so the bytes are read the
 * long way round. What is being asserted is that the staged copy is the same
 * bytes, which is the whole promise of this module.
 */
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function areaFor(options: FakeOptions = {}) {
  const root = new FakeDirectory(options);
  const area = new OpfsStagingArea(async () => root as unknown as FileSystemDirectoryHandle);
  return { area, root };
}

describe("staging bytes locally", () => {
  it("writes a file under workspace, batch, and client id -- not its name", async () => {
    const { area, root } = areaFor();
    const path = opfsPathFor(ORG, BATCH, "abc123");

    await area.stage(path, new Blob(["one frame"]));

    expect(root.paths()).toEqual([`mastline-imports/${ORG}/${BATCH}/abc123`]);
    // The camera's filename appears nowhere in the tree.
    expect(opfsPathString(path)).not.toContain("MH_0819");
  });

  it("reads back exactly what was staged", async () => {
    const { area } = areaFor();
    const path = opfsPathFor(ORG, BATCH, "abc123");
    await area.stage(path, new Blob(["forty two bytes of raw"]));

    const blob = await area.read(path);
    expect(blob!.size).toBe(22);
    expect(await readText(blob!)).toBe("forty two bytes of raw");
  });

  it("knows whether a staged copy is there", async () => {
    const { area } = areaFor();
    const path = opfsPathFor(ORG, BATCH, "abc123");

    expect(await area.exists(path)).toBe(false);
    await area.stage(path, new Blob(["x"]));
    expect(await area.exists(path)).toBe(true);

    await area.remove(path);
    expect(await area.exists(path)).toBe(false);
    expect(await area.read(path)).toBeNull();
  });

  it("removing something that is already gone is not an error", async () => {
    const { area } = areaFor();
    await expect(area.remove(opfsPathFor(ORG, BATCH, "never"))).resolves.toBeUndefined();
  });

  it("clears a whole abandoned batch", async () => {
    const { area, root } = areaFor();
    await area.stage(opfsPathFor(ORG, BATCH, "one"), new Blob(["1"]));
    await area.stage(opfsPathFor(ORG, BATCH, "two"), new Blob(["2"]));
    const other = "b2222222-0000-4000-8000-000000000002";
    await area.stage(opfsPathFor(ORG, other, "three"), new Blob(["3"]));

    await area.removeBatch(ORG, BATCH);

    expect(root.paths()).toEqual([`mastline-imports/${ORG}/${other}/three`]);
  });

  it("refuses to call a truncated copy staged", async () => {
    // A half-written file that reported success would be the one lie this
    // module cannot afford: the queue would show it as recoverable.
    const { area, root } = areaFor({ truncateTo: 2 });
    const path = opfsPathFor(ORG, BATCH, "abc123");

    await expect(area.stage(path, new Blob(["much longer than two"]))).rejects.toThrow(
      /is 2 bytes, not/,
    );
    expect(root.paths()).toEqual([]);
  });

  it("says so when the browser will not write on this thread", async () => {
    const { area } = areaFor({ noWritable: true });
    await expect(area.stage(opfsPathFor(ORG, BATCH, "abc123"), new Blob(["x"]))).rejects.toThrow(
      /private file system/,
    );
  });

  it("reports itself unavailable when the browser has no OPFS", () => {
    expect(OpfsStagingArea.create({ navigator: {} as Navigator })).toBeNull();
    expect(OpfsStagingArea.create({})).toBeNull();
  });
});
