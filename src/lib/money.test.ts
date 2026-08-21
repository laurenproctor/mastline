import { describe, expect, it } from "vitest";
import {
  CurrencyMismatchError,
  add,
  applyRate,
  formatMoney,
  formatMoneyRange,
  fromMajor,
  money,
  negate,
  roundHalfUp,
  subtract,
  sum,
  zero,
} from "./money";

describe("money construction", () => {
  it("rejects fractional minor units", () => {
    expect(() => money(10.5)).toThrow(TypeError);
  });

  it("rejects values beyond the safe integer range", () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 2)).toThrow();
  });

  it("accepts negative amounts so reversals are representable", () => {
    expect(money(-2500).minor).toBe(-2500);
  });

  it("converts major units without floating point drift", () => {
    expect(fromMajor(49).minor).toBe(4900);
    expect(fromMajor(1188).minor).toBe(118800);
    expect(fromMajor(0.07).minor).toBe(7);
    expect(fromMajor(1234.56).minor).toBe(123456);
  });
});

describe("money arithmetic", () => {
  it("adds and subtracts in minor units", () => {
    expect(add(money(4900), money(100)).minor).toBe(5000);
    expect(subtract(money(4900), money(100)).minor).toBe(4800);
  });

  it("refuses to mix currencies", () => {
    expect(() => add(money(100, "USD"), money(100, "GBP"))).toThrow(CurrencyMismatchError);
  });

  it("sums an empty list to zero", () => {
    expect(sum([])).toEqual(zero());
  });

  it("negates symmetrically", () => {
    expect(negate(money(300)).minor).toBe(-300);
    expect(negate(negate(money(300))).minor).toBe(300);
  });
});

describe("roundHalfUp", () => {
  it("rounds halves away from zero", () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(2.5)).toBe(3);
  });

  it("is symmetric about zero so reversals cancel exactly", () => {
    for (const value of [0.5, 1.5, 2.5, 99.9, 300.5, 0.1]) {
      expect(roundHalfUp(-value)).toBe(-roundHalfUp(value));
    }
  });

  it("leaves integers untouched", () => {
    expect(roundHalfUp(300)).toBe(300);
    expect(roundHalfUp(-300)).toBe(-300);
  });
});

describe("applyRate", () => {
  it("returns an integer number of minor units", () => {
    expect(Number.isInteger(applyRate(money(333), 0.3).minor)).toBe(true);
  });

  it("rounds half away from zero", () => {
    expect(applyRate(money(5), 0.3).minor).toBe(2); // 1.5 -> 2
    expect(applyRate(money(-5), 0.3).minor).toBe(-2);
  });
});

describe("formatting", () => {
  it("hides cents for whole amounts", () => {
    expect(formatMoney(money(842000))).toBe("$8,420");
  });

  it("shows cents when the amount has a fractional part", () => {
    expect(formatMoney(money(842050))).toBe("$8,420.50");
  });

  it("shows cents on request", () => {
    expect(formatMoney(money(4900), { showCents: true })).toBe("$49.00");
  });

  it("renders negative amounts with a leading minus", () => {
    expect(formatMoney(money(-84000))).toBe("-$840");
  });

  it("renders ranges with an en dash", () => {
    expect(formatMoneyRange(money(90000), money(140000))).toBe("$900–$1,400");
  });
});
