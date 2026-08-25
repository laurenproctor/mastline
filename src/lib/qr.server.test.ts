import { describe, expect, it } from "vitest";
import { otpauthUri } from "./mfa";
import { qrCode } from "./qr.server";

/**
 * The QR is the part of enrolment a camera reads, so what matters is that it is
 * a real code of the right shape rather than that it looks like one.
 */
describe("qrCode", () => {
  it("encodes at a version whose size is 21 + 4n", async () => {
    const { size } = await qrCode(
      otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "marcus@mastline.test" }),
    );
    // Version 1 is 21 modules a side and each version adds 4. An otpauth URI of
    // this length lands at version 5 or 6 at error correction level M.
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 21) % 4).toBe(0);
  });

  it("draws the finder pattern in the top-left corner", async () => {
    // Every QR starts with a 7x7 finder: a full run of 7 on the first row.
    const { path } = await qrCode("otpauth://totp/Mastline:a@b.c?secret=JBSWY3DPEHPK3PXP");
    expect(path.startsWith("M0 0h7v1h-7z")).toBe(true);
  });

  it("merges adjacent modules into one rectangle instead of one each", async () => {
    const { path, size } = await qrCode("otpauth://totp/Mastline:a@b.c?secret=JBSWY3DPEHPK3PXP");
    const runs = path.match(/h(\d+)v1/g) ?? [];
    expect(runs.some((run) => run !== "h1v1")).toBe(true);
    // A path of one rectangle per module would be far longer than this.
    expect(runs.length).toBeLessThan(size * size);
  });

  it("gives different secrets different codes", async () => {
    const a = await qrCode(otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "a@b.c" }));
    const b = await qrCode(otpauthUri({ secret: "KRSXG5CTMVRXEZLU", account: "a@b.c" }));
    expect(a.path).not.toBe(b.path);
  });

  it("refuses text it cannot encode rather than returning an empty code", async () => {
    await expect(qrCode("")).rejects.toThrow();
  });
});
