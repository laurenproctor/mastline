/**
 * Looking up many rows by id without building a URL nobody will accept.
 *
 * PostgREST takes `?id=in.(...)` in the query string, so a lookup keyed on
 * every asset in a workspace grows the URL by about 37 bytes per id. Kong
 * answers 414 at roughly 8KB, which lands at about 215 ids -- a small workspace
 * for a working photographer.
 *
 * Measured on the local stack: 210 ids is 7,839 bytes and answers 200; 220 ids
 * is 8,209 bytes and answers 414.
 *
 * That alone would be a bug you could see. What made it dangerous is that the
 * callers destructured `{ data }` and never looked at `error`, so a 414 became
 * an empty array and every asset quietly reported having no versions: no
 * digest, no object key, no earnings. The workspace export -- which the README
 * promises carries "every asset record with its file hashes and object keys" --
 * silently stopped carrying them, and nothing failed.
 *
 * So this batches, and it throws. A lookup that cannot be completed is an
 * error, not an empty result.
 */

/** Comfortably inside the limit measured above, with room for longer columns. */
export const ID_BATCH_SIZE = 150;

interface Answer<T> {
  readonly data: T[] | null;
  readonly error: { readonly message: string } | null;
}

/**
 * Run `lookup` over `ids` in batches and concatenate the rows.
 *
 * `what` names the thing being fetched, so a failure says which lookup broke
 * rather than only that one did.
 */
export async function selectByIds<T>(
  ids: readonly string[],
  what: string,
  lookup: (batch: string[]) => PromiseLike<Answer<T>>,
): Promise<T[]> {
  if (ids.length === 0) return [];

  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += ID_BATCH_SIZE) {
    batches.push(ids.slice(start, start + ID_BATCH_SIZE));
  }

  const answers = await Promise.all(batches.map((batch) => lookup(batch)));

  const rows: T[] = [];
  for (const answer of answers) {
    if (answer.error) throw new Error(`Could not load ${what}: ${answer.error.message}`);
    rows.push(...(answer.data ?? []));
  }
  return rows;
}
