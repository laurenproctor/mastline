import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CopyButton } from "../_components/copy";

/**
 * The approved descriptions, held once.
 *
 * The page renders these and the copy controls put the same characters on the
 * clipboard. Two literals would eventually disagree, and a reporter would
 * publish the one that was not approved.
 */
const ONE_SENTENCE =
  "Mastline is the business operating system for paparazzi and entertainment photographers, handling everything between the shutter and the bank: pitching, licensing, delivery, payments, rights, and archive resale.";

const ONE_PARAGRAPH =
  "Mastline is the business operating system for professional paparazzi, independent celebrity and news photographers, small field teams, and boutique photo agencies. It gives every picture a commercial memory, a record of where it was shot, who it was pitched to, what it licensed for, what it earned, and when it becomes valuable again, and turns that record into faster sales, cleaner licenses, on-time payment, and recurring income from the archive. Photographers keep 100% of the sales they make themselves and 70% of the sales Mastline helps create. Mastline is a Storyworlding company, built on the sidewalks of Hollywood and New York with the photographers who use it every night.";

export const metadata: Metadata = { title: "Press" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / Press
          </div>
          <h1>Press and media kit.</h1>
          <p className="lede">
            Everything a journalist needs to cover Mastline accurately: what it is, who built it,
            what it will and won’t do, approved language, logos, screenshots, and a person to call.
          </p>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "24px" }}>
            <a className="btn primary" href="mailto:press@mastline.co">
              Contact press@mastline.co
            </a>
            <a className="btn ghost" href="[PRESS KIT ZIP URL]">
              Download the full kit (ZIP)
            </a>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Boilerplate</span>
              <h2>Describe Mastline this way.</h2>
            </div>
            <p className="lede">
              Use either version verbatim. Please don’t shorten Mastline to “an app for paparazzi”;
              the business layer is the point.
            </p>
          </div>
          <div className="principles" data-rv-group>
            <div>
              <h3>One sentence</h3>
              <p>{ONE_SENTENCE}</p>
              <p className="copy-block">
                <CopyButton label="Copy sentence" text={ONE_SENTENCE} />
              </p>
            </div>
            <div>
              <h3>One paragraph</h3>
              <p>{ONE_PARAGRAPH}</p>
              <p className="copy-block">
                <CopyButton label="Copy paragraph" text={ONE_PARAGRAPH} />
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Fast facts</span>
              <h2>The numbers and names that are safe to print.</h2>
            </div>
          </div>
          <div className="tablewrap">
            <table className="diff">
              <tbody data-rv-group>
                <tr>
                  <td>Company</td>
                  <td colSpan={2}>Mastline, a Storyworlding company</td>
                </tr>
                <tr>
                  <td>Founder</td>
                  <td colSpan={2}>Lauren Proctor</td>
                </tr>
                <tr>
                  <td>Headquarters</td>
                  <td colSpan={2}>155 Prince Street, Floor 3, New York, NY 10012</td>
                </tr>
                <tr>
                  <td>Founded</td>
                  <td colSpan={2}>2026</td>
                </tr>
                <tr>
                  <td>Product</td>
                  <td colSpan={2}>
                    Web application for desktop and mobile browsers; nothing to install
                  </td>
                </tr>
                <tr>
                  <td>Customers</td>
                  <td colSpan={2}>
                    Independent paparazzi and entertainment photographers, teams of two to ten, and
                    boutique agencies, primarily in New York, Los Angeles, and London
                  </td>
                </tr>
                <tr>
                  <td>Pricing</td>
                  <td colSpan={2}>
                    Solo $49, Pro $99, Studio $279 per month billed annually; Agency custom. No
                    commission on a photographer’s own sales; 30% on sales Mastline creates.
                  </td>
                </tr>
                <tr>
                  <td>Buyers</td>
                  <td colSpan={2}>
                    Picture desks and editors receive pitches by link and never need an account
                  </td>
                </tr>
                <tr>
                  <td>Website</td>
                  <td colSpan={2}>mastline.co</td>
                </tr>
                <tr>
                  <td>Press contact</td>
                  <td colSpan={2}>
                    <a href="mailto:press@mastline.co">press@mastline.co</a> ·{" "}
                    <a href="tel:+13479263232">347.926.3232</a>{" "}
                    <CopyButton label="Copy address" text="press@mastline.co" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="who" data-rv-group>
            <div>
              <span className="mk-eyebrow">The story</span>
              <h2>The people who make the pictures never had software of their own.</h2>
              <p className="lede" style={{ marginTop: "18px" }}>
                Every outlet, agency, and portal downstream of a paparazzo runs on software. The
                photographers themselves have run on memory, group chats, hard drives, and unpaid
                invoices. Mastline was built to fix that, by sitting with working photographers in
                Hollywood and New York and turning the questions they ask every night into screens:
                what’s worth shooting, who will buy it, what’s it worth, did they pay, and which of
                my old pictures just became valuable again.
              </p>
            </div>
            <div>
              <span className="mk-eyebrow">Angles Mastline is glad to discuss</span>
              <ol>
                <li>
                  The economics of a night: what a set actually earns, and where the money has been
                  leaking.
                </li>
                <li>
                  Archive resale: why a ten-year-old picture becomes worth money again, and how
                  software can notice first.
                </li>
                <li>
                  Rights and recovery: how often editorial images are used without a license, and
                  what photographers can do about it.
                </li>
                <li>
                  The ethics line: what a tool like this should refuse to do, and why Mastline says
                  so publicly.
                </li>
                <li>
                  Storyworlding: building a company by building the world around the people it
                  serves.
                </li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head" style={{ alignItems: "start" }}>
            <div>
              <span className="mk-eyebrow">Founder</span>
              <h2>Lauren Proctor</h2>
            </div>
            <div>
              <p className="lede">
                Lauren Proctor is a New York–based entrepreneur, consultant, and marketing
                strategist who builds companies at the intersection of technology, media, and
                culture. Earlier in her career, she co-founded an influencer marketing platform that
                was acquired by Twitter, giving her an early view into how creators, publishers, and
                technology platforms shape modern influence.
              </p>
              <p className="lede" style={{ marginTop: "14px" }}>
                As a consultant, Lauren builds the systems companies need to operate and scale,
                advises leaders on growth and positioning, and helps organizations understand and
                apply emerging technologies. Her work combines cultural insight, commercial
                strategy, and product design to transform complex or overlooked problems into
                useful, durable businesses.
              </p>
              <p style={{ marginTop: "14px", fontSize: "15px", color: "var(--ink-3)" }}>
                Founder of Mastline and of Storyworlding, the company behind it. Available for
                interviews on the business of entertainment photography, archive economics, and
                responsible product design.
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <a className="btn ghost" href="[FOUNDER HEADSHOT URL]">
              Download headshot
            </a>
            <a className="btn ghost" href="mailto:press@mastline.co?subject=Interview%20request">
              Request an interview
            </a>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Approved quotes</span>
              <h2>Attributable to Lauren Proctor, founder.</h2>
            </div>
            <p className="lede">
              Use as written, or ask press@mastline.co for a quote on a specific story.
            </p>
          </div>
          <div className="quotes" data-rv-group>
            <blockquote className="quote">
              <p>
                “Every picture a photographer takes should keep paying them. Most of the industry is
                set up so it pays everyone else.”
              </p>
              <cite>
                <b>Lauren Proctor</b> · Founder, Mastline
              </cite>
            </blockquote>
            <blockquote className="quote">
              <p>
                “We built this with the people who stand on the sidewalk at one in the morning. If
                it doesn’t make tonight easier, nothing else we do matters.”
              </p>
              <cite>
                <b>Lauren Proctor</b> · Founder, Mastline
              </cite>
            </blockquote>
            <blockquote className="quote">
              <p>
                “Mastline helps photographers sell pictures taken in public. It is not a tool for
                following people, and we say so in writing.”
              </p>
              <cite>
                <b>Lauren Proctor</b> · Founder, Mastline
              </cite>
            </blockquote>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">What Mastline will not do</span>
              <h2>Please quote this directly when the question comes up.</h2>
            </div>
            <p className="lede">
              These come up in every interview. They are product rules, written into the Terms and
              enforced in the software.
            </p>
          </div>
          <div className="never" data-rv-group>
            <div>
              <span>
                <b>No real-time tracking of individuals.</b> The news radar reads public signals
                only: premieres, court calendars, published stories, public appearances.
              </span>
            </div>
            <div>
              <span>
                <b>No scraping of private accounts</b> or messages, and no storing of anyone’s home
                address as a “signal.”
              </span>
            </div>
            <div>
              <span>
                <b>No coordinating photographers onto a target.</b> Tips and locations belong to the
                account that stored them and are never pooled.
              </span>
            </div>
            <div>
              <span>
                <b>No synthetic or altered imagery presented as editorial.</b> Every image carries
                provenance; edits beyond tone and crop are flagged.
              </span>
            </div>
            <div>
              <span>
                <b>No automated legal action.</b> Takedowns, invoices, and escalations wait for a
                human.
              </span>
            </div>
            <div>
              <span>
                <b>No selling of photographer or buyer data.</b>
              </span>
            </div>
          </div>
          <p style={{ marginTop: "18px", fontSize: "14px", color: "var(--ink-3)" }}>
            Full detail on the <Link href="/trust">Trust</Link> page, the one-screen{" "}
            <Link href="/acceptable-use">Acceptable use</Link> summary, and the{" "}
            <Link href="/terms">Terms of Service</Link>.
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Logo</span>
              <h2>Use the wordmark as supplied.</h2>
            </div>
            <p className="lede">
              The mark is the M-and-frame symbol with the blue square; the wordmark is MASTLINE set
              in its custom geometric letterforms. Don’t recolor, rotate, stretch, outline, or add
              effects, and don’t set the name in another typeface.
            </p>
          </div>
          <div className="principles" data-rv-group>
            <div style={{ alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
              <Image
                src="/marketing/wordmark.png"
                alt="Mastline wordmark, black on white"
                style={{ maxWidth: "320px" }}
                width={800}
                height={137}
              />
            </div>
            <div
              style={{
                alignItems: "center",
                justifyContent: "center",
                padding: "40px 24px",
                background: "var(--ink)",
              }}
            >
              <Image
                src="/marketing/wordmark-reversed.png"
                alt="Mastline wordmark, white on black"
                style={{ maxWidth: "320px" }}
                width={800}
                height={137}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "20px" }}>
            <a className="btn ghost" href="[LOGO PACK URL]">
              Download logos (SVG, PNG, EPS)
            </a>
          </div>
          <div className="integrations" style={{ marginTop: "28px" }}>
            <div>
              <b
                style={{
                  display: "block",
                  height: "28px",
                  borderRadius: "4px",
                  background: "#0B0C0E",
                }}
              ></b>
              <span>Ink · #0B0C0E</span>
              <CopyButton label="Copy hex" text="#0B0C0E" />
            </div>
            <div>
              <b
                style={{
                  display: "block",
                  height: "28px",
                  borderRadius: "4px",
                  background: "#1E5BFF",
                }}
              ></b>
              <span>Mastline Blue · #1E5BFF</span>
              <CopyButton label="Copy hex" text="#1E5BFF" />
            </div>
            <div>
              <b
                style={{
                  display: "block",
                  height: "28px",
                  borderRadius: "4px",
                  background: "#F6F7F9",
                  border: "1px solid var(--rule)",
                }}
              ></b>
              <span>Paper · #F6F7F9</span>
              <CopyButton label="Copy hex" text="#F6F7F9" />
            </div>
            <div>
              <b
                style={{
                  display: "block",
                  height: "28px",
                  borderRadius: "4px",
                  background: "#89FF0A",
                }}
              ></b>
              <span>Signal Green · #89FF0A</span>
              <CopyButton label="Copy hex" text="#89FF0A" />
            </div>
          </div>
          <p style={{ marginTop: "18px", fontSize: "14px", color: "var(--ink-3)" }}>
            Clear space around the logo: at least the height of the M on every side. Minimum width:
            96 pixels on screen, 25 mm in print.
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Product images</span>
              <h2>Screenshots cleared for editorial use.</h2>
            </div>
            <p className="lede">
              All people, names, and stories shown in product images are fictional. Please credit
              “Mastline” and do not crop out the interface.
            </p>
          </div>
          <div className="shot">
            <Image
              src="/marketing/news-radar.jpg"
              alt="Mastline News radar screen"
              width={1400}
              height={996}
            />
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "20px" }}>
            <a className="btn ghost" href="[SCREENSHOT PACK URL]">
              Download screenshots (PNG, 2x)
            </a>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="faq-grid">
            <div>
              <span className="mk-eyebrow">For reporters</span>
              <h2>Things reporters ask.</h2>
            </div>
            <div className="faq" data-rv-group>
              <details open>
                <summary>How is the name said?</summary>
                <p>
                  MAST-line, one word, capital M. It comes from masthead and byline, the two words
                  at the top of a page that say who made it.
                </p>
              </details>
              <details>
                <summary>Is Mastline an agency?</summary>
                <p>
                  No. Agencies take a share of everything a photographer sells through them.
                  Mastline is software the photographer owns; it takes nothing on sales they make
                  themselves and a 30% share only on sales it creates. Photographers can keep their
                  agencies and use Mastline alongside them.
                </p>
              </details>
              <details>
                <summary>Does Mastline tell photographers where celebrities are?</summary>
                <p>
                  No. The news radar surfaces public events: premieres, court dates, published
                  stories, scheduled appearances. It does not track or locate individuals, and the
                  Terms prohibit using the platform to do so.
                </p>
              </details>
              <details>
                <summary>Who owns the photographs?</summary>
                <p>
                  The photographer, always. Mastline never takes ownership or licenses images on its
                  own behalf.
                </p>
              </details>
              <details>
                <summary>Can I speak to photographers who use it?</summary>
                <p>
                  Often, yes. Email press@mastline.co with the outlet and the angle. Mastline asks
                  first, and only connects reporters with photographers who want to talk.
                </p>
              </details>
              <details>
                <summary>Can I try the product?</summary>
                <p>
                  Yes. Ask for a demo account at press@mastline.co. It comes loaded with fictional
                  sets, buyers, and deals, so every screen can be seen without touching anyone’s
                  real work.
                </p>
              </details>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>On deadline?</h2>
            <p>
              Email press@mastline.co with “DEADLINE” in the subject line. Replies come within the
              hour during New York business hours, and as fast as possible outside them.
            </p>
          </div>
          <div className="actions">
            <a className="btn light" href="mailto:press@mastline.co?subject=DEADLINE">
              Email press@mastline.co
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
