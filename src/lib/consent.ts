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
 * What the preferences panel offers, and the single source the panel and its
 * tests both read.
 *
 * There is one optional category because the site has one optional collector.
 * The privacy policy states that Mastline shows no advertising and lets no
 * advertiser target anyone, so an "advertising" row would be a category
 * invented for the look of granularity, and a panel that lists choices the site
 * does not actually make is worse than one that lists the choice it does.
 *
 * The cookie stays `granted`/`denied` for the same reason: with one optional
 * category the existing vocabulary already expresses every reachable state, so
 * the panel is an affordance over the stored choice rather than a new format.
 * `consentDefaultsScript()` parses that cookie inline, before the container
 * loads, and not having to change it is the point.
 */
export type ConsentCategoryId = "essential" | "analytics";

export interface ConsentCategory {
  id: ConsentCategoryId;
  label: string;
  /** Optional categories get a switch; the essential one is stated, not asked. */
  optional: boolean;
  description: string;
}

export const CONSENT_CATEGORIES: readonly ConsentCategory[] = [
  {
    id: "essential",
    label: "Essential",
    optional: false,
    description:
      "Keeps you signed in, remembers this choice, and holds the short-lived country code the banner needs to know whether to ask. The site cannot work without them.",
  },
  {
    id: "analytics",
    label: "Analytics",
    optional: true,
    description:
      "Google Analytics, to understand how the site is used, and Microsoft Clarity, which records how pages are used — pointer movement, scrolling, and clicks — to show where the site is confusing. On a delivery page this also covers Mastline's own measurement of roughly how long the page is on screen and which photographs you look at, kept first-party for the photographer's delivery record: no advertising tag, no third-party tracker, no session recording, and nothing about your browsing elsewhere. Where a choice is required, none of it runs and no cookie of theirs is set until you turn this on; everywhere else it runs unless you turn this off. Clarity is provided by Microsoft, which may set cookies of its own once it runs. Turning this off does not stop a photographer's record that their link was opened, that terms were accepted, or that a file was downloaded — those are commercial records of what happened to their work.",
  },
];

/** The optional categories, in panel order. */
export const OPTIONAL_CONSENT_CATEGORIES = CONSENT_CATEGORIES.filter((c) => c.optional);

export type ConsentPreferences = Record<"analytics", boolean>;

export const DEFAULT_CONSENT_PREFERENCES: ConsentPreferences = { analytics: false };

/**
 * Collapse the panel's switches into the stored choice.
 *
 * A second optional category would make this a per-signal payload rather than a
 * single choice; today every optional collector is behind `analytics_storage`,
 * so the fold is exact rather than lossy.
 */
export function preferencesToChoice(preferences: ConsentPreferences): ConsentChoice {
  return preferences.analytics ? "granted" : "denied";
}

export function choiceToPreferences(choice: ConsentChoice): ConsentPreferences {
  return { analytics: choice === "granted" };
}

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

/**
 * Whether optional analytics may run for this visitor.
 *
 * Used by the recipient delivery page, which has two kinds of collection sitting
 * side by side and must not confuse them:
 *
 *   Essential. The link was opened, the terms were accepted, a file was
 *   downloaded. These are commercial evidence -- the photographer's record of
 *   what a buyer did with their work, and in the acceptance's case a record of
 *   an agreement. They are recorded whatever this returns.
 *
 *   Optional. How long the page was actually on screen, and which frames. This
 *   is engagement measurement. Useful, and not necessary to operate the
 *   delivery, so it is behind the same choice as everything else optional.
 *
 * The rule mirrors Consent Mode advanced, which is what the marketing site
 * already does: where a choice is required, nothing optional runs until the
 * visitor makes one; everywhere else it runs unless they turn it off. An
 * unknown country counts as requiring a choice, for the same reason
 * `shouldAskForConsent` treats it that way -- failing towards asking costs a
 * visitor one banner, and failing away from it collects something somebody
 * never agreed to.
 *
 * This is a mechanism, not a legal conclusion. Which jurisdictions require what,
 * and whether dwell time on a delivery page is caught by any of it, is a
 * question for review rather than one this function answers.
 */
export function mayCollectOptionalAnalytics(input: {
  choice: string | undefined;
  country: string | undefined;
}): boolean {
  if (input.choice === "granted") return true;
  if (input.choice === "denied") return false;
  // No stored choice: allowed only where one is not required.
  return !shouldAskForConsent(input.country);
}
