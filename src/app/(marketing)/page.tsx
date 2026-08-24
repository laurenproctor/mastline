import type { Metadata } from "next";
import {
  ArchiveReawakening,
  HeroStage,
  MoneyCounter,
  RelativeDates,
} from "./_components/behaviors";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = { title: "Mastline — the business behind every image" };

export default function Page() {
  return (
    <>
      <ArchiveReawakening />
      <MoneyCounter />
      <RelativeDates />
      <HeroStage />
      <section className="hero">
        <div className="wrap">
          <span className="mk-eyebrow">The business operating system for paparazzi</span>
          <h1>
            Every shoot, sale, and dollar <em>in one place.</em>
          </h1>
          <div className="row">
            <p className="lede">
              Pitch the right desks in minutes, see what every picture earned, and let your archive
              sell itself when a name is back in the news. For paparazzi, entertainment
              photographers, and small crews. Stills and video.
            </p>
            <div className="actions">
              <Link className="btn primary" href="/signup">
                Start your 30-day trial{" "}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              <Link className="btn ghost" href="/how-it-works">
                See how it works
              </Link>
            </div>
          </div>
          <div className="money-strip">
            <div>
              <b>100%</b>
              <span>of sales you make yourself. No commission, ever.</span>
            </div>
            <div>
              <b>70%</b>
              <span>of sales Mastline creates for you. We earn 30% only then.</span>
            </div>
            <div>
              <b>$0</b>
              <span>to start. Thirty days free on any plan, no card.</span>
            </div>
            <Link href="/pricing">See pricing →</Link>
          </div>
          <div className="stage" id="stage" aria-hidden="false">
            <div className="stage-glow"></div>
            <div className="float f1" data-depth="1.6" data-rot="-8">
              <span className="fl">Exclusive ends in</span>
              <b>00:18:07</b>
              <small>Daily Mail · opened 2m ago</small>
            </div>
            <div className="float f2" data-depth="1.1" data-rot="6">
              <span className="fl">Licensed</span>
              <b>$1,800</b>
              <small>All media · 30 days · paid net 30</small>
            </div>
            <div className="float f3" data-depth="2.1" data-rot="-5">
              <span className="fl">Archive match</span>
              <b>5 sets · 2019–2024</b>
              <small>Casting news · demand high</small>
            </div>
            <div className="float f4" data-depth="1.3" data-rot="9">
              <span className="fl">Rights match</span>
              <b>3 unlicensed uses</b>
              <small>Evidence saved · ready to invoice</small>
            </div>
            <div className="shot" id="heroShot">
              <Image
                src="/marketing/news-radar.jpg"
                alt="Mastline News radar screen: a live entertainment feed, a selected story with matching archive assets, and an opportunity panel with sales fit, likely buyers, estimated package range, rights snapshot and a Build sales package button."
                width={1400}
                height={996}
              />
            </div>
          </div>
          <div className="ticker" aria-label="A night with Mastline, as it happens">
            <div className="ticker-track">
              <div className="ticker-row">
                <span>
                  <em>11:08 PM</em>Set uploaded · Sunset Tower · 22 frames
                </span>
                <span>
                  <em>11:09 PM</em>Captions drafted in your voice
                </span>
                <span>
                  <em>11:11 PM</em>Suggested band $1,200–1,800
                </span>
                <span>
                  <em>11:14 PM</em>6 pitches sent · 2 exclusive
                </span>
                <span>
                  <em>11:16 PM</em>Daily Mail opened your pitch
                </span>
                <span>
                  <em>11:23 PM</em>Counter received · $1,800 · 48h exclusive
                </span>
                <span className="hot">
                  <em>11:24 PM</em>Accepted · license issued
                </span>
                <span>
                  <em>11:25 PM</em>Full-res delivered · 9 files
                </span>
                <span>
                  <em>11:40 PM</em>Invoice sent in the outlet&apos;s format
                </span>
                <span>
                  <em>12:02 AM</em>Archive match · [Subject] back in the news · 5 sets
                </span>
                <span>
                  <em>12:05 AM</em>Repitch approved · 8 editors
                </span>
                <span>
                  <em>07:42 AM</em>The Sun opened · London desk awake
                </span>
                <span>
                  <em>08:15 AM</em>Rights match · 3 unlicensed uses · evidence saved
                </span>
                <span className="hot">
                  <em data-tomorrow="upper">SEP 15</em>Paid · $1,800 · you keep 70%
                </span>
              </div>
              <div className="ticker-row" aria-hidden="true">
                <span>
                  <em>11:08 PM</em>Set uploaded · Sunset Tower · 22 frames
                </span>
                <span>
                  <em>11:09 PM</em>Captions drafted in your voice
                </span>
                <span>
                  <em>11:11 PM</em>Suggested band $1,200–1,800
                </span>
                <span>
                  <em>11:14 PM</em>6 pitches sent · 2 exclusive
                </span>
                <span>
                  <em>11:16 PM</em>Daily Mail opened your pitch
                </span>
                <span>
                  <em>11:23 PM</em>Counter received · $1,800 · 48h exclusive
                </span>
                <span className="hot">
                  <em>11:24 PM</em>Accepted · license issued
                </span>
                <span>
                  <em>11:25 PM</em>Full-res delivered · 9 files
                </span>
                <span>
                  <em>11:40 PM</em>Invoice sent in the outlet&apos;s format
                </span>
                <span>
                  <em>12:02 AM</em>Archive match · [Subject] back in the news · 5 sets
                </span>
                <span>
                  <em>12:05 AM</em>Repitch approved · 8 editors
                </span>
                <span>
                  <em>07:42 AM</em>The Sun opened · London desk awake
                </span>
                <span>
                  <em>08:15 AM</em>Rights match · 3 unlicensed uses · evidence saved
                </span>
                <span className="hot">
                  <em data-tomorrow="upper">SEP 15</em>Paid · $1,800 · you keep 70%
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="thesis">
        <div className="wrap">
          <div>
            <span className="mk-eyebrow">Core thesis</span>
            <h2 style={{ marginTop: "14px" }}>
              Every image deserves a <em>commercial memory.</em>
            </h2>
            <p style={{ marginTop: "18px" }}>
              Folders forget. Portals forget. Email definitely forgets. In Mastline every picture
              carries its own record of where it came from, where it went, what it earned, how it
              may be used, and when it becomes valuable again. Nothing you&apos;ve shot, sold, or
              are owed can quietly disappear.
            </p>
          </div>
          <div className="memory" aria-label="What an asset record preserves">
            <div className="memory-head">
              <span>Asset record</span>
              <span>Set 0419 · frame 07</span>
            </div>
            <div>
              <span>Origin</span>
              <span>Sunset Tower · 11:08 PM · original file, capture data, subjects</span>
            </div>
            <div>
              <span>Journey</span>
              <span>Pitched to 6 desks · Daily Mail opened 11:16 PM · countered 11:23 PM</span>
            </div>
            <div>
              <span>Earnings</span>
              <span>
                Licensed $1,800 · paid{" "}
                <em data-tomorrow="" data-days="3">
                  Sep 17
                </em>{" "}
                · lifetime $1,800
              </span>
            </div>
            <div>
              <span>Permissions</span>
              <span>All media · worldwide · 30 days · exclusive 48h · credit line set</span>
            </div>
            <div>
              <span>Next life</span>
              <span>Watching the news for both subjects · 2 related sets on file</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">The product</span>
              <h2>Know what to shoot, sell it fast, get paid, and sell it again.</h2>
            </div>
            <p className="lede">
              Every part of the job, from the tip to the bank, in one place that remembers
              everything. Here are three of the tools you&apos;ll use every night, plus a{" "}
              <Link href="/commercial">second market</Link>
              {" for what's inside every frame: the brands and products your subjects wear."}
            </p>
          </div>
          <div className="teaser">
            <div className="area">
              <div className="ic">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 6h16M4 12h10M4 18h7" />
                </svg>
              </div>
              <h3>Work Queue</h3>
              <p className="q">What needs my attention now?</p>
              <p>
                Active shoots, deadlines, dispatches waiting for review, buyer follow-ups, payment
                exceptions, rights matches, and archive opportunities, in priority order.
              </p>
              <span className="tag">Command center</span>
            </div>
            <div className="area">
              <div className="ic">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l4 4L19 6" />
                </svg>
              </div>
              <h3>Dispatch Review</h3>
              <p className="q">Is this package ready for the intended buyer?</p>
              <p>
                A final control point that checks selection, filenames, captions, people and places,
                timestamps, restrictions, buyer requirements, and delivery method.
              </p>
              <span className="tag">Sales operations</span>
            </div>
            <div className="area">
              <div className="ic">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3v18M16 7.5c0-1.4-1.8-2.5-4-2.5S8 6.1 8 7.5 9.8 10 12 10s4 1.1 4 2.5S14.2 15 12 15s-4-1.1-4-2.5" />
                </svg>
              </div>
              <h3>Revenue &amp; Payments</h3>
              <p className="q">What has been earned, paid, delayed, or lost?</p>
              <p>
                Expected revenue, statements, deductions, invoices, payment dates, aging, splits,
                expenses, and net earnings, by buyer, shoot, asset, subject, and period.
              </p>
              <span className="tag">Finance</span>
            </div>
          </div>
          <Link className="more" href="/product">
            See everything Mastline does for you{" "}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="editors">
            <div>
              <span className="mk-eyebrow">Editor experience</span>
              <h2 style={{ marginTop: "14px" }}>Buyers don&apos;t have to sign up.</h2>
              <p className="lede" style={{ marginTop: "18px" }}>
                Editors don&apos;t adopt new software. They open links. Every pitch you send is a
                single page that works on a phone: watermarked previews, your caption, your price, a
                countdown if it&apos;s exclusive, and one button to accept. No account, no password,
                no app. When they accept, the license and the full-resolution files arrive on their
                side, and the sale lands on yours.
              </p>
              <Link className="more" href="/editors">
                What we tell editors{" "}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            </div>
            <div className="edsteps">
              <div>
                <i>1</i>
                <div>
                  <b>They get a link</b>
                  <p>By email or text, from you, in your voice. It opens instantly on any phone.</p>
                </div>
              </div>
              <div>
                <i>2</i>
                <div>
                  <b>They see the set</b>
                  <p>Previews, caption, terms, price, and how long the exclusive lasts.</p>
                </div>
              </div>
              <div>
                <i>3</i>
                <div>
                  <b>They accept or counter</b>
                  <p>
                    One tap to accept at asking, or a structured counter you can answer from your
                    phone.
                  </p>
                </div>
              </div>
              <div>
                <i>4</i>
                <div>
                  <b>Files and license arrive</b>
                  <p>
                    Full-res downloads unlock the moment the license is accepted. Every download is
                    logged.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="spot" id="reawaken">
        <div className="wrap">
          <div>
            <span className="mk-eyebrow">Archive opportunities</span>
            <h2 style={{ marginTop: "14px" }}>Turn today&apos;s headlines into archive sales.</h2>
            <p className="lede" style={{ marginTop: "18px" }}>
              Your archive is full of pictures that are worth nothing today and a lot tomorrow.
              Mastline watches the news for the people in it. When a name spikes, the right sets
              light up, the right buyers are named, and a pitch is ready to approve before anyone
              else has found their hard drive.
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
                  <b>Who&apos;s trending in your archive</b>, matched against what you actually have
                  on file.
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
                  <b>Likely buyers and a price band</b>, drawn from your own sales, not a generic
                  rate card.
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
                  <b>A freshness window</b>, because interest peaks in the first 72 hours and then
                  it&apos;s gone.
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
                  <b>One tap to send</b>, then the normal pitch and license flow takes over.
                </span>
              </li>
            </ul>
          </div>
          <div
            className="rw"
            id="rw"
            aria-label="Demonstration: a headline wakes up matching archive sets and assembles a pitch"
          >
            <div className="rw-head">
              <span className="rw-live">
                <i></i>News radar
              </span>
              <span
                className="rw-headline"
                data-headline="Breaking · [Subject] cast as lead in [Franchise] sequel"
                id="rwHeadline"
              >
                Breaking · [Subject] cast as lead in [Franchise] sequel
              </span>
            </div>
            <div className="rw-grid" id="rwGrid">
              <div className="rw-tile t1" data-y="2019"></div>
              <div className="rw-tile t2" data-y="2020"></div>
              <div
                className="rw-tile t3 m"
                data-y="2019"
                data-set="Sundance · first premiere"
              ></div>
              <div className="rw-tile t4" data-y="2021"></div>
              <div className="rw-tile t2" data-y="2018"></div>
              <div className="rw-tile t3 m" data-y="2022" data-set="[Franchise] premiere"></div>
              <div className="rw-tile t1" data-y="2023"></div>
              <div className="rw-tile t4" data-y="2020"></div>
              <div className="rw-tile t4" data-y="2017"></div>
              <div className="rw-tile t1" data-y="2021"></div>
              <div className="rw-tile t2 m" data-y="2024" data-set="Melrose coffee run"></div>
              <div className="rw-tile t3" data-y="2022"></div>
            </div>
            <div className="rw-pitch" id="rwPitch">
              <div className="rw-pitch-top">
                <span className="mk-eyebrow" style={{ color: "var(--blue)" }}>
                  Proposed repitch
                </span>
                <span className="rw-score">Demand · High</span>
              </div>
              <b>[Subject], before the franchise: three file sets</b>
              <div className="rw-row">
                <span>Sets</span>
                <span id="rwSets">Sundance 2019 · [Franchise] premiere 2022 · Melrose 2024</span>
              </div>
              <div className="rw-row">
                <span>Buyers</span>
                <span>
                  Daily Mail · Page Six · People · Variety · THR <em>+3</em>
                </span>
              </div>
              <div className="rw-row">
                <span>Price</span>
                <span className="rw-price">
                  $350 <small>per set · band $250–450</small>
                </span>
              </div>
              <div className="rw-actions">
                <span className="btn primary rw-btn">Approve &amp; send 24 pitches</span>
                <span className="rw-est">
                  If 4 of 8 buy ≈ <b>$4,200</b>
                </span>
              </div>
            </div>
            <button className="rw-replay" id="rwReplay" type="button">
              Replay
            </button>
          </div>
        </div>
      </section>

      <section className="money" id="money">
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">One night, in dollars</span>
              <h2>Watch a single shoot add up.</h2>
            </div>
            <p className="lede">
              Scroll through the night. The number on the left is what this one set of pictures
              earns as Mastline does its work.
            </p>
          </div>
          <div className="money-grid">
            <div className="money-stick">
              <div className="money-card">
                <span className="mk-eyebrow" id="mLabel">
                  Earned so far
                </span>
                <div className="money-num">
                  <span>$</span>
                  <b id="mNum">0</b>
                </div>
                <p id="mNote">Twenty-two frames, uploaded from the sidewalk.</p>
                <div className="money-bar">
                  <i id="mBar"></i>
                </div>
              </div>
            </div>
            <ol className="msteps" id="msteps">
              <li
                className="mstep"
                data-value="0"
                data-label="Earned so far"
                data-note="Twenty-two frames, uploaded from the sidewalk."
              >
                <span className="mt">11:08 PM</span>
                <div>
                  <b>The shot.</b>
                  <p>
                    Two subjects at the valet. The set uploads from the sidewalk; previews and
                    watermarks render before the car pulls away.
                  </p>
                </div>
              </li>
              <li
                className="mstep"
                data-value="0"
                data-label="Pitched · asking $1,500"
                data-note="Six tracked pitches out. Two desks hold a 45-minute exclusive."
              >
                <span className="mt">11:14 PM</span>
                <div>
                  <b>The pitch.</b>
                  <p>
                    Mastline suggests $1,200–1,800 from past sales and drafts pitches to the six
                    desks most likely to buy.
                  </p>
                  <span className="mchip">6 pitches · 2 exclusive</span>
                </div>
              </li>
              <li
                className="mstep"
                data-value="1800"
                data-label="Licensed"
                data-note="Daily Mail countered for a 48-hour exclusive. Accepted in one tap."
              >
                <span className="mt">11:24 PM</span>
                <div>
                  <b>The sale.</b>
                  <p>
                    An editor opens the link on her phone and counters. One tap accepts it. The
                    license generates, she signs, and the full-res files release.
                  </p>
                  <span className="mchip">+ $1,800</span>
                </div>
              </li>
              <li
                className="mstep"
                data-value="3200"
                data-label="Archive repitched"
                data-note="A casting story broke at midnight. Four desks bought file sets shot years ago."
              >
                <span className="mt">12:02 AM</span>
                <div>
                  <b>The archive wakes up.</b>
                  <p>
                    A name in the archive is back in the news. Mastline lines up three old sets and
                    eight buyers; one approval over coffee sends them. Four buy.
                  </p>
                  <span className="mchip">+ $1,400</span>
                </div>
              </li>
              <li
                className="mstep"
                data-value="3800"
                data-label="Rights recovered"
                data-note="Three sites ran a frame without a license. Evidence saved, invoices sent, two paid."
              >
                <span className="mt">08:15 AM</span>
                <div>
                  <b>The pictures nobody paid for.</b>
                  <p>
                    Rights Matches finds three unlicensed uses from last month, with the evidence
                    attached. Invoices go out from the same screen.
                  </p>
                  <span className="mchip">+ $600</span>
                </div>
              </li>
              <li
                className="mstep"
                data-value="3800"
                data-label="Paid"
                data-note="Collected without a single follow-up email. 100% of the sales made directly, 70% of the ones Mastline made."
              >
                <span className="mt" data-tomorrow="" data-days="3">
                  Sep 17
                </span>
                <div>
                  <b>The money lands.</b>
                  <p>
                    Invoices went out the night of each sale, in each outlet&apos;s format. Payments
                    arrive on terms, and every dollar is tied back to the picture that earned it.
                  </p>
                  <span className="mchip paid">Paid in full</span>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">From the photographers who built it with us</span>
              <h2>Built on the sidewalks of Hollywood and New York.</h2>
            </div>
            <p className="lede">
              Mastline was shaped by working paparazzi who still use it every night and still tell
              us what&apos;s wrong with it.
            </p>
          </div>
          <div className="quotes">
            <blockquote className="quote">
              <p>&quot;[QUOTE FROM PHOTOGRAPHER 1]&quot;</p>
              <cite>
                <b>[First name]</b> · [X] years shooting · New York
              </cite>
            </blockquote>
            <blockquote className="quote">
              <p>&quot;[QUOTE FROM PHOTOGRAPHER 2]&quot;</p>
              <cite>
                <b>[First name]</b> · [X] years shooting · New York
              </cite>
            </blockquote>
            <blockquote className="quote">
              <p>&quot;[QUOTE FROM PHOTOGRAPHER 3]&quot;</p>
              <cite>
                <b>[First name]</b> · [X] years shooting · Los Angeles
              </cite>
            </blockquote>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Why it matters</span>
              <h2>Four things Mastline changes about the business.</h2>
            </div>
          </div>
          <div className="pillars">
            <div>
              <h3>Move faster</h3>
              <p>Reduce the time between opportunity, capture, and buyer-ready delivery.</p>
            </div>
            <div>
              <h3>Earn more</h3>
              <p>Improve buyer targeting, revive archive value, and reduce missed revenue.</p>
            </div>
            <div>
              <h3>Know the truth</h3>
              <p>
                See where every image went, what happened, what it earned, and what remains
                unresolved.
              </p>
            </div>
            <div>
              <h3>Build a durable business</h3>
              <p>Turn a succession of urgent shoots into a cumulative commercial asset.</p>
            </div>
          </div>
        </div>
      </section>
      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>Run the business behind every image.</h2>
            <p>
              Thirty days free on any plan. Keep 100% of the sales you make yourself, and 70% of the
              ones Mastline helps create.
            </p>
          </div>
          <div className="actions">
            <Link className="btn light" href="/signup">
              Start your 30-day trial
            </Link>
            <Link className="btn outline" href="/pricing">
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
