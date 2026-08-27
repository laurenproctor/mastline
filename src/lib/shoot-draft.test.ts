import { describe, expect, it } from "vitest";
import { type DraftPhotograph, reviewDraft, stagedPhotographs } from "./shoot-draft";

/**
 * The line between "cannot be saved" and "will not pass dispatch".
 *
 * These tests exist mostly to hold that line. Creating a shoot is private,
 * reversible work, so the list of things that can stop it is deliberately two
 * items long; everything a picture desk cares about is a warning here and a
 * hard gate later. A change that quietly promotes a warning to a blocker turns
 * a notebook into a form to be completed, and should fail here first.
 */

const photograph = (over: Partial<DraftPhotograph> = {}): DraftPhotograph => ({
  id: over.id ?? "p1",
  filename: over.filename ?? "MH_0001.jpg",
  bytes: over.bytes ?? 1_000_000,
  state: over.state ?? "staged",
  capturedAt: "capturedAt" in over ? over.capturedAt : "2026-08-27T10:00:00.000Z",
  caption: over.caption,
  headline: over.headline,
  subjects: over.subjects,
  keywords: over.keywords,
  locationName: over.locationName,
});

const draft = (over: Partial<Parameters<typeof reviewDraft>[0]> = {}) =>
  reviewDraft({
    title: "Hotel Chelsea departure",
    sensitiveContent: false,
    photographs: [],
    ...over,
  });

describe("what stops a draft being created", () => {
  it("needs a subject or event and nothing else", () => {
    expect(draft({ title: "" }).canCreate).toBe(false);
    expect(draft({ title: "" }).blocking.map((note) => note.id)).toEqual(["title"]);
    expect(draft().canCreate).toBe(true);
  });

  it("treats whitespace as no title", () => {
    expect(draft({ title: "   " }).canCreate).toBe(false);
  });

  it("creates with no photographs at all", () => {
    const review = draft();
    expect(review.canCreate).toBe(true);
    expect(review.readyCount).toBe(0);
    expect(review.warnings).toEqual([]);
  });

  it("waits for a photograph that is still moving", () => {
    for (const state of ["queued", "hashing", "uploading"] as const) {
      const review = draft({ photographs: [photograph({ state })] });
      expect(review.canCreate, state).toBe(false);
      expect(review.blocking.map((note) => note.id)).toContain("uploads-in-flight");
      expect(review.pendingCount).toBe(1);
    }
  });

  it("does not wait for one that failed, but says it will not be saved", () => {
    const review = draft({ photographs: [photograph({ state: "failed" })] });
    expect(review.canCreate).toBe(true);
    expect(review.readyCount).toBe(0);
    expect(review.failedCount).toBe(1);
    expect(review.warnings.map((note) => note.id)).toContain("uploads-failed");
  });
});

describe("what is only a warning", () => {
  it("never blocks on missing caption, credit, or copyright", () => {
    const review = draft({ photographs: [photograph({ caption: undefined })] });

    expect(review.canCreate).toBe(true);
    expect(review.blocking).toEqual([]);
    expect(review.warnings.map((note) => note.id)).toEqual(
      expect.arrayContaining(["missing-caption", "missing-credit", "missing-copyright"]),
    );
  });

  it("stops naming metadata once it is there", () => {
    const review = draft({
      creditLine: "Marcus Hale / Mastline",
      copyrightNotice: "© 2026 Marcus Hale",
      photographs: [photograph({ caption: "A complete caption." })],
    });
    expect(review.warnings).toEqual([]);
  });

  it("counts only the frames that are missing one", () => {
    const review = draft({
      creditLine: "Marcus Hale",
      copyrightNotice: "© 2026",
      photographs: [
        photograph({ id: "a", caption: "Described." }),
        photograph({ id: "b" }),
        photograph({ id: "c" }),
      ],
    });
    const caption = review.warnings.find((note) => note.id === "missing-caption");
    expect(caption?.text).toContain("2 of 3");
  });

  it("says nothing about metadata when there are no photographs to carry it", () => {
    const review = draft({ photographs: [] });
    expect(review.warnings.map((note) => note.id)).not.toContain("missing-credit");
  });

  it("names a capture time the file did not carry", () => {
    const review = draft({
      creditLine: "Marcus Hale",
      copyrightNotice: "© 2026",
      photographs: [photograph({ caption: "Described.", capturedAt: undefined })],
    });
    expect(review.warnings.map((note) => note.id)).toContain("missing-capture-time");
  });
});

describe("rights facts are surfaced, not enforced", () => {
  it("reports an embargo, an exclusivity, and sensitive content without blocking", () => {
    const review = draft({
      embargoUntil: "2026-09-01T00:00:00.000Z",
      exclusivity: "Agency exclusive",
      sensitiveContent: true,
    });

    expect(review.canCreate).toBe(true);
    expect(review.warnings.map((note) => note.id)).toEqual(
      expect.arrayContaining(["embargo", "exclusivity", "sensitive"]),
    );
  });

  it("points each note at the section that fixes it", () => {
    const review = draft({ title: "", photographs: [photograph({ state: "uploading" })] });
    expect(review.blocking.map((note) => note.section)).toEqual(["details", "photographs"]);
  });
});

describe("what a submission would carry", () => {
  it("is the staged photographs only", () => {
    const rows = [
      photograph({ id: "a", state: "staged" }),
      photograph({ id: "b", state: "uploading" }),
      photograph({ id: "c", state: "failed" }),
      photograph({ id: "d", state: "staged" }),
    ];
    expect(stagedPhotographs(rows).map((row) => row.id)).toEqual(["a", "d"]);
  });

  it("totals the bytes of those alone", () => {
    const review = draft({
      photographs: [
        photograph({ id: "a", bytes: 1_000 }),
        photograph({ id: "b", bytes: 9_000, state: "failed" }),
      ],
    });
    expect(review.totalBytes).toBe(1_000);
  });
});
