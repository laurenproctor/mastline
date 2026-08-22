import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = { title: "For editors" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / For editors
          </div>
          <h1>Better pictures, faster, with the paperwork already done.</h1>
          <p className="lede">
            Mastline is how working photographers pitch, license, and deliver to picture desks. Sets
            arrive captioned and cleared, exclusives hold, and the files are yours the moment you
            say yes.
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="editors">
            <div>
              <span className="mk-eyebrow">The short version</span>
              <h2 style={{ marginTop: "14px" }}>No account. No app. No new process.</h2>
              <p className="lede" style={{ marginTop: "18px" }}>
                Every pitch link works on its own. Open it, look, and accept, counter, or pass. Say
                yes and the license and full-resolution files are released on the spot. No login to
                buy. We rarely email, and only when it&apos;s useful.
              </p>
            </div>
            <div className="edsteps">
              <div>
                <i>1</i>
                <div>
                  <b>Open the link</b>
                  <p>It works in any browser. No download, no password.</p>
                </div>
              </div>
              <div>
                <i>2</i>
                <div>
                  <b>Review the set</b>
                  <p>Previews, caption, who and where, price, terms, and exclusivity.</p>
                </div>
              </div>
              <div>
                <i>3</i>
                <div>
                  <b>Accept, counter, or pass</b>
                  <p>
                    One tap to take it at asking, or send a counter on price or usage. The
                    photographer answers from their phone.
                  </p>
                </div>
              </div>
              <div>
                <i>4</i>
                <div>
                  <b>Get the files</b>
                  <p>
                    Accepting the license unlocks full-resolution downloads on the spot, with the
                    license document attached.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="spot">
        <div className="wrap" style={{ display: "block" }}>
          <div className="head" style={{ marginBottom: "0" }}>
            <div>
              <span className="mk-eyebrow">Unless you want one</span>
              <h2>A free editor account, for desks that buy often.</h2>
            </div>
            <div>
              <p className="lede">
                One inbox for every pitch your desk receives, a place to post briefs that go
                straight to photographers who can deliver, saved preferences, and a searchable
                record of every license you hold. Optional, free, and never required to buy.
              </p>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "22px" }}>
                <a className="btn primary" href="mailto:hello@mastline.co?subject=Editor%20account">
                  Create a free editor account
                </a>
                <a className="btn ghost" href="#editor-account">
                  See what&apos;s included
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">What you&apos;re getting</span>
              <h2>Pictures with their paperwork already done.</h2>
            </div>
            <p className="lede">
              Every image that reaches you through Mastline arrives with the things your desk
              usually has to chase.
            </p>
          </div>
          <div className="principles">
            <div>
              <h3>Provenance you can rely on</h3>
              <p>
                Each picture carries its capture data, original-file hash, and an unbroken history
                of where it has been. What you see is what came out of the camera, with standard
                tone and crop only; anything beyond that is flagged.
              </p>
            </div>
            <div>
              <h3>A license in writing, every time</h3>
              <p>
                Territory, media, duration, exclusivity, fee, and credit line, generated from the
                terms you accepted and kept on both sides. No more reconstructing a deal from an
                email thread six months later.
              </p>
            </div>
            <div>
              <h3>Captions that are ready to run</h3>
              <p>
                Who, where, when, and context, written by the photographer who was there. Names and
                places are checked against the photographer&apos;s own records before the pitch goes
                out.
              </p>
            </div>
            <div>
              <h3>Exclusives that mean something</h3>
              <p>
                When you&apos;re offered an exclusive, the countdown is real: the set is not
                released to anyone else until the window ends. When you take it, no one else gets it
                for the agreed period.
              </p>
            </div>
            <div>
              <h3>Files when you need them</h3>
              <p>
                Full-resolution downloads unlock the moment the license is accepted, at one in the
                morning or any other time. The link stays valid for the life of the license.
              </p>
            </div>
            <div>
              <h3>Invoices your accounts team will recognise</h3>
              <p>
                The invoice arrives in the format your outlet requires, with PO and reference
                fields, on the schedule you prefer: per deal or batched monthly.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="editor-account">
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">The free editor account</span>
              <h2>One inbox for every photographer. One place to ask for what you need.</h2>
            </div>
            <p className="lede">
              Optional, free, and built for desks that buy often. Nothing about buying from a single
              link changes if you never sign up.
            </p>
          </div>
          <div className="principles">
            <div>
              <h3>A pitch inbox</h3>
              <p>
                Every Mastline pitch sent to your desk, from every photographer, in one list sorted
                by exclusive deadline. Colleagues share it; nothing gets lost in a personal email
                account.
              </p>
            </div>
            <div>
              <h3>Post a brief</h3>
              <p>
                Tell Mastline photographers what you&apos;re looking for: a subject, a venue, a date
                range, an archive year. Briefs go only to photographers who have the subject on file
                or are positioned to shoot it, and the responses come back as normal pitches.
              </p>
            </div>
            <div>
              <h3>Saved preferences</h3>
              <p>
                Rights you buy, formats you take, subjects you cover, the hours your desk is open,
                your invoice format and PO rules. Photographers see them before they pitch, so fewer
                pitches miss.
              </p>
            </div>
            <div>
              <h3>Your license library</h3>
              <p>
                Every license your outlet holds through Mastline, searchable by subject,
                photographer, date, and term, with the files and the invoice attached. Useful when
                legal asks.
              </p>
            </div>
            <div>
              <h3>Team access</h3>
              <p>
                Add colleagues to the desk account with their own logins. Acceptances are recorded
                by name, so you always know who bought what.
              </p>
            </div>
            <div>
              <h3>Still nothing to pay</h3>
              <p>
                Editor accounts are free. Mastline earns from the photographer&apos;s side of a
                sale, never from the desk.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="spot">
        <div className="wrap">
          <div>
            <span className="mk-eyebrow">Buying from a Mastline photographer</span>
            <h2 style={{ marginTop: "14px" }}>Work the way you already do. Just faster.</h2>
            <p className="lede" style={{ marginTop: "18px" }}>
              You keep your relationships, your rates, and your judgment. Mastline changes the
              mechanics, not the deal.
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
                  <b>Counter in one step.</b> Different price, web-only, seven days instead of
                  thirty: structured options, not a negotiation by email.
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
                  <b>Request a set.</b> Reply to any pitch link to ask the photographer for
                  something specific, from tonight&apos;s shoot or their archive.
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
                  <b>Tell them what you want.</b> Let a photographer know your desk prefers couples,
                  arrivals, or UK rights only, and future pitches from them reflect it.
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
                  <b>Pay the way you pay now.</b> Card or bank through Stripe, or on your
                  outlet&apos;s standard terms. Your choice.
                </span>
              </li>
            </ul>
          </div>
          <div className="shot">
            <Image
              src="/marketing/news-radar.jpg"
              alt="A Mastline screen showing a story and the matching archive sets a photographer can offer"
              width={1400}
              height={996}
            />
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Where the pictures come from</span>
              <h2>Taken in public, by a named photographer, with the paperwork to prove it.</h2>
            </div>
            <p className="lede">
              Outlets accept pitches through Mastline knowing what the platform does and
              doesn&apos;t do.
            </p>
          </div>
          <div className="never">
            <div>
              <span>
                <b>No tracking of individuals.</b> Mastline&apos;s news radar reads public signals:
                premieres, court calendars, published stories, public appearances. It does not
                locate people.
              </span>
            </div>
            <div>
              <span>
                <b>No altered or synthetic imagery presented as editorial.</b> Edits beyond standard
                tone and crop are flagged in the image&apos;s provenance record.
              </span>
            </div>
            <div>
              <span>
                <b>A named photographer behind every picture.</b> Every image is tied to a real,
                accountable account holder and their original file.
              </span>
            </div>
            <div>
              <span>
                <b>Your information stays with you.</b> Your contact details, preferences, and what
                you paid are visible only to the photographer you dealt with. Mastline never sells
                or pools buyer data.
              </span>
            </div>
          </div>
          <p style={{ marginTop: "18px", fontSize: "14px", color: "var(--ink-3)" }}>
            Read more on our <Link href="/trust">Trust</Link> page, the{" "}
            <Link href="/acceptable-use">Acceptable use</Link> summary, or the{" "}
            <Link href="/privacy">Privacy Policy</Link>. If a subject contacts your desk about a
            Mastline image, you can point them to{" "}
            <Link href="/subjects">If you appear in a photo</Link>.
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="faq-grid">
            <div>
              <span className="mk-eyebrow">Questions from picture desks</span>
              <h2 style={{ marginTop: "14px" }}>Quick answers.</h2>
            </div>
            <div className="faq">
              <details open>
                <summary>Do I have to sign up to see the pictures?</summary>
                <p>
                  No. The link is the whole thing. You can view, counter, accept, and download
                  without creating an account. A free editor account is there if you want an inbox,
                  briefs, and a license library, but it&apos;s never required to buy.
                </p>
              </details>
              <details>
                <summary>Who am I buying from, the photographer or Mastline?</summary>
                <p>
                  The photographer. The license is between your outlet and them; Mastline generates
                  the paperwork, delivers the files, and keeps the record. The invoice comes from
                  the photographer, or from Mastline on their behalf if they&apos;ve asked us to
                  collect.
                </p>
              </details>
              <details>
                <summary>Can I negotiate?</summary>
                <p>
                  Yes. Every pitch has a counter option for price, usage, territory, and term. Most
                  photographers answer within minutes from their phone.
                </p>
              </details>
              <details>
                <summary>What if the exclusive window ends while I&apos;m deciding?</summary>
                <p>
                  The set is released to other buyers at the non-exclusive price. You can still buy
                  it; you just won&apos;t be the only one who has it.
                </p>
              </details>
              <details>
                <summary>Is the link safe to open?</summary>
                <p>
                  Pitch links always point to a Mastline address, contain no attachments, and ask
                  for no login or payment details to view. If a link looks wrong, forward it to{" "}
                  <a href="mailto:security@mastline.co">security@mastline.co</a>.
                </p>
              </details>
              <details>
                <summary>Can my whole desk see the same pitch?</summary>
                <p>
                  Yes. Forward the link to colleagues; it opens for anyone on your team. Only one
                  acceptance is recorded, and the photographer sees which address accepted.
                </p>
              </details>
              <details>
                <summary>
                  How do I get my outlet&apos;s invoice requirements into the system?
                </summary>
                <p>
                  Tell the photographer once, or email{" "}
                  <a href="mailto:hello@mastline.co">hello@mastline.co</a> with your format, PO
                  rules, and payment terms, and every Mastline photographer who bills you will use
                  them.
                </p>
              </details>
              <details>
                <summary>Can I ask Mastline photographers for pictures directly?</summary>
                <p>
                  Yes. Email <a href="mailto:hello@mastline.co">hello@mastline.co</a> with what your
                  desk is looking for and we&apos;ll route it to photographers who have that subject
                  on file or are in position to get it.
                </p>
              </details>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>Questions about a pitch you&apos;ve received?</h2>
            <p>Reply to the photographer directly from the link, or reach us any time.</p>
          </div>
          <div className="actions">
            <a className="btn light" href="mailto:hello@mastline.co">
              Email hello@mastline.co
            </a>
            <Link className="btn outline" href="/trust">
              How we protect your information
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
