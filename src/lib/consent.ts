/**
 * Google Consent Mode v2, in advanced mode.
 *
 * Advanced rather than basic: the container loads for everyone, but every
 * storage signal starts denied in the regulated regions, so nothing is written
 * to the visitor's device and the pings that do leave carry no identifiers
 * until they choose. Basic mode would withhold the container entirely and cost
 * all visibility into anyone who ignores the banner.
 *
 * The region split is done by Consent Mode's own `region` parameter rather than
 * by rendering different scripts per visitor. That matters: reading a geo
 * header inside the layout would make every marketing page dynamic and give up
 * static rendering for all seventeen of them. Google resolves the region
 * itself, so the same static HTML is correct everywhere.
 *
 * Nothing here is a legal conclusion about any jurisdiction. It records a
 * choice and reports it to the tag; which regions require a choice, and what
 * the policy says about it, are decisions to route to review.
 */

/** The visitor's stored answer. Absent means they have not been asked yet. */
export const CONSENT_COOKIE = "ml_consent";

/**
 * The visitor's country, stamped by middleware from Vercel's geo header so the
 * banner can decide whether to appear without a round trip of its own.
 *
 * Strictly necessary for operating the consent mechanism, holds nothing but a
 * two-letter code, and expires with the session.
 */
export const COUNTRY_COOKIE = "ml_country";

/** A year. Long enough not to re-ask on every visit, short enough to refresh. */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type ConsentChoice = "granted" | "denied";

/**
 * EU27, the three non-EU EEA states, the UK, and Switzerland.
 *
 * Consent Mode reads ISO 3166 codes here. This list decides two things: where
 * the tag defaults to denied, and where the banner appears at all.
 */
export const REGULATED_REGIONS = [
  // EU27
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  // EEA beyond the EU
  "IS",
  "LI",
  "NO",
  // Outside the EEA, same expectation of a choice
  "GB",
  "CH",
];

export function isRegulatedCountry(country: string | undefined): boolean {
  return country !== undefined && REGULATED_REGIONS.includes(country.toUpperCase());
}

/**
 * Whether to put the question in front of this visitor.
 *
 * An unknown country counts. The header is missing in local development, and
 * in production it is missing exactly when Vercel could not place the request
 * -- which is no reason to assume the visitor is somewhere that does not ask.
 * Failing towards the banner costs a visitor outside the EEA one dismissal;
 * failing away from it costs a visitor inside the EEA any way to say yes,
 * because Consent Mode resolves their region on its own and holds them at
 * denied whether or not this banner ever appeared.
 */
export function shouldAskForConsent(country: string | undefined): boolean {
  return country === undefined || country === "" || isRegulatedCountry(country);
}

/** The four signals Consent Mode v2 requires a value for, plus security. */
function signals(choice: ConsentChoice): Record<string, string> {
  return {
    ad_storage: choice,
    ad_user_data: choice,
    ad_personalization: choice,
    analytics_storage: choice,
  };
}

export function consentUpdatePayload(choice: ConsentChoice): Record<string, string> {
  return signals(choice);
}

/**
 * The script that has to run before the container loads.
 *
 * Order is the whole point. It declares the defaults, then re-applies a stored
 * choice synchronously, so a returning visitor's decision is already in effect
 * by the time any tag evaluates it. Run after the container and the first hit
 * has already been decided on the wrong basis.
 *
 * wait_for_update gives the banner a moment to report a first-time choice
 * before tags fall back to the defaults.
 */
export function consentDefaultsScript(): string {
  const granted = JSON.stringify({ ...signals("granted"), security_storage: "granted" });
  const denied = JSON.stringify({
    ...signals("denied"),
    security_storage: "granted",
    region: REGULATED_REGIONS,
    wait_for_update: 500,
  });

  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
gtag('consent','default',${granted});
gtag('consent','default',${denied});
var m=document.cookie.match(/(?:^|;\\s*)${CONSENT_COOKIE}=(granted|denied)/);
if(m){gtag('consent','update',{ad_storage:m[1],ad_user_data:m[1],ad_personalization:m[1],analytics_storage:m[1]})}`;
}
