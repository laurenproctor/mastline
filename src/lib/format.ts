/**
 * Display formatting.
 *
 * Timestamps are stored in UTC and rendered in the workspace timezone. The
 * workspace timezone is passed in rather than read from the browser so that a
 * server-rendered page and a client-rendered one agree.
 */

const DEFAULT_TIMEZONE = "America/New_York";

export function formatDate(
  iso: string,
  options: { timeZone?: string; withYear?: boolean } = {},
): string {
  const { timeZone = DEFAULT_TIMEZONE, withYear = false } = options;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone,
  }).format(new Date(iso));
}

export function formatLongDate(iso: string, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(new Date(iso));
}

/** The dateline form, with the year: "Friday, August 28, 2026". */
export function formatFullDate(iso: string, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone = DEFAULT_TIMEZONE): string {
  return `${formatDate(iso, { timeZone })} · ${formatTime(iso, timeZone)}`;
}

/**
 * A short elapsed-time label, e.g. "42 min", "2 hr", "Yesterday".
 *
 * `now` is passed explicitly so the demo dataset renders deterministically and
 * tests do not depend on the wall clock.
 */
export function formatElapsed(iso: string, now: Date): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days`;
  return formatDate(iso);
}

/** Turn a snake_case status into sentence case for display. */
export function humanizeStatus(status: string): string {
  const text = status.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Render a confidence as a whole percentage, always alongside its basis. */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
