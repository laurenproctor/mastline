import { describe, expect, it } from "vitest";
import { MAX_BUYER_NAME, parseNewBuyer } from "./buyer";

describe("parseNewBuyer", () => {
  it("accepts a name alone and defaults the kind", () => {
    const result = parseNewBuyer({ name: "  Backgrid  " });
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Backgrid",
        buyerType: "agency",
        contactName: undefined,
        contactEmail: undefined,
      },
    });
  });

  it("refuses a buyer with no name, because the name is the identity", () => {
    expect(parseNewBuyer({ name: "   " })).toEqual({
      ok: false,
      error: "Give the buyer a name.",
    });
    expect(parseNewBuyer({})).toMatchObject({ ok: false });
  });

  it("refuses a name too long to be one", () => {
    const result = parseNewBuyer({ name: "b".repeat(MAX_BUYER_NAME + 1) });
    expect(result.ok).toBe(false);
  });

  it("keeps every kind the schema allows and refuses anything else", () => {
    for (const buyerType of ["agency", "publisher", "picture_desk", "direct_licensee", "other"]) {
      expect(parseNewBuyer({ name: "Desk", buyerType })).toMatchObject({
        ok: true,
        value: { buyerType },
      });
    }
    expect(parseNewBuyer({ name: "Desk", buyerType: "friend" })).toMatchObject({ ok: false });
  });

  it("checks the shape of a contact address without pretending to verify it", () => {
    expect(parseNewBuyer({ name: "Desk", contactEmail: "pics@example.com" })).toMatchObject({
      ok: true,
      value: { contactEmail: "pics@example.com" },
    });
    expect(parseNewBuyer({ name: "Desk", contactEmail: "not an address" })).toMatchObject({
      ok: false,
    });
  });

  it("treats an empty contact as absent rather than blank", () => {
    const result = parseNewBuyer({ name: "Desk", contactName: "  ", contactEmail: "" });
    expect(result).toMatchObject({
      ok: true,
      value: { contactName: undefined, contactEmail: undefined },
    });
  });
});
