import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { RECOVERY_ALPHABET, RECOVERY_CODE_COUNT, RECOVERY_CODE_LENGTH } from "./recovery-codes";

/**
 * Making and checking recovery codes.
 *
 * Separated from the rest because it needs node:crypto, and the settings panel
 * that formats a code is a client component. Nothing here may be imported from
 * the browser.
 */

const scryptAsync = promisify(scrypt);

export function newRecoveryCode(): string {
  let code = "";
  for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
    code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  }
  return code;
}

export function newRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, newRecoveryCode);
}

export interface HashedRecoveryCode {
  readonly hash: string;
  readonly salt: string;
}

export async function hashRecoveryCode(code: string, salt?: string): Promise<HashedRecoveryCode> {
  const useSalt = salt ?? randomBytes(16).toString("hex");
  const derived = (await scryptAsync(code, useSalt, 32)) as Buffer;
  return { hash: derived.toString("hex"), salt: useSalt };
}

/**
 * Constant-time comparison, so the time taken says nothing about how much of a
 * code was right.
 */
export async function recoveryCodeMatches(
  code: string,
  stored: HashedRecoveryCode,
): Promise<boolean> {
  const { hash } = await hashRecoveryCode(code, stored.salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(stored.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
