import { describe, expect, it } from "vitest";
import {
  RECOVERY_CODE_COUNT,
  formatRecoveryCode,
  normalizeRecoveryCode,
  remainingLabel,
} from "./recovery-codes";
import {
  hashRecoveryCode,
  newRecoveryCode,
  newRecoveryCodes,
  recoveryCodeMatches,
} from "./recovery-codes.server";

describe("newRecoveryCode", () => {
  it("does not repeat itself", () => {
    const codes = new Set(Array.from({ length: 2000 }, newRecoveryCode));
    expect(codes.size).toBe(2000);
  });

  it("uses no character that can be misread as another", () => {
    // No I, L, O or U: nothing to confuse with 1, 0, or V when read off a
    // screen and typed by hand, and no accidental words.
    for (let attempt = 0; attempt < 500; attempt += 1) {
      expect(newRecoveryCode()).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/);
    }
  });

  it("makes a full set", () => {
    expect(newRecoveryCodes()).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(newRecoveryCodes()).size).toBe(RECOVERY_CODE_COUNT);
  });
});

describe("normalizeRecoveryCode", () => {
  it("accepts a code exactly as shown", () => {
    const code = newRecoveryCode();
    expect(normalizeRecoveryCode(formatRecoveryCode(code))).toBe(code);
  });

  it("accepts how people actually type it", () => {
    expect(normalizeRecoveryCode("abcde-fghjk")).toBe("ABCDEFGHJK");
    expect(normalizeRecoveryCode("  ABCDE FGHJK  ")).toBe("ABCDEFGHJK");
  });

  it("forgives the confusions the alphabet was chosen to avoid", () => {
    // Someone reading a 0 as an O, or a 1 as an I or l, still gets in.
    expect(normalizeRecoveryCode("O1234-5678I")).toBe("01234-56781".replace("-", ""));
    expect(normalizeRecoveryCode("l1234-56789")).toBe("1123456789");
    expect(normalizeRecoveryCode("U2345-67890")).toBe("V234567890");
  });

  it("refuses anything that is not a code", () => {
    for (const bad of ["", "ABCDE", "ABCDEFGHJKL", "ABCDE-FGHJ!", "!!!!!!!!!!"]) {
      expect(normalizeRecoveryCode(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("hashing", () => {
  it("never stores the code itself", async () => {
    const code = newRecoveryCode();
    const stored = await hashRecoveryCode(code);
    expect(stored.hash).not.toContain(code);
    expect(stored.salt).not.toContain(code);
    expect(stored.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("salts each code separately, so two identical codes do not look alike", async () => {
    const first = await hashRecoveryCode("ABCDEFGHJK");
    const second = await hashRecoveryCode("ABCDEFGHJK");
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it("recognises the right code and refuses the wrong one", async () => {
    const code = newRecoveryCode();
    const stored = await hashRecoveryCode(code);
    expect(await recoveryCodeMatches(code, stored)).toBe(true);
    expect(await recoveryCodeMatches(newRecoveryCode(), stored)).toBe(false);
  });

  it("refuses a code that is only nearly right", async () => {
    const stored = await hashRecoveryCode("ABCDEFGHJK");
    expect(await recoveryCodeMatches("ABCDEFGHJM", stored)).toBe(false);
    expect(await recoveryCodeMatches("ABCDEFGHJ", stored)).toBe(false);
  });
});

describe("remainingLabel", () => {
  it("counts down", () => {
    expect(remainingLabel(10)).toBe("10 of 10 recovery codes left");
    expect(remainingLabel(1)).toBe("1 of 10 recovery code left");
  });

  it("says plainly when there are none", () => {
    expect(remainingLabel(0)).toBe("No recovery codes left");
  });
});
