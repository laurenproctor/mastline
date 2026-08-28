import { describe, expect, it } from "vitest";
import {
  CONSENT_COOKIE,
  REGULATED_REGIONS,
  consentDefaultsScript,
  consentUpdatePayload,
  isRegulatedCountry,
  mayCollectOptionalAnalytics,
  shouldAskForConsent,
} from "@/lib/consent";

/**
 * Consent Mode fails silently: a wrong default or a script in the wrong place
 * still renders a working page, and the only symptom is measurement that should
 * not have been collected. So the things worth pinning are the ones nothing
 * else would catch.
 */

const REQUIRED_V2_SIGNALS = [
  "ad_storage",
  "ad_user_data",
  "ad_personalization",
  "analytics_storage",
];

describe("consent regions", () => {
  it("covers the EU27, the rest of the EEA, the UK, and Switzerland", () => {
    expect(REGULATED_REGIONS).toHaveLength(32);
    for (const country of ["FR", "DE", "IE", "IT", "ES", "SE", "PL"]) {
      expect(REGULATED_REGIONS).toContain(country);
    }
    for (const country of ["IS", "LI", "NO", "GB", "CH"]) {
      expect(REGULATED_REGIONS).toContain(country);
    }
  });

  it("does not regulate countries outside that set", () => {
    for (const country of ["US", "CA", "AU", "JP", "BR"]) {
      expect(isRegulatedCountry(country)).toBe(false);
    }
  });

  it("matches a country code whatever its case", () => {
    expect(isRegulatedCountry("gb")).toBe(true);
    expect(isRegulatedCountry(undefined)).toBe(false);
  });

  it("asks an unplaceable visitor rather than assuming", () => {
    // The header is absent in local development, and in production absent
    // exactly when Vercel could not place the request. Failing towards the
    // banner costs a dismissal; failing away from it leaves an EEA visitor
    // with no way to say yes, since Consent Mode holds them at denied anyway.
    expect(shouldAskForConsent(undefined)).toBe(true);
    expect(shouldAskForConsent("")).toBe(true);
    expect(shouldAskForConsent("FR")).toBe(true);
    expect(shouldAskForConsent("US")).toBe(false);
  });

  it("lists each region once", () => {
    expect(new Set(REGULATED_REGIONS).size).toBe(REGULATED_REGIONS.length);
  });
});

describe("consent defaults script", () => {
  const script = consentDefaultsScript();

  it("denies every v2 signal in the regulated regions", () => {
    const denied = script.slice(script.indexOf("'consent','default'", script.indexOf("region")));
    const regionalDefault = script.split("gtag('consent','default',")[2];

    for (const signal of REQUIRED_V2_SIGNALS) {
      expect(regionalDefault).toContain(`"${signal}":"denied"`);
    }
    expect(denied).toBeTruthy();
  });

  it("grants outside them, so the rest of the world is measured", () => {
    const globalDefault = script.split("gtag('consent','default',")[1];

    for (const signal of REQUIRED_V2_SIGNALS) {
      expect(globalDefault).toContain(`"${signal}":"granted"`);
    }
  });

  it("declares the global default before the regional one", () => {
    // Consent Mode applies them in order; a global grant declared afterwards
    // would overwrite the regional denial and silently un-gate the EEA.
    const first = script.indexOf('"analytics_storage":"granted"');
    const second = script.indexOf('"analytics_storage":"denied"');

    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it("waits for the banner before falling back to the defaults", () => {
    expect(script).toContain('"wait_for_update":500');
  });

  it("re-applies a stored choice on a later visit", () => {
    expect(script).toContain(CONSENT_COOKIE);
    expect(script).toContain("'consent','update'");
  });

  it("defines dataLayer and gtag before using them", () => {
    expect(script.indexOf("window.dataLayer=window.dataLayer")).toBe(0);
    expect(script.indexOf("function gtag")).toBeLessThan(script.indexOf("gtag('consent'"));
  });
});

describe("consent update payload", () => {
  it("reports all four v2 signals together", () => {
    for (const choice of ["granted", "denied"] as const) {
      const payload = consentUpdatePayload(choice);
      expect(Object.keys(payload).sort()).toEqual([...REQUIRED_V2_SIGNALS].sort());
      expect(Object.values(payload).every((value) => value === choice)).toBe(true);
    }
  });
});

/**
 * The gate the recipient delivery page reads.
 *
 * Two kinds of collection sit on that page and confusing them is the failure
 * worth pinning: opens, acceptances, and downloads are commercial evidence and
 * happen regardless; dwell time is engagement measurement and does not.
 */
describe("optional analytics on a delivery page", () => {
  it("runs when the visitor has said yes", () => {
    expect(mayCollectOptionalAnalytics({ choice: "granted", country: "DE" })).toBe(true);
    expect(mayCollectOptionalAnalytics({ choice: "granted", country: "US" })).toBe(true);
  });

  it("does not run when the visitor has said no, wherever they are", () => {
    expect(mayCollectOptionalAnalytics({ choice: "denied", country: "US" })).toBe(false);
    expect(mayCollectOptionalAnalytics({ choice: "denied", country: undefined })).toBe(false);
  });

  it("waits for an answer where one is required", () => {
    for (const country of ["DE", "FR", "GB", "CH", "NO"]) {
      expect(mayCollectOptionalAnalytics({ choice: undefined, country })).toBe(false);
    }
  });

  it("runs unasked only where no choice is required", () => {
    expect(mayCollectOptionalAnalytics({ choice: undefined, country: "US" })).toBe(true);
    expect(mayCollectOptionalAnalytics({ choice: undefined, country: "AU" })).toBe(true);
  });

  it("treats an unknown country as one that has to be asked", () => {
    // The geo header is missing in local development and, in production,
    // missing exactly when the request could not be placed -- which is no
    // reason to assume the visitor is somewhere that does not ask.
    expect(mayCollectOptionalAnalytics({ choice: undefined, country: undefined })).toBe(false);
    expect(mayCollectOptionalAnalytics({ choice: undefined, country: "" })).toBe(false);
  });

  it("agrees with the banner about where a choice is required", () => {
    for (const country of [...REGULATED_REGIONS, undefined, "", "US", "AU"]) {
      const asked = shouldAskForConsent(country);
      const collects = mayCollectOptionalAnalytics({ choice: undefined, country });
      // Nothing optional may run anywhere the banner would have to appear.
      expect(collects).toBe(!asked);
    }
  });
});
