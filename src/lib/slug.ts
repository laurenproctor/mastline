/**
 * Workspace addresses: the rules a slug has to satisfy before it can be one.
 *
 * A slug sits at the root of the site -- mastline.co/laurenproctor -- so it
 * shares a namespace with every marketing page and every application section.
 * That is why the reserved list is long and why it is duplicated in the
 * database: this copy gives somebody a straight answer while they type, and the
 * database's copy is what actually decides. A test compares the two, because
 * the failure mode of them drifting is a route added next year that quietly
 * becomes unreachable for whoever took its name first.
 */

/** Matches organizations.slug's check constraint and slugifyWorkspace's cap. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 40;

/**
 * Addresses no workspace may take.
 *
 * Kept in the same order and spelling as private.reserved_slugs() so the two
 * can be compared as sets without either side needing to be sorted first.
 */
export const RESERVED_SLUGS: readonly string[] = [
  // Marketing
  "acceptable-use",
  "accessibility",
  "commercial",
  "company",
  "copyright",
  "early-access",
  "editors",
  "how-it-works",
  "press",
  "pricing",
  "privacy",
  "product",
  "security",
  "subjects",
  "teams",
  "terms",
  "trust",
  "welcome",
  // Application
  "api",
  "archive",
  "assets",
  "auth",
  "billing",
  "d",
  "dispatch",
  "money",
  "news",
  "onboarding",
  "rights",
  "secure-your-account",
  "settings",
  "shoots",
  "submissions",
  "work",
  "workspace",
  // Auth screens and their redirects
  "login",
  "reset-password",
  "sign-in",
  "sign-up",
  "signup",
  // Reserved for the site itself
  "about",
  "admin",
  "app",
  "blog",
  "cdn",
  "contact",
  "docs",
  "help",
  "mail",
  "static",
  "status",
  "support",
  "www",
];

const RESERVED = new Set(RESERVED_SLUGS);

export function isReservedSlug(candidate: string): boolean {
  return RESERVED.has(candidate);
}

export function isValidSlugFormat(candidate: string): boolean {
  return (
    candidate.length > 0 && candidate.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(candidate)
  );
}

/** Why a slug cannot be used, or null when it can. Advisory: the RPC decides. */
export type SlugProblem = "invalid" | "reserved";

export function slugProblem(candidate: string): SlugProblem | null {
  if (!isValidSlugFormat(candidate)) return "invalid";
  if (isReservedSlug(candidate)) return "reserved";
  return null;
}

/**
 * Every outcome rename_workspace_slug() can report.
 *
 * The database returns one of these rather than raising, so nothing here has to
 * read an error message to decide what to say. `taken` covers both "somebody
 * holds it" and "somebody held it once", because an address is never released
 * and the person typing does not need to know which of the two it was.
 */
export type RenameOutcome =
  | "renamed"
  | "unchanged"
  | "invalid"
  | "reserved"
  | "taken"
  | "rate_limited"
  | "not_found";

/** How many times a workspace may move in a rolling twelve months. */
export const RENAME_LIMIT_PER_YEAR = 3;
