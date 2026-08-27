import { describe, expect, it } from "vitest";
import type { Asset } from "./domain";
import { money } from "./money";
import { BASELINE_RULES, reviewAsset, reviewSelection } from "./metadata-rules";

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "ast_1",
    organizationId: "org_1",
    status: "active",
    canonicalFilename: "MH_0001",
    capturedAt: "2026-08-19T18:47:18.000Z",
    headline: "A headline",
    caption: "A caption describing what is happening.",
    subjects: ["Avery Hart"],
    locationName: "New York, NY",
    keywords: [],
    creatorName: "Marcus Hale",
    copyrightNotice: "© 2026 Marcus Hale",
    creditLine: "Marcus Hale / Mastline",
    usageRestrictions: "Editorial use only.",
    selected: true,
    versions: [],
    captionHistory: [],
    lifetimeEarnings: money(0),
    ...overrides,
  };
}

describe("required metadata", () => {
  it("passes a fully described asset", () => {
    const report = reviewAsset(asset());
    expect(report.isDispatchReady).toBe(true);
    expect(report.missingRequired).toHaveLength(0);
    expect(report.requiredCompletionPercent).toBe(100);
  });

  it.each(["caption", "creditLine", "copyrightNotice", "capturedAt"] as const)(
    "blocks dispatch when %s is missing",
    (field) => {
      const report = reviewAsset(asset({ [field]: undefined }));
      expect(report.isDispatchReady).toBe(false);
      expect(report.missingRequired.map((rule) => rule.field)).toContain(field);
    },
  );

  it("treats whitespace as missing", () => {
    expect(reviewAsset(asset({ caption: "   " })).isDispatchReady).toBe(false);
  });

  it("does not block dispatch on a recommendation", () => {
    const report = reviewAsset(asset({ subjects: [], headline: undefined }));
    expect(report.isDispatchReady).toBe(true);
    expect(report.missingRecommended.map((rule) => rule.field)).toEqual(
      expect.arrayContaining(["headline", "subjects"]),
    );
  });

  it("does not require a named subject, so nobody is guessed into the record", () => {
    const subjectRule = BASELINE_RULES.find((rule) => rule.field === "subjects");
    expect(subjectRule?.severity).toBe("recommended");
  });

  it("scores required completion without counting recommendations", () => {
    // 4 required rules; one missing.
    const report = reviewAsset(asset({ caption: undefined }));
    expect(report.requiredCompletionPercent).toBe(75);
  });
});

describe("selection roll-up", () => {
  it("counts ready and blocked assets", () => {
    const report = reviewSelection([
      asset({ id: "a" }),
      asset({ id: "b", caption: undefined }),
      asset({ id: "c", creditLine: undefined }),
    ]);
    expect(report.total).toBe(3);
    expect(report.ready).toBe(1);
    expect(report.blocked).toBe(2);
    expect(report.completionPercent).toBe(33);
  });

  it("reports an empty selection as zero rather than complete", () => {
    const report = reviewSelection([]);
    expect(report.total).toBe(0);
    expect(report.completionPercent).toBe(0);
  });

  it("reports a fully described selection as complete", () => {
    const report = reviewSelection([asset({ id: "a" }), asset({ id: "b" })]);
    expect(report.completionPercent).toBe(100);
    expect(report.blocked).toBe(0);
  });

  it("keeps a per-asset report for every asset", () => {
    const report = reviewSelection([asset({ id: "a" }), asset({ id: "b" })]);
    expect(report.reports.map((entry) => entry.assetId)).toEqual(["a", "b"]);
  });
});

/**
 * The rule that makes drafting a caption at import safe.
 *
 * Every case here is about the same failure: a sentence the caption writer
 * produced, sitting in a field, looking exactly like one the photographer
 * typed. If these pass, that sentence cannot reach a buyer without somebody
 * having read it.
 */
describe("a caption drafted at import", () => {
  const drafted = (overrides: Partial<Asset> = {}) =>
    asset({
      caption: "A man in a dark coat leaves a hotel side entrance at night.",
      captionOrigin: "model",
      captionAwaitsReview: true,
      captionBasis: "Read from the image.",
      captionConfidence: 0.7,
      ...overrides,
    });

  it("does not make a frame dispatch ready on its own", () => {
    const report = reviewAsset(drafted());
    expect(report.isDispatchReady).toBe(false);
    expect(report.missingRequired.map((rule) => rule.field)).toContain("caption");
  });

  it("counts once a person has read it and saved", () => {
    const report = reviewAsset(
      drafted({
        captionOrigin: "human",
        captionAwaitsReview: false,
        captionReviewedAt: "2026-08-27T09:00:00.000Z",
      }),
    );
    expect(report.isDispatchReady).toBe(true);
  });

  it("counts when the reviewer kept the words but signed for them", () => {
    // Accepting a draft unchanged is still authoring it. What clears the gate
    // is the review, not the text having been edited.
    const report = reviewAsset(drafted({ captionAwaitsReview: false }));
    expect(report.isDispatchReady).toBe(true);
  });

  it("leaves captions written before any of this existed alone", () => {
    // No provenance at all: every caption in the archive on the day this
    // shipped. Treating those as unread would block approved dispatches.
    const { captionOrigin, captionAwaitsReview, ...rest } = drafted();
    void captionOrigin;
    void captionAwaitsReview;
    expect(reviewAsset(rest as Asset).isDispatchReady).toBe(true);
  });

  it("blocks a whole selection on one unread draft", () => {
    const report = reviewSelection([asset({ id: "a" }), drafted({ id: "b" })]);
    expect(report.ready).toBe(1);
    expect(report.blocked).toBe(1);
  });
});
