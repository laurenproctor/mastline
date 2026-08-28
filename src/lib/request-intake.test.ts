import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTAKE_WINDOW,
  INTAKE_LIMITS,
  intakeExpiryFrom,
  intakeUrl,
  isIntakeToken,
  isIntakeWindow,
  parseIntake,
} from "./request-intake";

describe("intake tokens", () => {
  it("accepts the shape the database accepts and nothing else", () => {
    expect(isIntakeToken("a".repeat(43))).toBe(true);
    expect(isIntakeToken("A-_0".repeat(8))).toBe(true);
    // Too short, too long, and characters base64url never produces.
    expect(isIntakeToken("a".repeat(31))).toBe(false);
    expect(isIntakeToken("a".repeat(129))).toBe(false);
    expect(isIntakeToken("a".repeat(42) + "+")).toBe(false);
    expect(isIntakeToken("a".repeat(42) + "/")).toBe(false);
    expect(isIntakeToken("")).toBe(false);
    expect(isIntakeToken("../../etc/passwd")).toBe(false);
  });

  it("builds a link without doubling the slash", () => {
    expect(intakeUrl("https://mastline.co/", "tok")).toBe("https://mastline.co/r/tok");
    expect(intakeUrl("https://mastline.co", "tok")).toBe("https://mastline.co/r/tok");
  });

  it("offers only the windows the interface offers", () => {
    expect(isIntakeWindow(14)).toBe(true);
    expect(isIntakeWindow(365)).toBe(false);
    const now = new Date("2026-08-28T00:00:00.000Z");
    expect(intakeExpiryFrom(DEFAULT_INTAKE_WINDOW, now).toISOString()).toBe(
      "2026-09-11T00:00:00.000Z",
    );
  });
});

