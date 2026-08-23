import { describe, expect, it } from "vitest";
import {
  NAME_PART_MAX,
  displayNameFrom,
  fullNameFrom,
  initialsFrom,
  parsePersonName,
} from "./person-name";

describe("parsePersonName", () => {
  it("keeps both parts", () => {
    expect(parsePersonName("Marcus", "Hale")).toEqual({
      name: { firstName: "Marcus", lastName: "Hale" },
    });
  });

  it("trims and collapses whitespace", () => {
    expect(parsePersonName("  Marcus  ", " Hale ")).toEqual({
      name: { firstName: "Marcus", lastName: "Hale" },
    });
    expect(parsePersonName("Ana   Maria", "de  Souza")).toEqual({
      name: { firstName: "Ana Maria", lastName: "de Souza" },
    });
  });

  it("accepts an empty name, because sign-up does not depend on it", () => {
    // Someone creating an account at 2am to move a set of frames should not be
    // stopped by a form asking who they are.
    expect(parsePersonName("", "")).toEqual({ name: { firstName: "", lastName: "" } });
  });

  it("accepts one part without the other", () => {
    expect(parsePersonName("Cher", "")).toEqual({ name: { firstName: "Cher", lastName: "" } });
    expect(parsePersonName("", "Hale")).toEqual({ name: { firstName: "", lastName: "Hale" } });
  });

  it("keeps the characters that are actually in people's names", () => {
    // Hyphens, apostrophes, particles, accents, and non-Latin scripts.
    for (const [first, last] of [
      ["Anne-Marie", "O'Brien"],
      ["Ludwig", "van der Berg"],
      ["Álvaro", "Núñez"],
      ["雅", "田中"],
    ]) {
      expect(parsePersonName(first, last)).toEqual({
        name: { firstName: first, lastName: last },
      });
    }
  });

  it("refuses a part longer than the column allows", () => {
    const long = "a".repeat(NAME_PART_MAX + 1);
    expect(parsePersonName(long, "Hale")).toEqual({
      error: `First name cannot be longer than ${NAME_PART_MAX} characters.`,
    });
    expect(parsePersonName("Marcus", long)).toEqual({
      error: `Last name cannot be longer than ${NAME_PART_MAX} characters.`,
    });
  });

  it("measures length after trimming", () => {
    const exact = "a".repeat(NAME_PART_MAX);
    expect(parsePersonName(`  ${exact}  `, "")).toEqual({
      name: { firstName: exact, lastName: "" },
    });
  });
});

describe("fullNameFrom", () => {
  it("joins the parts", () => {
    expect(fullNameFrom({ firstName: "Marcus", lastName: "Hale" })).toBe("Marcus Hale");
  });

  it("does not leave a stray space when a part is missing", () => {
    expect(fullNameFrom({ firstName: "Cher", lastName: "" })).toBe("Cher");
    expect(fullNameFrom({ firstName: "", lastName: "Hale" })).toBe("Hale");
    expect(fullNameFrom({ firstName: "", lastName: "" })).toBe("");
  });
});

describe("displayNameFrom", () => {
  it("prefers the two parts", () => {
    expect(
      displayNameFrom({ firstName: "Marcus", lastName: "Hale", fullName: "Ignored", email: "m@x" }),
    ).toBe("Marcus Hale");
  });

  it("falls back to a name stored before the split", () => {
    // Accounts created when this was one field still have only full_name.
    expect(displayNameFrom({ fullName: "Marcus Hale", email: "marcus@mastline.test" })).toBe(
      "Marcus Hale",
    );
  });

  it("falls back to the address before the domain", () => {
    expect(displayNameFrom({ email: "marcus@mastline.test" })).toBe("marcus");
  });

  it("never renders an empty label", () => {
    expect(displayNameFrom({})).toBe("Member");
    expect(displayNameFrom({ firstName: "  ", lastName: "  ", email: "" })).toBe("Member");
  });
});

describe("initialsFrom", () => {
  it("is first and last initial when both are known", () => {
    expect(initialsFrom({ firstName: "Marcus", lastName: "Hale" })).toBe("MH");
  });

  it("does not mistake a particle for the surname", () => {
    // The reason the name is collected in two fields: splitting "Ludwig van der
    // Berg" on whitespace gives LV, which is nobody's initials.
    expect(initialsFrom({ firstName: "Ludwig", lastName: "van der Berg" })).toBe("LV");
    expect(initialsFrom({ fullName: "Ludwig van der Berg" })).toBe("LV");
    // Both read LV here, but the first is deliberate and the second is a guess;
    // the point is that the parts are known rather than inferred.
    expect(initialsFrom({ firstName: "Ana Maria", lastName: "de Souza" })).toBe("AD");
  });

  it("uses what there is when only one part is known", () => {
    expect(initialsFrom({ firstName: "Cher" })).toBe("CH");
    expect(initialsFrom({ lastName: "Hale" })).toBe("HA");
  });

  it("falls back to the email", () => {
    expect(initialsFrom({ email: "marcus.hale@mastline.test" })).toBe("MH");
    // Only the local part: the domain is the company's name, not the person's.
    expect(initialsFrom({ email: "marcus@mastline.test" })).toBe("MA");
  });

  it("never renders a blank avatar", () => {
    expect(initialsFrom({})).toBe("ME");
  });

  it("handles a name outside the Latin alphabet", () => {
    expect(initialsFrom({ firstName: "雅", lastName: "田中" })).toBe("雅田");
  });
});
