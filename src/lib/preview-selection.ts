import type { AssetVersion } from "./domain";

/**
 * Which preview a reviewer sees, and therefore which one approval freezes.
 *
 * The package-review screen used to take the first `preview` version it
 * found in an array the database had returned in no particular order, and
 * `approve_package()` freezes the earliest preview by `created_at`. Two rules
 * for one fact is a way to freeze a picture nobody looked at. There is one
 * rule now, stated here and repeated in SQL:
 *
 *     the preview derivative with the earliest `created_at`,
 *     ties broken by the smaller version id.
 *
 * `approve_package()` selects `order by pv.created_at, pv.id limit 1` over the
 * same rows, so the identity the review renders, the identity the snapshot
 * records, and the identity the recipient is served are one identity. The
 * database test "review, approval, and recipient agree on the preview" pins
 * the three together against real rows.
 */
export function reviewPreviewVersion(versions: readonly AssetVersion[]): AssetVersion | undefined {
  return versions
    .filter((version) => version.versionKind === "preview")
    .sort((a, b) => {
      const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
      if (byTime !== 0) return byTime;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })[0];
}

/**
 * Where a marked preview is cached.
 *
 * Keyed on the link, the snapshot row, and the digest of the exact object it
 * was rendered from -- not on the asset. Two approvals of the same frame, or a
 * legacy row and a later one, can name different objects, and a marked
 * preview made for one must never be served for the other. The token prefix
 * keeps one recipient's mark from being served to another.
 */
export function markedPreviewKey(input: {
  token: string;
  snapshotId: string;
  sha256: string;
}): string {
  return `watermarked/${input.token.slice(0, 24)}/${input.snapshotId}-${input.sha256.slice(0, 16)}.jpg`;
}
