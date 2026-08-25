import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = { title: "Commercial" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / <Link href="/product">Product</Link> / Commercial
            opportunities
          </div>
          <h1>Photograph the moment. Get paid for what’s inside it.</h1>
          <p className="lede">
            Every frame carries more than a face. The jacket, the sneakers, the bag, the watch: each
            one is a product a brand wants seen and a reader wants to buy. Mastline finds them,
            names who might pay, and opens two ways to earn: license the picture to the brand, or
            publish it as shoppable content and collect on every sale it drives.
          </p>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "24px" }}>
            <Link className="btn primary" href="/sign-up">
              Start the 30-day trial
            </Link>
            <a className="btn ghost" href="#co-flow">
              See how it works
            </a>
          </div>
        </div>
      </section>

      <section className="spot">
        <div className="wrap">
          <div>
            <span className="mk-eyebrow">Commercial opportunities</span>
            <h2 style={{ marginTop: "14px" }}>
              A second market for every set, found automatically.
            </h2>
            <p className="lede" style={{ marginTop: "18px" }}>
              News desks buy the moment. Brands and retailers buy what the moment is wearing. When a
              set lands in Mastline, it is scanned for people, garments, accessories, and logos,
              matched against brand catalogs, and scored for commercial value. Likely buyers and
              shoppable products appear beside the editorial pitch, ready to act on in the same
              session.
            </p>
            <ul>
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l4 4L19 6" />
                </svg>
                <span>
                  <b>Detected, not typed.</b> People, garments, and brands are identified
                  automatically, then confirmed or corrected in seconds.
                </span>
              </li>
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l4 4L19 6" />
                </svg>
                <span>
                  <b>Buyers named.</b> Brand-side contacts and marketing buyers, ranked by fit,
                  beside the editorial desks already on the list.
                </span>
              </li>
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l4 4L19 6" />
                </svg>
                <span>
                  <b>Rights checked first.</b> Every route is filtered by what the license, the
                  subject, and the law actually allow.
                </span>
              </li>
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l4 4L19 6" />
                </svg>
                <span>
                  <b>Attributed to the frame.</b> License fees and affiliate commissions land on the
                  Asset Record, next to the editorial sales.
                </span>
              </li>
            </ul>
          </div>
          <div className="shot">
            <Image
              src="/marketing/commercial-opportunities.jpg"
              alt="Mastline Commercial Opportunities screen: a photo with detected garments and brands, confidence labels, brand licensing candidates, and a shoppable package with affiliate links and attributed revenue."
              width={1400}
              height={1114}
            />
          </div>
        </div>
      </section>

      <section id="co-flow">
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">How it works</span>
              <h2>One upload. Two ways to earn.</h2>
            </div>
            <p className="lede">
              The flow runs inside the Shoot Workspace already in use. Nothing is sent, published,
              or linked without an explicit approval.
            </p>
          </div>
          <div className="coflow" aria-label="Commercial opportunities flow">
            <div className="fstep">
              <span className="n">1</span>
              <h3>Upload the set</h3>
              <p>
                Stills or clips arrive as usual, from the phone on the sidewalk or the laptop the
                next morning.
              </p>
            </div>
            <div className="farrow" aria-hidden="true"></div>
            <div className="fstep">
              <span className="n">2</span>
              <h3>Detect people, garments, and brands</h3>
              <p>
                Faces, clothing, accessories, and logos are identified and matched against brand and
                retailer catalogs.
              </p>
            </div>
            <div className="farrow" aria-hidden="true"></div>
            <div className="fstep">
              <span className="n">3</span>
              <h3>A person confirms</h3>
              <p>
                Approve, correct, or remove any detection. The confirmation is what the system sells
                from, not its guess.
              </p>
            </div>
            <div className="farrow" aria-hidden="true"></div>
            <div className="fstep">
              <span className="n">4</span>
              <h3>Rights and opportunity analysis</h3>
              <p>
                License terms, subject rules, and brand policies are applied, and the commercial
                value of each element is scored.
              </p>
            </div>
            <div className="fsplit" aria-hidden="true"></div>
            <div className="froutes">
              <div className="froute">
                <span className="mk-eyebrow">Route A · Brand licensing</span>
                <h3>Pitch → Offer → License</h3>
                <p>
                  A ranked list of brand and marketing buyers for the frame, with a suggested
                  package and price. Pitched from the same composer editors are pitched from. The
                  buyer accepts or counters with one tap; the license issues and the fee is
                  attributed to the picture.
                </p>
                <span className="foot">
                  70% to the photographer · 30% to Mastline, only when Mastline creates the sale
                </span>
              </div>
              <div className="froute">
                <span className="mk-eyebrow">Route B · Shoppable content</span>
                <h3>Publish → Track → Earn</h3>
                <p>
                  Mastline assembles a shoppable package: the image, the products inside it, and
                  affiliate links for exact matches or same-brand alternatives. Publish to a
                  personal site, a partner, or a social post. Every click and purchase is tracked
                  back to the frame.
                </p>
                <span className="foot">Net commissions paid out · Attributed per image</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Honest matching</span>
              <h2>Every product is labeled by how certain the match is.</h2>
            </div>
            <p className="lede">
              Matching is assisted, not magic. Each item carries a label a photographer and their
              readers can trust, and nothing is presented as a certainty that isn’t one.
            </p>
          </div>
          <div className="matches">
            <div className="match">
              <span className="chip exact">Exact match</span>
              <h3>The product, confirmed</h3>
              <p>
                Catalog match with high confidence, or confirmed by hand. Eligible for brand
                licensing pitches and direct affiliate links.
              </p>
            </div>
            <div className="match">
              <span className="chip probable">Probable match</span>
              <h3>Very likely, flagged as such</h3>
              <p>
                Strong visual match with one or two open questions. Shown with a “likely” label, and
                promoted to exact in one tap.
              </p>
            </div>
            <div className="match">
              <span className="chip alt">Same-brand alternative</span>
              <h3>The brand’s current equivalent</h3>
              <p>
                The item is sold out or last season; the brand’s nearest in-stock piece is offered,
                labeled as an alternative.
              </p>
            </div>
            <div className="match">
              <span className="chip similar">Similar style</span>
              <h3>Get the look</h3>
              <p>
                No brand identified, or the brand doesn’t sell online. Comparable items from partner
                retailers, clearly marked as similar.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="who">
            <div>
              <span className="mk-eyebrow">Route A</span>
              <h2 style={{ marginTop: "14px" }}>Brand licensing, handled like any other sale.</h2>
              <ol>
                <li>
                  <span>
                    <strong>Buyers nobody thinks to pitch.</strong> The brand’s PR team, its agency,
                    the retailer that stocks it, and the marketing desks that buy
                    celebrity-wearing-product imagery, ranked by how often they buy and what they
                    pay.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>A suggested package and price.</strong> Built from the frame, the
                    detected product, the subject’s demand, and what comparable licenses have closed
                    for.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>The same one-tap pitch.</strong> Watermarked preview, the caption, the
                    price, the terms. Brand buyers accept or counter without creating an account.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>A license that says exactly what it says.</strong> Use, territory, term,
                    media, fee. Anything outside it shows up in Rights Matches.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Money on the record.</strong> The fee lands in Revenue & Payments and on
                    the Asset Record, beside every editorial sale of the same frame.
                  </span>
                </li>
              </ol>
            </div>
            <div>
              <span className="mk-eyebrow">Route B</span>
              <h2 style={{ marginTop: "14px" }}>Shoppable content, published in minutes.</h2>
              <ol>
                <li>
                  <span>
                    <strong>A package, not a chore.</strong> The image, the confirmed products, the
                    labels, and the affiliate links, assembled ready to publish.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Publish where the audience already is.</strong> An embeddable page for a
                    site, a partner feed, or a link for a social caption.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Tracked to the frame.</strong> Clicks, conversions, and commissions are
                    attributed to the picture and the product, not a monthly lump sum.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Links that stay alive.</strong> When an item sells out, the same-brand
                    alternative takes over automatically, so old posts keep earning.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Paid with everything else.</strong> Net commissions arrive through the
                    same payouts as licensing revenue, with every line explained.
                  </span>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Built into Mastline</span>
              <h2>It lives where the work already lives.</h2>
            </div>
          </div>
          <div className="principles">
            <div>
              <h3>Work Queue</h3>
              <p>
                High-value commercial matches appear as items to act on, prioritized with dispatches
                and follow-ups.
              </p>
            </div>
            <div>
              <h3>Asset Record</h3>
              <p>
                Detected products, confirmations, brand pitches, shoppable packages, and every
                dollar either one earns, on the picture’s permanent record.
              </p>
            </div>
            <div>
              <h3>Buyer directory</h3>
              <p>
                Brand and marketing buyers sit alongside editors, with the same history: what they
                bought, what they paid, when they open links.
              </p>
            </div>
            <div>
              <h3>News radar</h3>
              <p>
                When a product, a collaboration, or a collection is in the news, the archive is
                searched for frames that show it.
              </p>
            </div>
            <div>
              <h3>Rights Matches</h3>
              <p>
                Brand licenses are enforced like editorial ones. A use outside the license is
                flagged with evidence.
              </p>
            </div>
            <div>
              <h3>Revenue & Payments</h3>
              <p>
                License fees and affiliate commissions, attributed by image, product, and channel,
                reconciled with the rest of the money.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="spot">
        <div className="wrap">
          <div>
            <span className="mk-eyebrow">Nothing moves on its own</span>
            <h2 style={{ marginTop: "14px" }}>
              Nothing is sold, published, or linked without an approval.
            </h2>
            <ul>
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l4 4L19 6" />
                </svg>
                <span>
                  <b>Confirm before anything moves.</b> Detections stay suggestions until someone
                  approves them.
                </span>
              </li>
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l4 4L19 6" />
                </svg>
                <span>
                  <b>Turn either route off.</b> Per shoot, per subject, per brand, or for the whole
                  account.
                </span>
              </li>
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l4 4L19 6" />
                </svg>
                <span>
                  <b>Subject and rights rules apply.</b> Commercial use that needs a release, or a
                  subject who has opted out, is blocked before it is offered.
                </span>
              </li>
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l4 4L19 6" />
                </svg>
                <span>
                  <b>Disclosures handled.</b> Shoppable packages carry the affiliate disclosures the
                  platform and the law require.
                </span>
              </li>
              <li>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l4 4L19 6" />
                </svg>
                <span>
                  <b>The picture stays owned.</b> A brand license grants a use; it never transfers
                  copyright.
                </span>
              </li>
            </ul>
          </div>
          <div>
            <div className="vs">
              <div className="m">
                <span className="mk-eyebrow">Brand licensing</span>
                <span className="big">
                  70
                  <small
                    style={{
                      fontFamily: "var(--sans)",
                      fontSize: "14px",
                      color: "var(--ink-3)",
                      letterSpacing: "0",
                      marginLeft: "6px",
                    }}
                  >
                    % to the photographer
                  </small>
                </span>
                <p>
                  The same split as every Mastline-created sale. Direct sales to brands stay whole;
                  record them here and nothing is charged.
                </p>
              </div>
              <div>
                <span className="mk-eyebrow">Shoppable content</span>
                <span className="big">Net</span>
                <p>
                  Affiliate commissions are paid out net of the network’s fees, attributed per image
                  and product, and shown line by line in Revenue & Payments.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="faq-grid">
            <div>
              <span className="mk-eyebrow">Questions</span>
              <h2 style={{ marginTop: "14px" }}>Before turning it on.</h2>
            </div>
            <div className="faq">
              <details open>
                <summary>Does this change how I sell to editors?</summary>
                <p>
                  No. Commercial opportunities appear beside the editorial pitch, never instead of
                  it. Most sets still go to the desk first; the brand route and the shoppable route
                  are additional income from the same frames.
                </p>
              </details>
              <details>
                <summary>
                  Can a brand license a picture of a celebrity without their permission?
                </summary>
                <p>
                  Not through Mastline unless the rights analysis clears it. Commercial use of a
                  person’s likeness often requires a release, and subjects who have opted out are
                  excluded. Where a release is needed, Mastline says so before any pitch is sent.
                </p>
              </details>
              <details>
                <summary>How accurate is the detection?</summary>
                <p>
                  Good enough to save the typing, not good enough to act alone. That is why every
                  item carries a confidence label and nothing is sold or linked until someone
                  confirm it.
                </p>
              </details>
              <details>
                <summary>Where does shoppable content get published?</summary>
                <p>
                  Anywhere: an embeddable page on a personal site, a feed to a partner publication,
                  or a link for a caption. Mastline tracks clicks and purchases back to the image
                  regardless of where it ran.
                </p>
              </details>
              <details>
                <summary>Which affiliate networks and brands are included?</summary>
                <p>
                  Mastline connects to the major retail affiliate networks and a growing set of
                  direct brand programs. When a brand isn’t in a program, the licensing route stays
                  open, with a “similar style” alternative for the shoppable one.
                </p>
              </details>
              <details>
                <summary>Is this included in my plan?</summary>
                <p>
                  Commercial opportunities are included in Pro and above. See the{" "}
                  <Link href="/pricing">Pricing</Link> page for what each plan covers.
                </p>
              </details>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>Every archive is full of products. Time they paid.</h2>
            <p>Thirty days free on Pro. Upload a set and see what’s inside it.</p>
          </div>
          <div className="actions">
            <Link className="btn light" href="/sign-up">
              Start the 30-day trial
            </Link>
            <Link className="btn outline" href="/product">
              See the full product
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
