import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Product" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / Product
          </div>
          <h1>Everything between the shutter and the bank, handled.</h1>
          <p className="lede">
            Stills and video, from the first tip to the last dollar. Know what&apos;s worth shooting
            tonight. Get the package to the right desk in minutes. See who opened it, what they
            paid, and what they still owe. Catch your pictures being used without a license. Sell
            from your archive the moment a name is back in the news. One workspace, every picture
            remembered, nothing typed twice.
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Command center and opportunity intelligence</span>
              <h2>Know what matters before the day starts.</h2>
            </div>
          </div>
          <div className="areas">
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
                The operating homepage. Active shoots, deadlines, dispatches waiting for review,
                buyer follow-ups, payment exceptions, rights matches, and archive opportunities, in
                priority order. Prioritize, assign, open, snooze, complete.
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
                  <circle cx="12" cy="12" r="2" />
                  <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8" />
                </svg>
              </div>
              <h3>News radar</h3>
              <p className="q">What is becoming photographically or commercially relevant?</p>
              <p>
                Breaking stories, entertainment news, public appearances, court activity, premieres,
                and travel signals from sources you configure, scored against your geography,
                archive, contacts, and buyer demand. Filter, save, connect to archive, create a
                shoot.
              </p>
              <span className="tag">Opportunity intelligence</span>
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
                  <rect x="4" y="5" width={16} height={14} rx="1" />
                  <path d="M4 15l5-5 4 4 3-3 4 4" />
                </svg>
              </div>
              <h3>Archive Opportunities</h3>
              <p className="q">Which images I already own just became timely?</p>
              <p>
                A bridge between live news and owned material. When a person, relationship, venue,
                dispute, release, anniversary, or cultural moment resurfaces, Mastline suggests
                relevant archive assets and likely buyers, and explains why.
              </p>
              <span className="tag">Opportunity intelligence</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Shoot planning and field operations</span>
              <h2>Earn money from your photos, from anywhere.</h2>
            </div>
          </div>
          <div className="areas">
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
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <h3>Create Shoot</h3>
              <p className="q">What are we pursuing, where, when, and for whom?</p>
              <p>
                A fast intake for subject, story angle, place, schedule, source or tip, priority,
                collaborators, target buyers, expenses, and confidentiality. Reusable templates cut
                setup time for recurring venues and events.
              </p>
              <span className="tag">Planning</span>
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
                  <path d="M4 7h16v13H4zM8 7V4h8v3" />
                </svg>
              </div>
              <h3>Shoot Workspace</h3>
              <p className="q">What is happening on this job, and what&apos;s the next action?</p>
              <p>
                The live record for a job: brief, timeline, map and logistics, contacts, notes, file
                intake, selects, metadata status, team messages, costs, and next action. Mobile
                speed is essential.
              </p>
              <span className="tag">Field operations</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Dispatch and sales operations</span>
              <h2>Nothing leaves until it&apos;s buyer-ready. Nothing sent is forgotten.</h2>
            </div>
          </div>
          <div className="areas">
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
                A final control point before delivery. It checks asset selection, filenames,
                captions, people and places, timestamps, restrictions, buyer-specific requirements,
                delivery method, and package completeness. Validate, package, approve, send.
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
                  <path d="M4 5h16v14H4zM4 9l8 5 8-5" />
                </svg>
              </div>
              <h3>Submission Record</h3>
              <p className="q">What was sent, to whom, under which terms, and what happened?</p>
              <p>
                A durable record of every buyer delivery: the package sent, recipients, time,
                proposed terms, exclusivity, status, feedback, sale outcome, and related payment.
                Update status, follow up, link the sale.
              </p>
              <span className="tag">Sales operations</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Asset, rights, and revenue records</span>
              <h2>The memory that outlives any folder, portal, or agency.</h2>
            </div>
          </div>
          <div className="areas">
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
                  <rect x="4" y="5" width={16} height={14} rx="1" />
                  <path d="M4 15l5-5 4 4 3-3 4 4" />
                </svg>
              </div>
              <h3>Asset Record</h3>
              <p className="q">What is the complete commercial history of this picture or clip?</p>
              <p>
                The canonical record for each image or clip: original and derivatives, capture data,
                subjects, location, shoot, caption history, ownership, restrictions, submissions,
                licenses, usage, matches, and lifetime earnings.
              </p>
              <span className="tag">The commercial record</span>
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
                  <circle cx="12" cy="12" r="8" />
                  <path d="M14.5 9.5a3 3 0 1 0 0 5" />
                </svg>
              </div>
              <h3>Rights Matches</h3>
              <p className="q">
                Is someone using my picture without paying, and what happens next?
              </p>
              <p>
                Mastline searches the web for your images and groups suspected uses by picture and
                publisher, with a screenshot and URL saved as evidence, a confidence score, and a
                check against your licenses. You decide what happens: ignore, watch, send a
                licensing request, invoice from the same screen, or hand the file to your own
                counsel. Recovery is included on Pro and above with no extra fee.
              </p>
              <span className="tag">Rights oversight</span>
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
                A financial view by buyer, shoot, asset, subject, period, and status. Expected
                revenue, statements, deductions, invoices, payment dates, aging, splits, expenses,
                and estimated net earnings. Reconcile, chase, export, analyze.
              </p>
              <span className="tag">Finance</span>
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
                  <path d="M6 7h12l-1 13H7zM9 7a3 3 0 0 1 6 0" />
                </svg>
              </div>
              <h3>Commercial Opportunities</h3>
              <p className="q">What inside this picture can I sell beyond the story?</p>
              <p>
                Garments, accessories, and brands are detected in every set and confirmed by you.
                Mastline names the brand buyers likely to license the frame, and builds shoppable
                packages with affiliate links so the picture keeps earning after it runs. Every
                dollar is attributed to the image. <Link href="/commercial">See how it works</Link>.
              </p>
              <span className="tag">Brand licensing · Shoppable content</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Type it once</span>
              <h2>Enter a fact once and it follows the picture everywhere.</h2>
            </div>
            <p className="lede">
              You never re-enter the same fact twice. The shoot populates the asset; the asset
              populates the dispatch; the submission populates the revenue record; the license
              informs rights matching.
            </p>
          </div>
          <div className="tablewrap">
            <table className="records">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>What it preserves</th>
                  <th>What it connects to</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Opportunity</td>
                  <td>Story, source, signal, timing, relevance</td>
                  <td>Shoots, archive assets, subjects, buyers</td>
                </tr>
                <tr>
                  <td>Shoot</td>
                  <td>Brief, logistics, people, costs, notes, status</td>
                  <td>Assets, team, opportunities, submissions</td>
                </tr>
                <tr>
                  <td>Asset</td>
                  <td>Original, derivatives, metadata, ownership, restrictions</td>
                  <td>Shoot, subjects, submissions, usage, revenue</td>
                </tr>
                <tr>
                  <td>Submission</td>
                  <td>Buyer, package, terms, delivery, status, feedback</td>
                  <td>Assets, licenses, revenue, contacts</td>
                </tr>
                <tr>
                  <td>License / usage</td>
                  <td>Permitted use, territory, term, media, fee</td>
                  <td>Asset, buyer, payment, rights matches</td>
                </tr>
                <tr>
                  <td>Payment</td>
                  <td>Expected and received amounts, deductions, timing, splits</td>
                  <td>Submission, license, buyer, shoot</td>
                </tr>
                <tr>
                  <td>Rights match</td>
                  <td>Detection, evidence, confidence, authorization, case status</td>
                  <td>Asset, usage, buyer or publisher</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="editors">
            <div>
              <span className="mk-eyebrow">What your editors see</span>
              <h2 style={{ marginTop: "14px" }}>A link, a look, a tap. No account required.</h2>
              <p className="lede" style={{ marginTop: "18px" }}>
                Every pitch is a single mobile page: watermarked previews, your caption, the price,
                the terms, and a countdown if you&apos;ve offered an exclusive. Editors accept or
                counter with one tap and never create a login. The license and full-resolution files
                are released to them the moment they accept, and every open and download is logged
                for you.
              </p>
            </div>
            <div className="edsteps">
              <div>
                <i>1</i>
                <div>
                  <b>They get a link</b>
                  <p>By email or text, from you. Opens on any phone.</p>
                </div>
              </div>
              <div>
                <i>2</i>
                <div>
                  <b>They see the set</b>
                  <p>Previews, caption, terms, price, exclusive countdown.</p>
                </div>
              </div>
              <div>
                <i>3</i>
                <div>
                  <b>They accept or counter</b>
                  <p>One tap at asking, or a structured counter.</p>
                </div>
              </div>
              <div>
                <i>4</i>
                <div>
                  <b>Files and license arrive</b>
                  <p>Full-res unlocks on acceptance. Downloads are logged.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Bring your archive in</span>
              <h2>Ten years of hard drives, searchable by the weekend.</h2>
            </div>
            <p className="lede">
              The archive features only pay off if the archive is in. Import from Dropbox, Google
              Drive, external drives, or an agency export. Mastline reads the captions and keywords
              already embedded in your files, groups frames into sets by time and place, and queues
              anything untagged for quick, assisted tagging so every subject you&apos;ve ever shot
              becomes something it can watch the news for.
            </p>
          </div>
          <div className="principles">
            <div>
              <h3>Bulk import</h3>
              <p>
                Point Mastline at a folder, a drive, or a cloud account. Originals are preserved
                untouched; previews generate in the background.
              </p>
            </div>
            <div>
              <h3>Reads what&apos;s already there</h3>
              <p>
                IPTC captions, keywords, dates, and locations come in automatically. Nothing
                you&apos;ve typed before gets typed again.
              </p>
            </div>
            <div>
              <h3>Assisted tagging</h3>
              <p>
                Untagged sets are grouped and suggested names offered from faces and context. You
                confirm with a tap; twenty sets takes about six minutes.
              </p>
            </div>
            <div>
              <h3>Watching from day one</h3>
              <p>
                As soon as a subject is tagged, the news radar is watching for them. Your first
                archive signal often arrives before the import finishes.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Works with the tools you already use</span>
              <h2>Keep your editor. Keep your storage. Keep your accountant.</h2>
            </div>
            <p className="lede">
              Mastline is the business layer, not a replacement for how you shoot, edit, or do your
              books.
            </p>
          </div>
          <div className="integrations">
            <div>
              <b>Photo Mechanic</b>
              <span>Ingest and captions flow straight in</span>
            </div>
            <div>
              <b>Lightroom Classic</b>
              <span>Export presets for Mastline packages</span>
            </div>
            <div>
              <b>Capture One</b>
              <span>Tethered and session workflows</span>
            </div>
            <div>
              <b>Dropbox</b>
              <span>Import, sync, and archive</span>
            </div>
            <div>
              <b>Google Drive</b>
              <span>Import, sync, and archive</span>
            </div>
            <div>
              <b>QuickBooks &amp; Xero</b>
              <span>Invoices and payments sync to your books</span>
            </div>
            <div>
              <b>Stripe</b>
              <span>Card and bank payments from buyers</span>
            </div>
            <div>
              <b>Email &amp; SMS</b>
              <span>Pitches go out the way editors already read</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="appblock">
            <div>
              <span className="mk-eyebrow">On your phone</span>
              <h3 style={{ marginTop: "10px" }}>
                A web app that works anywhere, nothing to install.
              </h3>
              <p>
                Open Mastline in the browser on your phone and upload from the camera roll or a card
                reader, tag, pitch, accept a counter, and release files without opening a laptop.
                Add it to your home screen and it behaves like an app. Everything is there on your
                desktop for the desk work the next morning.
              </p>
            </div>
            <div className="stores">
              <Link className="btn primary" href="/sign-up">
                Start your 30-day trial
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Intelligence and automation</span>
              <h2>Suggestions that show their work.</h2>
            </div>
            <p className="lede">
              Mastline removes the repetitive work without touching your judgment, your contracts,
              or your evidence. It makes suggestions, shows why, and leaves the final call to you.
            </p>
          </div>
          <div className="principles">
            <div>
              <h3>Metadata assistance</h3>
              <p>
                Suggested names, locations, dates, event context, caption structure, keywords, and
                duplicate detection from the shoot record and image data.
              </p>
            </div>
            <div>
              <h3>Selects support</h3>
              <p>
                Group bursts, flag technical issues, and surface visual variation so large sets
                review faster, without claiming aesthetic certainty.
              </p>
            </div>
            <div>
              <h3>Buyer-fit recommendations</h3>
              <p>
                Learn which outlets buy which subjects, formats, territories, and story types;
                recommend packaging and outreach from actual history.
              </p>
            </div>
            <div>
              <h3>Deadline and follow-up automation</h3>
              <p>
                Alerts when dispatch windows are closing, submissions are stale, invoices are aging,
                or statement data is incomplete.
              </p>
            </div>
            <div>
              <h3>Rights-match triage</h3>
              <p>
                Suspected use ranked by visual confidence, commercial importance, publisher,
                territory, and known license history.
              </p>
            </div>
            <div>
              <h3>Revenue intelligence</h3>
              <p>
                Earnings patterns by subject, buyer, venue, format, turnaround time, and cost, so
                you can decide where the next night is worth spending.
              </p>
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
            <Link className="btn light" href="/sign-up">
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
