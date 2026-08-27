import type { Metadata } from "next";
import Link from "next/link";
import { RoleAccess } from "../_components/role-access";

export const metadata: Metadata = { title: "Trust" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / Trust
          </div>
          <h1>Trust is built into the product.</h1>
          <p className="lede">
            Mastline handles commercially sensitive media, locations, subjects, buyer relationships,
            financial records, and potential legal evidence. It stores facts and routes decisions;
            it does not imply universal legal conclusions.
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="trust" data-rv-group>
            <div>
              <b>Provenance and chain of custody</b>
              <p>
                Originals, capture metadata, import history, edits, derivatives, and user actions
                are preserved.
              </p>
            </div>
            <div>
              <b>Role-based access</b>
              <p>
                Separate owner, editor, dispatcher, finance, and legal or rights-review permissions.
              </p>
            </div>
            <div>
              <b>Security and resilience</b>
              <p>
                Data encrypted in transit and at rest, backups maintained, export supported, and
                clear retention controls.
              </p>
            </div>
            <div>
              <b>Human review</b>
              <p>
                Confirmation before outbound submissions, legal escalation, invoices, takedown
                notices, or any consequential action.
              </p>
            </div>
            <div>
              <b>Jurisdiction-aware rights workflows</b>
              <p>
                Usage, privacy, publicity, copyright, and licensing rules vary by place. Workflows
                store facts and route decisions accordingly.
              </p>
            </div>
            <div>
              <b>Source protection</b>
              <p>
                Confidential tips, locations, and identities get deliberate visibility controls and
                audit logs.
              </p>
            </div>
            <div>
              <b>Responsible automation</b>
              <p>
                AI-generated metadata and matches are labeled as suggestions, with confidence and
                editable evidence.
              </p>
            </div>
            <div>
              <b>Not a legal decision-maker</b>
              <p>
                Rights matches and claim recommendations always require human review and
                counsel-defined policies.
              </p>
            </div>
            <div>
              <b>Exportable in full</b>
              <p>
                The commercial record belongs to the photographer. It can be exported in full at any
                time.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Role-based access</span>
              <h2>Who may do what, and who may never see a source.</h2>
            </div>
            <p className="lede">
              A workspace is not one login shared around. Pick a role to see exactly what it can
              reach. These answers are read from the capability table the database policies mirror,
              not written for this page.
            </p>
          </div>
          <RoleAccess />
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Where the line is drawn</span>
              <h2>What Mastline will never do.</h2>
            </div>
            <p className="lede">
              Mastline helps sell pictures taken in public. It is not a tool for following people,
              and outlets can accept pitches through it knowing that.
            </p>
          </div>
          <div className="never" data-rv-group>
            <div>
              <span>
                <b>No real-time tracking of individuals.</b> The news radar reads public signals:
                premieres, court calendars, published stories, public appearances. It does not
                locate people.
              </span>
            </div>
            <div>
              <span>
                <b>No scraping of private accounts</b> or private messages, and no storing of
                anyone’s home address as a “signal.”
              </span>
            </div>
            <div>
              <span>
                <b>No coordinating shooters onto a target.</b> Stored tips and locations belong to
                one workspace and are never pooled across accounts.
              </span>
            </div>
            <div>
              <span>
                <b>No altered or synthetic imagery presented as editorial.</b> Edits beyond standard
                tone and crop are flagged in the picture’s provenance.
              </span>
            </div>
            <div>
              <span>
                <b>No automated legal action.</b> Takedowns, invoices, and escalations always wait
                for a human to press send.
              </span>
            </div>
            <div>
              <span>
                <b>No selling data.</b> Not images, not contacts, not deal history, not to anyone.
              </span>
            </div>
          </div>
          <p style={{ marginTop: "18px", fontSize: "14px", color: "var(--ink-3)" }}>
            The short rules: <Link href="/acceptable-use">Acceptable use</Link>. For copyright
            matters: <Link href="/copyright">Copyright and DMCA Policy</Link>. For anyone appearing
            in a photograph handled through Mastline: <Link href="/subjects">start here</Link>.
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Support at working hours</span>
              <h2>A human at 1 a.m., because that’s when it matters.</h2>
            </div>
            <p className="lede">
              Live chat and phone support run [SUPPORT HOURS] every night of the week, staffed by
              people who know what an exclusive window is. Email is answered around the clock, and
              anything that blocks a sale in progress is treated as urgent. Reach support at{" "}
              <a href="mailto:support@mastline.co">support@mastline.co</a>.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head">
            <div>
              <span className="mk-eyebrow">Product principles</span>
              <h2>What Mastline holds itself to.</h2>
            </div>
          </div>
          <div className="principles" data-rv-group>
            <div>
              <h3>Speed under pressure</h3>
              <p>
                Defaults, keyboard actions, bulk operations, mobile use, and clear next actions.
              </p>
            </div>
            <div>
              <h3>One fact, entered once</h3>
              <p>
                Records inherit context across the workflow instead of asking for the same metadata
                twice.
              </p>
            </div>
            <div>
              <h3>Every image has a commercial memory</h3>
              <p>
                The asset record outlives any individual submission, folder, or agency relationship.
              </p>
            </div>
            <div>
              <h3>Revenue is visible</h3>
              <p>
                Financial truth is tied back to buyers, submissions, shoots, and assets, not stored
                only in a separate ledger.
              </p>
            </div>
            <div>
              <h3>Automation remains accountable</h3>
              <p>Suggestions carry confidence and evidence; a person makes the final call.</p>
            </div>
            <div>
              <h3>Scope discipline</h3>
              <p>
                Every expansion must strengthen speed, commercial memory, revenue visibility, or
                control over owned work.
              </p>
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
