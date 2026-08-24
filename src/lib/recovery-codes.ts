/**
 * Recovery codes for two-factor authentication.
 *
 * A code is what a photographer has when the phone is gone. Supabase has no
 * notion of them, and none of this can raise a session to aal2 -- only a real
 * TOTP verification does that -- so a code does the honest thing instead: it
 * proves who is asking, the factor comes off, and they sign in and enrol again.
 *
 * Stored as a hash with a salt of its own, exactly as a password would be. The
 * plaintext exists for the moment it is shown and never again, which is why the
 * screen that shows it says so.
 *
 * This half is free of node:crypto on purpose: the settings panel is a client
 * component, and importing the generator there would pull the whole of
 * node:crypto into a browser bundle. Making and checking a code lives in
 * recovery-codes.server.ts.
 */

/** Ten is enough to lose a few and still get in. */
export const RECOVERY_CODE_COUNT = 10;

/**
 * Crockford base32 without I, L, O, or U: no character can be confused with
 * another when read off a screen and typed by hand, and no accidental words.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 10 characters of that alphabet is 50 bits. */
const CODE_LENGTH = 10;

/** Shown in two halves, which is easier to read across and to type. */
export function formatRecoveryCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * What was typed, as it is stored.
 *
 * People paste the hyphen, use lower case, and add spaces. None of that is a
 * different code. The digit-letter confusions the alphabet already avoids are
 * folded in as well, so someone reading a 0 as an O still gets in.
 */
export function normalizeRecoveryCode(raw: string): string | null {
  const cleaned = raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V");
  return new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(cleaned) ? cleaned : null;
}

/** How many are left, for a line that says so without listing them. */
export function remainingLabel(unused: number): string {
  if (unused === 0) return "No recovery codes left";
  return `${unused} of ${RECOVERY_CODE_COUNT} recovery ${unused === 1 ? "code" : "codes"} left`;
}

/** Exported for the generator, which lives in recovery-codes.server.ts. */
export const RECOVERY_ALPHABET = ALPHABET;
export const RECOVERY_CODE_LENGTH = CODE_LENGTH;
