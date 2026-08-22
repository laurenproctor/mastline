import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / Terms
          </div>
          <h1>Terms of Service</h1>
          <p className="lede">
            The plain-English agreement between you and Mastline. The short version: your pictures
            are yours, you pay for the software, and we earn a share only on sales we help create.
          </p>
        </div>
      </section>
      <section>
        <div className="wrap">
          <div className="legal">
            <p className="meta">Effective August 21, 2026</p>

            <h2>1. The agreement</h2>
            <p>
              These Terms govern your use of the Mastline website and application (the
              &quot;Service&quot;), operated by Storyworlding (&quot;Mastline&quot;). By creating an
              account or using the Service you agree to these Terms and to our{" "}
              <Link href="/privacy">Privacy Policy</Link>. If you use Mastline on behalf of a team
              or agency, you confirm you have authority to bind it.
            </p>

            <h2>2. Your content stays yours</h2>
            <p>
              You retain all copyright and other rights in the photographs, video, captions,
              records, and other material you add to Mastline (&quot;Your Content&quot;). Mastline
              does not acquire ownership of Your Content, ever. You grant Mastline a limited,
              non-exclusive license to host, store, process, display, and transmit Your Content
              solely to operate the Service for you and at your direction, for example to render
              previews, generate watermarks, send pitches you approve, and deliver files under
              licenses you accept. This license ends when you delete the content or close your
              account, except for copies we must keep under Section 11.
            </p>
            <p>
              You are responsible for Your Content and confirm you have the rights needed to upload
              it and to license it through Mastline.
            </p>

            <h2>3. Sales, licenses, and the 70/30 split</h2>
            <ul>
              <li>
                <strong>Sales you make yourself.</strong> If you record, invoice, or track a sale in
                Mastline that you arranged through your own relationships, agency, or portal,
                Mastline charges no commission. You keep 100%.
              </li>
              <li>
                <strong>Sales made through Mastline.</strong> When an image is licensed through a
                Mastline opportunity, a pitch sent through the platform, or a buyer request Mastline
                helps close (a &quot;Mastline Sale&quot;), you receive 70% and Mastline receives 30%
                of the license fee, calculated after taxes, refunds, chargebacks, and discounts.
                Standard payment-processing costs are paid from Mastline&apos;s share.
              </li>
              <li>
                <strong>Licenses.</strong> You set the price and terms of every license. Mastline
                generates the license document from your choices and records the buyer&apos;s
                acceptance. Mastline is not a party to the license between you and the buyer.
              </li>
              <li>
                <strong>Payouts.</strong> Where Mastline collects payment on your behalf, we remit
                your share according to the payout schedule in your plan, less any amounts you owe
                us.
              </li>
            </ul>

            <h2>4. Plans, billing, and trials</h2>
            <p>
              Paid plans are billed monthly or annually in advance. Your 30-day trial converts to
              the plan you selected unless you cancel before it ends. You can change or cancel your
              plan at any time; changes take effect at the next billing cycle and annual plans are
              prorated as described on our <Link href="/pricing">Pricing page</Link>. Fees are
              non-refundable except where required by law. We may change prices with at least 30
              days&apos; notice.
            </p>

            <h2>5. Acceptable use</h2>
            <p>You agree not to use the Service to:</p>
            <ul>
              <li>
                upload content you do not have the right to use or license, or that infringes
                anyone&apos;s rights;
              </li>
              <li>
                harass, stalk, threaten, or endanger any person, or coordinate others to do so;
              </li>
              <li>
                collect or store information about individuals&apos; private locations or activities
                beyond what is lawful in the relevant jurisdiction;
              </li>
              <li>
                upload sexual or exploitative content involving minors, or any unlawful content;
              </li>
              <li>
                misrepresent the provenance of an image, or present altered or synthetic imagery as
                editorial;
              </li>
              <li>
                interfere with the Service, probe its security, or access another user&apos;s
                account or data without permission.
              </li>
            </ul>
            <p>
              We may suspend or terminate accounts that violate these rules, and we will cooperate
              with lawful requests from authorities in cases involving harm to any person. A
              plain-language summary is at <Link href="/acceptable-use">Acceptable use</Link>;
              copyright notices and counter-notices are handled under our{" "}
              <Link href="/copyright">Copyright and DMCA Policy</Link>, including termination of
              repeat infringers.
            </p>

            <h2>6. Suggestions are suggestions</h2>
            <p>
              Mastline offers automated suggestions such as captions, buyer fit, price bands,
              archive matches, and suspected rights matches. These are aids to your judgment. They
              may be wrong. You are responsible for reviewing and confirming every caption, pitch,
              price, license, invoice, and rights action before it goes out. Mastline does not
              provide legal advice, and a rights match is not a determination that any use is
              unauthorized.
            </p>

            <h2>7. Buyers and third parties</h2>
            <p>
              Editors and buyers who receive your pitches interact with Mastline through links you
              send. They are not required to hold accounts. We are not responsible for a
              buyer&apos;s decisions, payment behavior, or use of licensed material beyond what
              Mastline records. Third-party services you connect are governed by their own terms.
            </p>

            <h2>8. Teams</h2>
            <p>
              On team and agency plans, the account owner controls roles, permissions, and revenue
              splits, and is responsible for the actions of team members. Content uploaded by a team
              member is treated as the content of the account unless your team agreement with that
              member says otherwise; Mastline is not a party to that agreement.
            </p>

            <h2>9. Intellectual property of the Service</h2>
            <p>
              Mastline, its software, design, and trademarks belong to Mastline and its licensors.
              You may not copy, modify, reverse-engineer, or resell the Service. Feedback you give
              us may be used without obligation to you.
            </p>

            <h2>10. Availability and support</h2>
            <p>
              We work hard to keep Mastline available, especially at night when you need it, but we
              do not guarantee uninterrupted service. Support is available at{" "}
              <a href="mailto:support@mastline.co">support@mastline.co</a>.
            </p>

            <h2>11. Termination and your data</h2>
            <p>
              You may close your account at any time. We may suspend or terminate your account for
              breach of these Terms, with notice where practical. On termination, you can export all
              of Your Content and records for 30 days, after which we delete them as described in
              our Privacy Policy, except for license and provenance records we are required to keep
              or that you ask us to preserve as evidence.
            </p>

            <h2>12. Disclaimers and limitation of liability</h2>
            <p>
              The Service is provided &quot;as is&quot; and &quot;as available.&quot; To the fullest
              extent permitted by law, Mastline disclaims all warranties, express or implied, and is
              not liable for indirect, incidental, special, consequential, or punitive damages, or
              for lost profits, revenue, or data. Mastline&apos;s total liability for any claim
              arising from the Service will not exceed the greater of the fees you paid us in the
              twelve months before the claim or US$100. Some jurisdictions do not allow these
              limitations, in which case they apply to the maximum extent permitted.
            </p>

            <h2>13. Indemnity</h2>
            <p>
              You agree to defend and indemnify Mastline against claims arising from Your Content,
              your use of the Service, or your breach of these Terms, including claims by the
              subjects of your photographs or by buyers.
            </p>

            <h2>14. Governing law and disputes</h2>
            <p>
              These Terms are governed by the laws of the State of New York, without regard to
              conflict-of-law rules. Disputes will be resolved in the state or federal courts
              located in New York County, New York, and you consent to their jurisdiction.
            </p>

            <h2>15. Changes to these Terms</h2>
            <p>
              We may update these Terms. For material changes we will give at least 30 days&apos;
              notice by email or in the product. Continued use after the effective date means you
              accept the new Terms.
            </p>

            <h2>16. Contact</h2>
            <p>
              Storyworlding · 155 Prince Street, Floor 3, New York, NY 10012 ·{" "}
              <a href="mailto:legal@mastline.co">legal@mastline.co</a>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
