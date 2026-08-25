import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Copyright" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / Copyright
          </div>
          <h1>Copyright and DMCA Policy</h1>
          <p className="lede">
            Mastline stores and transmits photographs on behalf of the photographers who own them.
            We respect copyright in both directions: we protect our photographers’ work, and we
            respond promptly when someone believes their work has been used without permission.
          </p>
        </div>
      </section>
      <section>
        <div className="wrap">
          <div className="legal">
            <p className="meta">Effective August 21, 2026</p>

            <h2>1. Designated copyright agent</h2>
            <p>
              Under the Digital Millennium Copyright Act (17 U.S.C. § 512), Mastline has designated
              an agent to receive notices of claimed infringement. Notices may be sent to:
            </p>
            <p>
              <strong>Copyright Agent</strong>
              <br />
              Storyworlding
              <br />
              155 Prince Street, Floor 3<br />
              New York, NY 10012
              <br />
              Email: <a href="mailto:copyright@mastline.co">copyright@mastline.co</a>
              <br />
              Phone: [AGENT PHONE]
            </p>
            <p>
              This agent is registered with the United States Copyright Office. [CONFIRM
              REGISTRATION AND ADD DIRECTORY LISTING DATE.] Please use this contact only for
              copyright matters; other questions go to{" "}
              <a href="mailto:hello@mastline.co">hello@mastline.co</a>.
            </p>

            <h2>2. Sending a takedown notice</h2>
            <p>
              If you believe material on Mastline infringes your copyright, send a written notice to
              the agent above that includes:
            </p>
            <ul>
              <li>
                Your physical or electronic signature, or that of a person authorized to act for
                you.
              </li>
              <li>Identification of the copyrighted work you claim has been infringed.</li>
              <li>
                Identification of the material you claim is infringing, with enough detail for us to
                locate it, such as the Mastline pitch link, set reference, or URL.
              </li>
              <li>Your name, mailing address, telephone number, and email address.</li>
              <li>
                A statement that you have a good-faith belief that the use is not authorized by the
                copyright owner, its agent, or the law.
              </li>
              <li>
                A statement, made under penalty of perjury, that the information in the notice is
                accurate and that you are the copyright owner or authorized to act on the
                owner’s behalf.
              </li>
            </ul>
            <p>
              Notices that are missing required elements may not be acted on. Knowingly
              misrepresenting that material is infringing can expose you to liability for damages
              under Section 512(f).
            </p>

            <h2>3. What happens when we receive a notice</h2>
            <ul>
              <li>We acknowledge receipt, usually within one business day.</li>
              <li>
                If the notice is complete, we promptly disable access to the identified material on
                Mastline, including pitch links and downloads, and record the action in the
                image’s provenance log.
              </li>
              <li>
                We notify the photographer whose account holds the material, provide a copy of the
                notice, and explain the counter-notice process.
              </li>
              <li>We retain the notice and our response as part of the asset record.</li>
            </ul>
            <p>
              Mastline cannot remove an image from a publication, website, or outlet that has
              already licensed or published it. Our action is limited to material hosted on or
              transmitted through Mastline.
            </p>

            <h2>4. Counter-notice</h2>
            <p>
              If material you uploaded was disabled and you believe this was a mistake or
              misidentification, you may send a counter-notice to the agent that includes:
            </p>
            <ul>
              <li>Your physical or electronic signature.</li>
              <li>
                Identification of the material that was disabled and where it appeared before it was
                disabled.
              </li>
              <li>
                A statement, under penalty of perjury, that you have a good-faith belief the
                material was disabled as a result of mistake or misidentification.
              </li>
              <li>
                Your name, address, and telephone number, and a statement that you consent to the
                jurisdiction of the federal district court for your district (or, if outside the
                United States, for any district in which Mastline may be found) and that you will
                accept service of process from the person who filed the original notice.
              </li>
            </ul>
            <p>
              On receiving a valid counter-notice we forward it to the original complainant. Unless
              they notify us within 10 business days that they have filed a court action seeking to
              restrain the use, we restore the material within 10 to 14 business days.
            </p>

            <h2>5. Repeat infringers</h2>
            <p>
              Mastline terminates, in appropriate circumstances, the accounts of users who are
              repeat infringers. We track notices against each account. Two substantiated notices
              without a successful counter-notice within a 12-month period result in a review; a
              third results in termination. We may act sooner where infringement is flagrant.
            </p>

            <h2>6. Protecting our photographers’ work</h2>
            <p>
              The same rules protect the photographers who use Mastline. If you are a Mastline
              photographer and find your image used without a license, Rights Matches helps you
              gather evidence and send a licensing request or invoice. Where a takedown is
              warranted, the tool prepares a notice that meets the requirements above for you to
              send to the hosting service. Mastline does not send takedown notices on your behalf
              without your confirmation.
            </p>

            <h2>7. Provenance</h2>
            <p>
              Every image on Mastline carries its original file hash, capture metadata, and an
              append-only history of pitches, licenses, and downloads. This record is available to
              the photographer, and we provide it in response to lawful process, which makes
              ownership disputes faster to resolve for everyone.
            </p>

            <h2>8. Changes</h2>
            <p>
              We may update this policy. Material changes are noted here with a new effective date.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
