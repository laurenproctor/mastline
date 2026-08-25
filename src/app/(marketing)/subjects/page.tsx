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
            that was pitched or licensed using Mastline. Here is what Mastline is, what it isn’t,
            and how to reach Mastline.
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
              Mastline does not track people’s locations, scrape private accounts, or coordinate
              photographers toward any individual. Its news radar reads public information only:
              premieres, court calendars, published stories, and announced appearances. These rules
              are written into Mastline’s <Link href="/terms">Terms of Service</Link> and enforced
              in the software. If you believe a Mastline photographer has behaved in a way that
              breaks them, Mastline wants to know.
            </p>

            <h2>What Mastline can and cannot do about a picture</h2>
            <p>
              Mastline can route your concern to the photographer who holds the image, record that
              you raised it, and, where Mastline’s rules have been broken, act on the account.
              Mastline cannot remove a picture from a newspaper, website, or outlet that has already
              published it; that request needs to go to the publisher. Mastline also cannot
              adjudicate privacy or publicity claims. Photography of people in public places is
              generally lawful in the places Mastline operates, and the rules vary by jurisdiction,
              so where a dispute involves the law, it is a matter between you, the photographer,
              and, if necessary, the courts.
            </p>

            <h2>Situations Mastline treats as urgent</h2>
            <ul>
              <li>
                <strong>Safety.</strong> If a picture or its caption reveals a private home address,
                a school, or a pattern of movement that puts someone at risk, tell Mastline. It acts
                immediately on anything it hosts.
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

            <h2>How to contact Mastline</h2>
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
              Mastline acknowledges every message within two business days, tell you what Mastline
              can do, and keep your message confidential. Mastline does not share your contact
              details with the photographer unless you ask Mastline to.
            </p>

            <h2>Your information</h2>
            <p>
              Anything you send Mastline is handled under Mastline’s{" "}
              <Link href="/privacy">Privacy Policy</Link>. Mastline keeps it only as long as needed
              to address your concern and any related obligations.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
