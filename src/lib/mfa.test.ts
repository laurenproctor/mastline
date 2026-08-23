import { describe, expect, it } from "vitest";
import {
  ROLES_REQUIRING_MFA,
  formatSecretForTyping,
  mfaBlocksAccess,
  mfaStanding,
  normalizeTotpCode,
  otpauthUri,
  roleRequiresMfa,
} from "./mfa";
import { APP_ROLES } from "./domain";

describe("which roles are expected to hold a second factor", () => {
  it("names owner and finance", () => {
    // The two that can export the entire commercial record. /security says so.
    expect([...ROLES_REQUIRING_MFA].sort()).toEqual(["finance", "owner"]);
  });

  it("does not expect it of the roles that cannot take the record away", () => {
    for (const role of APP_ROLES) {
      if (role === "owner" || role === "finance") continue;
      expect(roleRequiresMfa(role), role).toBe(false);
    }
  });
});

describe("mfaStanding", () => {
  it("is protected once a factor is verified, whatever the role or policy", () => {
    for (const role of APP_ROLES) {
      expect(mfaStanding({ role, hasVerifiedFactor: true, enforced: false })).toBe("protected");
      expect(mfaStanding({ role, hasVerifiedFactor: true, enforced: true })).toBe("protected");
    }
  });

  it("only requires it when the workspace has asked for it", () => {
    // Turning the policy on locks out an owner who has not enrolled, so the
    // role alone must never be enough to demand it.
    expect(mfaStanding({ role: "owner", hasVerifiedFactor: false, enforced: false })).toBe(
      "available",
    );
    expect(mfaStanding({ role: "owner", hasVerifiedFactor: false, enforced: true })).toBe(
      "required",
    );
  });

  it("does not require it of a role outside the policy, even when enforced", () => {
    expect(mfaStanding({ role: "editor", hasVerifiedFactor: false, enforced: true })).toBe(
      "available",
    );
  });

  it("blocks access only when it is actually required", () => {
    expect(mfaBlocksAccess("required")).toBe(true);
    expect(mfaBlocksAccess("available")).toBe(false);
    expect(mfaBlocksAccess("protected")).toBe(false);
  });
});

describe("normalizeTotpCode", () => {
  it("accepts six digits", () => {
    expect(normalizeTotpCode("123456")).toBe("123456");
  });

  it("accepts the way authenticator apps actually show a code", () => {
    // Two groups of three, and people paste the space with it.
    expect(normalizeTotpCode("123 456")).toBe("123456");
    expect(normalizeTotpCode(" 123-456 ")).toBe("123456");
  });

  it("refuses anything that is not six digits", () => {
    for (const bad of ["", "12345", "1234567", "12345a", "abcdef", "12 34 5"]) {
      expect(normalizeTotpCode(bad), bad).toBeNull();
    }
  });
});

describe("otpauthUri", () => {
  it("names the issuer and the account so the app labels it usefully", () => {
    const uri = otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "marcus@mastline.test" });
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(decodeURIComponent(uri)).toContain("Mastline:marcus@mastline.test");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=Mastline");
  });

  it("states the parameters rather than leaving them to the app's defaults", () => {
    const uri = otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "a@b.c" });
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });

  it("escapes an address that would otherwise break the label", () => {
    const uri = otpauthUri({ secret: "S", account: "first last@x.io", issuer: "Mast/line" });
    expect(uri).not.toContain(" ");
    expect(decodeURIComponent(uri)).toContain("Mast/line:first last@x.io");
  });
});

describe("formatSecretForTyping", () => {
  it("groups the key so it can be typed without losing your place", () => {
    expect(formatSecretForTyping("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });

  it("leaves a short key alone", () => {
    expect(formatSecretForTyping("ABC")).toBe("ABC");
  });
});
