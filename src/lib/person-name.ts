/**
 * A person's name, as two fields.
 *
 * Collected as first and last rather than as one box, so the parts are known
 * rather than guessed at. A single field forces a split later, and splitting on
 * whitespace gets "Ana Maria" and "van der Berg" wrong in opposite directions.
 *
 * Both parts are optional at sign-up. Someone creating an account at two in the
 * morning to get a set of frames out should not be stopped by a form asking who
 * they are; the display falls back to the address until they say.
 */

/** Long enough for anyone; short enough to keep a stray paste out of the row. */
export const NAME_PART_MAX = 60;

export interface PersonName {
  readonly firstName: string;
  readonly lastName: string;
}

export type PersonNameResult = { readonly name: PersonName } | { readonly error: string };

/**
 * Normalise a single part.
 *
 * Collapses runs of whitespace but keeps everything else: hyphens, apostrophes,
 * accents, and non-Latin scripts are all parts of names, and stripping them
 * would be a statement about whose names count.
 */
function normalizePart(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function parsePersonName(firstRaw: string, lastRaw: string): PersonNameResult {
  const firstName = normalizePart(firstRaw);
  const lastName = normalizePart(lastRaw);

  for (const [label, value] of [
    ["First name", firstName],
    ["Last name", lastName],
  ] as const) {
    if (value.length > NAME_PART_MAX) {
      return { error: `${label} cannot be longer than ${NAME_PART_MAX} characters.` };
    }
  }

  return { name: { firstName, lastName } };
}

/** How the name reads in a sentence. Empty when neither part was given. */
export function fullNameFrom(name: PersonName): string {
  return [name.firstName, name.lastName].filter(Boolean).join(" ");
}

/**
 * What to show for someone, in order of what is actually known.
 *
 * The address before the domain is a poor name, but it is theirs, and it beats
 * a row that says "Member".
 */
export function displayNameFrom(input: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
}): string {
  const parts = parsePersonName(input.firstName ?? "", input.lastName ?? "");
  if ("name" in parts) {
    const full = fullNameFrom(parts.name);
    if (full) return full;
  }
  const legacy = (input.fullName ?? "").trim();
  if (legacy) return legacy;
  return (input.email ?? "").split("@")[0] || "Member";
}

/**
 * Two letters for an avatar.
 *
 * With both parts known this is first-initial plus last-initial, which is what
 * a person expects to see. Without them it falls back to splitting whatever
 * there is, which is the guess this module exists to avoid making twice.
 */
export function initialsFrom(input: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
}): string {
  const first = normalizePart(input.firstName ?? "");
  const last = normalizePart(input.lastName ?? "");
  if (first && last) return (first[0] + last[0]).toUpperCase();

  // Only the part before the @ : the domain is the company's name, not theirs,
  // so "marcus@mastline.test" is MA rather than MM.
  const source =
    first || last || (input.fullName ?? "").trim() || (input.email ?? "").split("@")[0] || "";
  const words = source.split(/[\s._-]+/).filter(Boolean);

  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  // One word gives two letters rather than one, because a single initial in an
  // avatar reads as a mistake.
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return displayNameFrom(input).slice(0, 2).toUpperCase();
}
