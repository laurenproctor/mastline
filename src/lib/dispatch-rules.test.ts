import { describe, expect, it } from "vitest";
import type { PhotographMetadata } from "./asset-metadata";
import type { Asset, Buyer, DispatchPackage } from "./domain";
import { reviewDispatch } from "./dispatch-rules";
import { money } from "./money";

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "ast_1",
    organizationId: "org_1",
    status: "active",
    canonicalFilename: "MH_0001",
    capturedAt: "2026-08-19T18:47:18.000Z",
    headline: "Headline",
    caption: "A caption.",
    subjects: ["Avery Hart"],
    locationName: "New York, NY",
    keywords: ["a"],
    creatorName: "Marcus Hale",
    copyrightNotice: "© 2026 Marcus Hale",
    creditLine: "Marcus Hale / Mastline",
    usageRestrictions: "Editorial use only.",
    selected: true,
    versions: [
      {
        id: "ver_1",
        assetId: "ast_1",
        versionKind: "delivery",
        storageBucket: "derivatives",
        objectKey: "k",
        sha256: "a".repeat(64),
        bytes: 1,
        mimeType: "image/jpeg",
        createdAt: "2026-08-19T00:00:00.000Z",
      },
    ],
    captionHistory: [],
    lifetimeEarnings: money(0),
    ...overrides,
  };
}

const BUYER: Buyer = {
  id: "buy_1",
  organizationId: "org_1",
  name: "Backgrid",
  buyerType: "agency",
};

function pkg(overrides: Partial<DispatchPackage> = {}): DispatchPackage {
  return {
    id: "pkg_1",
    organizationId: "org_1",
    shootId: "sht_1",
    buyerId: "buy_1",
    name: "Package 01",
    status: "needs_review",
    deliveryMethod: "SFTP",
    proposedTerms: "Non-exclusive agency distribution.",
    restrictions: "Editorial use only.",
    assets: [{ assetId: "ast_1", assetVersionId: "ver_1", position: 0 }],
    ...overrides,
  };
}

describe("a complete package", () => {
  it("is approvable", () => {
    const review = reviewDispatch({ pkg: pkg(), assets: [asset()], buyer: BUYER });
    expect(review.isApprovable).toBe(true);
    expect(review.blocking).toHaveLength(0);
  });
});

describe("blocking failures", () => {
  it("blocks an empty package", () => {
    const review = reviewDispatch({ pkg: pkg({ assets: [] }), assets: [], buyer: BUYER });
    expect(review.isApprovable).toBe(false);
    expect(review.blocking.map((c) => c.id)).toContain("selection");
  });

  it("blocks when required metadata is missing", () => {
    const review = reviewDispatch({
      pkg: pkg(),
      assets: [asset({ caption: undefined })],
      buyer: BUYER,
    });
    expect(review.isApprovable).toBe(false);
    const check = review.blocking.find((c) => c.id === "metadata");
    expect(check?.remedy).toMatch(/caption/i);
  });

  it("names every missing field across the package", () => {
    const review = reviewDispatch({
      pkg: {
        ...pkg(),
        assets: [
          { assetId: "ast_1", assetVersionId: "ver_1", position: 0 },
          { assetId: "ast_2", assetVersionId: "ver_2", position: 1 },
        ],
      },
      assets: [
        asset({ caption: undefined }),
        asset({
          id: "ast_2",
          creditLine: undefined,
          versions: [{ ...asset().versions[0], id: "ver_2", assetId: "ast_2" }],
        }),
      ],
      buyer: BUYER,
    });
    const remedy = review.blocking.find((c) => c.id === "metadata")?.remedy ?? "";
    expect(remedy).toMatch(/caption/i);
    expect(remedy).toMatch(/credit/i);
  });

  it("blocks when no buyer is set", () => {
    const review = reviewDispatch({
      pkg: pkg({ buyerId: undefined }),
      assets: [asset()],
      buyer: null,
    });
    expect(review.blocking.map((c) => c.id)).toContain("buyer");
  });

  it("blocks when there is no delivery route", () => {
    const review = reviewDispatch({
      pkg: pkg({ deliveryMethod: undefined }),
      assets: [asset()],
      buyer: BUYER,
    });
    expect(review.blocking.map((c) => c.id)).toContain("delivery_method");
  });

  it("blocks when terms are not stated", () => {
    const review = reviewDispatch({
      pkg: pkg({ proposedTerms: undefined }),
      assets: [asset()],
      buyer: BUYER,
    });
    expect(review.blocking.map((c) => c.id)).toContain("terms");
  });

  it("blocks a tombstoned asset from being sent", () => {
    const review = reviewDispatch({
      pkg: pkg(),
      assets: [asset({ status: "tombstoned" })],
      buyer: BUYER,
    });
    expect(review.blocking.map((c) => c.id)).toContain("asset_availability");
  });

  it("blocks a restricted asset from being sent", () => {
    const review = reviewDispatch({
      pkg: pkg(),
      assets: [asset({ status: "restricted" })],
      buyer: BUYER,
    });
    expect(review.blocking.map((c) => c.id)).toContain("asset_availability");
  });

  it("blocks when a packaged asset cannot be read at all", () => {
    const review = reviewDispatch({ pkg: pkg(), assets: [], buyer: BUYER });
    expect(review.blocking.map((c) => c.id)).toContain("asset_availability");
  });

  it("blocks when the packaged version no longer exists", () => {
    const review = reviewDispatch({
      pkg: pkg({ assets: [{ assetId: "ast_1", assetVersionId: "ver_gone", position: 0 }] }),
      assets: [asset()],
      buyer: BUYER,
    });
    expect(review.blocking.map((c) => c.id)).toContain("delivery_versions");
  });

  it("gives every blocking check something to do about it", () => {
    const review = reviewDispatch({
      pkg: pkg({ buyerId: undefined, deliveryMethod: undefined, proposedTerms: undefined }),
      assets: [asset({ caption: undefined })],
      buyer: null,
    });
    expect(review.blocking.length).toBeGreaterThan(3);
    for (const check of review.blocking) {
      expect(check.remedy, `${check.id} has no remedy`).toBeTruthy();
    }
  });
});

