import type { Metadata } from "next";
import Link from "next/link";
import { SplitCalculator } from "../_components/behaviors";
import { Plans } from "../_components/plans";

export const metadata: Metadata = { title: "Pricing" };

export default function Page() {
  return (
    <>
      <SplitCalculator />
      <section className="pagehead pr-hero">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / Pricing
          </div>
          <div className="pr-hero-grid">
            <h1>
              Run the business.
              <br />
              <em>Keep the value.</em>
            </h1>
            <div className="pr-hero-side">
              <p>
                The operating system for professional photographers, with an optional sales engine
                that turns timely work and dormant archives into new licensing revenue.
              </p>
              <div className="pr-trial">
                <b>30</b>
                <span>
                  <strong>Days free</strong>
                  <br />
                  Keep 100% of sales made outside Mastline.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pr-split">
        <div className="wrap">
          <div className="pr-split-grid">
            <div>
              <span className="mk-eyebrow" style={{ color: "#8FB0FF" }}>
                One clear split
              </span>
              <div className="pr-split-nums">
                <div className="keep">
                  <b>70%</b>
                  <span>Photographer</span>
                </div>
                <div className="earn">
                  <b>30%</b>
                  <span>Mastline</span>
                </div>
              </div>
            </div>
            <div>
              <h2>Mastline earns only when it creates the sale.</h2>
              <p>
                Every photo licensed through Mastline follows a 70/30 split: 70% of the license to
                the photographer. Sales made through a photographer’s own relationships, outside
                Mastline, stay whole.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <Plans
            eyebrow="Choose an operating level"
            heading="Built for the way the work happens now."
          />
          <p className="pr-foot">
            All paid plans include the optional Mastline Sales Engine. The 70/30 share applies only
            to licenses generated inside Mastline.
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head" style={{ alignItems: "end" }}>
            <span className="mk-eyebrow">Two lanes, no ambiguity</span>
            <h2 style={{ textAlign: "right" }}>
              The work stays <em className="serif-i">with the photographer.</em>
            </h2>
          </div>
          <div className="lanes">
            <div className="lane">
              <div className="lane-top">
                <span>01</span>
                <span>Outside Mastline</span>
              </div>
              <h3>
                The photographer creates the sale.
                <br />
                <b>They keep 100%.</b>
              </h3>
              <p>
                Record it, invoice it and track it in Mastline. There is no sales commission on
                business completed through existing relationships or agencies.
              </p>
            </div>
            <div className="lane hot">
              <div className="lane-top">
                <span>02</span>
                <span>Through Mastline</span>
              </div>
              <h3>
                Mastline helps create the sale.
                <br />
                <b>They keep 70%.</b>
              </h3>
              <p>
                When a photo is licensed through a Mastline opportunity, pitch or buyer request,
                Mastline handles the commercial process and earns 30%.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Compared with an agency</span>
              <h2>Agencies can stay. A lot more of the money stays too.</h2>
            </div>
            <p className="lede">
              A typical agency takes a share of everything sold through them, on every sale,
              forever. Mastline takes a share only of the sales it creates, and nothing on the rest.
            </p>
          </div>
          <div className="vs">
            <div>
              <span className="mk-eyebrow">Typical agency</span>
              <span className="big">40–60%</span>
              <p>
                Of every license they distribute, including the ones that came from the
                photographer’s own relationships. That history and those buyer contacts stay inside
                the agency’s portal.
              </p>
            </div>
            <div className="m">
              <span className="mk-eyebrow">Mastline</span>
              <span className="big">0% or 30%</span>
              <p>
                Nothing on sales made directly. 30% only when Mastline surfaced the opportunity,
                sent the pitch, or closed the buyer. History and contacts stay with the
                photographer, exportable any time.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="calc">
            <div className="calc-l">
              <span className="mk-eyebrow" style={{ color: "#8FB0FF" }}>
                See the split
              </span>
              <h2>
                Simple numbers.
                <br />
                Visible before every sale.
              </h2>
              <p>
                The split is calculated on the license fee after taxes, refunds, chargebacks and
                discounts. Standard payment processing comes out of Mastline’s share.
              </p>
              <label className="calc-slider">
                <span className="mk-eyebrow" style={{ color: "#8FB0FF" }}>
                  Example license value
                </span>
                <div>
                  <input
                    type="range"
                    min="100"
                    max="10000"
                    step="50"
                    value="1000"
                    id="pr-range"
                    aria-label="Example license value"
                  />
                  <output id="pr-out">$1,000</output>
                </div>
              </label>
            </div>
            <div className="calc-r">
              <div className="calc-row big">
                <span className="mk-eyebrow">License</span>
                <b id="pr-total">$1,000</b>
              </div>
              <div className="calc-row">
                <span>
                  <i className="dot you"></i>Photographer <small>70%</small>
                </span>
                <b id="pr-you">$700</b>
              </div>
              <div className="calc-row">
                <span>
                  <i className="dot us"></i>Mastline <small>30%</small>
                </span>
                <b id="pr-us">$300</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head" style={{ alignItems: "end" }}>
            <span className="mk-eyebrow">Plan comparison</span>
            <h2 style={{ textAlign: "right" }}>The complete picture.</h2>
          </div>
          <div className="tablewrap">
            <table className="cmp">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>Solo</th>
                  <th>Pro</th>
                  <th>Studio</th>
                  <th>Agency</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Shoot, asset & submission records</td>
                  <td>✓</td>
                  <td>✓</td>
                  <td>✓</td>
                  <td>✓</td>
                </tr>
                <tr>
                  <td>Invoicing, payments & revenue reporting</td>
                  <td>✓</td>
                  <td>✓</td>
                  <td>✓</td>
                  <td>✓</td>
                </tr>
                <tr>
                  <td>Mastline Sales Engine</td>
                  <td>✓</td>
                  <td>✓</td>
                  <td>✓</td>
                  <td>✓</td>
                </tr>
                <tr>
                  <td>News and archive opportunity monitoring</td>
                  <td>—</td>
                  <td>✓</td>
                  <td>✓</td>
                  <td>✓</td>
                </tr>
                <tr>
                  <td>Rights and usage monitoring</td>
                  <td>—</td>
                  <td>✓</td>
                  <td>✓</td>
                  <td>✓</td>
                </tr>
                <tr>
                  <td>Dispatch, roles and approval workflows</td>
                  <td>—</td>
                  <td>—</td>
                  <td>✓</td>
                  <td>✓</td>
                </tr>
                <tr>
                  <td>API and custom integrations</td>
                  <td>—</td>
                  <td>—</td>
                  <td>—</td>
                  <td>✓</td>
                </tr>
                <tr className="hl">
                  <td>Commission on Mastline sales</td>
                  <td>30%</td>
                  <td>30%</td>
                  <td>30%</td>
                  <td>30%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="faq-grid">
            <div>
              <span className="mk-eyebrow">Questions, answered</span>
              <h2 style={{ marginTop: "14px" }}>
                The fine print,
                <br />
                in plain English.
              </h2>
              <p className="lede" style={{ marginTop: "18px", fontSize: "16px" }}>
                Transparent economics are part of the product, not an afterthought.
              </p>
            </div>
            <div className="faq">
              <details open>
                <summary>When does Mastline take 30%?</summary>
                <p>
                  Only when a photo is licensed through Mastline: an opportunity it surfaces, a
                  pitch sent through the platform, or a buyer request it helps close.
                </p>
              </details>
              <details>
                <summary>Do I pay commission on my existing sales?</summary>
                <p>
                  No. Sales made through a photographer’s own relationships, agencies, or portals
                  can be recorded, invoiced, and tracked in Mastline with no commission. They keep
                  100%.
                </p>
              </details>
              <details>
                <summary>Who owns the copyright?</summary>
                <p>
                  The photographer does, always. Mastline never takes ownership of an image. A
                  license sold through Mastline grants the buyer the specific usage in the license
                  and nothing more.
                </p>
              </details>
              <details>
                <summary>What happens after the 30-day trial?</summary>
                <p>
                  The trial converts to the chosen plan unless it is cancelled. Records, assets and
                  history stay intact, and everything remains exportable.
                </p>
              </details>
              <details>
                <summary>Can I change plans later?</summary>
                <p>
                  Yes. Move up or down at any time; changes take effect at the next billing cycle,
                  and annual plans are prorated.
                </p>
              </details>
              <details>
                <summary>Who collects the money from the buyer?</summary>
                <p>
                  It is a choice per outlet. Mastline can invoice and collect on the photographer’s
                  behalf through Stripe, then pay out their share, or the outlet can be invoiced
                  directly from Mastline and record the payment when it lands. Either way the sale,
                  the license, and the payment stay attached to the picture.
                </p>
              </details>
              <details>
                <summary>How quickly do I get paid?</summary>
                <p>
                  When Mastline collects, the photographer’s share is paid out within two business
                  days of the buyer’s payment clearing. When the outlet is invoiced directly,
                  payment arrives on the outlet’s terms, and Mastline tracks and chases the invoice.
                </p>
              </details>
              <details>
                <summary>Does Mastline work with buyers outside the US?</summary>
                <p>
                  Yes. Pitches, licenses, and invoices support US dollars, British pounds, and
                  euros, and license terms can be set by territory. London desks are a large part of
                  the market and Mastline is built with their hours in mind.
                </p>
              </details>
              <details>
                <summary>Are commercial opportunities and affiliate earnings included?</summary>
                <p>
                  Brand-buyer matching, brand licensing pitches, and shoppable packages are included
                  in Pro and above. Brand licenses Mastline creates follow the same 70/30 split;
                  affiliate commissions are paid out net of network fees and attributed per image.
                  See <Link href="/commercial">Commercial opportunities</Link>.
                </p>
              </details>
              <details>
                <summary>Does rights recovery cost extra?</summary>
                <p>
                  No. Finding unlicensed uses, saving the evidence, and sending licensing requests
                  or invoices are included in Pro and above. Escalating a case to outside counsel is
                  a separate, private arrangement; Mastline hands over the file.
                </p>
              </details>
            </div>
          </div>
        </div>
      </section>

      <section className="pr-cta">
        <div className="wrap">
          <span className="wm" aria-hidden="true">
            M
          </span>
          <div className="pr-cta-in">
            <span className="mk-eyebrow" style={{ color: "#D6E0FF" }}>
              Shoot more. Chase less.
            </span>
            <h2>
              Every picture,
              <br />
              <em className="serif-i">paid in full.</em>
            </h2>
            <p>
              Pitch faster, sell smarter, get paid on time, and keep earning from work already done.
              Mastline runs the business; the photographer runs the night.
            </p>
            <Link className="btn light" href="/sign-up">
              Start the 30-day trial
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
