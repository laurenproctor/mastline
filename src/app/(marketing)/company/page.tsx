import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Company" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / Company
          </div>
          <h1>Built for the people who make the pictures.</h1>
          <p className="lede">
            Mastline helps professional paparazzi manage the business behind every image, from
            opportunity and shoot planning to dispatch, rights, payments, and archive resale, in one
            purpose-built workspace.
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="who">
            <div>
              <span className="mk-eyebrow">About Mastline</span>
              <h2 style={{ marginTop: "14px" }}>
                A Storyworlding company, built on the sidewalks of Hollywood and New York.
              </h2>
              <p className="lede" style={{ marginTop: "18px" }}>
                Mastline is a Storyworlding company founded by Lauren Proctor. It was built in
                collaboration with working paparazzi in Hollywood and New York, the photographers
                who stand outside the premiere, the courthouse, and the hotel at one in the morning,
                and who make the pictures the rest of the industry runs on.
              </p>
            </div>
            <div>
              <p style={{ fontSize: "16px", lineHeight: "1.6", color: "var(--ink-2)" }}>
                Storyworlding is the practice of building the world around a story rather than a
                single product inside it. For Mastline, that meant starting with the people, not the
                software: riding along on shoots, sitting at kitchen tables while invoices were
                chased, and watching ten years of archive sit on hard drives earning nothing. Every
                screen in Mastline answers a question a working photographer actually asked us.
              </p>
              <p
                style={{
                  fontSize: "16px",
                  lineHeight: "1.6",
                  color: "var(--ink-2)",
                  marginTop: "14px",
                }}
              >
                The photographers who helped shape it still use it every night, and they still tell
                us what&apos;s wrong with it. That&apos;s the arrangement. Mastline exists to make
                their business faster, more visible, and more valuable, and to give every picture
                they take a memory that outlasts the news cycle.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="who">
            <div>
              <span className="mk-eyebrow">Who it&apos;s for</span>
              <h2 style={{ marginTop: "14px" }}>
                Independent professionals and teams of two to ten.
              </h2>
              <p className="lede" style={{ marginTop: "18px" }}>
                Photographers and small agencies who already produce meaningful volume but still
                coordinate through informal systems. Their pain is acute, their workflows are
                observable, and Mastline creates value without asking them to change how they
                already sell or distribute work.
              </p>
              <Link className="more" href="/teams">
                Mastline for teams and agencies{" "}
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
            <div>
              <span className="mk-eyebrow">What Mastline is not</span>
              <ol>
                <li>
                  Not a generic digital asset manager with paparazzi terminology added afterward.
                </li>
                <li>
                  Not a generic media library, accounting package, or project-management tool.
                </li>
                <li>
                  Not an editing suite; it integrates with the tools photographers already use.
                </li>
                <li>Not an automated legal decision-maker.</li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Differentiation</span>
              <h2>Not unprecedented features. Shared context.</h2>
            </div>
            <p className="lede">
              Mastline&apos;s advantage is that its features share context across the full
              commercial lifecycle and are designed for one highly specific form of work.
            </p>
          </div>
          <div className="tablewrap">
            <table className="diff">
              <thead>
                <tr>
                  <th>Alternative</th>
                  <th>What it does well</th>
                  <th>What Mastline adds</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Agency submission portal</td>
                  <td>Receives and distributes content</td>
                  <td>Photographer-owned history across all buyers and outcomes</td>
                </tr>
                <tr>
                  <td>Digital asset manager</td>
                  <td>Stores, organizes, and retrieves media</td>
                  <td>Live opportunity, dispatch, sales, rights, and revenue workflow</td>
                </tr>
                <tr>
                  <td>Project management tool</td>
                  <td>Tracks tasks and collaboration</td>
                  <td>Image-level metadata, provenance, submissions, licenses, and earnings</td>
                </tr>
                <tr>
                  <td>Rights-monitoring service</td>
                  <td>Finds suspected online use</td>
                  <td>
                    Authorization context, asset history, revenue records, and operational triage
                  </td>
                </tr>
                <tr>
                  <td>News alert product</td>
                  <td>Surfaces current events</td>
                  <td>
                    Connects news directly to shoots, archives, buyers, and commercial actions
                  </td>
                </tr>
                <tr>
                  <td>Spreadsheet and email</td>
                  <td>Flexible and familiar</td>
                  <td>One connected, searchable, automated system of record</td>
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
              <span className="mk-eyebrow">Common questions</span>
              <h2 style={{ marginTop: "14px" }}>Before you start.</h2>
            </div>
            <div className="faq">
              <details open>
                <summary>Do I have to leave my agency?</summary>
                <p>
                  No. Keep every relationship you have. Record those sales in Mastline with no
                  commission, and use Mastline&apos;s own pitching and archive tools alongside them.
                </p>
              </details>
              <details>
                <summary>Does it handle video?</summary>
                <p>
                  Yes. Clips are pitched, licensed, delivered, and tracked exactly like stills, and
                  the archive monitor watches them too.
                </p>
              </details>
              <details>
                <summary>Does it work on my phone?</summary>
                <p>
                  Yes. Mastline is a web app, so there is nothing to install: open it in your
                  phone&apos;s browser, add it to your home screen, and it works like an app. Most
                  photographers run the whole night from the phone and do the desk work on a laptop
                  the next day.
                </p>
              </details>
              <details>
                <summary>Which markets do you support?</summary>
                <p>
                  Mastline is built in New York and used most heavily in New York, Los Angeles, and
                  London. Pitches, licenses, and invoices work in dollars, pounds, and euros, with
                  terms set by territory.
                </p>
              </details>
              <details>
                <summary>What happens to my data if I leave?</summary>
                <p>
                  You export everything, including originals, records, licenses, and invoices, from
                  Settings, with a 30-day window after closing your account. Your archive and your
                  history never belong to us.
                </p>
              </details>
              <details>
                <summary>How do I get my old archive in?</summary>
                <p>
                  Import from Dropbox, Google Drive, external drives, or an agency export. Existing
                  captions and keywords are read automatically; untagged sets go into an assisted
                  tagging queue.
                </p>
              </details>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Contact</span>
              <h2>Talk to the team.</h2>
            </div>
            <p className="lede">
              Press, partnerships, agencies, or just a photographer with an opinion: we want to hear
              from you.
            </p>
          </div>
          <div className="actions" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <Link className="btn primary" href="/early-access">
              Start free
            </Link>
            <a className="btn ghost" href="mailto:hello@mastline.co">
              hello@mastline.co
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