describe("what a stranger typed", () => {
  const minimal = { title: "Departure from last night" };

  it("needs a title and nothing else", () => {
    const parsed = parseIntake(minimal);
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.title).toBe("Departure from last night");
  });

  it("refuses an empty or whitespace title", () => {
    expect(parseIntake({ title: "" }).failure).toBe("title_required");
    expect(parseIntake({ title: "   " }).failure).toBe("title_required");
    expect(parseIntake({}).failure).toBe("title_required");
  });

  /*
   * The commercially load-bearing rule. A desk that did not name a territory
   * has not asked for worldwide, and one that said nothing about money has not
   * offered zero. Blank must survive as blank all the way to the column, or the
   * product will later present a right nobody negotiated as one that was.
   */
  it("keeps an unsaid term unsaid rather than defaulting it", () => {
    const parsed = parseIntake({ ...minimal, territory: "", usageMedia: "   ", exclusivity: "" });
    expect(parsed.value?.territory).toBeUndefined();
    expect(parsed.value?.usageMedia).toBeUndefined();
    expect(parsed.value?.exclusivity).toBeUndefined();
  });

  it("treats an undisclosed budget as not provided, never as zero", () => {
    const parsed = parseIntake({ ...minimal, budgetMin: "500" });
    expect(parsed.value?.budgetDisclosed).toBe(false);
    expect(parsed.value?.budgetMinMinor).toBeUndefined();
    expect(parsed.value?.budgetMaxMinor).toBeUndefined();
  });

  it("refuses a disclosure with no figure in it", () => {
    expect(parseIntake({ ...minimal, budgetDisclosed: "on" }).failure).toBe("budget_incomplete");
  });

  it("takes a figure in major units and stores minor", () => {
    const parsed = parseIntake({ ...minimal, budgetDisclosed: "on", budgetMin: "500.50" });
    expect(parsed.value?.budgetDisclosed).toBe(true);
    expect(parsed.value?.budgetMinMinor).toBe(50050);
  });

  it("refuses a backwards range", () => {
    const parsed = parseIntake({
      ...minimal,
      budgetDisclosed: "on",
      budgetMin: "900",
      budgetMax: "100",
    });
    expect(parsed.failure).toBe("budget_backwards");
    expect(parsed.field).toBe("budgetMax");
  });

  it("accepts a disclosed zero, which is a real thing a desk says", () => {
    const parsed = parseIntake({ ...minimal, budgetDisclosed: "on", budgetMin: "0" });
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.budgetDisclosed).toBe(true);
    expect(parsed.value?.budgetMinMinor).toBe(0);
  });

  it("enforces every field limit the schema enforces", () => {
    for (const [field, limit] of [
      ["brief", INTAKE_LIMITS.brief],
      ["subjectOrEvent", INTAKE_LIMITS.subjectOrEvent],
      ["territory", INTAKE_LIMITS.territory],
      ["usageRestrictions", INTAKE_LIMITS.usageRestrictions],
    ] as const) {
      const parsed = parseIntake({ ...minimal, [field]: "x".repeat(limit + 1) });
      expect(parsed.failure, field).toBe("too_long");
      expect(parsed.field, field).toBe(field);
    }
    expect(parseIntake({ title: "x".repeat(INTAKE_LIMITS.title + 1) }).failure).toBe(
      "title_too_long",
    );
  });

  /*
   * The list was the only unbounded thing on this form, which made it the only
   * way to push size through a function anyone holding a link may call.
   */
  it("bounds the format list by count and by item", () => {
    expect(
      parseIntake({
        ...minimal,
        requestedFormats: Array.from({ length: 400 }, (_, i) => `format-${i}`),
      }).failure,
    ).toBe("too_many_formats");

    expect(parseIntake({ ...minimal, requestedFormats: ["x".repeat(41)] }).failure).toBe(
      "too_many_formats",
    );

    expect(parseIntake({ ...minimal, requestedFormats: ["JPEG", "RAW"] }).ok).toBe(true);
  });

  it("still caps the whole submission as a backstop", () => {
    // Every field inside its own limit; the total pushed past the cap.
    const parsed = parseIntake({
      ...minimal,
      brief: "x".repeat(INTAKE_LIMITS.brief),
      deliverables: "y".repeat(INTAKE_LIMITS.deliverables),
      usageRestrictions: "z".repeat(INTAKE_LIMITS.usageRestrictions),
      usageMedia: "m".repeat(INTAKE_LIMITS.usageMedia),
      territory: "t".repeat(INTAKE_LIMITS.territory),
      usageDuration: "d".repeat(INTAKE_LIMITS.usageDuration),
      exclusivity: "e".repeat(INTAKE_LIMITS.exclusivity),
      subjectOrEvent: "s".repeat(INTAKE_LIMITS.subjectOrEvent),
      locationName: "l".repeat(INTAKE_LIMITS.locationName),
      requestedFormats: Array.from({ length: INTAKE_LIMITS.formatCount }, () =>
        "f".repeat(INTAKE_LIMITS.formatLength),
      ),
    });
    // ~11KB of text plus the list is still under the backstop, which is the
    // honest result: the cap exists for what gets added later, and the per-field
    // limits are what actually bind today.
    expect(parsed.ok).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(parsed.value), "utf8")).toBeLessThan(
      INTAKE_LIMITS.TOTAL_BYTES,
    );
  });

  it("refuses a name too short to mean anything, but allows none at all", () => {
    expect(parseIntake({ ...minimal, submitterName: "J" }).failure).toBe("name_too_short");
    expect(parseIntake({ ...minimal, submitterName: "" }).ok).toBe(true);
    expect(parseIntake({ ...minimal, submitterName: "" }).value?.submitterName).toBeUndefined();
  });

  it("refuses a date it cannot read rather than guessing one", () => {
    expect(parseIntake({ ...minimal, eventAt: "last tuesday" }).failure).toBe("bad_date");
    expect(parseIntake({ ...minimal, responseDeadline: "not-a-date" }).field).toBe(
      "responseDeadline",
    );
  });

  /*
   * Nothing here escapes or strips markup. React escapes on render and Postgres
   * takes a parameter, so the injection routes are already closed; a sanitiser
   * in the middle would silently rewrite a desk's own words -- a brief really
   * can contain "<embargo>" or an ampersand -- and make the stored record
   * differ from what they typed.
   */
  it("stores what was typed rather than rewriting it", () => {
    const brief = "Need <b>wide</b> & tight — 'side door' \"main\"; DROP TABLE assets;--";
    expect(parseIntake({ ...minimal, brief }).value?.brief).toBe(brief);
  });

  it("takes formats as a list or as a comma-separated string", () => {
    expect(
      parseIntake({ ...minimal, requestedFormats: ["JPEG", "RAW"] }).value?.requestedFormats,
    ).toEqual(["JPEG", "RAW"]);
    expect(
      parseIntake({ ...minimal, requestedFormats: "JPEG, RAW" }).value?.requestedFormats,
    ).toEqual(["JPEG", "RAW"]);
    expect(parseIntake({ ...minimal, requestedFormats: "" }).value?.requestedFormats).toEqual([]);
  });
});
