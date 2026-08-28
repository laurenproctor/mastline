import type { OpportunityKind, OpportunitySignal, OpportunityStatus } from "./domain";
import type { Tone } from "@/components/primitives";

/**
 * The News Radar's two modes, and how the interface talks about them.
 *
 * The radar does two jobs with one record: connect a current story to work the
 * workspace already owns (archive match), and surface a story or scheduled
 * event that may justify a new shoot (shoot opportunity). The selected mode is
 * URL-addressable -- `?mode=archive` and `?mode=shoot` -- so a mode can be
 * linked, bookmarked, and restored, and the two-tab rule holds: the URL, not
 * any cookie or client state, says what the page shows.
 *
 * This module is deliberately free of server imports so the labels and the
 * mode parser can be shared by pages, client components, and unit tests.
 */

export const NEWS_MODES = ["archive", "shoot"] as const;
export type NewsMode = (typeof NEWS_MODES)[number];

/**
 * The mode a query parameter names.
 *
 * Anything that is not exactly "shoot" -- absent, misspelt, or hostile -- is
 * the archive mode. A query parameter is browser input; it selects between two
 * known views and can do nothing else.
 */
export function parseNewsMode(value: string | string[] | undefined): NewsMode {
  return value === "shoot" ? "shoot" : "archive";
}

export const KIND_FOR_MODE: Record<NewsMode, OpportunityKind> = {
  archive: "archive_match",
  shoot: "shoot_opportunity",
};

export const MODE_FOR_KIND: Record<OpportunityKind, NewsMode> = {
  archive_match: "archive",
  shoot_opportunity: "shoot",
};

export const KIND_LABELS: Record<OpportunityKind, string> = {
  archive_match: "Archive match",
  shoot_opportunity: "Shoot opportunity",
};

/** The two jobs, said plainly. Shown on the mode control and empty states. */
export const MODE_DESCRIPTIONS: Record<NewsMode, string> = {
  archive: "Current stories your existing photographs can serve",
  shoot: "Current stories and scheduled events worth a new shoot",
};

export const SIGNAL_TONES: Record<OpportunitySignal, Tone> = {
  rising: "warn",
  high: "danger",
  steady: "blue",
  watch: "neutral",
};

export const STATUS_TONES: Record<OpportunityStatus, Tone> = {
  new: "blue",
  watching: "warn",
  pitching: "blue",
  acted: "good",
  dismissed: "neutral",
  expired: "neutral",
};

/**
 * The useful window, as a person reads it.
 *
 * `closed` is derived from the clock rather than stored: expiry is a fact
 * about time, not a decision anyone made, and a stored copy would go stale the
 * moment it was written.
 */
export function usefulWindow(
  closesAt: string | undefined,
  now: Date,
): { readonly text: string; readonly urgent: boolean; readonly closed: boolean } {
  if (!closesAt) return { text: "No window set", urgent: false, closed: false };
  const minutes = Math.round((new Date(closesAt).getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return { text: "Window closed", urgent: false, closed: true };
  if (minutes < 60) return { text: `${minutes} min left`, urgent: true, closed: false };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return {
      text: rest === 0 ? `${hours} hr left` : `${hours} hr ${rest} min left`,
      urgent: hours <= 3,
      closed: false,
    };
  }
  const days = Math.round(hours / 24);
  return { text: `${days} day${days === 1 ? "" : "s"} left`, urgent: false, closed: false };
}
