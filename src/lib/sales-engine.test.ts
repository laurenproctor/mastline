import { describe, expect, it } from "vitest";
import { add, money } from "./money";
import {
  SALES_ENGINE_PHOTOGRAPHER_RATE,
  SALES_ENGINE_PLATFORM_RATE,
  calculateSalesEngineRefund,
  calculateSalesEngineSplit,
  netSalesEngineSplits,
} from "./sales-engine";

describe("the split only applies to licenses generated inside Mastline", () => {
  it("takes no platform fee on an externally generated license", () => {
    const split = calculateSalesEngineSplit(money(100000), "external");
    expect(split.platform.minor).toBe(0);
    expect(split.photographer.minor).toBe(100000);
  });

  it("takes 30% on a Mastline-generated license", () => {
    const split = calculateSalesEngineSplit(money(100000), "mastline_sales_engine");
    expect(split.platform.minor).toBe(30000);
    expect(split.photographer.minor).toBe(70000);
  });

  it("uses rates that sum to the whole", () => {
    expect(SALES_ENGINE_PLATFORM_RATE + SALES_ENGINE_PHOTOGRAPHER_RATE).toBeCloseTo(1, 10);
  });
});

describe("rounding", () => {
  it("never loses or invents a minor unit", () => {
    for (let base = 0; base <= 2000; base += 1) {
      const split = calculateSalesEngineSplit(money(base), "mastline_sales_engine");
      expect(add(split.platform, split.photographer).minor).toBe(base);
    }
  });

  it("rounds a half minor unit toward Mastline", () => {
    // 5 x 0.30 = 1.5 -> 2 to the platform, 3 to the photographer.
    const split = calculateSalesEngineSplit(money(5), "mastline_sales_engine");
    expect(split.platform.minor).toBe(2);
    expect(split.photographer.minor).toBe(3);
  });

  it("handles a base of one minor unit", () => {
    const split = calculateSalesEngineSplit(money(1), "mastline_sales_engine");
    expect(split.platform.minor).toBe(0);
    expect(split.photographer.minor).toBe(1);
  });

  it("handles a zero base", () => {
    const split = calculateSalesEngineSplit(money(0), "mastline_sales_engine");
    expect(split.platform.minor).toBe(0);
    expect(split.photographer.minor).toBe(0);
  });

  it("keeps the photographer above 69.9% at realistic sale sizes", () => {
    for (const base of [5000, 64000, 84000, 121000, 140000]) {
      const split = calculateSalesEngineSplit(money(base), "mastline_sales_engine");
      expect(split.photographer.minor / base).toBeGreaterThan(0.699);
    }
  });
});

describe("refunds", () => {
  it("reverses a full refund exactly", () => {
    const original = calculateSalesEngineSplit(money(64000), "mastline_sales_engine");
    const reversal = calculateSalesEngineRefund(original, money(64000));
    expect(reversal.platform.minor).toBe(-original.platform.minor);
    expect(reversal.photographer.minor).toBe(-original.photographer.minor);
    expect(netSalesEngineSplits([original, reversal]).platform.minor).toBe(0);
    expect(netSalesEngineSplits([original, reversal]).photographer.minor).toBe(0);
  });

  it("reverses a full refund exactly even when the base rounds oddly", () => {
    for (const base of [1, 3, 5, 7, 333, 1005, 99999]) {
      const original = calculateSalesEngineSplit(money(base), "mastline_sales_engine");
      const reversal = calculateSalesEngineRefund(original, money(base));
      const net = netSalesEngineSplits([original, reversal]);
      expect(net.base.minor).toBe(0);
      expect(net.platform.minor).toBe(0);
      expect(net.photographer.minor).toBe(0);
    }
  });

  it("reverses a partial refund proportionally", () => {
    const original = calculateSalesEngineSplit(money(100000), "mastline_sales_engine");
    const reversal = calculateSalesEngineRefund(original, money(33300));
    expect(reversal.platform.minor).toBe(-9990);
    expect(reversal.photographer.minor).toBe(-23310);
  });

  it("leaves a partial refund netting to the split of the remaining base", () => {
    const original = calculateSalesEngineSplit(money(100000), "mastline_sales_engine");
    const reversal = calculateSalesEngineRefund(original, money(33300));
    const net = netSalesEngineSplits([original, reversal]);
    const direct = calculateSalesEngineSplit(money(100000 - 33300), "mastline_sales_engine");
    expect(net.platform.minor).toBe(direct.platform.minor);
    expect(net.photographer.minor).toBe(direct.photographer.minor);
  });

  it("takes back nothing on refund of an external license", () => {
    const original = calculateSalesEngineSplit(money(100000), "external");
    const reversal = calculateSalesEngineRefund(original, money(100000));
    expect(reversal.platform.minor).toBe(0);
    expect(reversal.photographer.minor).toBe(-100000);
  });

  it("rejects a refund larger than the base", () => {
    const original = calculateSalesEngineSplit(money(1000), "mastline_sales_engine");
    expect(() => calculateSalesEngineRefund(original, money(1001))).toThrow(RangeError);
  });

  it("rejects a negative refund amount", () => {
    const original = calculateSalesEngineSplit(money(1000), "mastline_sales_engine");
    expect(() => calculateSalesEngineRefund(original, money(-100))).toThrow(RangeError);
  });

  it("never edits the original split", () => {
    const original = calculateSalesEngineSplit(money(64000), "mastline_sales_engine");
    const snapshot = { ...original };
    calculateSalesEngineRefund(original, money(32000));
    expect(original).toEqual(snapshot);
  });
});

describe("netting", () => {
  it("requires at least one split", () => {
    expect(() => netSalesEngineSplits([])).toThrow(RangeError);
  });

  it("nets a sale against two partial refunds", () => {
    const original = calculateSalesEngineSplit(money(90000), "mastline_sales_engine");
    const first = calculateSalesEngineRefund(original, money(20000));
    const second = calculateSalesEngineRefund(original, money(10000));
    const net = netSalesEngineSplits([original, first, second]);
    expect(net.base.minor).toBe(60000);
    expect(add(net.platform, net.photographer).minor).toBe(60000);
  });
});
