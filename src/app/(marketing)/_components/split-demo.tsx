"use client";

import { useMemo, useState } from "react";
import { type Money, formatMoney, fromMajor, money } from "@/lib/money";
import { type LicenseOrigin, calculateSalesEngineSplit } from "@/lib/sales-engine";

/**
 * One night's sale, divided the way the crew agreed.
 *
 * The Teams page promises splits that settle themselves rather than being
 * argued out, and then asked the reader to take that on trust. This is the
 * same arithmetic with the handle left on: move the sale, move the shares, and
 * watch four payouts and the platform's cut resolve.
 *
 * The 70/30 comes from `calculateSalesEngineSplit`, the module a real sale is
 * split by, for the same reason the pricing calculator reads its rates from
 * there: an illustration that computes its own version of the split will
 * eventually disagree with what a photographer is actually paid.
 *
 * The origin toggle is the load-bearing part, not decoration. Nothing is taken
 * from a sale the crew made themselves, and the page says so; being able to
 * flip between the two and see the platform line go to zero is the clearest
 * way to say it.
 */

interface Member {
  role: string;
  note: string;
  /** Share of the crew's take, in points. Not required to total 100. */
  share: number;
}

const CREW: readonly Member[] = [
  { role: "Lead", note: "Created the shoot, worked the front door", share: 40 },
  { role: "Shooter A", note: "Side entrance", share: 25 },
  { role: "Shooter B", note: "Valet", share: 25 },
  { role: "House", note: "The agency's own share", share: 10 },
];

const MIN = 250;
const MAX = 10000;
const STEP = 50;

/**
 * Divide an amount by share, in minor units, so the parts add back up to
 * exactly what was divided.
 *
 * Straight rounding of each share loses or invents a cent on most inputs,
 * which on a page about splits being settled rather than argued is precisely
 * the wrong detail to get wrong. The remainder goes to the largest fractions
 * first, and any residue to the largest share, which is the same
 * largest-remainder rule the ledger uses.
 */
function allocate(amount: Money, shares: readonly number[]): Money[] {
  const total = shares.reduce((a, b) => a + b, 0);
  if (total <= 0) return shares.map(() => money(0, amount.currency));

  const exact = shares.map((share) => (amount.minor * share) / total);
  const floors = exact.map(Math.floor);
  let residue = amount.minor - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  const out = [...floors];
  for (let i = 0; residue > 0; i += 1, residue -= 1) {
    out[order[i % order.length].index] += 1;
  }
  return out.map((minor) => money(minor, amount.currency));
}

export function SplitDemo() {
  const [sale, setSale] = useState(1800);
  const [origin, setOrigin] = useState<LicenseOrigin>("mastline_sales_engine");
  const [shares, setShares] = useState(CREW.map((member) => member.share));

  const totalShare = shares.reduce((a, b) => a + b, 0);

  const { split, payouts } = useMemo(() => {
    const base = fromMajor(sale);
    const engine = calculateSalesEngineSplit(base, origin);
    return { split: engine, payouts: allocate(engine.photographer, shares) };
  }, [sale, origin, shares]);

  const setShare = (index: number, value: number) =>
    setShares((was) => was.map((share, i) => (i === index ? value : share)));

  return (
    <div className="split">
      <div className="split-controls">
        <label className="split-amount">
          <span className="mk-eyebrow">The sale</span>
          <output>{formatMoney(fromMajor(sale))}</output>
          <input
            aria-label="License value"
            max={MAX}
            min={MIN}
            onChange={(event) => setSale(Number(event.target.value))}
            step={STEP}
            type="range"
            value={sale}
          />
        </label>

        <div aria-label="Where the sale came from" className="split-origin" role="group">
          <button
            aria-pressed={origin === "external"}
            className={origin === "external" ? "on" : ""}
            onClick={() => setOrigin("external")}
            type="button"
          >
            The crew sold it
            <small>No commission</small>
          </button>
          <button
            aria-pressed={origin === "mastline_sales_engine"}
            className={origin === "mastline_sales_engine" ? "on" : ""}
            onClick={() => setOrigin("mastline_sales_engine")}
            type="button"
          >
            Mastline sold it
            <small>30% to Mastline</small>
          </button>
        </div>
      </div>

      <div className="split-ledger">
        <div className="split-row split-head">
          <span>{origin === "external" ? "The crew keeps" : "To the crew after the 30%"}</span>
          <b>{formatMoney(split.photographer)}</b>
        </div>

        {CREW.map((member, index) => (
          <div className="split-row" key={member.role}>
            <span>
              <b>{member.role}</b>
              <small>{member.note}</small>
              <label>
                <input
                  aria-label={`${member.role} share`}
                  max={80}
                  min={0}
                  onChange={(event) => setShare(index, Number(event.target.value))}
                  step={5}
                  type="range"
                  value={shares[index]}
                />
                <em>
                  {totalShare === 0 ? "0" : Math.round((shares[index] / totalShare) * 100)}
                  <i>%</i>
                </em>
              </label>
            </span>
            <b className="split-pay">{formatMoney(payouts[index])}</b>
          </div>
        ))}

        <div className="split-row split-foot">
          <span>Mastline</span>
          <b>{formatMoney(split.platform)}</b>
        </div>
      </div>

      <p className="split-note">
        Set once per person, per shoot, or per deal. Every line stays attached to the picture that
        earned it, so an archive resale years later pays the shooter who took it.
      </p>
    </div>
  );
}
