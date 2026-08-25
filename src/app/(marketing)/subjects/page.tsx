import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Subjects" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / If you appear in a photo
          </div>
          <h1>If you appear in a photograph handled through Mastline.</h1>
          <p className="lede">
            You may have found this page because you, or someone you represent, appears in a picture
            that was pitched or licensed using Mastline. Here is what Mastline is, what it
            isn’t, and how to reach us.
          </p>
        </div>
      </section>
      <section>
        <div className="wrap">
          <div className="legal">
            <h2>What Mastline is</h2>
            <p>
              Mastline is business software used by professional photographers to organize, pitch,
              license, and get paid for their work. It is a tool, like a camera or an email account.
              The photographers who use it own their images and decide what to do with them.
              Mastline does not take photographs, does not decide what gets published, and does not
              own any picture on the platform.
            </p>

            <h2>What Mastline will not do</h2>
            <p>
              Mastline does not track people’s locations, scrape private accounts, or
              coordinate photographers toward any individual. Its news radar reads public
              information only: premieres, court calendars, published stories, and announced
              appearances. These rules are written into our{" "}
              <Link href="/terms">Terms of Service</Link> and enforced in the software. If you
              believe a Mastline photographer has behaved in a way that breaks them, we want to
              know.
            </p>

            <h2>What we can and cannot do about a picture</h2>
            <p>
              We can route your concern to the photographer who holds the image, record that you
              raised it, and, where our rules have been broken, act on the account. We cannot remove
              a picture from a newspaper, website, or outlet that has already published it; that
              request needs to go to the publisher. We also cannot adjudicate privacy or publicity
              claims. Photography of people in public places is generally lawful in the places
              Mastline operates, and the rules vary by jurisdiction, so where a dispute involves the
              law, it is a matter between you, the photographer, and, if necessary, the courts.
            </p>

            <h2>Situations we treat as urgent</h2>
            <ul>
              <li>
                <strong>Safety.</strong> If a picture or its caption reveals a private home address,
                a school, or a pattern of movement that puts someone at risk, tell us and we will
                act immediately on anything hosted on Mastline.
              </li>
              <li>
                <strong>Minors.</strong> Concerns involving images of children are reviewed first
                and escalated to the account holder the same day.
              </li>
              <li>
                <strong>Legal process.</strong> Court orders, subpoenas, and law-enforcement
                requests are handled by counsel. Send them to{" "}
                <a href="mailto:legal@mastline.co">legal@mastline.co</a>.
              </li>
            </ul>

            <h2>How to contact us</h2>
            <p>
              Email <a href="mailto:subjects@mastline.co">subjects@mastline.co</a>. Please include:
            </p>
            <ul>
              <li>Who you are and, if you are a representative, whom you represent.</li>
              <li>
                How you came across the image: a publication, a link, a pitch, or another route.
              </li>
              <li>
                As much detail as you have about the picture: where and roughly when it was taken,
                where it appeared.
              </li>
              <li>What concerns you about it.</li>
            </ul>
            <p>
              We acknowledge every message within two business days, tell you what we can do, and
              keep your message confidential. We do not share your contact details with the
              photographer unless you ask us to.
            </p>

            <h2>Your information</h2>
            <p>
              Anything you send us is handled under our <Link href="/privacy">Privacy Policy</Link>.
              We keep it only as long as needed to address your concern and any related obligations.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
