import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LifecycleChain } from "../_components/lifecycle";

export const metadata: Metadata = { title: "How it works" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / How it works
          </div>
          <h1>Mastline follows the work in the order it actually happens.</h1>
          <p className="lede">
            Each step creates records that make the next step faster and the entire business more
            measurable. The value compounds because every operational action strengthens the record
            around the image.
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="flow">
            <div>
              <h3>Discover the opportunity</h3>
              <p>
                Monitor breaking news, scheduled appearances, locations, tips, and stories the
                archive already covers.
              </p>
            </div>
            <div>
              <h3>Create the shoot</h3>
              <p>
                Capture the subject, story hypothesis, location, time window, priority, buyer
                interest, team, and expected costs.
              </p>
            </div>
            <div>
              <h3>Work the assignment</h3>
              <p>
                A live workspace for notes, logistics, contacts, files, selects, and readiness
                status.
              </p>
            </div>
            <div>
              <h3>Prepare the dispatch</h3>
              <p>
                Review captions, entities, timestamps, location, releases or restrictions, outlet
                packages, and delivery requirements.
              </p>
            </div>
            <div>
              <h3>Record every submission</h3>
              <p>
                Track which assets were sent to which buyer, when, under what terms, and with what
                result.
              </p>
            </div>
            <div>
              <h3>Maintain the asset record</h3>
              <p>
                Preserve the original, derivatives, metadata, provenance, relationships,
                restrictions, usage, and earnings history.
              </p>
            </div>
            <div>
              <h3>Track money and rights</h3>
              <p>
                Reconcile sales and payments, flag aging receivables, surface possible unlicensed
                usage, and manage follow-up.
              </p>
            </div>
            <div>
              <h3>Reactivate the archive</h3>
              <p>
                Match current news with owned images and recommend timely pitches to likely buyers.
              </p>
            </div>
          </div>
          <div className="head" style={{ marginTop: "72px" }}>
            <div>
              <span className="mk-eyebrow">System logic</span>
              <h2>One fact, entered once, all the way down.</h2>
            </div>
            <p className="lede">
              The same chain, stage by stage: what each record keeps, and what the step after it
              inherits without anyone typing it again. Walk it with a click or the arrow keys.
            </p>
          </div>
          <LifecycleChain />
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">What comes back</span>
              <h2>Every hour spent shooting should pay for itself. Now it does.</h2>
            </div>
            <p className="lede">
              Mastline turns the scattered parts of the job into one connected record: faster moves,
              the right desks at the right price, payment on time, and pictures shot years ago still
              earning.
            </p>
          </div>
          <div className="friction">
            <div>
              <span className="was">
                Opportunities arrive through scattered tips, texts, alerts, and intuition.
              </span>
              <span className="now">
                A news radar and a prioritized work queue, so fewer opportunities are missed or
                late.
              </span>
            </div>
            <div>
              <span className="was">Shoot details live in memory or informal messages.</span>
              <span className="now">
                A structured shoot record with status, people, place, timing, and team.
              </span>
            </div>
            <div>
              <span className="was">
                Files, captions, and metadata are assembled under deadline.
              </span>
              <span className="now">
                A shoot workspace with assisted metadata, for faster and more consistent dispatch.
              </span>
            </div>
            <div>
              <span className="was">Submissions disappear into portals and email threads.</span>
              <span className="now">
                Submission records tied to assets and buyers, so follow-up is clear and every sale
                teaches the next one.
              </span>
            </div>
            <div>
              <span className="was">Payments are tracked manually or incompletely.</span>
              <span className="now">
                A revenue ledger with payment reconciliation and aging, for real cash visibility.
              </span>
            </div>
            <div>
              <span className="was">Archives become passive storage.</span>
              <span className="now">
                News-to-archive matching and resale prompts, so finished work keeps earning.
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="spot">
        <div className="wrap">
          <div>
            <span className="mk-eyebrow">The first hour</span>
            <h2>One live shoot, start to finish.</h2>
            <p className="lede" style={{ marginTop: "18px" }}>
              The first loop is designed to be fast enough to complete during real work. If Mastline
              can’t make one live shoot materially easier, nothing else matters.
            </p>
            <div className="who" style={{ gridTemplateColumns: "1fr", gap: "0", marginTop: "8px" }}>
              <div>
                <ol>
                  <li>Import or create one active shoot.</li>
                  <li>Add a small set of images and complete assisted metadata.</li>
                  <li>Build and approve a buyer-ready dispatch.</li>
                  <li>Record a submission and set a follow-up state.</li>
                  <li>Connect the resulting sale or expected payment to the same assets.</li>
                </ol>
              </div>
            </div>
            <span className="mk-eyebrow" style={{ display: "block", marginTop: "28px" }}>
              The first weekend
            </span>
            <p
              style={{
                marginTop: "10px",
                fontSize: "15px",
                color: "var(--ink-2)",
                maxWidth: "56ch",
              }}
            >
              Point Mastline at the archive and let it import overnight. Existing captions and
              keywords come in on their own; anything untagged waits in a queue that clears in a few
              short sessions. By Monday the news radar is watching every subject ever shot.
            </p>
          </div>
          <div className="shot">
            <Image
              src="/marketing/news-radar.jpg"
              alt="News radar screen in Mastline"
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
              <span className="mk-eyebrow">What changes</span>
              <h2>Faster, more commercially effective, more certain.</h2>
            </div>
          </div>
          <div className="mk-metrics">
            <div>
              <b>Capture to first dispatch</b>
              <p>Minutes, from the sidewalk</p>
            </div>
            <div>
              <b>Dispatches that pass metadata checks</b>
              <p>Caught before they leave</p>
            </div>
            <div>
              <b>Submission-to-sale rate</b>
              <p>Better targeting, better prices</p>
            </div>
            <div>
              <b>Margin per shoot</b>
              <p>Which nights actually pay</p>
            </div>
            <div>
              <b>Days from sale to payment</b>
              <p>Shorter, with fewer emails</p>
            </div>
            <div>
              <b>Archive share of revenue</b>
              <p>Work already done, earning again</p>
            </div>
            <div>
              <b>Rights matches recovered</b>
              <p>Money already owed</p>
            </div>
            <div>
              <b>Hours back each week</b>
              <p>Spent shooting, not administrating</p>
            </div>
          </div>
        </div>
      </section>
      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>Run the business behind every image.</h2>
            <p>
              Thirty days free on any plan. 100% of sales made directly, and 70% of the ones
              Mastline helps create.
            </p>
          </div>
          <div className="actions">
            <Link className="btn light" href="/sign-up">
              Start the 30-day trial
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
