import { describe, expect, it } from "vitest";
import type { PhotographMetadata } from "./asset-metadata";
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

/** A metadata record at one stage, for the rule that reads one. */
function metadataRecord(
  generationStatus: PhotographMetadata["generationStatus"],
): PhotographMetadata {
  return {
    assetId: "ast_1",
    organizationId: "org_1",
    generationStatus,
    generationAttempts: 1,
    fieldConfidence: {},
    generatedValues: {},
    technical: { raw: {} },
    editorial: {
      subjects: [],
      objects: [],
      clothing: [],
      brands: [],
      keywords: [],
      sensitivity: "none",
    },
    rights: {
      editorialUseOnly: true,
      commercialUseEligible: "unknown",
      modelReleaseStatus: "unknown",
      propertyReleaseStatus: "unknown",
      sensitiveOrMinor: false,
    },
    manualOverrides: [],
    metadataSource: "ai_generated",
    version: 2,
    updatedAt: "2026-08-19T10:00:00.000Z",
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
    // Derived rather than hard-coded: a rule added to the baseline changes this
    // figure, and a test that had to be re-typed each time would eventually be
    // re-typed wrongly.
    const required = BASELINE_RULES.filter((rule) => rule.severity === "required").length;
    const report = reviewAsset(asset({ caption: undefined }));
    expect(report.requiredCompletionPercent).toBe(Math.round(((required - 1) / required) * 100));
    expect(report.missingRequired.map((rule) => rule.field)).toEqual(["caption"]);
  });

  it("counts an unconfirmed generated caption as a required gap", () => {
    // The rule that connects this module to the metadata record: a machine's
    // words may not reach a desk unread, however complete the asset looks.
    const report = reviewAsset(asset(), undefined, metadataRecord("needs_review"));
    expect(report.isDispatchReady).toBe(false);
    expect(report.missingRequired.map((rule) => rule.field)).toEqual(["metadataConfirmed"]);
  });

  it("passes a photograph with no metadata record, which is a hand-captioned one", () => {
    expect(reviewAsset(asset(), undefined, null).isDispatchReady).toBe(true);
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
