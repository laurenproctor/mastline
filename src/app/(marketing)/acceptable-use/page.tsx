import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Acceptable use" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / Acceptable use
          </div>
          <h1>Acceptable use, in one screen.</h1>
          <p className="lede">
            The plain-English version of the rules every Mastline account agrees to. The{" "}
            <Link href="/terms">Terms of Service</Link> control if anything here conflicts with
            them.
          </p>
        </div>
      </section>
      <section>
        <div className="wrap">
          <div className="vs">
            <div className="m">
              <span className="mk-eyebrow">What Mastline is for</span>
              <ul
                style={{
                  margin: "10px 0 0",
                  paddingLeft: "18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  fontSize: "15px",
                  color: "var(--ink-2)",
                }}
              >
                <li>
                  Organizing, captioning, and selling photographs and video you took, or have the
                  rights to license, in public places and at events.
                </li>
                <li>
                  Pitching picture desks and buyers, running exclusives, issuing licenses, and
                  delivering files.
                </li>
                <li>Recording sales you made elsewhere, invoicing, and tracking payment.</li>
                <li>
                  Storing your archive and being told when something in it is newsworthy again.
                </li>
                <li>
                  Finding where your images are used without a license and pursuing payment through
                  lawful means.
                </li>
                <li>Working as a team, with roles and revenue splits you control.</li>
              </ul>
            </div>
            <div>
              <span
                className="mk-eyebrow"
                style={{
                  color: "var(--ink)",
                  background: "var(--green)",
                  padding: "3px 7px",
                  display: "inline-block",
                }}
              >
                What gets an account closed
              </span>
              <ul
                style={{
                  margin: "10px 0 0",
                  paddingLeft: "18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  fontSize: "15px",
                  color: "var(--ink-2)",
                }}
              >
                <li>Uploading images you don&apos;t own or have no right to license.</li>
                <li>
                  Using Mastline to follow, harass, threaten, or endanger anyone, or to coordinate
                  others to do so.
                </li>
                <li>
                  Storing private addresses, private movements, or scraped private-account data as
                  &quot;tips.&quot;
                </li>
                <li>
                  Sexual or exploitative content involving minors, or any unlawful content. This is
                  reported, not just removed.
                </li>
                <li>
                  Presenting altered or synthetic imagery as genuine editorial photography, or
                  faking provenance.
                </li>
                <li>
                  Accessing another user&apos;s account or data, probing the service, or abusing
                  buyer contact information.
                </li>
                <li>
                  Repeated copyright infringement, under our{" "}
                  <Link href="/copyright">Copyright Policy</Link>.
                </li>
              </ul>
            </div>
          </div>
          <div className="legal" style={{ marginTop: "40px" }}>
            <h2>How enforcement works</h2>
            <p>
              We review reports from buyers, subjects, other photographers, and our own systems.
              Where a rule has been broken we may warn, restrict features, suspend, or terminate,
              depending on severity, and we tell the account holder what happened and why. Serious
              harm to any person is escalated immediately and, where required, reported to
              authorities. Decisions can be appealed by email to{" "}
              <a href="mailto:legal@mastline.co">legal@mastline.co</a>.
            </p>
            <h2>Reporting a concern</h2>
            <p>
              Photographers and buyers: <a href="mailto:support@mastline.co">support@mastline.co</a>
              . People who appear in a photograph: see{" "}
              <Link href="/subjects">If you appear in a photo</Link>. Copyright:{" "}
              <Link href="/copyright">Copyright and DMCA Policy</Link>. Security:{" "}
              <a href="mailto:security@mastline.co">security@mastline.co</a>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
