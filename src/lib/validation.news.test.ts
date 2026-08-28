import { describe, expect, it } from "vitest";
import { parseManualStory } from "./validation";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

/**
 * Manual story entry. Only the headline and the kind are required -- the
 * record is private -- and the one cross-field rule is that a confidence may
 * not arrive without a stated basis.
 */
describe("parseManualStory", () => {
  it("accepts the minimum: a headline and a kind", () => {
    const parsed = parseManualStory(
      form({ title: "Premiere moved to Friday", kind: "archive_match" }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.title).toBe("Premiere moved to Friday");
    expect(parsed.value.kind).toBe("archive_match");
    // Absent signal defaults to the quietest one rather than failing.
    expect(parsed.value.signal).toBe("watch");
    expect(parsed.value.sourceUrl).toBeUndefined();
    expect(parsed.value.confidence).toBeUndefined();
  });

  it("requires the headline", () => {
    const parsed = parseManualStory(form({ kind: "shoot_opportunity" }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.title).toBeTruthy();
  });

  it("requires a kind it recognises", () => {
    for (const kind of ["", "both", "ARCHIVE_MATCH", "archive"]) {
      const parsed = parseManualStory(form({ title: "A story", kind }));
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.errors.kind).toBeTruthy();
    }
  });

  it("accepts a full record and converts the confidence to a fraction", () => {
    const parsed = parseManualStory(
      form({
        title: "Gallery opening on the South Bank",
        kind: "shoot_opportunity",
        sourceName: "Evening Standard",
        sourceUrl: "https://example.com/story",
        sourcePublishedAt: "2026-08-20T10:30",
        summary: "A scheduled public event with named attendees.",
        signal: "rising",
        windowClosesAt: "2026-08-22T18:00",
        suggestionBasis: "Two represented subjects are named in the invitation.",
        confidence: "72",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.signal).toBe("rising");
    expect(parsed.value.confidence).toBe(0.72);
    expect(parsed.value.sourceUrl).toBe("https://example.com/story");
    expect(parsed.value.sourcePublishedAt).toMatch(/Z$/);
  });

  it("refuses a source that is not an http(s) address", () => {
    for (const sourceUrl of ["not a url", "javascript:alert(1)", "ftp://example.com/x"]) {
      const parsed = parseManualStory(form({ title: "A story", kind: "archive_match", sourceUrl }));
      expect(parsed.ok, sourceUrl).toBe(false);
      if (parsed.ok) return;
      expect(parsed.errors.sourceUrl).toBeTruthy();
    }
  });

  it("refuses a confidence with nothing behind it", () => {
    const parsed = parseManualStory(
      form({ title: "A story", kind: "archive_match", confidence: "80" }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.suggestionBasis).toMatch(/basis/i);
  });

  it("refuses a confidence outside 0 to 100", () => {
    for (const confidence of ["-1", "101", "many"]) {
      const parsed = parseManualStory(
        form({ title: "A story", kind: "archive_match", confidence, suggestionBasis: "A reason" }),
      );
      expect(parsed.ok, confidence).toBe(false);
      if (parsed.ok) return;
      expect(parsed.errors.confidence).toBeTruthy();
    }
  });

  it("refuses an unreadable timestamp rather than dropping it", () => {
    const parsed = parseManualStory(
      form({ title: "A story", kind: "archive_match", sourcePublishedAt: "not-a-time" }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.sourcePublishedAt).toBeTruthy();
  });

  it("refuses an unrecognised signal rather than guessing one", () => {
    const parsed = parseManualStory(
      form({ title: "A story", kind: "archive_match", signal: "screaming" }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.signal).toBeTruthy();
  });
});
