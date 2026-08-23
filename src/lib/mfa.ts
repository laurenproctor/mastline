import type { AppRole } from "./domain";

/**
 * Two-factor authentication policy.
 *
 * The product holds unpublished frames, confidential source notes, buyer
 * relationships, and money. A stolen password should not be enough to reach any
 * of it, which is why this exists at all.
 *
 * The rules live here rather than in a screen so the same answer is given by
 * the settings panel, the sign-in challenge, and the tests.
 */

/**
 * Roles for which a second factor is expected.
 *
 * An owner can change the plan, invite people, and export the entire commercial
 * record. Finance can read every payment and export it. Those two carry the most
 * damage if a password leaks, and `/security` says so in as many words.
 */
export const ROLES_REQUIRING_MFA: readonly AppRole[] = ["owner", "finance"];

export function roleRequiresMfa(role: AppRole): boolean {
  return ROLES_REQUIRING_MFA.includes(role);
}

export type MfaStanding =
  /** A verified factor is enrolled. Nothing to do. */
  | "protected"
  /** The role expects a factor and there is none. */
  | "required"
  /** Any role may enrol; this one is not obliged to. */
  | "available";

/**
 * What to tell someone about their own account.
 *
 * `enforced` is the workspace's own switch. It is deliberately separate from
 * the role rule: turning it on locks out an owner who has not enrolled yet, so
 * it is a decision a workspace makes rather than something that happens to it.
 */
export function mfaStanding(input: {
  role: AppRole;
  hasVerifiedFactor: boolean;
  enforced: boolean;
}): MfaStanding {
  if (input.hasVerifiedFactor) return "protected";
  if (input.enforced && roleRequiresMfa(input.role)) return "required";
  return "available";
}

/** Whether this person may still use the workspace as things stand. */
export function mfaBlocksAccess(standing: MfaStanding): boolean {
  return standing === "required";
}

/**
 * A six-digit code, as typed.
 *
 * Authenticator apps display codes in two groups of three, and people paste
 * them with the space still in. Rejecting that would be a rejection of how the
 * code is shown rather than of the code.
 */
export function normalizeTotpCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/**
 * The `otpauth://` URI an authenticator app reads.
 *
 * Supabase returns one already; this exists so the label and issuer can be
 * checked, and so a QR can be generated from a known-good string when the
 * provider's own is absent.
 */
export function otpauthUri(input: {
  secret: string;
  account: string;
  issuer?: string;
}): string {
  const issuer = input.issuer ?? "Mastline";
  const label = encodeURIComponent(`${issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * The shared secret, in groups a person can read aloud or type without losing
 * their place. Authenticator apps ignore the spaces.
 */
export function formatSecretForTyping(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(" ");
}
