/**
 * Mastline Sales Engine revenue share.
 *
 * The photographer receives 70% and Mastline receives 30%, and the share
 * applies ONLY to a license that Mastline itself generated. A license the
 * photographer sold through an agency or direct relationship carries no
 * platform fee, regardless of where the money is recorded.
 *
 * Rounding rule (founder ruling, 2026-08-21): the platform share is
 * round-half-away-from-zero of `base x 0.30` and the photographer receives the
 * exact remainder, so the two always reconstitute the base with no lost or
 * invented minor unit. Refunds reverse proportionally as separate signed
 * records; an original split is never edited in place.
 *
 * Open decision: WHEN the share is earned (checkout completed, funds cleared,
 * refund window passed, or payout made) is unresolved -- see
 * `docs/DECISIONS.md` item 3. This module computes the amounts only; it makes
 * no claim about when they become payable.
 */

import { type Money, applyRate, money, subtract } from "./money";

/** Where a license came from. Only the first value can carry a platform fee. */
export type LicenseOrigin = "mastline_sales_engine" | "external";

export const SALES_ENGINE_PLATFORM_RATE = 0.3;
export const SALES_ENGINE_PHOTOGRAPHER_RATE = 0.7;

export interface SalesEngineSplit {
  /** The contractually defined sale base the split was computed from. */
  readonly base: Money;
  /** Mastline's share. Always zero for an externally generated license. */
  readonly platform: Money;
  /** The photographer's share. Always the exact remainder of the base. */
  readonly photographer: Money;
  readonly origin: LicenseOrigin;
}

/**
 * Split a sale base between the photographer and Mastline.
 *
 * `base` must be the contractual sale base captured at the time of sale, not a
 * figure derived from displayed net revenue.
 */
export function calculateSalesEngineSplit(base: Money, origin: LicenseOrigin): SalesEngineSplit {
  if (origin !== "mastline_sales_engine") {
    return { base, platform: money(0, base.currency), photographer: base, origin };
  }
  const platform = applyRate(base, SALES_ENGINE_PLATFORM_RATE);
  return { base, platform, photographer: subtract(base, platform), origin };
}

/**
 * Reverse part or all of a previously computed split.
 *
 * `refundBase` is the positive amount being refunded. The result is a signed
 * reversal: both shares come back negative, proportional to the refunded base
 * under the same rounding rule. Because rounding is symmetric about zero, a
 * full refund reverses the original split exactly.
 *
 * The caller stores this as a new record. The original split is immutable.
 */
export function calculateSalesEngineRefund(
  original: SalesEngineSplit,
  refundBase: Money,
): SalesEngineSplit {
  if (refundBase.minor < 0) {
    throw new RangeError("refundBase must be positive; the reversal sign is applied for you.");
  }
  if (refundBase.minor > original.base.minor) {
    throw new RangeError(
      `Cannot refund ${refundBase.minor} against a base of ${original.base.minor}.`,
    );
  }
  const negatedBase = money(-refundBase.minor, refundBase.currency);
  return calculateSalesEngineSplit(negatedBase, original.origin);
}

/** Net a split against its reversals. Used to show a current position. */
export function netSalesEngineSplits(splits: readonly SalesEngineSplit[]): SalesEngineSplit {
  if (splits.length === 0) {
    throw new RangeError("netSalesEngineSplits requires at least one split.");
  }
  const [first] = splits;
  return splits.slice(1).reduce<SalesEngineSplit>(
    (net, split) => ({
      base: subtract(net.base, money(-split.base.minor, split.base.currency)),
      platform: subtract(net.platform, money(-split.platform.minor, split.platform.currency)),
      photographer: subtract(
        net.photographer,
        money(-split.photographer.minor, split.photographer.currency),
      ),
      origin: net.origin,
    }),
    first,
  );
}
