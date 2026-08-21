/**
 * The workspace timezone.
 *
 * Timestamps are stored in UTC and rendered in the workspace zone, so this list
 * is a display setting rather than a data one: changing it re-renders history,
 * it never rewrites it.
 *
 * Deliberately a short list of the zones a working photographer is likely to
 * want, not the full IANA database. A selector with six hundred entries is
 * worse than one with ten, and `docs/DECISIONS.md` has no requirement for
 * exhaustive coverage. Add entries when a real user needs one.
 */
export const WORKSPACE_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
] as const;

export type WorkspaceTimezone = (typeof WORKSPACE_TIMEZONES)[number];

export const DEFAULT_TIMEZONE: WorkspaceTimezone = "America/New_York";

/**
 * A form can post anything, so the server decides what counts as a zone.
 */
export function isSupportedTimezone(value: string): value is WorkspaceTimezone {
  return (WORKSPACE_TIMEZONES as readonly string[]).includes(value);
}

/** "America/New_York" reads better as "America/New York" in a menu. */
export function formatTimezone(zone: string): string {
  return zone.replace(/_/g, " ");
}

/**
 * The database allows 1 to 120 characters; this mirrors that so a person gets
 * a sentence back instead of a constraint violation.
 */
export const WORKSPACE_NAME_MAX = 120;

export function parseWorkspaceName(raw: string): { name: string } | { error: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name === "") return { error: "A workspace needs a name." };
  if (name.length > WORKSPACE_NAME_MAX) {
    return { error: `A workspace name cannot be longer than ${WORKSPACE_NAME_MAX} characters.` };
  }
  return { name };
}
