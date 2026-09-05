import { describe, expect, it } from "vitest";
import { assessCapacity, marginFor } from "./capacity";
import { sanitizeErrorMessage } from "./errors";

describe("assessing storage before a card dump", () => {
  const GIGABYTE = 1024 * 1024 * 1024;

  it("keeps headroom beyond the files themselves", () => {
    expect(marginFor(10 * GIGABYTE)).toBe(Math.round(GIGABYTE));
    // Never less than 32 MB, however small the selection.
    expect(marginFor(1024)).toBe(32 * 1024 * 1024);
  });

  it("is satisfied when the quota comfortably covers the files", () => {
    const assessment = assessCapacity({
      requiredBytes: 2 * GIGABYTE,
      quota: 20 * GIGABYTE,
      usage: GIGABYTE,
      persisted: true,
    });

    expect(assessment.sufficient).toBe(true);
    expect(assessment.warning).toBeUndefined();
    expect(assessment.shortfallBytes).toBe(0);
  });

  it("refuses to call an unknown quota sufficient", () => {
    // Not saying there is room is not the same as saying there is.
    const assessment = assessCapacity({ requiredBytes: GIGABYTE, persisted: false });
    expect(assessment.sufficient).toBe(false);
    expect(assessment.warning).toContain("will not report");
  });

  it("reports the shortfall in plain language", () => {
    const assessment = assessCapacity({
      requiredBytes: 8 * GIGABYTE,
      quota: 10 * GIGABYTE,
      usage: 9 * GIGABYTE,
      persisted: false,
    });

    expect(assessment.sufficient).toBe(false);
    expect(assessment.availableBytes).toBe(GIGABYTE);
    expect(assessment.shortfallBytes).toBeGreaterThan(7 * GIGABYTE);
    expect(assessment.warning).toContain("not enough free storage");
  });

  it("counts what the origin is already using", () => {
    const nearlyFull = assessCapacity({
      requiredBytes: GIGABYTE,
      quota: 4 * GIGABYTE,
      usage: 3.5 * GIGABYTE,
      persisted: true,
    });
    expect(nearlyFull.sufficient).toBe(false);
  });
});

describe("what a failure is allowed to say", () => {
  it("removes links, credentials, and long keys", () => {
    const message = sanitizeErrorMessage(
      new Error(
        "PUT https://project.supabase.co/storage/v1/object/originals?token=abc failed: authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      ),
    );

    expect(message).not.toContain("https://");
    expect(message).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(message).toContain("[link removed]");
  });

  it("shortens anything too long to read", () => {
    expect(sanitizeErrorMessage("x ".repeat(600)).length).toBeLessThanOrEqual(500);
  });

  it("always says something", () => {
    expect(sanitizeErrorMessage(undefined)).toBe("Unknown error");
    expect(sanitizeErrorMessage("   ")).toBe("Unknown error");
  });
});
