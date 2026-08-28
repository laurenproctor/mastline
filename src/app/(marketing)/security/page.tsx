import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Security" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / Security
          </div>
          <h1>Security at Mastline</h1>
          <p className="lede">
            Mastline holds unpublished pictures, confidential sources, buyer relationships, and
            money. Here is how it protects them.
          </p>
        </div>
      </section>
      <section>
        <div className="wrap">
          <div className="legal">
            <p className="meta">Last reviewed August 21, 2026</p>

            <h2>Encryption</h2>
            <p>
              All traffic between photographers’ devices, buyers’ devices, and Mastline is encrypted
              with TLS 1.2 or higher. Files and records are encrypted at rest using AES-256.
              Encryption keys are managed through the cloud provider’s key-management service and
              rotated on a schedule.
            </p>

            <h2>Originals are immutable</h2>
            <p>
              Every original is stored write-once. Every derivative, preview, watermark, and edit is
              generated from it and recorded separately, so the original and its capture metadata
              are always available as evidence of what was shot and when.
            </p>

            <h2>Full-resolution files are gated</h2>
            <p>
              Buyers see watermarked previews. Full-resolution files are released only after the
              terms are accepted, through a time-limited link made for a single recipient, and every
              download is logged against that link with the time and the address it came from. The
              log sits on the deal.
            </p>
            <p>
              What that log records is which link was used, not who was holding it. Links get
              forwarded and desks share logins, so Mastline does not claim to know the person at the
              other end. The one moment somebody identifies themselves is when they accept the
              terms, and the name they give is kept with the acceptance, alongside the wording they
              agreed to.
            </p>

            <h2>Access control</h2>
            <ul>
              <li>
                Role-based permissions separate owner, editor, dispatcher, finance, and
                rights-review access.
              </li>
              <li>
                Confidential source and location fields have their own visibility controls and
                access logs.
              </li>
              <li>
                Two-factor authentication is available for every account and required for team
                owners and finance roles.
              </li>
              <li>
                Mastline staff access to customer data is restricted to named engineers, requires a
                documented reason, and is logged and reviewed.
              </li>
            </ul>

            <h2>Audit trail</h2>
            <p>
              Consequential actions, including sending a pitch, accepting a license, releasing
              files, issuing an invoice, and changing permissions, are written to an append-only
              event log that cannot be edited or deleted by any user, Mastline included.
            </p>

            <h2>Infrastructure</h2>
            <p>
              Mastline runs on [CLOUD PROVIDER] in [REGION], in facilities certified to SOC 2 and
              ISO 27001. Production systems are isolated from development, protected by network
              controls and a web application firewall, and monitored around the clock. Backups are
              taken continuously, encrypted, stored in a separate region, and tested for restoration
              on a regular schedule.
            </p>

            <h2>Application security</h2>
            <p>
              Code changes are peer-reviewed and pass automated security checks before deployment.
              Dependencies are scanned and patched continuously. Mastline engages independent
              penetration testers at least annually and fix findings on defined timelines.
            </p>

            <h2>Payments</h2>
            <p>
              Card and bank details are handled by Stripe, a PCI DSS Level 1 service provider.
              Mastline never stores full card numbers.
            </p>

            <h2>The record, under its owner’s control</h2>
            <ul>
              <li>
                Export everything, including originals, records, licenses, and invoices, at any time
                from Settings.
              </li>
              <li>
                Delete content or an entire account at any time; deletion propagates to backups
                within 90 days.
              </li>
              <li>Set retention rules for sensitive fields on team plans.</li>
            </ul>

            <h2>Incident response</h2>
            <p>
              Mastline maintains a written incident-response plan and rehearses it. If an incident
              affects a workspace, it notifies the account without undue delay and within any
              timeframe required by law, says what happened and what is being done, and provides
              what is needed to respond.
            </p>

            <h2>Reporting a vulnerability</h2>
            <p>
              Security issues can be reported to{" "}
              <a href="mailto:security@mastline.co">security@mastline.co</a>. Every report is read,
              respond within two business days, and will not pursue legal action against good-faith
              researchers who respect user privacy and allow reasonable time for a fix.
            </p>

            <h2>Questions</h2>
            <p>
              Security questionnaires, data-processing agreements, and compliance documentation are
              available on request at <a href="mailto:security@mastline.co">security@mastline.co</a>
              .
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
