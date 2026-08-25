import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = { title: "Teams" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / Teams & agencies
          </div>
          <h1>Run a crew like one business, not five phones.</h1>
          <p className="lede">
            Everything Mastline does for one photographer, shared across a team: one buyer history,
            one dispatch queue, one set of books, and splits that pay out without a spreadsheet.
          </p>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "24px" }}>
            <Link className="btn primary" href="/sign-up">
              Start a Studio trial
            </Link>
            <a className="btn ghost" href="mailto:hello@mastline.co?subject=Agency%20plan">
              Ask about Agency
            </a>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Who it’s for</span>
              <h2>Crews of two to ten, and the agencies that grew out of them.</h2>
            </div>
            <p className="lede">
              A lead shooter with two regulars. A husband-and-wife team that splits every night. A
              boutique agency with a desk, a dispatcher, and a dozen contributors on an Agency plan.
              Where more than one person touches the pictures or the money, this is the plan.
            </p>
          </div>
          <div className="wants">
            <div className="want">
              <span className="k">
                Same <em>night,</em> one record
              </span>
              <h3>Everyone’s frames, one set</h3>
              <p>
                Three shooters at three doors of the same venue upload to one shoot. Captions,
                selects, and the pitch draw from all of it. The buyer sees one package, not three
                emails.
              </p>
              <span className="foot">Shared shoots · Combined selects</span>
            </div>
            <div className="want">
              <span className="k">
                One <em>desk,</em> not five inboxes
              </span>
              <h3>Dispatch and review in a queue</h3>
              <p>
                Packages wait for whoever is on the desk to check names, restrictions, and outlet
                rules, then go out under the team’s name. Nothing leaves twice; nothing leaves
                wrong.
              </p>
              <span className="foot">Review queue · Approvals</span>
            </div>
            <div className="want">
              <span className="k">
                Paid <em>out,</em> not argued out
              </span>
              <h3>Splits that settle themselves</h3>
              <p>
                Set the split once per person, per shoot, or per deal. When the sale lands, every
                share is calculated and paid, with the record to show who shot what and who earned
                what.
              </p>
              <span className="foot">Revenue splits · Per-person statements</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">What a team gets</span>
              <h2>
                Everything in Pro, plus the parts that only matter with more than one shooter.
              </h2>
            </div>
          </div>
          <div className="principles">
            <div>
              <h3>Shared buyer history</h3>
              <p>
                Every editor any team member has ever pitched, what they bought, what they paid, and
                when they open links, in one graph the whole crew sells from. New shooters inherit
                years of relationships on day one.
              </p>
            </div>
            <div>
              <h3>Roles and permissions</h3>
              <p>
                Owner, shooter, dispatcher, finance, and rights review. A contributor sees their own
                shoots and earnings; the desk sees every package; finance sees the money; nobody
                sees a confidential source they weren’t given.
              </p>
            </div>
            <div>
              <h3>Dispatch and review queues</h3>
              <p>
                Packages assemble from any shooter’s frames and wait for desk approval.
                Outlet-specific rules are checked automatically; the human on the desk makes the
                call.
              </p>
            </div>
            <div>
              <h3>Revenue splits and statements</h3>
              <p>
                Percentage or fixed splits, set by default and overridden per deal. Monthly
                statements per person, with every line tied to a picture, a buyer, and a license.
              </p>
            </div>
            <div>
              <h3>Team revenue reporting</h3>
              <p>
                Earnings by shooter, buyer, venue, subject, and night, with costs and net. See which
                crews, which doors, and which desks actually pay.
              </p>
            </div>
            <div>
              <h3>One shared archive</h3>
              <p>
                Ten years of everyone’s frames, searchable by subject, watched by the news radar,
                pitched under the team’s name, with the original shooter credited and paid on every
                resale.
              </p>
            </div>
            <div>
              <h3>Source protection across the team</h3>
              <p>
                Tips and locations are stored per person with their own visibility. A lead can share
                a tip with tonight’s crew without it living in everyone’s account forever.
              </p>
            </div>
            <div>
              <h3>Workload at a glance</h3>
              <p>
                Who is on which shoot, what is waiting for review, whose invoices are aging, and
                what the archive wants pitched, on one Work Queue for the whole team.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="spot">
        <div className="wrap">
          <div>
            <span className="mk-eyebrow">A night for a crew</span>
            <h2>Three doors, one package, one payout.</h2>
            <div className="who" style={{ gridTemplateColumns: "1fr", gap: "0", marginTop: "8px" }}>
              <div>
                <ol>
                  <li>
                    <span>
                      <strong>10:40 PM.</strong> The lead creates the shoot and assigns two shooters
                      to the side entrances. The tip stays in the lead’s account; the crew sees the
                      brief.
                    </span>
                  </li>
                  <li>
                    <span>
                      <strong>11:08 PM.</strong> All three upload to the same shoot from the
                      sidewalk. Selects are grouped across shooters; the best frame at each door
                      rises.
                    </span>
                  </li>
                  <li>
                    <span>
                      <strong>11:14 PM.</strong> The dispatcher reviews one package, fixes a name,
                      and sends six pitches under the agency’s name, with a 45-minute exclusive to
                      two desks.
                    </span>
                  </li>
                  <li>
                    <span>
                      <strong>11:31 PM.</strong> A desk accepts. The license names the agency; the
                      provenance names the shooter whose frame ran.
                    </span>
                  </li>
                  <li>
                    <span>
                      <strong>Next morning.</strong> The invoice is out. The split is calculated:
                      lead, two shooters, house. Each sees their line in their own statement.
                    </span>
                  </li>
                </ol>
              </div>
            </div>
          </div>
          <div className="shot">
            <Image
              src="/marketing/news-radar.jpg"
              alt="Mastline screen"
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
              <span className="mk-eyebrow">For agencies</span>
              <h2>A tailored operating layer for larger operations.</h2>
            </div>
            <p className="lede">
              Agency plans are built around how a crew already works: its contributor structure,
              outlet contracts, accounting, and archive.
            </p>
          </div>
          <div className="principles">
            <div>
              <h3>Custom team structure</h3>
              <p>
                Staff, contributors, stringers, and desks, with contract-specific splits and
                visibility for each.
              </p>
            </div>
            <div>
              <h3>High-volume archive migration</h3>
              <p>
                Mastline moves the existing archive and metadata in, with tagging assistance and the
                original shooter preserved on every frame, so resale credits and pays the right
                person.
              </p>
            </div>
            <div>
              <h3>Outlet requirements, built in</h3>
              <p>
                Delivery templates per outlet: file naming, caption format, invoice layout, PO
                rules. Every package from every contributor follows them.
              </p>
            </div>
            <div>
              <h3>API access and integrations</h3>
              <p>
                Connect Mastline to an existing portal, accounting, storage, or rights-monitoring
                service. Keep what works; replace what doesn’t.
              </p>
            </div>
            <div>
              <h3>Agency-wide reporting and governance</h3>
              <p>
                Asset, submission, and revenue reporting across the whole operation, with retention,
                audit, and export controls counsel will sign off on.
              </p>
            </div>
            <div>
              <h3>Priority support and onboarding</h3>
              <p>
                A named contact, onboarding for the desk and its contributors, and the same
                night-hours support every shooter gets.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Plans for teams</span>
              <h2>Studio for crews. Agency for operations.</h2>
            </div>
            <p className="lede">
              The 70/30 split works the same way for teams: nothing on sales the crew makes itself,
              30% only on sales Mastline creates, divided by the crew’s own splits. Full detail on
              the <Link href="/pricing">Pricing</Link> page.
            </p>
          </div>
          <div className="vs">
            <div className="m">
              <span className="mk-eyebrow">Studio</span>
              <span className="big">
                $279
                <small
                  style={{
                    fontFamily: "var(--sans)",
                    fontSize: "14px",
                    color: "var(--ink-3)",
                    letterSpacing: "0",
                    marginLeft: "6px",
                  }}
                >
                  per month, billed annually
                </small>
              </span>
              <p>
                Up to 10 team members. Dispatch and review queues, roles and approvals, team revenue
                allocation, 5 TB shared archive. Everything in Pro for every seat.
              </p>
              <Link
                className="btn primary"
                href="/sign-up"
                style={{ alignSelf: "flex-start", marginTop: "8px" }}
              >
                Start a Studio trial
              </Link>
            </div>
            <div>
              <span className="mk-eyebrow">Agency</span>
              <span className="big">Custom</span>
              <p>
                Custom team structure, high-volume archive migration, API access and integrations,
                custom permissions, priority support, flexible storage. Priced around contributor
                count and archive volume.
              </p>
              <a
                className="btn ghost"
                href="mailto:hello@mastline.co?subject=Agency%20plan"
                style={{ alignSelf: "flex-start", marginTop: "8px" }}
              >
                Contact Mastline
              </a>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="faq-grid">
            <div>
              <span className="mk-eyebrow">Questions from crews</span>
              <h2>Before bringing a team over.</h2>
            </div>
            <div className="faq">
              <details open>
                <summary>Who owns the pictures on a team account?</summary>
                <p>
                  Whoever the crew’s agreement says. Mastline records the shooter on every frame and
                  never takes ownership itself. By default the account owner controls distribution
                  and the shooter is credited; it can be configured to match existing contracts.
                </p>
              </details>
              <details>
                <summary>Can a contributor take their work with them if they leave?</summary>
                <p>
                  That is between the crew and its shooters, and Mastline supports either answer.
                  Per-shooter export is available when the owner allows it, and the shooter’s credit
                  and provenance stay on the frames either way.
                </p>
              </details>
              <details>
                <summary>Can contributors keep their own Mastline accounts?</summary>
                <p>
                  Yes. A photographer can belong to a team for the work they do with it and keep a
                  separate Solo or Pro account for their own work. The two never mix.
                </p>
              </details>
              <details>
                <summary>How do splits handle archive resales years later?</summary>
                <p>
                  The split on the original shoot applies unless a different archive rule is set.
                  The original shooter is identified on every frame, so resale pays the right person
                  automatically.
                </p>
              </details>
              <details>
                <summary>Can the desk see a shooter’s sources?</summary>
                <p>
                  Only if the shooter shares them. Tips and locations are stored per person with
                  their own visibility, and access is logged.
                </p>
              </details>
              <details>
                <summary>Crews bigger than ten — is that Agency?</summary>
                <p>
                  Yes. Studio covers up to ten seats; beyond that, Agency is priced around
                  contributor count and archive size. Email{" "}
                  <a href="mailto:hello@mastline.co">hello@mastline.co</a> with contributor count
                  and archive size, and a reply says which plan fits and what migration looks like.
                </p>
              </details>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>Bring one night’s crew. Keep the rest of the business.</h2>
            <p>Thirty days free on Studio. Agency plans start with a conversation.</p>
          </div>
          <div className="actions">
            <Link className="btn light" href="/sign-up">
              Start a Studio trial
            </Link>
            <a className="btn outline" href="mailto:hello@mastline.co?subject=Agency%20plan">
              Ask about Agency
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
