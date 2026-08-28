import { describe, expect, it } from "vitest";
import {
  MAX_DELIVERY_PARAMETERS,
  deliveryUrlWithParameters,
  normalizeDeliveryParameters,
  parameterPairsFromForm,
} from "./delivery-parameters";

/**
 * Attribution parameters, and the things they must never become.
 *
 * These rules are duplicated in `private.delivery_parameters_ok()`. This file
 * covers the copy an operator meets while typing; the database-backed tests
 * cover the copy that actually holds when something other than this form writes
 * a row.
 */

const ok = (pairs: { key: string; value: string }[]) => normalizeDeliveryParameters(pairs);

describe("what a photographer may attach to a link", () => {
  it("keeps ordinary attribution", () => {
    const result = ok([
      { key: "campaign", value: "awards-season" },
      { key: "channel", value: "email" },
      { key: "desk", value: "new-york" },
      { key: "assignment", value: "film-premiere" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parameters).toEqual({
      campaign: "awards-season",
      channel: "email",
      desk: "new-york",
      assignment: "film-premiere",
    });
  });

  it("drops the blank row the form always renders", () => {
    const result = ok([
      { key: "campaign", value: "awards-season" },
      { key: "", value: "" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.parameters)).toEqual(["campaign"]);
  });

  it("trims and lowercases the key so two spellings are one parameter", () => {
    const result = ok([{ key: "  Campaign  ", value: "  awards-season  " }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parameters).toEqual({ campaign: "awards-season" });
  });

  it("refuses an empty key", () => {
    expect(ok([{ key: "", value: "something" }])).toMatchObject({
      ok: false,
      error: expect.stringMatching(/needs a name/i),
    });
  });

  it("refuses a key listed twice", () => {
    expect(
      ok([
        { key: "campaign", value: "one" },
        { key: "campaign", value: "two" },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/twice/i) });
  });

  it("refuses more than the cap", () => {
    const pairs = Array.from({ length: MAX_DELIVERY_PARAMETERS + 1 }, (_, index) => ({
      key: `k${index}`,
      value: "v",
    }));
    expect(ok(pairs)).toMatchObject({ ok: false, error: expect.stringMatching(/at most/i) });
  });

  it("refuses an over-long value", () => {
    expect(ok([{ key: "campaign", value: "x".repeat(121) }])).toMatchObject({
      ok: false,
      error: expect.stringMatching(/too long/i),
    });
  });

  it.each(["Campaign!", "1campaign", "camp aign", "cam.paign", "-campaign"])(
    "refuses the unusable key %s",
    (key) => {
      expect(ok([{ key, value: "v" }])).toMatchObject({ ok: false });
    },
  );
});

/**
 * The reserved list is the load-bearing part.
 *
 * Nothing reads these parameters to decide anything, so none of them could
 * actually override authorization -- but a parameter called `token` would read,
 * to a person and to whoever maintains this next, as though it might. The right
 * answer to "can a custom parameter override the token?" is "there is no
 * parameter by that name".
 */
describe("keys Mastline refuses to store", () => {
  it.each([
    "token",
    "delivery_token",
    "sig",
    "signature",
    "auth",
    "authorization",
    "access_token",
    "secret",
    "expires",
    "exp",
    "ttl",
  ])("refuses the credential-shaped key %s", (key) => {
    expect(ok([{ key, value: "anything" }])).toMatchObject({
      ok: false,
      error: expect.stringMatching(/reserved/i),
    });
  });

  it.each(["email", "phone", "name", "recipient", "contact", "contact_reference", "user_id"])(
    "refuses the identity-shaped key %s, which belongs in a protected column",
    (key) => {
      expect(ok([{ key, value: "jane@example.com" }])).toMatchObject({
        ok: false,
        error: expect.stringMatching(/reserved/i),
      });
    },
  );

  it.each(["__proto__", "constructor", "prototype"])(
    "refuses the prototype-poisoning key %s",
    (key) => {
      expect(ok([{ key, value: "polluted" }])).toMatchObject({ ok: false });
    },
  );

  it("cannot reach Object.prototype even if a key slipped through", () => {
    const result = ok([{ key: "campaign", value: "awards-season" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result.parameters, "campaign")).toBe(true);
  });
});

describe("the address handed to a desk", () => {
  it("puts the token in the path and the attribution in the query", () => {
    const url = deliveryUrlWithParameters("https://mastline.co", "TOKEN123", {
      campaign: "awards-season",
      channel: "email",
    });
    expect(url).toBe(
      "https://mastline.co/d/TOKEN123?campaign=awards-season&channel=email",
    );
  });

  it("is stable, so copying twice does not look like two links", () => {
    const a = deliveryUrlWithParameters("https://mastline.co", "T", { b: "2", a: "1" });
    const b = deliveryUrlWithParameters("https://mastline.co", "T", { a: "1", b: "2" });
    expect(a).toBe(b);
  });

  it("encodes a value that would otherwise break the query", () => {
    const url = deliveryUrlWithParameters("https://mastline.co", "T", {
      campaign: "awards & season",
      desk: "new york",
    });
    expect(url).toContain("campaign=awards+%26+season");
    expect(url).toContain("desk=new+york");
    // The token is still exactly one path segment.
    expect(new URL(url).pathname).toBe("/d/T");
  });

  it("leaves the URL bare when there is nothing to attribute", () => {
    expect(deliveryUrlWithParameters("https://mastline.co/", "T")).toBe("https://mastline.co/d/T");
  });

  it("never carries a recipient name or contact reference", () => {
    // The recipient fields are not parameters and have no way to become them:
    // the key that would name them is reserved, and the URL builder is only
    // ever handed the stored parameter snapshot.
    const rejected = ok([{ key: "recipient", value: "New York picture desk" }]);
    expect(rejected.ok).toBe(false);

    const url = deliveryUrlWithParameters("https://mastline.co", "TOKEN", {
      desk: "new-york",
    });
    expect(url).not.toMatch(/picture desk/i);
    expect(url).not.toMatch(/@/);
  });
});

describe("reading the form", () => {
  it("pairs keys with values by position", () => {
    const form = new FormData();
    form.append("parameterKey", "campaign");
    form.append("parameterValue", "awards-season");
    form.append("parameterKey", "channel");
    form.append("parameterValue", "email");

    expect(parameterPairsFromForm(form)).toEqual([
      { key: "campaign", value: "awards-season" },
      { key: "channel", value: "email" },
    ]);
  });

  it("survives a key with no matching value", () => {
    const form = new FormData();
    form.append("parameterKey", "campaign");
    expect(parameterPairsFromForm(form)).toEqual([{ key: "campaign", value: "" }]);
  });
});
