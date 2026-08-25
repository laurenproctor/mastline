import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / Privacy
          </div>
          <h1>Privacy Policy</h1>
          <p className="lede">
            Mastline exists to protect the business behind your pictures. That starts with being
            clear about what we collect, why, and what we will never do with it.
          </p>
        </div>
      </section>
      <section>
        <div className="wrap">
          <div className="legal">
            <p className="meta">
              Effective August 21, 2026 · Applies to mastline.co and the Mastline application
            </p>

            <h2>1. Who we are</h2>
            <p>
              Mastline (“Mastline,” “we,” “us”) is operated by
              Storyworlding, with its principal place of business at 155 Prince Street, Floor 3, New
              York, NY 10012. We are the controller of the personal information described in this
              policy. You can reach us at{" "}
              <a href="mailto:privacy@mastline.co">privacy@mastline.co</a>.
            </p>

            <h2>2. What we collect</h2>
            <h3>Information you give us</h3>
            <ul>
              <li>
                <strong>Account details:</strong> name, email address, password, city or market, and
                billing information (processed by our payment provider; we do not store full card
                numbers).
              </li>
              <li>
                <strong>Your work:</strong> photographs, video, captions, metadata, shoot records,
                contacts, submissions, licenses, invoices, and payment records you add to Mastline.
              </li>
              <li>
                <strong>Contacts and buyers:</strong> names, outlets, email addresses, and notes
                about the editors and buyers you work with.
              </li>
              <li>
                <strong>Messages:</strong> support requests and anything you send us directly.
              </li>
            </ul>
            <h3>Information collected automatically</h3>
            <ul>
              <li>
                <strong>Usage data:</strong> pages and features used, actions taken, timestamps, and
                performance data, so we can keep Mastline fast and fix what breaks.
              </li>
              <li>
                <strong>Device and connection data:</strong> IP address, browser and device type,
                operating system, and approximate location derived from IP address.
              </li>
              <li>
                <strong>Pitch and license activity:</strong> when a buyer opens a pitch link,
                accepts a license, or downloads files. This is core to the product and is shown to
                you.
              </li>
            </ul>
            <h3>Information from third parties</h3>
            <p>
              If you connect storage, accounting, or other services, we receive the data you
              authorize those services to share. If you use Rights Matches, we receive results from
              image-matching providers about where your images may appear online.
            </p>

            <h2>3. How we use it</h2>
            <ul>
              <li>
                To run Mastline: store your work, send your pitches, issue licenses, track payments,
                and keep your records.
              </li>
              <li>
                To make suggestions inside your own workspace, such as captions, buyer fit, pricing
                bands, and archive matches, based on your own history.
              </li>
              <li>
                To secure the service, prevent fraud and abuse, and keep an audit trail of
                consequential actions.
              </li>
              <li>
                To bill you and communicate about your account, including service and security
                notices.
              </li>
              <li>To improve the product, using aggregated and de-identified usage patterns.</li>
              <li>To comply with law and enforce our Terms.</li>
            </ul>

            <h2>4. What we will not do</h2>
            <ul>
              <li>
                We do not sell your personal information, your images, your contacts, or your sales
                history.
              </li>
              <li>
                We do not use your photographs to train artificial-intelligence models for anyone
                else, and we do not license them to third parties.
              </li>
              <li>
                We do not share one photographer’s buyer relationships, prices, or deal history
                with another photographer in identifiable form.
              </li>
              <li>
                We do not show advertising, and we do not let advertisers target you based on your
                data.
              </li>
            </ul>

            <h2>5. When we share information</h2>
            <ul>
              <li>
                <strong>With buyers, at your direction:</strong> when you send a pitch, license an
                image, or deliver files, the recipient receives what you chose to send, under the
                terms you set.
              </li>
              <li>
                <strong>With service providers</strong> who help us run Mastline, such as cloud
                hosting, payment processing, email delivery, and image matching. They may use your
                data only to provide services to us.
              </li>
              <li>
                <strong>Within your team,</strong> according to the roles and permissions you
                configure.
              </li>
              <li>
                <strong>For legal reasons,</strong> if required by law, subpoena, or court order, or
                to protect the rights, safety, or property of Mastline, our users, or others. Where
                lawful, we will tell you first.
              </li>
              <li>
                <strong>In a business transfer,</strong> such as a merger or acquisition, under the
                same protections described here.
              </li>
            </ul>

            <h2>6. Confidential sources and sensitive content</h2>
            <p>
              We know that tips, locations, and identities can be sensitive. Source and location
              fields you mark confidential are visible only to the roles you allow, are excluded
              from any aggregated analysis, and are covered by access logs you can review. We will
              resist disclosure of confidential source information to the fullest extent the law
              allows and will notify you of any request unless legally prohibited.
            </p>

            <h2>7. Your rights and choices</h2>
            <p>
              Depending on where you live, you may have the right to access, correct, export,
              restrict, or delete your personal information, and to object to certain processing.
              Regardless of where you live, every Mastline account can export its complete data at
              any time from Settings, and you can delete your account and its contents. To exercise
              any other right, email <a href="mailto:privacy@mastline.co">privacy@mastline.co</a>.
              We will respond within the time required by applicable law.
            </p>
            <p>
              Residents of California, the European Economic Area, the United Kingdom, and other
              jurisdictions with specific privacy laws have additional rights including the right to
              lodge a complaint with a supervisory authority.
            </p>

            <h2>8. Retention</h2>
            <p>
              We keep your work and records for as long as your account is active, because the
              commercial history of an image is the product. After you close your account, we delete
              or de-identify your data within 30 days, except where we must keep it to meet legal,
              tax, or dispute-resolution obligations, or where you have asked us to retain license
              and provenance records as evidence.
            </p>

            <h2>9. Security</h2>
            <p>
              We encrypt data in transit and at rest, restrict access to production systems, log
              access to sensitive records, and test our defenses regularly. Our{" "}
              <Link href="/security">Security page</Link> describes our practices in more detail. No
              system is perfectly secure; if we learn of a breach affecting your information, we
              will notify you as required by law.
            </p>

            <h2>10. International transfers</h2>
            <p>
              Mastline is operated from the United States. If you use it from elsewhere, your
              information will be transferred to and processed in the United States and in the
              countries where our service providers operate, under appropriate safeguards such as
              standard contractual clauses.
            </p>

            <h2>11. Children</h2>
            <p>
              Mastline is a professional tool and is not directed to anyone under 18. We do not
              knowingly collect personal information from children.
            </p>

            <h2>12. Changes</h2>
            <p>
              When we change this policy, we will update the effective date above and, for material
              changes, notify you by email or inside the product before they take effect.
            </p>

            <h2>13. Contact</h2>
            <p>
              Storyworlding · 155 Prince Street, Floor 3, New York, NY 10012 ·{" "}
              <a href="mailto:privacy@mastline.co">privacy@mastline.co</a>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
