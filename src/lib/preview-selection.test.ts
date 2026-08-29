import { describe, expect, it } from "vitest";
import type { AssetVersion } from "./domain";
import { markedPreviewKey, reviewPreviewVersion } from "./preview-selection";

function version(overrides: Partial<AssetVersion> & { id: string }): AssetVersion {
  return {
    assetId: "asset",
    versionKind: "preview",
    storageBucket: "derivatives",
    objectKey: `org/shoot/${overrides.id}.jpg`,
    sha256: "a".repeat(64),
    bytes: 100,
    mimeType: "image/jpeg",
    createdAt: "2026-08-28T10:00:00Z",
    ...overrides,
  };
}

describe("reviewPreviewVersion", () => {
  it("picks the earliest preview whatever order the rows arrived in", () => {
    const later = version({ id: "b", createdAt: "2026-08-28T12:00:00Z" });
    const earliest = version({ id: "c", createdAt: "2026-08-28T09:00:00Z" });
    const middle = version({ id: "a", createdAt: "2026-08-28T10:00:00Z" });

    expect(reviewPreviewVersion([later, middle, earliest])?.id).toBe("c");
    expect(reviewPreviewVersion([earliest, later, middle])?.id).toBe("c");
    expect(reviewPreviewVersion([middle, earliest, later])?.id).toBe("c");
  });

  it("breaks a tie on created_at by the smaller id, as the SQL does", () => {
    const x = version({ id: "ffffffff-0000-0000-0000-000000000000" });
    const y = version({ id: "00000000-0000-0000-0000-00000000ffff" });
    expect(reviewPreviewVersion([x, y])?.id).toBe(y.id);
    expect(reviewPreviewVersion([y, x])?.id).toBe(y.id);
  });

  it("never returns anything but a preview", () => {
    const original = version({
      id: "orig",
      versionKind: "original",
      storageBucket: "originals",
      createdAt: "2026-01-01T00:00:00Z",
    });
    const delivery = version({ id: "del", versionKind: "delivery" });
    expect(reviewPreviewVersion([original, delivery])).toBeUndefined();
    const preview = version({ id: "prev", createdAt: "2026-12-31T00:00:00Z" });
    expect(reviewPreviewVersion([original, delivery, preview])?.id).toBe("prev");
  });

  it("does not mutate the list it was given", () => {
    const versions = [
      version({ id: "b", createdAt: "2026-08-28T12:00:00Z" }),
      version({ id: "a", createdAt: "2026-08-28T09:00:00Z" }),
    ];
    reviewPreviewVersion(versions);
    expect(versions.map((v) => v.id)).toEqual(["b", "a"]);
  });
});

describe("markedPreviewKey", () => {
  const token = "T".repeat(43);

  it("separates two snapshots of the same frame, and two objects of one snapshot", () => {
    const one = markedPreviewKey({ token, snapshotId: "snap-1", sha256: "a".repeat(64) });
    const two = markedPreviewKey({ token, snapshotId: "snap-2", sha256: "a".repeat(64) });
    const other = markedPreviewKey({ token, snapshotId: "snap-1", sha256: "b".repeat(64) });
    expect(new Set([one, two, other]).size).toBe(3);
  });

  it("separates two recipients of the same snapshot", () => {
    const desk = markedPreviewKey({
      token: "A".repeat(43),
      snapshotId: "s",
      sha256: "c".repeat(64),
    });
    const other = markedPreviewKey({
      token: "B".repeat(43),
      snapshotId: "s",
      sha256: "c".repeat(64),
    });
    expect(desk).not.toBe(other);
  });

  it("stays inside the watermarked prefix and never carries the whole token", () => {
    const key = markedPreviewKey({ token, snapshotId: "s", sha256: "d".repeat(64) });
    expect(key.startsWith("watermarked/")).toBe(true);
    expect(key).not.toContain(token);
    expect(key.endsWith(".jpg")).toBe(true);
  });
});
