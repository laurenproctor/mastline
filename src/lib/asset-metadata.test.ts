import { describe, expect, it } from "vitest";
import {
  AI_WRITABLE_FIELDS,
  type PhotographMetadata,
  RIGHTS_FIELDS,
  blockingMetadataReasons,
  describeStatus,
  mergeGeneratedMetadata,
  nextMetadataSource,
  requiresIndividualConfirmation,
  resolveMetadata,
  reviewProgress,
  technicalRows,
} from "./asset-metadata";
import type { Shoot } from "./domain";

const SHOOT: Shoot = {
  id: "shoot-1",
  organizationId: "org-1",
  title: "Soho arrival",
  status: "preparing",
  priority: "standard",
  locationName: "Dean Street, London",
  targetBuyerIds: [],
  sensitiveContent: false,
  hasSensitiveNote: false,
  createdAt: "2026-08-19T10:00:00.000Z",
  updatedAt: "2026-08-19T10:00:00.000Z",
};

function record(overrides: Partial<PhotographMetadata> = {}): PhotographMetadata {
  return {
    assetId: "asset-1",
    organizationId: "org-1",
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

// ---------------------------------------------------------------------------
// Inheritance
// ---------------------------------------------------------------------------

describe("inheritance from the shoot", () => {
  it("fills an empty field from the shoot and says where it came from", () => {
    const resolved = resolveMetadata(record(), SHOOT);
    expect(resolved.fields.eventName).toEqual({ value: "Soho arrival", provenance: "inherited" });
    expect(resolved.fields.venue).toEqual({
      value: "Dean Street, London",
      provenance: "inherited",
    });
  });

  it("stops inheriting once a person writes to the field", () => {
    const resolved = resolveMetadata(
      record({
        editorial: { ...record().editorial, venue: "The Groucho Club" },
        manualOverrides: ["venue"],
      }),
      SHOOT,
    );
    expect(resolved.fields.venue).toEqual({ value: "The Groucho Club", provenance: "entered" });
  });

  it("stops inheriting when a person deliberately CLEARS the field", () => {
    // This is the case a null column alone cannot express. Without the override
    // list, clearing a venue would simply let the shoot's answer flow back in
    // on the next render, and the photographer's deletion would look like a bug.
    const resolved = resolveMetadata(record({ manualOverrides: ["venue"] }), SHOOT);
    expect(resolved.fields.venue.value).toBeUndefined();
    expect(resolved.fields.venue.provenance).toBe("entered");
  });

  it("lets a later shoot change reach a frame nobody has edited", () => {
    const renamed: Shoot = { ...SHOOT, title: "Soho arrival, second night" };
    const resolved = resolveMetadata(record(), renamed);
    expect(resolved.fields.eventName.value).toBe("Soho arrival, second night");
  });

  it("does not let a later shoot change reach a frame somebody has edited", () => {
    const renamed: Shoot = { ...SHOOT, title: "Soho arrival, second night" };
    const resolved = resolveMetadata(
      record({
        editorial: { ...record().editorial, eventName: "Soho arrival" },
        manualOverrides: ["eventName"],
      }),
      renamed,
    );
    expect(resolved.fields.eventName.value).toBe("Soho arrival");
  });

  it("inherits a shoot embargo and its sensitive flag", () => {
    const held: Shoot = {
      ...SHOOT,
      embargoUntil: "2026-09-01T00:00:00.000Z",
      sensitiveContent: true,
    };
    const resolved = resolveMetadata(record(), held);
    expect(resolved.fields.embargoUntil.value).toBe("2026-09-01T00:00:00.000Z");
    expect(resolved.fields.sensitiveOrMinor).toEqual({ value: true, provenance: "inherited" });
  });

  it("resolves to empty rather than throwing when there is no record and no shoot", () => {
    const resolved = resolveMetadata(null, null);
    expect(resolved.fields.headline).toEqual({ value: undefined, provenance: "empty" });
    expect(resolved.needsReview).toEqual([]);
  });
});

describe("provenance", () => {
  const generated = record({
    generatedAt: "2026-08-19T11:00:00.000Z",
    generationStatus: "needs_review",
    editorial: { ...record().editorial, headline: "Two people leave a hotel" },
    generatedValues: { headline: "Two people leave a hotel" },
    fieldConfidence: { headline: 0.62 },
  });

  it("marks an unaccepted model value as generated, with its confidence", () => {
    const resolved = resolveMetadata(generated, SHOOT);
    expect(resolved.fields.headline).toEqual({
      value: "Two people leave a hotel",
      provenance: "generated",
      confidence: 0.62,
    });
    expect(resolved.needsReview).toContain("headline");
  });

  it("stops calling a value generated once the record is confirmed", () => {
    const resolved = resolveMetadata(
      { ...generated, generationStatus: "confirmed", confirmedAt: "2026-08-19T12:00:00.000Z" },
      SHOOT,
    );
    expect(resolved.fields.headline.provenance).toBe("confirmed");
    expect(resolved.needsReview).toEqual([]);
  });

  it("calls a hand-typed value entered even where a generation also ran", () => {
    const resolved = resolveMetadata({ ...generated, manualOverrides: ["headline"] }, SHOOT);
    expect(resolved.fields.headline.provenance).toBe("entered");
    expect(resolved.needsReview).not.toContain("headline");
  });
});

// ---------------------------------------------------------------------------
// The merge
// ---------------------------------------------------------------------------

describe("mergeGeneratedMetadata", () => {
  it("writes into empty and inherited fields", () => {
    const { patch } = mergeGeneratedMetadata(record(), {
      headline: "Two people leave a hotel",
      keywords: ["hotel", "night"],
    });
    expect(patch).toEqual({ headline: "Two people leave a hotel", keywords: ["hotel", "night"] });
  });

  it("replaces an unconfirmed value from an earlier run, which is what Regenerate means", () => {
    const previous = record({
      generatedAt: "2026-08-19T11:00:00.000Z",
      editorial: { ...record().editorial, headline: "An earlier guess" },
      generatedValues: { headline: "An earlier guess" },
    });
    const { patch } = mergeGeneratedMetadata(previous, { headline: "A better guess" });
    expect(patch.headline).toBe("A better guess");
  });

  it("refuses a field the photographer typed, confirmed or not", () => {
    const edited = record({
      editorial: { ...record().editorial, headline: "What I actually saw" },
      manualOverrides: ["headline"],
    });
    const { patch, skipped } = mergeGeneratedMetadata(edited, { headline: "A machine's guess" });
    expect(patch).not.toHaveProperty("headline");
    expect(skipped).toContainEqual({ field: "headline", reason: "edited_by_hand" });
  });

  it("writes nothing at all into a confirmed record", () => {
    const confirmed = record({
      generationStatus: "confirmed",
      confirmedAt: "2026-08-19T12:00:00.000Z",
      confirmedBy: "user-1",
    });
    const { patch, skipped } = mergeGeneratedMetadata(confirmed, {
      headline: "A machine's guess",
      keywords: ["hotel"],
    });
    expect(patch).toEqual({});
    expect(skipped.every((entry) => entry.reason === "confirmed")).toBe(true);
  });

  it("lets sensitivity rise", () => {
    const { patch } = mergeGeneratedMetadata(record(), { sensitivity: "review" });
    expect(patch.sensitivity).toBe("review");
  });

  it("never lets sensitivity fall", () => {
    // A model deciding a frame is fine must not clear a concern somebody, or an
    // earlier run, already raised.
    const flagged = record({
      editorial: { ...record().editorial, sensitivity: "sensitive" },
    });
    const { patch, skipped } = mergeGeneratedMetadata(flagged, { sensitivity: "none" });
    expect(patch).not.toHaveProperty("sensitivity");
    expect(skipped).toContainEqual({ field: "sensitivity", reason: "would_lower_sensitivity" });
  });

  it("ignores an empty value rather than blanking what is there", () => {
    const existing = record({
      editorial: { ...record().editorial, headline: "Something" },
      generatedValues: { headline: "Something" },
    });
    const { patch } = mergeGeneratedMetadata(existing, { headline: "", keywords: [] });
    expect(patch).toEqual({});
  });

  it("merges against no record at all, which is a first run", () => {
    const { patch } = mergeGeneratedMetadata(null, { headline: "First" });
    expect(patch).toEqual({ headline: "First" });
  });
});

describe("what a generation is allowed to touch", () => {
  it("cannot write a single rights field", () => {
    for (const field of RIGHTS_FIELDS) {
      expect(AI_WRITABLE_FIELDS).not.toContain(field as never);
    }
  });

  it("cannot write the list of people in frame", () => {
    // Naming a face is a factual claim with legal consequences. The
    // photographer, who was there, records it.
    expect(AI_WRITABLE_FIELDS).not.toContain("subjects" as never);
  });

  it("cannot write the photographer's own notes", () => {
    expect(AI_WRITABLE_FIELDS).not.toContain("photographerNotes" as never);
  });

  it("refuses a field outside its list even if one is handed to it", () => {
    const { patch, skipped } = mergeGeneratedMetadata(record(), {
      // Deliberately off-contract: what a future schema change might leak in.
      subjects: ["Someone Famous"],
    } as never);
    expect(patch).toEqual({});
    expect(skipped).toContainEqual({ field: "subjects", reason: "not_generatable" });
  });
});

describe("nextMetadataSource", () => {
  it("says mixed once a generated record has been edited", () => {
    expect(nextMetadataSource({ hasGenerated: true, hasManual: true })).toBe("mixed");
    expect(nextMetadataSource({ hasGenerated: true, hasManual: false })).toBe("ai_generated");
    expect(nextMetadataSource({ hasGenerated: false, hasManual: true })).toBe("manual");
    expect(nextMetadataSource({ hasGenerated: false, hasManual: false })).toBe("inherited");
  });
});

// ---------------------------------------------------------------------------
// The dispatch gate
// ---------------------------------------------------------------------------

describe("blockingMetadataReasons", () => {
  it("does not block a photograph with no metadata record", () => {
    // Captioning by hand has always been a complete workflow.
    expect(blockingMetadataReasons(null)).toEqual([]);
  });

  it("does not block a record nothing has been generated for", () => {
    expect(blockingMetadataReasons(record())).toEqual([]);
  });

  it("blocks generated metadata nobody has confirmed", () => {
    expect(blockingMetadataReasons(record({ generationStatus: "needs_review" }))).toEqual([
      "AI-generated metadata has not been confirmed",
    ]);
  });

  it("blocks while a generation is still running", () => {
    for (const status of ["queued", "processing"] as const) {
      expect(blockingMetadataReasons(record({ generationStatus: status }))).toEqual([
        "metadata is still being generated",
      ]);
    }
  });

  it("blocks a sensitive frame until somebody confirms it", () => {
    const flagged = record({
      editorial: { ...record().editorial, sensitivity: "sensitive" },
    });
    expect(blockingMetadataReasons(flagged)).toContain("flagged as sensitive and not confirmed");
  });

  it("blocks a frame held under an embargo that has not passed", () => {
    const held = record({
      generationStatus: "confirmed",
      confirmedAt: "2026-08-19T12:00:00.000Z",
      rights: { ...record().rights, embargoUntil: "2999-01-01T00:00:00.000Z" },
    });
    expect(blockingMetadataReasons(held)).toHaveLength(1);
  });

  it("stops blocking once an embargo has passed", () => {
    const released = record({
      generationStatus: "confirmed",
      confirmedAt: "2026-08-19T12:00:00.000Z",
      rights: { ...record().rights, embargoUntil: "2000-01-01T00:00:00.000Z" },
    });
    expect(blockingMetadataReasons(released)).toEqual([]);
  });

  it("does not block a confirmed record", () => {
    const confirmed = record({
      generationStatus: "confirmed",
      confirmedAt: "2026-08-19T12:00:00.000Z",
      confirmedBy: "user-1",
      generatedAt: "2026-08-19T11:00:00.000Z",
    });
    expect(blockingMetadataReasons(confirmed)).toEqual([]);
  });

  it("does not block a failed generation, because no machine words are in play", () => {
    expect(blockingMetadataReasons(record({ generationStatus: "failed" }))).toEqual([]);
  });
});

describe("requiresIndividualConfirmation", () => {
  it("lets an ordinary reviewed frame through the bulk path", () => {
    expect(requiresIndividualConfirmation(record({ generationStatus: "needs_review" }))).toBe(
      false,
    );
  });

  it("holds back anything with a rights position recorded", () => {
    for (const rights of [
      { commercialUseEligible: "eligible" as const },
      { modelReleaseStatus: "obtained" as const },
      { propertyReleaseStatus: "not_obtained" as const },
      { embargoUntil: "2999-01-01T00:00:00.000Z" },
      { sensitiveOrMinor: true },
    ]) {
      expect(
        requiresIndividualConfirmation(record({ rights: { ...record().rights, ...rights } })),
      ).toBe(true);
    }
  });

  it("holds back anything flagged for editorial attention", () => {
    expect(
      requiresIndividualConfirmation(
        record({ editorial: { ...record().editorial, sensitivity: "review" } }),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

describe("describeStatus", () => {
  it("reads as not generated when there is no record", () => {
    expect(describeStatus(null).status).toBe("not_generated");
  });

  it("keeps polling only while a job is in flight", () => {
    expect(describeStatus(record({ generationStatus: "queued" })).inFlight).toBe(true);
    expect(describeStatus(record({ generationStatus: "processing" })).inFlight).toBe(true);
    expect(describeStatus(record({ generationStatus: "needs_review" })).inFlight).toBe(false);
    expect(describeStatus(record({ generationStatus: "confirmed" })).inFlight).toBe(false);
    expect(describeStatus(record({ generationStatus: "failed" })).inFlight).toBe(false);
  });

  it("uses the recorded reason for a failure when there is one", () => {
    const failed = record({
      generationStatus: "failed",
      failureDetail: "There is no readable preview for this file.",
    });
    expect(describeStatus(failed).detail).toBe("There is no readable preview for this file.");
  });

  it("says review is required in as many words", () => {
    expect(describeStatus(record({ generationStatus: "needs_review" })).detail).toMatch(
      /AI-generated — review required/,
    );
  });
});

describe("reviewProgress", () => {
  it("counts a shoot the way the header states it", () => {
    const progress = reviewProgress([
      record({ generationStatus: "confirmed" }),
      record({ generationStatus: "confirmed" }),
      record({ generationStatus: "needs_review" }),
      record({ generationStatus: "failed" }),
      record({ generationStatus: "processing" }),
      null,
    ]);
    expect(progress).toEqual({
      total: 6,
      confirmed: 2,
      needsReview: 1,
      failed: 1,
      inFlight: 1,
      notGenerated: 1,
      percent: 33,
    });
  });

  it("does not divide by zero on an empty shoot", () => {
    expect(reviewProgress([]).percent).toBe(0);
  });
});

describe("technicalRows", () => {
  it("lists only what was actually read", () => {
    const rows = technicalRows({
      raw: {},
      cameraMake: "SONY",
      cameraModel: "ILCE-1",
      apertureF: 2.8,
      source: "exif",
    });
    const labels = rows.map((row) => row.label);
    expect(labels).toContain("Camera");
    expect(labels).toContain("Aperture");
    expect(labels).not.toContain("Lens");
    expect(rows.find((row) => row.label === "Aperture")?.value).toBe("f/2.8");
  });

  it("says when the camera recorded no timezone rather than implying it did", () => {
    const rows = technicalRows({
      raw: { captured_at_zone: "not recorded" },
      capturedAt: "2026-08-19T18:47:03.000Z",
      source: "exif",
    });
    expect(rows.find((row) => row.label === "Captured")?.value).toMatch(/no timezone/);
  });

  it("renders an instant through the caller's formatter, not as a raw ISO string", () => {
    const rows = technicalRows(
      { raw: {}, capturedAt: "2026-08-19T18:47:03.000Z", source: "exif" },
      () => "Aug 19 · 2:47 PM",
    );
    expect(rows.find((row) => row.label === "Captured")?.value).toBe("Aug 19 · 2:47 PM");
  });

  it("returns nothing for a photograph with no technical record", () => {
    expect(technicalRows(null)).toEqual([]);
  });
});
