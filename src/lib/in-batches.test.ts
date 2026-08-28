import { describe, expect, it, vi } from "vitest";
import { ID_BATCH_SIZE, selectByIds } from "./in-batches";

describe("looking up rows by id", () => {
  it("asks for nothing when there is nothing to ask for", async () => {
    const lookup = vi.fn();
    expect(await selectByIds([], "things", lookup)).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("makes one request while the list is small", async () => {
    const lookup = vi.fn(async (batch: string[]) => ({
      data: batch.map((id) => ({ id })),
      error: null,
    }));
    const rows = await selectByIds(["a", "b", "c"], "things", lookup);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(3);
  });

  /*
   * The measurement this exists for: PostgREST puts the id list in the URL and
   * Kong answers 414 at roughly 8KB, which is about 215 uuids. 300 in one
   * request would be refused.
   */
  it("splits a list past the limit, and loses nothing across the seams", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `id-${i}`);
    const seen: string[][] = [];
    const lookup = vi.fn(async (batch: string[]) => {
      seen.push(batch);
      return { data: batch.map((id) => ({ id })), error: null };
    });

    const rows = await selectByIds(ids, "things", lookup);

    expect(lookup).toHaveBeenCalledTimes(Math.ceil(300 / ID_BATCH_SIZE));
    expect(seen.every((batch) => batch.length <= ID_BATCH_SIZE)).toBe(true);
    expect(rows.map((row) => row.id)).toEqual(ids);
  });

  /*
   * The half that actually caused the damage. These lookups used to destructure
   * `{ data }` and ignore `error`, so a refused request became an empty array
   * and the export silently shipped without a single file digest.
   */
  it("throws rather than reporting a failed lookup as no rows", async () => {
    const lookup = vi.fn(async () => ({ data: null, error: { message: "URI too large" } }));
    await expect(selectByIds(["a"], "asset versions", lookup)).rejects.toThrow(
      /Could not load asset versions: URI too large/,
    );
  });

  it("still throws when only one batch of several fails", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `id-${i}`);
    let call = 0;
    const lookup = vi.fn(async (batch: string[]) => {
      call += 1;
      return call === 2
        ? { data: null, error: { message: "boom" } }
        : { data: batch.map((id) => ({ id })), error: null };
    });
    await expect(selectByIds(ids, "things", lookup)).rejects.toThrow(/boom/);
  });
});