describe("advisories do not block", () => {
  it("allows approval with a missing restriction note", () => {
    const review = reviewDispatch({
      pkg: pkg({ restrictions: undefined }),
      assets: [asset()],
      buyer: BUYER,
    });
    expect(review.isApprovable).toBe(true);
    expect(review.advisories.map((c) => c.id)).toContain("restrictions");
  });

  it("allows approval when only recommended metadata is missing", () => {
    const review = reviewDispatch({
      pkg: pkg(),
      assets: [asset({ subjects: [], headline: undefined })],
      buyer: BUYER,
    });
    expect(review.isApprovable).toBe(true);
    expect(review.advisories.map((c) => c.id)).toContain("metadata_recommended");
  });

  it("surfaces an embargo without blocking", () => {
    const review = reviewDispatch({
      pkg: pkg({ embargoUntil: "2026-09-01T00:00:00.000Z" }),
      assets: [asset()],
      buyer: BUYER,
    });
    expect(review.isApprovable).toBe(true);
    expect(review.advisories.map((c) => c.id)).toContain("embargo");
  });
});

/**
 * A photograph's structured metadata record, at whatever stage the test needs.
 *
 * The dispatch gate is the last thing standing between a machine's caption and
 * a picture desk, so these cases are about who wrote the words rather than
 * whether the words exist.
 */
function metadata(overrides: Partial<PhotographMetadata> = {}): PhotographMetadata {
  return {
    assetId: "ast_1",
    organizationId: "org_1",
    generationStatus: "not_generated",
    generationAttempts: 0,
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
    metadataSource: "inherited",
    version: 1,
    updatedAt: "2026-08-19T10:00:00.000Z",
    ...overrides,
  };
}

const CONFIRMED = metadata({
  generationStatus: "confirmed",
  generatedAt: "2026-08-19T11:00:00.000Z",
  confirmedAt: "2026-08-19T12:00:00.000Z",
  confirmedBy: "usr_1",
});

describe("the metadata review gate", () => {
  it("reviews exactly as before when no metadata has been loaded", () => {
    // Every screen that does not need the records keeps working unchanged, and
    // the new check simply does not appear.
    const review = reviewDispatch({ pkg: pkg(), assets: [asset()], buyer: BUYER });
    expect(review.isApprovable).toBe(true);
    expect(review.checks.map((check) => check.id)).not.toContain("metadata_review");
  });

  it("blocks a dispatch carrying generated metadata nobody has confirmed", () => {
    const review = reviewDispatch({
      pkg: pkg(),
      assets: [asset()],
      buyer: BUYER,
      metadata: new Map([["ast_1", metadata({ generationStatus: "needs_review" })]]),
    });

    expect(review.isApprovable).toBe(false);
    const check = review.blocking.find((entry) => entry.id === "metadata_review");
    expect(check?.detail).toMatch(/has not been confirmed/);
    // The photographs are named, so the screen can link straight to them.
    expect(check?.assetIds).toEqual(["ast_1"]);
  });

  it("blocks while a generation is still running, and says it will clear itself", () => {
    const review = reviewDispatch({
      pkg: pkg(),
      assets: [asset()],
      buyer: BUYER,
      metadata: new Map([["ast_1", metadata({ generationStatus: "processing" })]]),
    });

    expect(review.isApprovable).toBe(false);
    expect(review.blocking.find((entry) => entry.id === "metadata_review")?.remedy).toMatch(
      /clears itself/,
    );
  });

  it("blocks a frame held under an embargo that has not passed", () => {
    const review = reviewDispatch({
      pkg: pkg(),
      assets: [asset()],
      buyer: BUYER,
      metadata: new Map([
        [
          "ast_1",
          metadata({
            ...CONFIRMED,
            rights: { ...CONFIRMED.rights, embargoUntil: "2999-01-01T00:00:00.000Z" },
          }),
        ],
      ]),
    });
    expect(review.isApprovable).toBe(false);
  });

  it("allows the dispatch once the metadata is confirmed", () => {
    const review = reviewDispatch({
      pkg: pkg(),
      assets: [asset()],
      buyer: BUYER,
      metadata: new Map([["ast_1", CONFIRMED]]),
    });

    expect(review.isApprovable).toBe(true);
    expect(review.checks.find((entry) => entry.id === "metadata_review")?.status).toBe("pass");
  });

  it("allows a photograph captioned entirely by hand, with nothing generated", () => {
    const review = reviewDispatch({
      pkg: pkg(),
      assets: [asset()],
      buyer: BUYER,
      metadata: new Map([["ast_1", metadata()]]),
    });
    expect(review.isApprovable).toBe(true);
  });

  it("names both problems separately when a frame has each", () => {
    // "Write a caption" and "read the one a machine wrote" are different jobs,
    // and rolling them together would tell somebody to write what is already
    // there.
    const review = reviewDispatch({
      pkg: pkg(),
      assets: [asset({ caption: undefined })],
      buyer: BUYER,
      metadata: new Map([["ast_1", metadata({ generationStatus: "needs_review" })]]),
    });

    const ids = review.blocking.map((entry) => entry.id);
    expect(ids).toContain("metadata");
    expect(ids).toContain("metadata_review");
  });
});
